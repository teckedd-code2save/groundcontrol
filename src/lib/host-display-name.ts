import { isDesktopMode } from "./runtime";

type DisplayHost = { name?: string | null; host?: string | null; isLocal: boolean };
const genericLocal = /^(?:local|localhost|127\.0\.0\.1|::1|\[::1\]|this computer)$/i;

/** Display only: local execution is relative to GC, not the browser's computer. */
export function hostDisplayName(host: DisplayHost | null | undefined, desktop = isDesktopMode()): string {
  if (!host) return "Connection unavailable";
  const name = host.name?.trim();
  const address = host.host?.trim();
  if (name && (!host.isLocal || !genericLocal.test(name))) return name;
  if (host.isLocal) {
    if (desktop) return name || "This computer";
    // Use only a saved connection hostname, never the GC container's OS hostname.
    return address && !genericLocal.test(address)
      ? `GroundControl server (${address})`
      : "GroundControl server";
  }
  return address || "Connection unavailable";
}
