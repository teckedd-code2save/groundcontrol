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
});
