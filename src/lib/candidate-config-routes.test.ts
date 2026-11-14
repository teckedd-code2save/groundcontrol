// @vitest-environment node
import {beforeEach,expect,it,vi} from "vitest";
import {NextRequest} from "next/server";
const mocks=vi.hoisted(()=>({user:{id:2,role:"admin"},mapping:vi.fn(),fresh:vi.fn(),project:vi.fn(),profile:vi.fn(),resolve:vi.fn(),values:vi.fn()}));
vi.mock("./prisma",()=>({prisma:{agentProposalConfiguration:{findFirst:mocks.mapping},user:{findUnique:mocks.fresh},project:{findUnique:mocks.project},deploymentEnvProfile:{findUnique:mocks.profile}}}));
vi.mock("./auth",()=>({requireAuth:()=>mocks.user}));
vi.mock("./env-management",()=>({resolveDeploymentEnv:mocks.resolve,getProfileValues:mocks.values}));
import {GET as getProfiles,POST as saveProfile} from "@/app/api/env/profiles/route";
import {GET as exportProfile} from "@/app/api/env/profiles/[id]/export/route";
import {POST as validateProfile} from "@/app/api/env/profiles/[id]/validate/route";
import {POST as syncProfile} from "@/app/api/env/profiles/[id]/sync/route";
import {POST as materializeProfile} from "@/app/api/env/profiles/[id]/materialize/route";
beforeEach(()=>{vi.clearAllMocks();mocks.user={id:2,role:"admin"};mocks.mapping.mockResolvedValue({projectId:2,profileId:3,userId:1});mocks.project.mockResolvedValue({id:2});mocks.profile.mockResolvedValue({id:3,projectId:2,project:{id:2}});mocks.fresh.mockResolvedValue({role:"admin",forcePasswordChange:false});});
it.each([
 ["profiles GET",(r:NextRequest)=>getProfiles(r)],
 ["profiles POST",(r:NextRequest)=>saveProfile(r)],
 ["export",(r:NextRequest)=>exportProfile(r,{params:Promise.resolve({id:"3"})})],
 ["validate",(r:NextRequest)=>validateProfile(r,{params:Promise.resolve({id:"3"})})],
 ["sync",(r:NextRequest)=>syncProfile(r,{params:Promise.resolve({id:"3"})})],
 ["materialize",(r:NextRequest)=>materializeProfile(r,{params:Promise.resolve({id:"3"})})],
] as const)("%s rejects other administrator before any decrypted values are loaded",async(_name,run)=>{
 const response=await run(new NextRequest("https://gc.example/api/env/profiles?projectId=2",{method:"POST",body:JSON.stringify({projectId:2})}));
 expect(response.status).toBe(403);expect(mocks.resolve).not.toHaveBeenCalled();expect(mocks.values).not.toHaveBeenCalled();
});
it.each([{role:"viewer"},{role:"admin",forcePasswordChange:true}])("rejects stale JWT admin from profile reads: %j",async fresh=>{
 mocks.user={id:1,role:"admin"};mocks.fresh.mockResolvedValue(fresh);
 const response=await getProfiles(new NextRequest("https://gc.example/api/env/profiles?projectId=2"));
 expect(response.status).toBe(403);expect(mocks.values).not.toHaveBeenCalled();
});

it("does not materialize candidate secrets on the generic active-host path even for owner",async()=>{
 mocks.user={id:1,role:"admin"};
 const response=await materializeProfile(new NextRequest("https://gc.example/api/env/profiles/3/materialize",{method:"POST"}),{params:Promise.resolve({id:"3"})});
 expect(response.status).toBe(409);expect(mocks.resolve).not.toHaveBeenCalled();
});
