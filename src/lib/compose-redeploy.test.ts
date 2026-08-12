import { describe, expect, it } from "vitest";
import { spawnSync } from "child_process";
import {
  buildDetachedComposeRedeployCommand,
  buildDeploymentVerificationCommand,
  buildPublicEndpointVerificationCommand,
  buildRuntimeImageVerificationCommand,
  expectedComposeImages,
  normalizeDeploymentVerificationChecks,
  normalizePublicEndpointUrl,
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
    expect(script).toContain("ps -q --all 'api'");
    expect(script).toContain("ghcr.io/acme/api:abc123");
    expect(script).toContain("exit 42");
    expect(script).toContain("completed one-shot");
    expect(script).toContain("[failure] phase=verify service=api error=image mismatch");
    expect(script).toContain("[failure] phase=verify service=api error=container not running");
    expect(spawnSync("sh", ["-n"], { input: script }).status).toBe(0);
  });

  it("treats completed one-shot services as verified when the image matches and exit code is zero", () => {
    const script = buildRuntimeImageVerificationCommand(
      "docker compose",
      "/opt/app/compose.yaml",
      { migrate: "ghcr.io/acme/api:abc123" },
      2
    );

    expect(script).toContain("[verify] migrate: completed one-shot $gc_actual (exit 0)");
    expect(script).toContain("[verify] Runtime verification found service image or container-state mismatch");
    expect(script).toContain("[failure] phase=verify service=migrate error=no container exists for service");
    expect(spawnSync("sh", ["-n"], { input: script }).status).toBe(0);
  });

  it("builds a valid detached redeploy that only reports success after verification", () => {
    const script = buildDetachedComposeRedeployCommand({
      projectPath: "/opt/agent-flow/RentAWeekend",
      composeCommand: "docker compose",
      composeFile: "/opt/agent-flow/RentAWeekend/compose.yaml",
      deployArgs: "up -d --remove-orphans --force-recreate 'api'",
      expectedImages: { api: "ghcr.io/acme/api:abc123" },
      publicUrl: "https://app.example.com/",
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
    expect(script).toContain("[verify] Checking each Compose service against the effective image and runtime state");
    expect(script).toContain("[verify] api: expected ghcr.io/acme/api:abc123");
    expect(script).toContain("[check] $gc_check_name: checking $gc_check_url");
    expect(script).toContain("[failure] phase=public check=$gc_check_id name=$gc_check_name url=$gc_check_url status=$gc_public_status");
    expect(script.indexOf("[verify]")).toBeLessThan(script.indexOf("__GC_REDEPLOY_STATUS__=success"));
    expect(script.indexOf("[check]")).toBeLessThan(script.indexOf("__GC_REDEPLOY_STATUS__=success"));
    expect(script).toContain("docker image prune -f >/dev/null 2>&1 || true");
    expect(spawnSync("sh", ["-n"], { input: script }).status).toBe(0);
  });

  it("builds public endpoint verification that fails on unhealthy HTTP status", () => {
    const script = buildPublicEndpointVerificationCommand("https://app.example.com/");
    expect(script).toContain("[check] $gc_check_name: checking $gc_check_url");
    expect(script).toContain("curl -k -sS -o /dev/null");
    expect(script).toContain("exit 43");
    expect(script).toContain("[public] Public endpoint verified");
    expect(script).toContain("[failure] phase=public");
    expect(spawnSync("sh", ["-n"], { input: script }).status).toBe(0);
  });

  it("builds named release verification checks with exact expected statuses", () => {
    const checks = normalizeDeploymentVerificationChecks("https://app.example.com/", [
      { id: "home", name: "Homepage", url: "https://app.example.com/", expectStatus: 200 },
      { id: "login", name: "Login screen", url: "https://app.example.com/login", expectStatus: 200 },
    ]);
    const script = buildDeploymentVerificationCommand(checks);

    expect(checks.map((check) => check.name)).toEqual(["Homepage", "Login screen"]);
    expect(script).toContain("gc_check_id='home'");
    expect(script).toContain("gc_check_name='Login screen'");
    expect(script).toContain("expected=$gc_check_expected");
    expect(script).toContain("[check] Release verification passed");
    expect(spawnSync("sh", ["-n"], { input: script }).status).toBe(0);
  });

  it("normalizes configured public endpoints for redeploy verification", () => {
    expect(normalizePublicEndpointUrl("app.example.com")).toBe("https://app.example.com/");
    expect(normalizePublicEndpointUrl("https://app.example.com/health")).toBe("https://app.example.com/health");
    expect(normalizePublicEndpointUrl("ftp://app.example.com")).toBe(null);
    expect(normalizePublicEndpointUrl("https://user:pass@app.example.com")).toBe(null);
  });

  it("skips public endpoint verification when no live URL is configured", () => {
    expect(buildPublicEndpointVerificationCommand()).toBe("printf '%s\\n' '[public] No release verification checks configured; skipped'");
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

  it("explains legacy blank running-image verification failures by service", () => {
    const parsed = parseDetachedComposeRedeployLog([
      "[verify] Checking running images against the effective Compose configuration",
      "[verify] api: expected ghcr.io/acme/api:abc123",
      "[verify] api: running ghcr.io/acme/api:abc123",
      "[verify] migrate: expected ghcr.io/acme/api:abc123",
      "[verify] migrate: running",
      "[verify] Running image does not match the effective Compose configuration",
      "[verify] Runtime image verification failed (exit 42)",
      "__GC_REDEPLOY_STATUS__=failed:42",
    ].join("\n"));

    expect(parsed.error).toBe("[failure] phase=verify service=migrate error=no running image was observed after Compose recreation; migrate: expected ghcr.io/acme/api:abc123");
  });

  it("surfaces public endpoint failures as the deploy error", () => {
    const parsed = parseDetachedComposeRedeployLog([
      "[verify] Service images and runtime states match the effective Compose configuration",
      "[public] Checking https://app.example.com/",
      "[public] https://app.example.com/ returned HTTP 502",
      "[failure] phase=public url=https://app.example.com/ status=502 error=public endpoint returned unhealthy status",
      "[public] Public endpoint verification failed",
      "__GC_REDEPLOY_STATUS__=failed:43",
    ].join("\n"));

    expect(parsed.status).toBe("failed");
    expect(parsed.exitCode).toBe(43);
    expect(parsed.error).toBe("[failure] phase=public url=https://app.example.com/ status=502 error=public endpoint returned unhealthy status");
  });
});
