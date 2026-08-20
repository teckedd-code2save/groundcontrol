import type { HttpProbeResult } from "./types";

export interface ProbeHttpInput {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  /** Optional allowed origin (e.g. "https://example.com") to prevent SSRF. */
  baseOrigin?: string;
  timeoutMs?: number;
}

function originOf(rawUrl: string): string {
  const url = new URL(rawUrl);
  return `${url.protocol}//${url.host}`;
}

function normalizeMethod(method?: string): string {
  return String(method || "GET").toUpperCase();
}

/**
 * Deterministic, SSRF-constrained HTTP probe used for contract discovery.
 * Redirects are surfaced as a status instead of being followed, so a probe
 * can never be redirected off the allowed origin.
 */
export async function probeHttp(input: ProbeHttpInput): Promise<HttpProbeResult> {
  const method = normalizeMethod(input.method);
  const started = Date.now();
  let url: URL;
  try {
    url = new URL(input.url);
  } catch {
    return { url: input.url, method, ok: false, latencyMs: 0, error: "Invalid URL." };
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return { url: url.toString(), method, ok: false, latencyMs: 0, error: "Only http(s) URLs are allowed." };
  }
  if (input.baseOrigin) {
    const targetOrigin = `${url.protocol}//${url.host}`;
    if (targetOrigin !== input.baseOrigin) {
      return { url: url.toString(), method, ok: false, latencyMs: 0, error: "Target origin is not allowed." };
    }
  }

  const timeoutMs = input.timeoutMs && input.timeoutMs > 0 ? input.timeoutMs : 10_000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url.toString(), {
      method,
      headers: {
        "user-agent": "groundcontrol-qa-harness/1.0",
        ...(input.headers || {}),
      },
      body: input.body && method !== "GET" && method !== "HEAD" ? input.body : undefined,
      redirect: "manual",
      signal: controller.signal,
    });
    const contentType = response.headers.get("content-type") || undefined;
    const text = await response.text();
    return {
      url: url.toString(),
      method,
      ok: response.status < 500,
      statusCode: response.status,
      latencyMs: Date.now() - started,
      contentType,
      bodyPreview: text.slice(0, 500),
    };
  } catch (error) {
    return {
      url: url.toString(),
      method,
      ok: false,
      latencyMs: Date.now() - started,
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    clearTimeout(timer);
  }
}

export function originOfUrl(url: string): string | null {
  try {
    return originOf(url);
  } catch {
    return null;
  }
}
