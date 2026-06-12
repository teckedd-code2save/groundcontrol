import { execOnVps, shQuote, type VpsConnection } from "./vps";
import type { ServerCapabilities } from "./server-capabilities-types";

export type { ServerCapabilities };

function normalizeOsId(id: string): "alpine" | "debian" | "other" {
  const lower = id.toLowerCase();
  if (lower.includes("alpine")) return "alpine";
  if (lower.includes("debian") || lower.includes("ubuntu")) return "debian";
  return "other";
}

async function readOsFamily(vps?: VpsConnection | null): Promise<"alpine" | "debian" | "other"> {
  const result = await execOnVps(
    `cat /etc/os-release 2>/dev/null || echo 'ID=unknown'`,
    vps
  );
  for (const line of result.stdout.split("\n")) {
    const m = line.match(/^ID=(.*)$/);
    if (m) {
      return normalizeOsId(m[1].replace(/^["']|["']$/g, "").trim());
    }
  }
  return "other";
}

async function hasBinary(name: string, vps?: VpsConnection | null): Promise<boolean> {
  const result = await execOnVps(
    `command -v ${shQuote(name)} >/dev/null 2>&1 && echo yes || echo no`,
    vps
  );
  return result.stdout.trim() === "yes";
}

async function detectInitSystem(vps?: VpsConnection | null): Promise<"systemd" | "openrc" | "other"> {
  // systemd leaves a well-known runtime marker.
  const systemdMarker = await execOnVps(
    `[ -d /run/systemd/system ] && echo yes || echo no`,
    vps
  );
  if (systemdMarker.stdout.trim() === "yes" && (await hasBinary("systemctl", vps))) {
    return "systemd";
  }

  // OpenRC markers.
  const openrcMarker = await execOnVps(
    `(command -v openrc >/dev/null 2>&1 || command -v rc-status >/dev/null 2>&1 || [ -x /sbin/openrc-init ]) && echo yes || echo no`,
    vps
  );
  if (openrcMarker.stdout.trim() === "yes") {
    return "openrc";
  }

  return "other";
}

/**
 * Lightweight, read-only probe of the active VPS's OS family, init system,
 * and installed tooling. Commands are POSIX sh / BusyBox compatible.
 */
export async function detectServerCapabilities(vps?: VpsConnection | null): Promise<ServerCapabilities> {
  const [
    osFamily,
    initSystem,
    hasDocker,
    hasCaddy,
    hasNginx,
    hasNode,
    hasSystemctl,
    hasService,
    hasSs,
    hasNetstat,
  ] = await Promise.all([
    readOsFamily(vps),
    detectInitSystem(vps),
    hasBinary("docker", vps),
    hasBinary("caddy", vps),
    hasBinary("nginx", vps),
    hasBinary("node", vps),
    hasBinary("systemctl", vps),
    hasBinary("service", vps),
    hasBinary("ss", vps),
    hasBinary("netstat", vps),
  ]);

  return {
    osFamily,
    initSystem,
    hasDocker,
    hasCaddy,
    hasNginx,
    hasNode,
    hasSystemctl,
    hasService,
    networkTool: hasSs ? "ss" : hasNetstat ? "netstat" : null,
  };
}
