// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest";
const db=vi.hoisted(()=>({agentProposalConfiguration:{findFirst:vi.fn()},user:{findUnique:vi.fn()}}));
vi.mock("./prisma",()=>({prisma:db}));
import { requireCandidateConfigOwner } from "./candidate-config-access";
beforeEach(()=>{vi.resetAllMocks();db.agentProposalConfiguration.findFirst.mockResolvedValue({projectId:2,profileId:3,userId:1});db.user.findUnique.mockResolvedValue({id:1,role:"admin",forcePasswordChange:false});});
it("requires a fresh administrator record for the matching candidate owner",async()=>{
 expect(await requireCandidateConfigOwner(1,2,3)).toMatchObject({userId:1});expect(db.user.findUnique).toHaveBeenCalledWith({where:{id:1}});
});
it.each([2,null])("rejects other owners and pipeline-only tokens: %s",async userId=>{
 await expect(requireCandidateConfigOwner(userId,2,3)).rejects.toMatchObject({status:403});expect(db.user.findUnique).not.toHaveBeenCalled();
});
it.each([{role:"viewer"},{role:"admin",forcePasswordChange:true},null])("rejects revoked admin/password state %j",async user=>{
 db.user.findUnique.mockResolvedValue(user);await expect(requireCandidateConfigOwner(1,2,3)).rejects.toMatchObject({status:403});
});
it("rejects a mapped profile supplied for another project",async()=>{await expect(requireCandidateConfigOwner(1,999,3)).rejects.toMatchObject({status:403});});
it("preserves existing noncandidate authorization behavior",async()=>{db.agentProposalConfiguration.findFirst.mockResolvedValue(null);expect(await requireCandidateConfigOwner(null,99)).toBeNull();expect(db.user.findUnique).not.toHaveBeenCalled();});
it("blocks generic candidate apply/release for owner and preserves noncandidate mutations",async()=>{
 const {rejectCandidateLegacyMutation}=await import("./candidate-config-access");
 await expect(rejectCandidateLegacyMutation(1,2)).rejects.toMatchObject({status:409});
 db.agentProposalConfiguration.findFirst.mockResolvedValue(null);
 await expect(rejectCandidateLegacyMutation(null,99)).resolves.toBeUndefined();
});
