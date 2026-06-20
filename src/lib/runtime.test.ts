import { describe, it, expect, beforeEach } from "vitest";
import {
  isContainerized,
  getRuntimeInfo,
  __resetRuntimeCache,
  detectRuntime,
  type RuntimeDeps,
} from "./runtime";

function deps(partial: Partial<RuntimeDeps> & { env: RuntimeDeps["env"] }): RuntimeDeps {
  return {
    existsSync: () => false,
    readFileSync: () => "",
    ...partial,
  };
}

describe("runtime detection", () => {
  beforeEach(() => {
    __resetRuntimeCache();
  });

  it("returns false when no container markers exist", () => {
    const result = detectRuntime(deps({ env: {} }));
    expect(result.containerized).toBe(false);
    expect(result.containerRuntime).toBeUndefined();
  });

  it("detects docker via /.dockerenv", () => {
    const result = detectRuntime(
      deps({
        existsSync: (p: string) => p === "/.dockerenv",
        readFileSync: () => "",
        env: {},
      })
    );
    expect(result.containerized).toBe(true);
    expect(result.containerRuntime).toBe("docker");
  });

  it("detects docker via /proc/self/cgroup", () => {
    const result = detectRuntime(
      deps({
        readFileSync: () => "12:freezer:/docker/abc\n",
        env: {},
      })
    );
    expect(result.containerized).toBe(true);
    expect(result.containerRuntime).toBe("docker");
  });

  it("detects kubernetes via KUBERNETES_SERVICE_HOST", () => {
    const result = detectRuntime(
      deps({
        env: { KUBERNETES_SERVICE_HOST: "10.0.0.1" },
      })
    );
    expect(result.containerized).toBe(true);
    expect(result.containerRuntime).toBe("kubernetes");
  });

  it("detects podman via container env var", () => {
    const result = detectRuntime(
      deps({
        env: { container: "podman" },
      })
    );
    expect(result.containerized).toBe(true);
    expect(result.containerRuntime).toBe("podman");
  });

  it("detects containerd via cgroup", () => {
    const result = detectRuntime(
      deps({
        readFileSync: () => "0::/system.slice/containerd.service/container:abc\n",
        env: {},
      })
    );
    expect(result.containerized).toBe(true);
    expect(result.containerRuntime).toBe("containerd");
  });

  it("caches isContainerized() result", () => {
    __resetRuntimeCache();
    const first = isContainerized();
    const second = isContainerized();
    expect(first).toBe(second);
  });

  it("getRuntimeInfo populates cache", () => {
    __resetRuntimeCache();
    const info = getRuntimeInfo();
    expect(typeof info.containerized).toBe("boolean");
  });
});
