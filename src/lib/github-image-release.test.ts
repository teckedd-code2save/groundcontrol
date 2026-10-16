// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  buildBuildkitBuildPushCommand,
  buildDigestImageOverride,
  buildEnsureBuildkitBuilderCommand,
  buildReleaseBuildPushCommand,
  buildReleaseImageOverride,
  buildRunTestsCommand,
  buildableServiceImages,
  composeImageEnvKeys,
  normalizeReleaseSha,
  normalizeTestCommand,
  parseReleaseVerifyOutput,
  releaseImageReference,
  releaseImageRepository,
} from "./github-image-release";

const SHA = "a".repeat(40);
const DIGEST = "b".repeat(64);

describe("github-image-release", () => {
  it("validates a release SHA", () => {
    expect(normalizeReleaseSha(SHA)).toBe(SHA);
    expect(normalizeReleaseSha(`  ${SHA.toUpperCase()}  `)).toBe(SHA);
    expect(() => normalizeReleaseSha("deadbeef")).toThrow(/40-64/);
    expect(() => normalizeReleaseSha("")).toThrow(/40-64/);
    expect(() => normalizeReleaseSha(`${SHA}evil`)).toThrow(/40-64/);
  });

  it("derives a repository from a tagged or digested reference", () => {
    expect(releaseImageRepository("ghcr.io/org/app:oldsha")).toBe("ghcr.io/org/app");
    expect(releaseImageRepository(`ghcr.io/org/app@sha256:${DIGEST}`)).toBe("ghcr.io/org/app");
    expect(releaseImageRepository("org/app:1.2.3")).toBe("org/app");
    expect(releaseImageRepository("localhost:5000/app:tag")).toBe("localhost:5000/app");
    // Bare local names have no pushable registry target.
    expect(releaseImageRepository("nginx:alpine")).toBeNull();
    expect(releaseImageRepository("docker.io/library/nginx:alpine")).toBeNull();
    expect(releaseImageRepository("myapp")).toBeNull();
  });

  it("derives a SHA-tagged reference and rejects local-only images", () => {
    expect(releaseImageReference("ghcr.io/org/app:oldsha", SHA)).toBe(`ghcr.io/org/app:${SHA}`);
    expect(releaseImageReference(`ghcr.io/org/app@sha256:${DIGEST}`, SHA)).toBe(`ghcr.io/org/app:${SHA}`);
    expect(() => releaseImageReference("nginx:alpine", SHA)).toThrow(/registry/);
  });

  it("extracts only buildable services from effective compose", () => {
    const compose = [
      "services:",
      "  web:",
      "    build:",
      "      context: .",
      "    image: ghcr.io/org/app:oldsha",
      "  api:",
      "    build: .",
      "    image: ghcr.io/org/api:oldsha",
      "  db:",
      "    image: postgres:16-alpine",
      "  worker:",
      "    build: .",
    ].join("\n");
    expect(buildableServiceImages(compose)).toEqual({
      web: "ghcr.io/org/app:oldsha",
      api: "ghcr.io/org/api:oldsha",
    });
  });

  it("maps services to their canonical image env keys", () => {
    const compose = [
      "services:",
      "  web:",
      "    build: .",
      "    image: ${API_IMAGE}",
      "  worker:",
      "    build: .",
      "    image: ${WORKER_IMAGE}",
      "  db:",
      "    image: postgres:16-alpine",
    ].join("\n");
    expect(composeImageEnvKeys(compose)).toEqual({ web: "API_IMAGE", worker: "WORKER_IMAGE" });
  });

  it("builds the release override and resolves SHA-tagged refs", () => {
    const { content, refs } = buildReleaseImageOverride(
      { web: "ghcr.io/org/app:oldsha", api: `ghcr.io/org/api@sha256:${DIGEST}` },
      SHA
    );
    expect(refs).toEqual({ web: `ghcr.io/org/app:${SHA}`, api: `ghcr.io/org/api:${SHA}` });
    expect(content).toContain(`ghcr.io/org/app:${SHA}`);
    expect(content).toContain(`ghcr.io/org/api:${SHA}`);
  });

  it("rejects a release with no buildable, registry-backed services", () => {
    expect(() => buildReleaseImageOverride({}, SHA)).toThrow(/buildable/i);
    expect(() => buildReleaseImageOverride({ web: "nginx:alpine" }, SHA)).toThrow(/registry/);
  });

  it("builds a build+push command for the selected services", () => {
    const command = buildReleaseBuildPushCommand({
      projectPath: "/opt/myapp",
      composeCommand: "docker compose",
      composeFile: "/opt/myapp/compose.yml",
      services: ["web", "api"],
    });
    expect(command).toContain("cd '/opt/myapp'");
    expect(command).toContain("build 'web' 'api'");
    expect(command).toContain("push 'web' 'api'");
  });

  it("parses verification output and rejects bad artifacts", () => {
    const refs = { web: `ghcr.io/org/app:${SHA}` };
    const digest = `ghcr.io/org/app@sha256:${DIGEST}`;
    const good = `service=web ref=${refs.web} digest=${digest} arch=amd64\n`;
    expect(parseReleaseVerifyOutput(good, refs)).toEqual([
      { service: "web", ref: refs.web, digest },
    ]);

    expect(() =>
      parseReleaseVerifyOutput(`service=web ref=${refs.web} digest=${digest} arch=arm64\n`, refs)
    ).toThrow(/amd64/);

    expect(() =>
      parseReleaseVerifyOutput(`service=web ref=${refs.web} digest= arch=amd64\n`, refs)
    ).toThrow(/digest/);

    expect(() => parseReleaseVerifyOutput("", refs)).toThrow(/did not observe/);
  });

  it("builds a digest-pinned release override and rejects non-digests", () => {
    const digest = `ghcr.io/org/app@sha256:${DIGEST}`;
    const { content, refs } = buildDigestImageOverride([{ service: "web", digest }]);
    expect(refs).toEqual({ web: digest });
    expect(content).toContain(digest);
    expect(() => buildDigestImageOverride([{ service: "web", digest: "ghcr.io/org/app:tag" }])).toThrow(/sha256/);
    expect(() => buildDigestImageOverride([])).toThrow(/No release images/);
  });

  it("validates test commands and builds a throwaway run command", () => {
    expect(normalizeTestCommand("  npm test  ")).toBe("npm test");
    expect(normalizeTestCommand("")).toBeNull();
    expect(() => normalizeTestCommand("x".repeat(1001))).toThrow(/1000/);
    const cmd = buildRunTestsCommand(`ghcr.io/org/app:${SHA}`, "npm test");
    expect(cmd).toContain("docker run --rm");
    expect(cmd).toContain(`ghcr.io/org/app:${SHA}`);
    expect(cmd).toContain("npm test");
  });

  it("builds the resource-capped BuildKit builder and bake commands", () => {
    const ensure = buildEnsureBuildkitBuilderCommand("gc-buildkit", "2", "2g");
    expect(ensure).toContain("docker buildx create --name 'gc-buildkit'");
    expect(ensure).toContain("--driver docker-container");
    expect(ensure).toContain("docker update --cpus '2' --memory '2g' --memory-swap '2g'");

    const bake = buildBuildkitBuildPushCommand({
      projectPath: "/opt/myapp",
      composeFile: "/opt/myapp/compose.yml",
      builder: "gc-buildkit",
      refs: { web: `ghcr.io/org/app:${SHA}` },
    });
    expect(bake).toContain("docker buildx bake --builder 'gc-buildkit'");
    expect(bake).toContain("--load");
    expect(bake).toContain(`docker push 'ghcr.io/org/app:${SHA}'`);
  });
});
