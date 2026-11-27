// @vitest-environment node
import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { PrismaClient } from "@prisma/client";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
const exec = vi.hoisted(() => vi.fn());
vi.mock("./host-exec", () => ({ execOnTargetStrict: exec }));
import { claimPreparationRetry } from "./template-preparation-retry";
let db: PrismaClient;
let directory: string;
let input: Parameters<typeof claimPreparationRetry>[0];
beforeAll(async () => {
  directory = mkdtempSync(join(tmpdir(), "gc-retry-test-"));
  writeFileSync(join(directory, "test.db"), "");
  const url = `file:${join(directory, "test.db")}`;
  execFileSync(process.execPath, ["node_modules/prisma/build/index.js", "db", "push", "--skip-generate"], { env: { ...process.env, DATABASE_URL: url }, stdio: "pipe" });
  db = new PrismaClient({ datasources: { db: { url } } });
}, 30000);
afterAll(async () => { await db?.$disconnect(); if (directory) rmSync(directory, { recursive: true, force: true }); });
beforeEach(async () => {
  vi.clearAllMocks(); exec.mockResolvedValue({ code: 0, stdout: "", stderr: "" });
  await db.project.deleteMany(); await db.projectGroup.deleteMany(); await db.vpsConfig.deleteMany(); await db.deploymentTarget.deleteMany();
  const host = await db.vpsConfig.create({ data: { name: "host", host: "203.0.113.10", isLocal: true } });
  const group = await db.projectGroup.create({ data: { name: "Portal", slug: "portal" } });
  const project = await db.project.create({ data: {
    slug: "portal-production", name: "portal", path: "/srv/portal", status: "pending", projectGroupId: group.id,
    repoUrl: "https://github.com/team/portal", domain: "portal.example.com",
    envVars: JSON.stringify({ source: { repoUrl: "https://github.com/team/portal", branch: "main" } }),
  } });
  const existing = await db.enrolledDeployment.create({ data: {
    name: "portal", slug: project.slug, kind: "compose", managementMode: "managed", status: "active",
    sourcePath: project.path, composePath: "/srv/portal/compose.yml", vpsConfigId: host.id, projectGroupId: group.id, legacyProjectId: project.id,
    metadataJson: JSON.stringify({ source: "template", templateName: "vps-caddy-existing-compose", composeProject: "gc_portal" }),
  } });
  const target = await db.deploymentTarget.create({ data: { name: "host", type: "compose", vpsConfigId: host.id } });
  await db.deployment.create({ data: { projectId: project.id, targetId: target.id, status: "pending", output: JSON.stringify({ upOutput: { stdout: "Image delivery prepared; runtime has not started." } }) } });
  input = { existing, project, projectGroupId: group.id, templateName: "vps-caddy-existing-compose", repoUrl: project.repoUrl!, branch: "main", domain: project.domain!, sourcePath: project.path, composePath: existing.composePath!, composeProject: "gc_portal", vps: { id: host.id, host: host.host, port: 22, username: "root", isLocal: true } };
});
it("claims a partial preparation once and preserves its identity", async () => {
  const results = await Promise.allSettled([claimPreparationRetry(input, db), claimPreparationRetry(input, db)]);
  expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
  expect(await db.enrolledDeployment.count()).toBe(1);
  expect((await db.enrolledDeployment.findUniqueOrThrow({ where: { id: input.existing!.id } })).status).toBe("preparing");
  for (const result of results) if (result.status === "fulfilled") await result.value();
  expect((await db.enrolledDeployment.findUniqueOrThrow({ where: { id: input.existing!.id } })).status).toBe("active");
});
it.each(["repoUrl", "branch", "domain", "sourcePath", "composePath", "composeProject"] as const)("refuses a changed %s", async field => {
  await expect(claimPreparationRetry({ ...input, [field]: "different" }, db)).rejects.toThrow(/already exists/);
  expect(exec).not.toHaveBeenCalled();
});
it("refuses a different host and previously successful release", async () => {
  await expect(claimPreparationRetry({ ...input, vps: { ...input.vps, id: input.vps.id + 1 } }, db)).rejects.toThrow(/already exists/);
  await db.deployment.updateMany({ data: { status: "success" } });
  await expect(claimPreparationRetry(input, db)).rejects.toThrow(/already exists/);
  expect(exec).not.toHaveBeenCalled();
});
it.each([{ code: 0, stdout: "container-id", stderr: "" }, { code: 1, stdout: "", stderr: "unavailable" }])("refuses existing or uninspectable containers and releases its claim", async result => {
  exec.mockResolvedValue(result);
  await expect(claimPreparationRetry(input, db)).rejects.toThrow(/containers or its runtime/);
  expect((await db.enrolledDeployment.findUniqueOrThrow({ where: { id: input.existing!.id } })).status).toBe("active");
});
it("refuses a pending or uncertain delivery operation", async () => {
  // Count is the only simulated DB boundary here; other tests exercise real SQLite claims.
  const count = vi.spyOn(db.agentOperation, "count").mockResolvedValue(1);
  await expect(claimPreparationRetry(input, db)).rejects.toThrow(/already exists/);
  expect(count).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ status: { notIn: ["failed", "cancelled"] } }) }));
  expect(exec).not.toHaveBeenCalled(); count.mockRestore();
});
