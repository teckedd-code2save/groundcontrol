// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest";
const db = vi.hoisted(() => ({ user: { findUnique: vi.fn() }, deploymentEnvProfile: { findFirst: vi.fn() }, deploymentEnvValue: { findUnique: vi.fn() }, deploymentEnvValueVersion: { findUnique: vi.fn() } }));
vi.mock("./prisma", () => ({ prisma: db }));
vi.mock("./crypto", () => ({ isEncrypted: (v: string) => v.startsWith("enc:"), decrypt: () => "SECRET_VALUE" }));
import { captureFirstLaunchConfiguration, resolveFirstLaunchConfiguration } from "./agent-first-launch-config";
const key = { service: "app", key: "DATABASE_URL", required: true };
const version = { id: 10, profileId: 3, component: "app", key: "DATABASE_URL", value: "enc:ciphertext", version: 2, state: "active" };
beforeEach(()=>{vi.resetAllMocks();db.user.findUnique.mockResolvedValue({role:"admin"});db.deploymentEnvProfile.findFirst.mockResolvedValue({providerType:"local"});db.deploymentEnvValue.findUnique.mockResolvedValue(version);db.deploymentEnvValueVersion.findUnique.mockResolvedValue(version);});
it("captures only references, never ciphertext, plaintext or unexpected fields",async()=>{
 const result=await captureFirstLaunchConfiguration(1,2,3,[{...key,value:"SECRET_INPUT"} as typeof key],["app"]);
 expect(result.configuration.bindings).toEqual([{...key,versionId:10,version:2}]);
 expect(JSON.stringify(result)).not.toMatch(/SECRET|ciphertext/);
 expect(await resolveFirstLaunchConfiguration(1,result.configuration,2,["app"])).toEqual({app:{DATABASE_URL:"SECRET_VALUE"}});
});
it("reports required missing service keys without guessing shared configuration",async()=>{
 db.deploymentEnvValue.findUnique.mockResolvedValue(null);
 const result=await captureFirstLaunchConfiguration(1,2,3,[key],["app"]);
 expect(result.missing).toEqual([key]);expect(result.configuration.bindings).toEqual([]);
});
it("requires re-review after modification or deletion, never loads latest secrets silently",async()=>{
 const {configuration}=await captureFirstLaunchConfiguration(1,2,3,[key],["app"]);
 db.deploymentEnvValue.findUnique.mockResolvedValue({...version,version:3});
 await expect(resolveFirstLaunchConfiguration(1,configuration,2,["app"])).rejects.toThrow(/changed or removed/);
 db.deploymentEnvValue.findUnique.mockResolvedValue(null);
 await expect(resolveFirstLaunchConfiguration(1,configuration,2,["app"])).rejects.toThrow(/changed or removed/);
});
it("rejects wrong owner role, profile, service or project",async()=>{
 await expect(captureFirstLaunchConfiguration(1,2,3,[key],["other"])).rejects.toThrow(/declaration/);
 db.user.findUnique.mockResolvedValue({role:"user"});await expect(captureFirstLaunchConfiguration(1,2,3,[key],["app"])).rejects.toThrow(/administrator/);
});
