// @vitest-environment node
import { describe, expect, it } from "vitest";
import { runtimeCapabilities, runtimeIdentity, staticRecipe } from "./agent-runtime-capabilities";

const compose = { kind: "compose", vpsConfigId: 7, composePath: "/srv/demo/compose.yml", githubRepositories: [{}] };
const site = { kind: "static", vpsConfigId: 7, sourcePath: "/src/site", legacyProject: { id: 2, path: "/www/site", category: "static", outputDir: "dist", buildCommand: "npm run build" } };
describe("runtime capabilities", () => {
  it.each(["track", "managed"])("supports native and generated Compose in %s mode", (managementMode) => {
    const d = { ...compose, managementMode };
    expect(Object.entries(runtimeCapabilities(d).operations).filter(([name]) => name !== "deployment.first_launch").every(([, op]) => op.supported)).toBe(true);
    expect(runtimeCapabilities({ ...d, kind: "app", composePath: null, sourcePath: "/srv/demo", legacyProject: { id: 1, path: "/srv/demo", category: "docker", dockerCompose: "services: {}" } }).operations["deployment.redeploy"].supported).toBe(true);
  });
  it("offers standalone restart without inventing an image recreate recipe", () => {
    const capabilities = runtimeCapabilities({ kind: "container", vpsConfigId: 7, containerName: "demo" });
    expect(capabilities.operations["deployment.restart"].supported).toBe(true);
    expect(capabilities.operations["deployment.redeploy"].supported).toBe(false);
    expect(capabilities.operations["deployment.build_publish"].supported).toBe(false);
  });
  it("supports saved static publication and linked source without container operations", () => {
    const capabilities = runtimeCapabilities({ ...site, githubRepositories: [{}] });
    expect(capabilities.operations["deployment.redeploy"].supported).toBe(true);
    expect(capabilities.operations["deployment.source.deploy"].supported).toBe(true);
    expect(capabilities.operations["deployment.restart"].supported).toBe(false);
    expect(capabilities.operations["deployment.release"].supported).toBe(false);
  });
  it("rejects missing hosts, unknown runtimes and unlinked source", () => {
    expect(runtimeCapabilities({ ...compose, vpsConfigId: null }).operations["deployment.redeploy"].supported).toBe(false);
    expect(runtimeCapabilities({ ...compose, githubRepositories: [] }).operations["deployment.source.deploy"].supported).toBe(false);
    expect(runtimeCapabilities({ kind: "systemd", vpsConfigId: 7 }).operations["deployment.restart"].supported).toBe(false);
  });
  it("does not guess lost static template recipes or copy source over itself", () => {
    expect(staticRecipe({ ...site, legacyProject: { ...site.legacyProject, outputDir: null, envVars: JSON.stringify({ templateName: "site" }) } })).toBeNull();
    expect(staticRecipe({ ...site, sourcePath: "/www/site" })).toBeNull();
    expect(staticRecipe({ ...site, legacyProject: { ...site.legacyProject, outputDir: "../../other" } })).toBeNull();
  });
  it("recovers an older static record only from exact saved choices bound to its paths", () => {
    const publishRecipe = { version: 1, sourcePath: "/src/site", staticDir: "/www/site", outputDir: "dist", buildCommand: "npm run build" };
    const older = (backup: object, buildCommand: string | null = null) => ({ ...site, legacyProject: { ...site.legacyProject, outputDir: null, buildCommand, envVars: JSON.stringify({ templateName: "static-site", publishRecipe: backup }) } });
    expect(staticRecipe(older(publishRecipe))).toEqual({ sourcePath: "/src/site", staticDir: "/www/site", outputPath: "/src/site/dist", buildCommand: "npm run build" });
    expect(staticRecipe(older({ ...publishRecipe, buildCommand: "" }))?.buildCommand).toBeNull();
    for (const patch of [{ sourcePath: "/other" }, { staticDir: "/other" }, { version: 2 }, { buildCommand: undefined }, { outputDir: undefined }]) {
      expect(staticRecipe(older({ ...publishRecipe, ...patch }))).toBeNull();
    }
    expect(staticRecipe(older(publishRecipe, "different-build"))).toBeNull();
  });
  it("detects host, container and recipe changes in queued identities", () => {
    expect(runtimeIdentity(compose)).not.toBe(runtimeIdentity({ ...compose, vpsConfigId: 8 }));
    expect(runtimeIdentity(site)).not.toBe(runtimeIdentity({ ...site, sourcePath: "/src/other" }));
  });
});

it("restricts accepted enrollments to first launch then restart, retaining stable identity", () => {
  const previous = process.env.GC_AGENT_ENROLLMENT_PROPOSALS;
  process.env.GC_AGENT_ENROLLMENT_PROPOSALS = "1";
  try {
    const pending = { kind: "compose", vpsConfigId: 1, sourcePath: "/srv/app", composePath: "/srv/app/.groundcontrol/effective-compose.yml", metadataJson: JSON.stringify({ agentEnrollment: { recipeHash: "a".repeat(64), firstLaunchState: "pending" } }) };
    const capabilities = runtimeCapabilities(pending);
    expect(capabilities.operations["deployment.first_launch"].supported).toBe(true);
    for (const name of ["deployment.restart", "deployment.redeploy", "deployment.source.deploy", "deployment.build_publish", "deployment.release"] as const) expect(capabilities.operations[name].supported).toBe(false);
    const success = { ...pending, composePath: "/srv/app/.groundcontrol/effective-compose.yml", metadataJson: JSON.stringify({ agentEnrollment: { recipeHash: "a".repeat(64), firstLaunchState: "success" } }) };
    expect(runtimeCapabilities(success).operations["deployment.first_launch"].supported).toBe(false);
    expect(runtimeCapabilities(success).operations["deployment.restart"].supported).toBe(true);
    expect(runtimeCapabilities(success).operations["deployment.redeploy"].supported).toBe(false);
    expect(runtimeIdentity(success)).toBe(runtimeIdentity(pending));
    expect(runtimeIdentity({ ...success, composePath: "/srv/other/compose.yml" })).not.toBe(runtimeIdentity(success));
  } finally { if (previous === undefined) delete process.env.GC_AGENT_ENROLLMENT_PROPOSALS; else process.env.GC_AGENT_ENROLLMENT_PROPOSALS = previous; }
});
