import { execOnTargetStrict } from "@/lib/host-exec";
import { getActiveVps, shQuote } from "@/lib/vps";
import type { ServicePath } from "./types";

export interface LiveUpstreamProbe {
  target: string;
  ok: boolean;
  statusCode?: number;
  latencyMs?: number;
  error?: string;
}

function safeLoopbackTarget(upstream?: string): string | null {
  if (!upstream) return null;
  const raw = upstream.trim();
  const candidate = /^https?:\/\//i.test(raw) ? raw : `http://${raw}`;
  try {
    const url = new URL(candidate);
    const loopback = ["127.0.0.1", "localhost", "::1", "0.0.0.0"].includes(url.hostname);
    if (!loopback || url.username || url.password || !url.port) return null;
    const port = Number(url.port);
    if (!Number.isInteger(port) || port < 1 || port > 65535) return null;
    url.pathname = "/";
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

/** Test a loopback upstream on the actual deployment host, never in the GC app container. */
export async function probePathUpstream(path: ServicePath): Promise<LiveUpstreamProbe | undefined> {
  const target = safeLoopbackTarget(path.upstream);
  if (!target) return undefined;

  const vps = await getActiveVps();
  if (!vps) return undefined;
  const result = await execOnTargetStrict(
    `curl -sS -o /dev/null -w '%{http_code}|%{time_total}' --connect-timeout 2 --max-time 5 ${shQuote(target)}`,
    vps
  );
  if (result.code !== 0) {
    return {
      target,
      ok: false,
      error: result.stderr.trim().split("\n").at(-1) || "The host could not reach the configured upstream.",
    };
  }

  const [statusValue, secondsValue] = result.stdout.trim().split("|");
  const statusCode = Number(statusValue);
  const latencyMs = Math.round(Number(secondsValue) * 1000);
  if (!Number.isInteger(statusCode) || statusCode < 100) {
    return { target, ok: false, error: "The upstream did not return a valid HTTP status." };
  }
  return {
    target,
    ok: statusCode < 500,
    statusCode,
    latencyMs: Number.isFinite(latencyMs) ? latencyMs : undefined,
  };
}
