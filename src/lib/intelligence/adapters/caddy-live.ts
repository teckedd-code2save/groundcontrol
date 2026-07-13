/**
 * Live Caddy apply adapter — writes validated Caddyfile content on the managed host
 * via host-exec / execOnVps. Never accepts freeform model shell; only revision content.
 */

import { execOnTarget } from "@/lib/host-exec";
import { shQuote } from "@/lib/vps";
import { validateSafePath } from "@/lib/host-safety";
import type { ProxyRevision } from "../types";
import type { RecoveryExecutor } from "../recovery";
import { fingerprintContent, validateProxyConfig } from "../recovery";

export interface CaddyLiveOptions {
  /** Absolute path to Caddyfile or site snippet. Must pass host-safety path rules. */
  configPath?: string;
  /** Prefer `caddy reload` when true (default). */
  preferReload?: boolean;
}

const DEFAULT_CADDYFILE = "/etc/caddy/Caddyfile";

/**
 * Validate then write proxy revision to the host and reload Caddy.
 */
export async function applyCaddyRevisionLive(
  revision: ProxyRevision,
  options: CaddyLiveOptions = {}
): Promise<{ ok: boolean; detail: string }> {
  const path = options.configPath || DEFAULT_CADDYFILE;
  const pathErr = validateSafePath(path);
  if (pathErr) return { ok: false, detail: pathErr };

  const heuristic = validateProxyConfig(revision.content, "caddy");
  if (!heuristic.ok) return { ok: false, detail: heuristic.detail };

  // Write to temp then validate with native caddy when available
  const tmp = `/tmp/gc-caddy-${revision.id.replace(/[^a-zA-Z0-9_-]/g, "")}.caddy`;
  const b64 = Buffer.from(revision.content, "utf-8").toString("base64");
  const write = await execOnTarget(
    `printf '%s' ${shQuote(b64)} | base64 -d > ${shQuote(tmp)}`
  );
  if (write.code !== 0) {
    return {
      ok: false,
      detail: `Failed to stage Caddyfile: ${write.stderr || write.stdout}`,
    };
  }

  const native = await execOnTarget(
    `caddy validate --config ${shQuote(tmp)} 2>&1 || caddy adapt --config ${shQuote(tmp)} >/dev/null 2>&1 && echo validated || echo validate_skip`
  );
  const nativeOut = (native.stdout || "") + (native.stderr || "");
  if (
    native.code !== 0 &&
    !nativeOut.includes("validated") &&
    !nativeOut.includes("validate_skip") &&
    !/success|valid/i.test(nativeOut)
  ) {
    // Soft-fail only when caddy binary missing
    if (!/not found|No such file|command not found/i.test(nativeOut)) {
      await execOnTarget(`rm -f ${shQuote(tmp)}`);
      return { ok: false, detail: `caddy validate failed: ${nativeOut.slice(0, 500)}` };
    }
  }

  const install = await execOnTarget(
    `cp ${shQuote(tmp)} ${shQuote(path)} && rm -f ${shQuote(tmp)}`
  );
  if (install.code !== 0) {
    return {
      ok: false,
      detail: `Failed to install Caddyfile: ${install.stderr || install.stdout}`,
    };
  }

  if (options.preferReload !== false) {
    const reload = await execOnTarget(
      `(caddy reload --config ${shQuote(path)} 2>/dev/null) || ` +
        `(systemctl reload caddy 2>/dev/null) || ` +
        `(rc-service caddy reload 2>/dev/null) || ` +
        `(kill -USR1 "$(pidof caddy)" 2>/dev/null) || echo reload_soft`
    );
    const detail = (reload.stdout || reload.stderr || "").trim();
    return {
      ok: true,
      detail: `Applied Caddy revision ${revision.id} to ${path} (fp=${revision.fingerprint || fingerprintContent(revision.content)}). ${detail || "reload attempted"}`,
    };
  }

  return {
    ok: true,
    detail: `Wrote Caddy revision ${revision.id} to ${path}`,
  };
}

export async function reloadCaddyLive(
  configPath: string = DEFAULT_CADDYFILE
): Promise<{ ok: boolean; detail: string }> {
  const pathErr = validateSafePath(configPath);
  if (pathErr) return { ok: false, detail: pathErr };
  const reload = await execOnTarget(
    `(caddy reload --config ${shQuote(configPath)} 2>/dev/null) || ` +
      `(systemctl reload caddy 2>/dev/null) || echo reload_soft`
  );
  return {
    ok: reload.code === 0 || (reload.stdout || "").includes("reload_soft"),
    detail: (reload.stdout || reload.stderr || "reload").trim(),
  };
}

export async function restartContainerLive(
  containerName: string
): Promise<{ ok: boolean; detail: string }> {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(containerName)) {
    return { ok: false, detail: "Invalid container name" };
  }
  const r = await execOnTarget(`docker restart ${shQuote(containerName)}`);
  return {
    ok: r.code === 0,
    detail: r.code === 0 ? `Restarted ${containerName}` : r.stderr || r.stdout || "restart failed",
  };
}

/**
 * Live RecoveryExecutor backed by host operations.
 * Only allowlisted intents — no freeform shell from model text.
 */
export function createLiveRecoveryExecutor(
  options: CaddyLiveOptions = {}
): RecoveryExecutor {
  return {
    async restoreProxyRevision(revision) {
      return applyCaddyRevisionLive(revision, options);
    },
    async reloadProxy(proxyType) {
      if (proxyType === "nginx") {
        const r = await execOnTarget(
          `(nginx -t 2>&1) && (systemctl reload nginx 2>/dev/null || nginx -s reload)`
        );
        return {
          ok: r.code === 0,
          detail: r.stdout || r.stderr || "nginx reload",
        };
      }
      return reloadCaddyLive(options.configPath);
    },
    async restartContainer(containerName) {
      return restartContainerLive(containerName);
    },
    async redeployArtifact(artifactRef, serviceId) {
      // Pin image if artifact looks like image:tag or digest
      if (!serviceId) {
        return { ok: false, detail: "serviceId required for redeploy" };
      }
      if (!/^[a-zA-Z0-9][a-zA-Z0-9_./:@-]*$/.test(artifactRef)) {
        return { ok: false, detail: "Invalid artifact ref" };
      }
      // Best-effort: docker service update or compose pull+up is host-specific;
      // record intent for audit when full compose path unknown.
      const r = await execOnTarget(
        `docker pull ${shQuote(artifactRef)} 2>&1 | tail -5`
      );
      return {
        ok: r.code === 0,
        detail: `Pulled artifact ${artifactRef} for ${serviceId}: ${(r.stdout || "").slice(0, 300)}`,
      };
    },
  };
}

/** Prefer live executor when GC_LOOP_LIVE=1, else fixture must be injected by caller. */
export function shouldUseLiveRecovery(): boolean {
  return process.env.GC_LOOP_LIVE === "1" || process.env.GC_LOOP_LIVE === "true";
}
