import { describe, expect, it } from "vitest";
import { buildManagedComposeInvocation } from "./vps";

describe("managed Docker Compose invocation", () => {
  it("uses GroundControl's isolated Docker credentials", () => {
    const command = buildManagedComposeInvocation("docker compose", "pull");
    expect(command).toContain('DOCKER_CONFIG="${HOME}/.groundcontrol/docker"');
    expect(command).toContain('docker compose "$@" pull');
  });

  it("keeps an explicit compose file and managed override behaviour", () => {
    const command = buildManagedComposeInvocation("docker compose", "up -d", "compose.prod.yml");
    expect(command).toContain("compose.prod.yml");
    expect(command).toContain(".groundcontrol/compose.env.override.yml");
    expect(command).toContain('DOCKER_CONFIG="${HOME}/.groundcontrol/docker"');
  });
});
