import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import { encrypt } from "./crypto";
import { deploymentProposalGrantHash, getOwnerDeploymentProposal } from "./agent-enrollment";
import { captureFirstLaunchConfiguration } from "./agent-first-launch-config";

export function normalizeProposalConfiguration(raw: unknown) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("Invalid configuration request");
  const body = raw as Record<string,unknown>;
  if (Object.keys(body).some(k=>!["contentHash","expectedRevision","values","removeKeys"].includes(k)) || typeof body.contentHash !== "string" || !/^[a-f0-9]{64}$/.test(body.contentHash) || !Number.isSafeInteger(body.expectedRevision) || Number(body.expectedRevision)<0 || !Array.isArray(body.values) || body.values.length>200) throw new Error("Invalid configuration request");
  const seen=new Set<string>();
  const values=body.values.map(rawItem=>{
    if (!rawItem || typeof rawItem!=="object" || Array.isArray(rawItem)) throw new Error("Invalid service configuration entry");
    const item=rawItem as Record<string,unknown>;
    if(Object.keys(item).some(k=>!["service","key","value","required"].includes(k)) || typeof item.service!=="string" || !/^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/.test(item.service) || typeof item.key!=="string" || !/^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(item.key) || typeof item.value!=="string" || item.value.includes("\0") || Buffer.byteLength(item.value)>65536 || typeof item.required!=="boolean") throw new Error("Invalid service configuration entry");
    const identity=`${item.service}:${item.key}`;
    if(seen.has(identity)) throw new Error("Invalid duplicate configuration key");seen.add(identity);
    return {service:item.service,key:item.key,value:item.value,required:item.required};
  });
  if(body.removeKeys!==undefined && (!Array.isArray(body.removeKeys) || body.removeKeys.length>200)) throw new Error("Invalid configuration removals");
  const removeKeys=((body.removeKeys || []) as unknown[]).map(rawItem=>{
    if(!rawItem || typeof rawItem!=="object" || Array.isArray(rawItem)) throw new Error("Invalid configuration removal");
    const item=rawItem as Record<string,unknown>;
    if(Object.keys(item).some(k=>!["service","key"].includes(k)) || typeof item.service!=="string" || !/^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/.test(item.service) || typeof item.key!=="string" || !/^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(item.key)) throw new Error("Invalid configuration removal");
    const identity=`${item.service}:${item.key}`;
    if(seen.has(identity)) throw new Error("Invalid duplicate configuration key");seen.add(identity);
    return {service:item.service,key:item.key};
  });
  return {contentHash:body.contentHash,expectedRevision:Number(body.expectedRevision),values,removeKeys};
}
/** Explicit owner values only. Never import another deployment's configuration. */
export async function saveProposalConfiguration(userId:number,proposalId:string,raw:unknown) {
  const body=normalizeProposalConfiguration(raw);
  const owner=await getOwnerDeploymentProposal(userId,proposalId);
  if(owner.status!=="pending" || owner.contentHash!==body.contentHash) throw new Error("Proposal changed or was accepted; start a new review");
  return prisma.$transaction(async tx=>{
    const proposal=await tx.agentDeploymentProposal.findUnique({where:{id:proposalId}});
    const grant=proposal && await tx.oAuthGrant.findUnique({where:{id:proposal.grantId},include:{user:true}});
    if(!proposal || proposal.userId!==userId || proposal.status!=="pending" || proposal.expiresAt<=new Date() || proposal.contentHash!==body.contentHash || !grant || grant.revokedAt || grant.userId!==userId || grant.user.role!=="admin" || grant.user.forcePasswordChange || deploymentProposalGrantHash(grant)!==proposal.grantHash) throw new Error("Proposal authorization changed");
    let mapping=await tx.agentProposalConfiguration.findUnique({where:{proposalId}});
    if(mapping && (mapping.userId!==userId || mapping.revision!==body.expectedRevision)) throw new Error("Review configuration changed; reload before saving");
    if(!mapping){
      if(body.expectedRevision!==0) throw new Error("Review configuration changed; reload before saving");
      const suffix=createHash("sha256").update(proposalId).digest("hex");
      const project=await tx.project.create({data:{slug:`gc-proposal-${suffix}`,name:`Candidate ${owner.input.workloadName}`,path:`/srv/groundcontrol/deployments/proposal-${suffix}`,repoUrl:owner.input.repositoryUrl,category:"docker",status:"draft"}});
      const profile=await tx.deploymentEnvProfile.create({data:{projectId:project.id,name:"Candidate configuration",slug:"candidate",providerType:"local",schemaJson:"[]",isDefault:true}});
      mapping=await tx.agentProposalConfiguration.create({data:{proposalId,projectId:project.id,profileId:profile.id,userId}});
    }
    const profile=await tx.deploymentEnvProfile.findUnique({where:{id:mapping.profileId}});
    if(!profile || profile.projectId!==mapping.projectId || profile.providerType!=="local") throw new Error("Review configuration profile changed");
    const existing=await tx.deploymentEnvValue.findMany({where:{profileId:mapping.profileId}});
    // Patch only explicitly supplied keys. Omitted candidate values are preserved.
    for(const row of existing){
      if(!body.removeKeys.some(item=>item.service===row.component && item.key===row.key)) continue;
      const latest=await tx.deploymentEnvValueVersion.aggregate({where:{profileId:mapping.profileId,component:row.component,key:row.key},_max:{version:true}});
      await tx.deploymentEnvValueVersion.create({data:{profileId:mapping.profileId,component:row.component,key:row.key,value:"",version:(latest._max.version||0)+1,state:"deleted",source:"local"}});
      await tx.deploymentEnvValue.delete({where:{id:row.id}});
    }
    for(const item of body.values){
      const latest=await tx.deploymentEnvValueVersion.aggregate({where:{profileId:mapping.profileId,component:item.service,key:item.key},_max:{version:true}});
      const version=(latest._max.version||0)+1;
      const value=encrypt(item.value); // Always encrypt input, even if it resembles an envelope.
      await tx.deploymentEnvValueVersion.create({data:{profileId:mapping.profileId,component:item.service,key:item.key,value,version,state:"active",source:"local"}});
      await tx.deploymentEnvValue.upsert({where:{profileId_component_key:{profileId:mapping.profileId,component:item.service,key:item.key}},create:{profileId:mapping.profileId,component:item.service,key:item.key,value,version,required:item.required,source:"local"},update:{value,version,required:item.required,source:"local"}});
    }
    const savedRows=await tx.deploymentEnvValue.findMany({where:{profileId:mapping.profileId},select:{component:true,key:true,required:true,version:true}});
    if(savedRows.length>200) throw new Error("Invalid configuration key count; limit candidate configuration to 200 keys");
    const schema=savedRows.map(({component,key,required})=>({component,key,required}));
    await tx.deploymentEnvProfile.update({where:{id:mapping.profileId},data:{schemaJson:JSON.stringify(schema),status:"stale"}});
    const updated=await tx.agentProposalConfiguration.update({where:{proposalId},data:{revision:{increment:1}}});
    return {revision:updated.revision,projectId:mapping.projectId,profileId:mapping.profileId,keys:savedRows.map(({component,key,required,version})=>({service:component,key,required,version,saved:true})),notice:"Saved only to this candidate's encrypted configuration. Review again before accepting or launching."};
  },{isolationLevel:Prisma.TransactionIsolationLevel.Serializable});
}
export async function captureProposalConfiguration(userId:number,proposalId:string,services:string[]) {
  const mapping=await prisma.agentProposalConfiguration.findUnique({where:{proposalId}});
  if(!mapping) return null;
  if(mapping.userId!==userId) throw new Error("Proposal configuration owner changed");
  const rows=await prisma.deploymentEnvValue.findMany({where:{profileId:mapping.profileId},select:{component:true,key:true,required:true}});
  const captured=await captureFirstLaunchConfiguration(userId,mapping.projectId,mapping.profileId,rows.map(row=>({service:row.component,key:row.key,required:row.required})),services);
  return {...captured,revision:mapping.revision};
}
export async function proposalConfigurationStatus(userId:number,proposalId:string) {
  await getOwnerDeploymentProposal(userId,proposalId);
  const mapping=await prisma.agentProposalConfiguration.findUnique({where:{proposalId}});
  if(!mapping) return {revision:0,keys:[]};
  if(mapping.userId!==userId) throw new Error("Proposal configuration owner changed");
  const rows=await prisma.deploymentEnvValue.findMany({where:{profileId:mapping.profileId},select:{component:true,key:true,required:true,version:true}});
  return {revision:mapping.revision,projectId:mapping.projectId,profileId:mapping.profileId,keys:rows.map(row=>({service:row.component,key:row.key,required:row.required,version:row.version,saved:true})),notice:"Values are hidden. Saving changes only submitted keys; omitted candidate values are preserved. Removal requires an explicit removeKeys entry."};
}
