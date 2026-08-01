import { describe, expect, it } from "vitest";
import { spawnSync } from "child_process";
import {
  buildDetachedComposeRedeployCommand,
  buildRuntimeImageVerificationCommand,
  expectedComposeImages,
  parseDetachedComposeRedeployLog,
} from "./compose-redeploy";

describe("Compose redeploy image verification", () => {
  it("selects the resolved image for the requested service", () => {
    const effective = `services:\n  api:\n    image: ghcr.io/acme/api:abc123\n  web:\n    image: ghcr.io/acme/web:abc123\n`;
    expect(expectedComposeImages(effective, ["api"])).toEqual({ api: "ghcr.io/acme/api:abc123" });
  });

  it("verifies the running container against the same compose file and image", () => {
    const script = buildRuntimeImageVerificationCommand(
      "docker compose",
      "/opt/app/compose.yaml",
      { api: "ghcr.io/acme/api:abc123" },
      2
    );
    expect(script).toContain("/opt/app/compose.yaml");
    expect(script).toContain("compose.image.override.yml");
    expect(script).toContain("ps -q 'api'");
    expect(script).toContain("ghcr.io/acme/api:abc123");
    expect(script).toContain("exit 42");
    expect(spawnSync("sh", ["-n"], { input: script }).status).toBe(0);
  });

  it("builds a valid detached redeploy that only reports success after verification", () => {
    const script = buildDetachedComposeRedeployCommand({
      projectPath: "/opt/agent-flow/RentAWeekend",
      composeCommand: "docker compose",
      composeFile: "/opt/agent-flow/RentAWeekend/compose.yaml",
      deployArgs: "up -d --remove-orphans --force-recreate 'api'",
      expectedImages: { api: "ghcr.io/acme/api:abc123" },
    });

    expect(script).toContain("--force-recreate 'api'");
    expect(script).toContain("[deploy] Starting Docker Compose recreation");
    expect(script).toContain("[deploy] Docker Compose failed to recreate the deployment");
    expect(script).toContain("[evidence] Compose state after failure");
    expect(script).toContain("[failure] container={{.Name}}");
    expect(script).toContain("[container-log] container=$gc_container_name");
    expect(script).toContain("Compose created no containers");
    expect(script).toContain("docker logs --tail 60");
    expect(script).toContain("[verify] Runtime image verification failed");
    expect(script).toContain("[verify] api: expected ghcr.io/acme/api:abc123");
    expect(script.indexOf("[verify]")).toBeLessThan(script.indexOf("__GC_REDEPLOY_STATUS__=success"));
    expect(script).toContain("docker image prune -f >/dev/null 2>&1 || true");
    expect(spawnSync("sh", ["-n"], { input: script }).status).toBe(0);
  });

  it("removes private control markers and exposes the real Compose failure", () => {
    const parsed = parseDetachedComposeRedeployLog([
      "[deploy] Starting Docker Compose recreation",
      "service api: failed to resolve image ghcr.io/acme/api:missing",
      "[deploy] Docker Compose failed to recreate the deployment (exit 1)",
      "__GC_REDEPLOY_STATUS__=failed:1",
    ].join("\n"));

    expect(parsed).toEqual({
      lines: [
        "[deploy] Starting Docker Compose recreation",
        "service api: failed to resolve image ghcr.io/acme/api:missing",
        "[deploy] Docker Compose failed to recreate the deployment (exit 1)",
      ],
      status: "failed",
      error: "service api: failed to resolve image ghcr.io/acme/api:missing",
      exitCode: 1,
    });
    expect(parsed.lines.join("\n")).not.toContain("__GC_REDEPLOY_STATUS__");
  });

  it("keeps in-flight logs running until a completion marker appears", () => {
    expect(parseDetachedComposeRedeployLog("[deploy] Starting Docker Compose recreation\n")).toEqual({
      lines: ["[deploy] Starting Docker Compose recreation"],
      status: "running",
      error: null,
      exitCode: null,
    });
  });

  it("prefers exact failed-container evidence over a generic exit code", () => {
    const parsed = parseDetachedComposeRedeployLog([
      "[deploy] Starting Docker Compose recreation",
      "[deploy] Docker Compose failed to recreate the deployment (exit 1)",
      "[evidence] Compose state after failure",
      "[failure] container=/api status=running health=unhealthy exit=0 error=",
      "__GC_REDEPLOY_STATUS__=failed:1",
    ].join("\n"));

    expect(parsed.error).toBe("[failure] container=/api status=running health=unhealthy exit=0 error=");
  });

  it("prefers the concrete container log error over a generic container state", () => {
    const parsed = parseDetachedComposeRedeployLog([
      "[deploy] Docker Compose failed to recreate the deployment (exit 1)",
      "[failure] container=/api status=exited health=none exit=1 error=",
      "[container-log] container=api Error: DATABASE_URL is missing",
      "__GC_REDEPLOY_STATUS__=failed:1",
    ].join("\n"));

    expect(parsed.error).toBe("[container-log] container=api Error: DATABASE_URL is missing");
  });

  it("never presents a successful phase marker as failure evidence", () => {
    const parsed = parseDetachedComposeRedeployLog([
      "[configuration] Deployment configuration ready",
      "[compose] Effective Compose configuration valid (/opt/app/compose.yml)",
      "[pull] Images resolved",
      "__GC_REDEPLOY_STATUS__=failed:1",
    ].join("\n"));

    expect(parsed.status).toBe("failed");
    expect(parsed.error).toMatch(/run evidence is incomplete/i);
    expect(parsed.error).not.toContain("Images resolved");
  });
});
