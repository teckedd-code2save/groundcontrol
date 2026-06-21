import { exec } from "child_process";
import { promisify } from "util";
import { probeServerLayout } from "./server-probe";
import { detectServerCapabilities } from "./server-capabilities";
import { execOnTarget } from "./host-exec";
import { isContainerized } from "./runtime";
import {
  isDockerInstalled,
  isCaddyInstalled,
  isNginxInstalled,
  isNodeInstalled,
  isGitInstalled,
  isK3sInstalled,
  isKubectlInstalled,
  isHelmInstalled,
  isTerraformInstalled,
  isCloudflaredInstalled,
} from "./bootstrap";
import type { ServerLayout } from "./server-probe";
import type { ServerCapabilities } from "./server-capabilities";

const execAsync = promisify(exec);

export interface HostCapabilities {
  layout: ServerLayout;
  capabilities: ServerCapabilities;
  installed: {
    docker: boolean;
    caddy: boolean;
    nginx: boolean;
    node: boolean;
    git: boolean;
    k3s: boolean;
    kubectl: boolean;
    helm: boolean;
    terraform: boolean;
    cloudflared: boolean;
  };
  hostAccess: {
    containerized: boolean;
    verified: boolean;
    warning?: string;
  };
}

interface Cached {
  at: number;
  data: HostCapabilities;
}

const TTL_MS = 30_000;
let cache: Cached | null = null;

async function readInitCmdline(
  execFn: (cmd: string) => Promise<{ stdout: string; stderr: string; code: number }>
): Promise<string> {
  const result = await execFn("cat /proc/1/cmdline 2>/dev/null | tr '\\0' ' ' | head -c 200");
  return result.stdout.trim();
}

function normalizeInitCmdline(value: string): string {
  return value
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")[0]
    .replace(/^.*\//, "");
}

/**
 * Verify that execOnTarget is actually reaching the host OS when GroundControl
 * runs inside a container. Some container deployments do not share the host PID
 * namespace, so nsenter -t 1 only enters the container's own PID 1. We compare
 * the init process (PID 1) command line: on the host it is usually systemd/init,
 * while inside the GC container it is node/docker-init/nextjs.
 */
async function verifyHostAccess(): Promise<{ containerized: boolean; verified: boolean; warning?: string }> {
  if (!isContainerized()) return { containerized: false, verified: true };

  try {
    const [containerInit, targetInit] = await Promise.all([
      readInitCmdline(async (cmd) => {
        const { stdout, stderr } = await execAsync(cmd, { timeout: 5000 });
        return { stdout, stderr, code: 0 };
      }),
      readInitCmdline(execOnTarget),
    ]);

    if (!containerInit || !targetInit) {
      return {
        containerized: true,
        verified: false,
        warning: "Could not determine container or host init process; host access status is unknown.",
      };
    }

    if (normalizeInitCmdline(containerInit) === normalizeInitCmdline(targetInit)) {
      return {
        containerized: true,
        verified: false,
        warning:
          "GroundControl is running inside a container but host-level commands appear to run in the same OS namespace. " +
          "Host installs and service management may target the container filesystem instead of the host. " +
          "Mount the Docker socket and ensure the GC container can spawn privileged helper containers, or manage the host via SSH.",
      };
    }

    return { containerized: true, verified: true };
  } catch (err) {
    return {
      containerized: true,
      verified: false,
      warning: `Host access verification failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

export async function getHostCapabilities(): Promise<HostCapabilities> {
  if (cache && Date.now() - cache.at < TTL_MS) {
    return cache.data;
  }

  const [layout, capabilities, hostAccess] = await Promise.all([
    probeServerLayout(),
    detectServerCapabilities(),
    verifyHostAccess(),
  ]);

  const [
    docker,
    caddy,
    nginx,
    node,
    git,
    k3s,
    kubectl,
    helm,
    terraform,
    cloudflared,
  ] = await Promise.all([
    isDockerInstalled(),
    isCaddyInstalled(),
    isNginxInstalled(),
    isNodeInstalled(),
    isGitInstalled(),
    isK3sInstalled(),
    isKubectlInstalled(),
    isHelmInstalled(),
    isTerraformInstalled(),
    isCloudflaredInstalled(),
  ]);

  const data: HostCapabilities = {
    layout,
    capabilities,
    installed: {
      docker,
      caddy,
      nginx,
      node,
      git,
      k3s,
      kubectl,
      helm,
      terraform,
      cloudflared,
    },
    hostAccess,
  };

  cache = { at: Date.now(), data };
  return data;
}

/** Clear the in-memory cache, useful after installs/mutations. */
export function clearHostCapabilitiesCache() {
  cache = null;
}

/** One-line summary for the AI system prompt. */
export function formatCapabilitiesForPrompt(caps: HostCapabilities): string {
  const c = caps.capabilities;
  const l = caps.layout;
  const installed: string[] = [];
  const missing: string[] = [];

  const entries: [string, boolean][] = [
    ["Docker", caps.installed.docker],
    ["Caddy", caps.installed.caddy],
    ["Nginx", caps.installed.nginx],
    ["Node", caps.installed.node],
    ["Git", caps.installed.git],
    ["k3s", caps.installed.k3s],
    ["kubectl", caps.installed.kubectl],
    ["Helm", caps.installed.helm],
    ["Terraform", caps.installed.terraform],
    ["cloudflared", caps.installed.cloudflared],
  ];

  for (const [name, ok] of entries) {
    if (ok) installed.push(name);
    else missing.push(name);
  }

  const parts = [
    `OS: ${l.osName || c.osFamily} (${c.osFamily})`,
    `init: ${c.initSystem}`,
    `network: ${c.networkTool || "unknown"}`,
    installed.length ? `installed: ${installed.join(", ")}` : "installed: none",
    missing.length ? `missing: ${missing.join(", ")}` : "",
    `paths: projectRoot=${l.projectRoot}, caddy=${l.caddyFile}, nginxSites=${l.nginxSitesDir}, staticRoot=${l.staticRoot}`,
    `compose: ${l.composeCommand}`,
  ].filter(Boolean);

  let summary = `Host capabilities: ${parts.join("; ")}.`;
  if (caps.hostAccess.warning) {
    summary += `\nWARNING: ${caps.hostAccess.warning}`;
  }
  return summary;
}
