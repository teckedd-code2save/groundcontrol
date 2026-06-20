import { probeServerLayout } from "./server-probe";
import { detectServerCapabilities } from "./server-capabilities";
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
}

interface Cached {
  at: number;
  data: HostCapabilities;
}

const TTL_MS = 30_000;
let cache: Cached | null = null;

export async function getHostCapabilities(): Promise<HostCapabilities> {
  if (cache && Date.now() - cache.at < TTL_MS) {
    return cache.data;
  }

  const [layout, capabilities] = await Promise.all([
    probeServerLayout(),
    detectServerCapabilities(),
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

  return `Host capabilities: ${parts.join("; ")}.`;
}
