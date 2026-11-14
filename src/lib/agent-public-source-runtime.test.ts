// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ claim: vi.fn(), run: vi.fn(), finish: vi.fn(), record: vi.fn(), binding: vi.fn(), verify: vi.fn() }));
vi.mock("./agent-public-source-update", () => ({ claimAgentPublicSourceUpdate: mocks.claim, recordPublicSourceUpdateEvidence: mocks.record, finishAgentPublicSourceUpdate: mocks.finish }));
vi.mock("./agent-first-deploy-execution", () => ({ executeAgentPublicSourceUpdate: mocks.run }));
vi.mock("./agent-app-domain-publish", () => ({ getActiveAppDomainBinding: mocks.binding, verifyActiveAppDomainBinding: mocks.verify }));
import { executeRuntimeOperation } from "./agent-runtime-execution";
const binding = { publicationId: "domain1", hostname: "app.example.test", marker: "public-route-marker" };
const target = { deployment: { id: 1, kind: "compose" }, operation: { id: "op", type: "deployment.source.deploy", grantId: 2, grant: { userId: 3 } }, input: { publicSourceRecipe: true, appDomainBinding: binding } } as unknown as Parameters<typeof executeRuntimeOperation>[0];
beforeEach(() => {
  vi.resetAllMocks(); mocks.claim.mockResolvedValue({ recipe: {}, update: {}, vps: {} });
  mocks.binding.mockResolvedValue(binding); mocks.verify.mockResolvedValue({ checked: true, healthy: true });
  mocks.run.mockImplementation(async (_r,_u,_v,record) => { await record({ phase: "launch" }); return { success: true, status: "success", hostMutation: "confirmed", publicVerified: false }; });
});
it("requires separately published trusted HTTPS health before declaring public success",async()=>{
 const result=await executeRuntimeOperation(target);
 expect(result).toMatchObject({success:true,publicVerified:true,applied:true});
 expect(mocks.verify).toHaveBeenCalledWith(3,1,binding);
 expect(mocks.binding).toHaveBeenCalledTimes(2);
});
it("does not call loopback success public success if route verification fails",async()=>{
 mocks.verify.mockResolvedValue({checked:true,healthy:false});
 const result=await executeRuntimeOperation(target);
 expect(result).toMatchObject({success:false,status:"failed",publicVerified:false,applied:true});
 expect(mocks.finish).toHaveBeenCalledWith(1,"op",expect.objectContaining({success:false}));
});
it("rejects changed route before any claim and never republishes it",async()=>{
 mocks.binding.mockResolvedValue({...binding,hostname:"other.example.test"});
 await expect(executeRuntimeOperation(target)).rejects.toThrow("domain binding changed");
 expect(mocks.claim).not.toHaveBeenCalled();expect(mocks.run).not.toHaveBeenCalled();
});
it("keeps no-domain updates explicitly loopback-only",async()=>{
 mocks.binding.mockResolvedValue(null);
 const result=await executeRuntimeOperation({...target,input:{...target.input,appDomainBinding:null}});
 expect(result).toMatchObject({success:true,publicVerified:false});expect(mocks.verify).not.toHaveBeenCalled();
});
