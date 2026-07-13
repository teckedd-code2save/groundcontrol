import type { ProbeResult } from "./types";

export interface ProbeTarget {
  id?: string;
  kind: "internal" | "external";
  target: string;
  serviceId?: string;
  /** Expected status codes (default [200, 204, 301, 302]). */
  expectStatus?: number[];
}

export interface ProbeExecutor {
  /** Fetch HTTP status for a URL. Implementations must not log secrets. */
  fetchStatus(url: string): Promise<{ statusCode: number; latencyMs: number }>;
}

/** Real HTTP probe used by production Loop runs. It never reads or logs a body. */
export function createHttpProbeExecutor(timeoutMs = 10_000): ProbeExecutor {
  return {
    async fetchStatus(target: string) {
      const url = new URL(target);
      if (url.protocol !== "http:" && url.protocol !== "https:") {
        throw new Error(`Unsupported probe protocol: ${url.protocol}`);
      }
      if (url.username || url.password) {
        throw new Error("Probe URLs cannot contain credentials");
      }
      const startedAt = Date.now();
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await fetch(url, {
          method: "GET",
          redirect: "manual",
          cache: "no-store",
          signal: controller.signal,
          headers: { "user-agent": "GroundControl-Loop/1.0" },
        });
        return { statusCode: response.status, latencyMs: Date.now() - startedAt };
      } finally {
        clearTimeout(timer);
      }
    },
  };
}

/**
 * Run probe targets through an executor. Pure orchestration — executor does I/O.
 */
export async function runProbes(
  targets: ProbeTarget[],
  executor: ProbeExecutor,
  observedAt: string = new Date().toISOString()
): Promise<ProbeResult[]> {
  const results: ProbeResult[] = [];
  for (const t of targets) {
    const expect = t.expectStatus ?? [200, 204, 301, 302];
    try {
      const { statusCode, latencyMs } = await executor.fetchStatus(t.target);
      results.push({
        id: t.id || `probe_${t.kind}_${hash(t.target)}`,
        kind: t.kind,
        target: t.target,
        serviceId: t.serviceId,
        ok: expect.includes(statusCode),
        statusCode,
        latencyMs,
        observedAt,
      });
    } catch (err) {
      results.push({
        id: t.id || `probe_${t.kind}_${hash(t.target)}`,
        kind: t.kind,
        target: t.target,
        serviceId: t.serviceId,
        ok: false,
        error: err instanceof Error ? err.message : String(err),
        observedAt,
      });
    }
  }
  return results;
}

/** Fixture executor: map URL → status without network. */
export function createMapProbeExecutor(
  statusByUrl: Record<string, number | { statusCode: number; latencyMs?: number; error?: string }>
): ProbeExecutor {
  return {
    async fetchStatus(url: string) {
      const entry = statusByUrl[url];
      if (entry == null) {
        throw new Error(`No fixture status for ${url}`);
      }
      if (typeof entry === "number") {
        return { statusCode: entry, latencyMs: 5 };
      }
      if (entry.error) throw new Error(entry.error);
      return { statusCode: entry.statusCode, latencyMs: entry.latencyMs ?? 5 };
    },
  };
}

function hash(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h).toString(36);
}
