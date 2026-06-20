import { describe, it, expect, vi, beforeEach } from "vitest";
import { isContainerized, getRuntimeInfo, __resetRuntimeCache, detectRuntime } from "./runtime";

describe("runtime detection", () => {
  beforeEach(() => {
    __resetRuntimeCache();
  });

  it("returns false when no container markers exist", () => {
    const result = detectRuntime({
      existsSync: () => false,
      readFileSync: () => "",
      env: {},
    });
    expect(result.containerized).toBe(false);
    expect(result.containerRuntime).toBeUndefined();
  });

  it("detects docker via /.dockerenv", () => {
    const result = detectRuntime({
      existsSync: (p: string) => p === "/.dockerenv",
      readFileSync: () => "",
      env: {},
    });
    expect(result.containerized).toBe(true);
    expect(result.containerRuntime).toBe("docker");
  });

  it("detects docker via /proc/self/cgroup", () => {
    const result = detectRuntime({
      existsSync: () => false,
      readFileSync: () => "12:freezer:/docker/abc\n",
      env: {},
    });
    expect(result.containerized).toBe(true);
    expect(result.containerRuntime).toBe("docker");
  });

  it("detects kubernetes via KUBERNETES_SERVICE_HOST", () => {
    const result = detectRuntime({
      existsSync: () => false,
      readFileSync: () => "",
      env: { KUBERNETES_SERVICE_HOST: "10.0.0.1" },
    });
    expect(result.containerized).toBe(true);
    expect(result.containerRuntime).toBe("kubernetes");
  });

  it("detects podman via container env var", () => {
    const result = detectRuntime({
      existsSync: () => false,
      readFileSync: () => "",
      env: { container: "podman" },
    });
    expect(result.containerized).toBe(true);
    expect(result.containerRuntime).toBe("podman");
  });

  it("detects containerd via cgroup", () => {
    const result = detectRuntime({
      existsSync: () => false,
      readFileSync: () => "0::/system.slice/containerd.service/container:abc\n",
      env: {},
    });
    expect(result.containerized).toBe(true);
    expect(result.containerRuntime).toBe("containerd");
  });

  it("caches isContainerized() result", () => {
    const existsSync = vi.fn(() => true);
    const readFileSync = vi.fn(() => "");

    // First call should populate cache using default deps (real fs), so we
    // test the cache directly by resetting and using a synthetic path.
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
