// @vitest-environment node
import { expect, it } from "vitest";
import { assertStandaloneSnapshot, captureStandaloneRecipe, parseStandaloneRecipe, standaloneConfigHash, type ContainerSnapshot } from "./standalone-recipe";
import { runtimeCapabilities, runtimeIdentity } from "./agent-runtime-capabilities";

export function snapshot(): ContainerSnapshot {
  return {
    Id: "a".repeat(64), Name: "/gc-app-demo", Image: `sha256:${"c".repeat(64)}`,
    Config: { Hostname: "original-host", Image: "example/app:latest", Labels: { "io.groundcontrol.project": "2", "io.groundcontrol.deployment": "7" }, Env: ["TOKEN=SECRET_NOT_STORED"], Cmd: ["serve"], Entrypoint: null, Volumes: null, ExposedPorts: { "8080/tcp": {} } },
    HostConfig: { NetworkMode: "default", Privileged: false, AutoRemove: false, Binds: null, Mounts: [], VolumesFrom: null, RestartPolicy: { Name: "no", MaximumRetryCount: 0 }, PortBindings: { "8080/tcp": [{ HostIp: "127.0.0.1", HostPort: "49152" }] }, LogConfig: { Type: "json-file", Config: {} } },
    Mounts: [], NetworkSettings: { Ports: { "8080/tcp": [{ HostIp: "127.0.0.1", HostPort: "49152" }] }, Networks: { bridge: { Aliases: null, Links: null, IPAMConfig: null } } },
    State: { Running: true, Status: "running" },
  };
}
export function recipe() { return captureStandaloneRecipe(snapshot(), { deploymentId: 7, projectId: 2, containerName: "gc-app-demo", containerPort: 8080, hostPort: 49152 })!; }
it("captures immutable image, private binding and exact identity without persisting environment values", () => {
  const captured = recipe();
  expect(captured).toMatchObject({ version: 1, imageId: snapshot().Image, containerId: snapshot().Id, hostPort: 49152, containerPort: 8080 });
  expect(JSON.stringify(captured)).not.toContain("SECRET_NOT_STORED");
  expect(JSON.stringify(captured)).not.toContain("TOKEN");
});
it.each(["mount", "network", "public", "privileged", "volume", "dynamic-port"])("does not capture unsupported %s configuration", (mode) => {
  const value = snapshot();
  if (mode === "mount") value.Mounts = [{ Type: "bind", Source: "/data" }];
  if (mode === "volume") value.Config.Volumes = { "/data": {} };
  if (mode === "network") value.NetworkSettings.Networks!.custom = {};
  if (mode === "privileged") value.HostConfig.Privileged = true;
  if (mode === "dynamic-port") value.HostConfig.PortBindings = { "8080/tcp": [{ HostIp: "127.0.0.1", HostPort: "" }] };
  if (mode === "public") value.NetworkSettings.Ports!["8080/tcp"]![0].HostIp = "0.0.0.0";
  expect(captureStandaloneRecipe(value, { deploymentId: 7, projectId: 2, containerName: "gc-app-demo", containerPort: 8080, hostPort: 49152 })).toBeNull();
});
it("detects environment, image and host configuration drift", () => {
  for (const change of [(s: ContainerSnapshot) => { s.Config.Env = ["TOKEN=changed"]; }, (s: ContainerSnapshot) => { s.Image = `sha256:${"d".repeat(64)}`; }, (s: ContainerSnapshot) => { s.HostConfig.Memory = 100; }]) {
    const value = snapshot(); change(value);
    expect(() => assertStandaloneSnapshot(value, recipe(), "gc-app-demo")).toThrow(/changed/);
  }
});
it("compares a not-yet-started candidate with the exact known configuration", () => {
  const candidate = snapshot(); candidate.State = { Running: false, Status: "created" };
  candidate.NetworkSettings = { Ports: null, Networks: {} };
  candidate.Config.Image = candidate.Image;
  candidate.HostConfig.PortBindings = { "8080/tcp": [{ HostIp: "127.0.0.1", HostPort: "49152" }] };
  expect(standaloneConfigHash(candidate, recipe())).toBe(recipe().configHash);
});
it("enables redeploy only for a validated, owner-bound captured recipe", () => {
  const deployment = { id: 7, projectGroupId: 2, kind: "container", containerName: "gc-app-demo", vpsConfigId: 9, metadataJson: JSON.stringify({ source: "local-image", recreateRecipe: recipe() }) };
  expect(runtimeCapabilities(deployment).operations["deployment.redeploy"].supported).toBe(true);
  expect(runtimeCapabilities({ ...deployment, id: 8 }).operations["deployment.redeploy"].supported).toBe(false);
  expect(parseStandaloneRecipe({ ...deployment, projectGroupId: 3 })).toBeNull();
  const replaced = { ...deployment, metadataJson: JSON.stringify({ source: "local-image", recreateRecipe: { ...recipe(), containerId: "b".repeat(64) } }) };
  expect(runtimeIdentity(replaced)).toBe(runtimeIdentity(deployment));
});
