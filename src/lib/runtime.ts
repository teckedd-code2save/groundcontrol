import fs from "fs";

let cachedContainerized: boolean | null = null;
let cachedRuntime: string | undefined;

export interface RuntimeEnv {
  KUBERNETES_SERVICE_HOST?: string;
  container?: string;
}

export interface RuntimeDeps {
  existsSync: (path: string) => boolean;
  readFileSync: (path: string, encoding?: string) => string;
  env: RuntimeEnv;
}

/** Reset internal caches. Exported for tests only. */
export function __resetRuntimeCache(): void {
  cachedContainerized = null;
  cachedRuntime = undefined;
}

const defaultDeps: RuntimeDeps = {
  existsSync: (path: string) => fs.existsSync(path),
  readFileSync: (path: string, encoding?: string) =>
    fs.readFileSync(path, encoding as BufferEncoding) as string,
  env: process.env as RuntimeEnv,
};

/**
 * Detect whether GroundControl is running inside a container.
 * The result is cached for the lifetime of the process.
 */
export function isContainerized(): boolean {
  if (cachedContainerized !== null) return cachedContainerized;
  const info = detectRuntime(defaultDeps);
  cachedContainerized = info.containerized;
  cachedRuntime = info.containerRuntime;
  return cachedContainerized;
}

/**
 * Return containerization status plus a best-effort runtime label.
 */
export function getRuntimeInfo(): { containerized: boolean; containerRuntime?: string } {
  isContainerized(); // ensure cache is populated
  return { containerized: cachedContainerized!, containerRuntime: cachedRuntime };
}

/**
 * Pure detection logic. Accepts injected dependencies so tests do not need to
 * mock the `fs` module.
 */
export function detectRuntime(deps: RuntimeDeps): { containerized: boolean; containerRuntime?: string } {
  const { existsSync, readFileSync, env } = deps;

  // Kubernetes sets this env var in every pod.
  if (env.KUBERNETES_SERVICE_HOST) {
    return { containerized: true, containerRuntime: "kubernetes" };
  }

  // podman/containerd sometimes set the lowercase `container` env var.
  const containerEnv = env.container;
  if (containerEnv) {
    if (/docker/i.test(containerEnv)) return { containerized: true, containerRuntime: "docker" };
    if (/podman/i.test(containerEnv)) return { containerized: true, containerRuntime: "podman" };
    return { containerized: true, containerRuntime: containerEnv };
  }

  // Docker creates this marker file.
  try {
    if (existsSync("/.dockerenv")) {
      return { containerized: true, containerRuntime: "docker" };
    }
  } catch {
    // ignore permission errors
  }

  // Read cgroup controllers for runtime hints.
  try {
    const cgroup = readFileSync("/proc/self/cgroup", "utf8");
    if (/docker/i.test(cgroup)) return { containerized: true, containerRuntime: "docker" };
    if (/containerd/i.test(cgroup)) return { containerized: true, containerRuntime: "containerd" };
    if (/kubepods/i.test(cgroup)) return { containerized: true, containerRuntime: "kubernetes" };
    if (/lxc/i.test(cgroup)) return { containerized: true, containerRuntime: "lxc" };
    if (/podman/i.test(cgroup)) return { containerized: true, containerRuntime: "podman" };
  } catch {
    // ignore read failures
  }

  return { containerized: false };
}
