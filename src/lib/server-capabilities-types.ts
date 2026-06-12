export interface ServerCapabilities {
  osFamily: "alpine" | "debian" | "other";
  initSystem: "systemd" | "openrc" | "other";
  hasDocker: boolean;
  hasCaddy: boolean;
  hasNginx: boolean;
  hasNode: boolean;
  hasSystemctl: boolean;
  hasService: boolean;
  /** Preferred network socket listing tool, if any. */
  networkTool: "ss" | "netstat" | null;
}

/**
 * Build the list of helper chip commands shown above the terminal. Only
 * includes commands that are actually usable on the active VPS.
 */
export function buildHelperChips(capabilities: ServerCapabilities | null): string[] {
  if (!capabilities) return [];
  const chips: string[] = [];
  if (capabilities.hasDocker) {
    chips.push("docker ps", "docker stats", "docker logs <container>");
  }
  if (capabilities.hasSystemctl) chips.push("systemctl status");
  if (capabilities.hasService) chips.push("service --status-all");
  if (capabilities.hasCaddy) chips.push("caddy reload");
  if (capabilities.hasNginx) chips.push("nginx -t");
  chips.push("df -h", "free -m", "ps aux");
  if (capabilities.networkTool === "ss") chips.push("ss -tlnp");
  else if (capabilities.networkTool === "netstat") chips.push("netstat -tlnp");
  if (capabilities.hasNode) chips.push("node -v");
  return chips;
}

/**
 * Return a context-aware hint when the user tries to run a command that is
 * known to be unavailable on the active VPS (e.g. `systemctl` on Alpine).
 */
export function hintForCommand(
  cmd: string,
  capabilities: ServerCapabilities | null
): string | undefined {
  if (!capabilities) return undefined;
  const first = cmd.trim().split(/\s+/)[0];
  if (first === "systemctl" && !capabilities.hasSystemctl) {
    return capabilities.hasService
      ? "systemctl not available — try `service <name> status`"
      : "systemctl not available on this server";
  }
  if (first === "service" && !capabilities.hasService && capabilities.hasSystemctl) {
    return "service not available — try `systemctl status <name>`";
  }
  if (first === "caddy" && !capabilities.hasCaddy) return "caddy not installed";
  if (first === "nginx" && !capabilities.hasNginx) return "nginx not installed";
  if (first === "docker" && !capabilities.hasDocker) return "docker not installed";
  return undefined;
}

/**
 * Human-readable summary of the detected capabilities for the terminal bar.
 */
export function capabilitySummary(capabilities: ServerCapabilities | null): string {
  if (!capabilities) return "";
  const parts: string[] = [capabilities.osFamily];
  if (capabilities.hasDocker) parts.push("Docker");
  if (capabilities.hasCaddy) parts.push("Caddy");
  if (capabilities.hasNginx) parts.push("Nginx");
  if (capabilities.hasNode) parts.push("Node");
  parts.push(capabilities.initSystem);
  return parts.map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join(" · ");
}
