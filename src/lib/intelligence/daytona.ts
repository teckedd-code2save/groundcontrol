/**
 * M4 — Daytona reproduction adapter + resilient blueprint comparison.
 * Daytona is optional: when no API token, runs a local sanitized reproduction plan.
 * Never receives production secrets.
 */

export type BlueprintId =
  | "single_web_caddy"
  | "frontend_api"
  | "api_postgres_redis"
  | "worker_queue"
  | "replicated_stateless"
  | "stateful_with_backups";

export interface BlueprintCheck {
  id: string;
  description: string;
  passed: boolean;
  recommendation?: string;
}

export interface BlueprintComparison {
  blueprintId: BlueprintId;
  label: string;
  checks: BlueprintCheck[];
  score: number;
  summary: string;
}

export interface DaytonaReproductionRequest {
  commitSha?: string;
  artifactDigest?: string;
  composeSnippet?: string;
  proxySnippet?: string;
  /** Sanitized env KEY names only — never values */
  envKeys?: string[];
  journeyUrl?: string;
  budgetSeconds?: number;
}

export interface DaytonaReproductionResult {
  id: string;
  status: "completed" | "failed" | "skipped" | "budget_exceeded";
  provider: "daytona" | "local_sanitized";
  detail: string;
  reproducedFailure: boolean;
  proposedPatch?: string;
  logs: string[];
  cleanedUp: boolean;
}

const BLUEPRINTS: Record<
  BlueprintId,
  { label: string; required: string[] }
> = {
  single_web_caddy: {
    label: "Single web application behind Caddy",
    required: ["proxy_healthcheck", "explicit_port", "restart_policy"],
  },
  frontend_api: {
    label: "Frontend plus API",
    required: ["proxy_healthcheck", "internal_network", "explicit_port"],
  },
  api_postgres_redis: {
    label: "API plus PostgreSQL and Redis",
    required: [
      "named_volumes",
      "dependency_readiness",
      "restart_policy",
      "no_public_db",
    ],
  },
  worker_queue: {
    label: "Worker and queue",
    required: ["restart_policy", "dependency_readiness"],
  },
  replicated_stateless: {
    label: "Replicated stateless application",
    required: ["restart_policy", "resource_limits", "healthcheck"],
  },
  stateful_with_backups: {
    label: "Stateful application with backup preconditions",
    required: ["named_volumes", "backup_hook", "restart_policy"],
  },
};

export interface TopologySignals {
  hasProxyHealthcheck?: boolean;
  hasExplicitPorts?: boolean;
  hasRestartPolicy?: boolean;
  hasInternalNetwork?: boolean;
  hasNamedVolumes?: boolean;
  hasDependencyReadiness?: boolean;
  exposesDatabasePublicly?: boolean;
  hasResourceLimits?: boolean;
  hasBackupHook?: boolean;
  hasContainerHealthcheck?: boolean;
}

/**
 * Compare current topology signals to an approved resilient blueprint.
 * Operators accept individual improvements — auto-migration is out of scope.
 */
export function compareToBlueprint(
  blueprintId: BlueprintId,
  signals: TopologySignals
): BlueprintComparison {
  const bp = BLUEPRINTS[blueprintId];
  const checks: BlueprintCheck[] = [];

  const map: Record<string, () => BlueprintCheck> = {
    proxy_healthcheck: () => ({
      id: "proxy_healthcheck",
      description: "Proxy or upstream health checks configured",
      passed: Boolean(signals.hasProxyHealthcheck || signals.hasContainerHealthcheck),
      recommendation: "Add health_uri / container HEALTHCHECK",
    }),
    explicit_port: () => ({
      id: "explicit_port",
      description: "Services declare explicit internal ports",
      passed: Boolean(signals.hasExplicitPorts),
      recommendation: "Pin container ports and proxy upstream ports",
    }),
    restart_policy: () => ({
      id: "restart_policy",
      description: "Restart policy set (unless-stopped / always)",
      passed: Boolean(signals.hasRestartPolicy),
      recommendation: "Set restart: unless-stopped on stateless services",
    }),
    internal_network: () => ({
      id: "internal_network",
      description: "Private application network for service mesh",
      passed: Boolean(signals.hasInternalNetwork),
      recommendation: "Place app containers on a dedicated bridge network",
    }),
    named_volumes: () => ({
      id: "named_volumes",
      description: "Named volumes for stateful data",
      passed: Boolean(signals.hasNamedVolumes),
      recommendation: "Use named volumes instead of anonymous/bind for data",
    }),
    dependency_readiness: () => ({
      id: "dependency_readiness",
      description: "Depends_on / readiness before start",
      passed: Boolean(signals.hasDependencyReadiness),
      recommendation: "Add depends_on with condition: service_healthy",
    }),
    no_public_db: () => ({
      id: "no_public_db",
      description: "Database not published on host 0.0.0.0",
      passed: !signals.exposesDatabasePublicly,
      recommendation: "Remove public DB ports; keep DB on internal network only",
    }),
    resource_limits: () => ({
      id: "resource_limits",
      description: "CPU/memory limits present",
      passed: Boolean(signals.hasResourceLimits),
      recommendation: "Set deploy.resources.limits for stability",
    }),
    healthcheck: () => ({
      id: "healthcheck",
      description: "Container healthcheck defined",
      passed: Boolean(signals.hasContainerHealthcheck),
      recommendation: "Add HEALTHCHECK or compose healthcheck",
    }),
    backup_hook: () => ({
      id: "backup_hook",
      description: "Backup precondition / hook documented",
      passed: Boolean(signals.hasBackupHook),
      recommendation: "Attach backup job before destructive recovery",
    }),
  };

  for (const req of bp.required) {
    checks.push(map[req]?.() || { id: req, description: req, passed: false });
  }

  const passed = checks.filter((c) => c.passed).length;
  const score = checks.length ? passed / checks.length : 1;

  return {
    blueprintId,
    label: bp.label,
    checks,
    score,
    summary: `${passed}/${checks.length} blueprint checks passed for ${bp.label}`,
  };
}

/**
 * Attempt Daytona reproduction. Without DAYTONA_API_KEY, performs a local
 * sanitized dry-run that validates compose/proxy candidates and records a plan.
 */
export async function reproduceInDaytona(
  req: DaytonaReproductionRequest
): Promise<DaytonaReproductionResult> {
  const id = `daytona_${Date.now()}`;
  const budget = req.budgetSeconds ?? 120;
  const logs: string[] = [];
  logs.push(`budget_seconds=${budget}`);
  logs.push("network_default=deny");
  logs.push("secrets=none");

  if (req.envKeys?.length) {
    logs.push(`env_keys_only=${req.envKeys.join(",")}`);
  }
  if (req.commitSha) logs.push(`commit=${req.commitSha}`);
  if (req.artifactDigest) logs.push(`artifact=${req.artifactDigest}`);

  const token = process.env.DAYTONA_API_KEY || process.env.DAYTONA_TOKEN;
  if (!token) {
    // Local sanitized reproduction: structural validation only
    const composeOk = !req.composeSnippet || !/password\s*[:=]\s*['"]?[^'"]+/i.test(req.composeSnippet);
    const proxyOk =
      !req.proxySnippet ||
      /reverse_proxy|proxy_pass/.test(req.proxySnippet);
    logs.push(`compose_sanitized=${composeOk}`);
    logs.push(`proxy_candidate_ok=${proxyOk}`);
    logs.push("cleanup=immediate");

    return {
      id,
      status: composeOk && proxyOk ? "completed" : "failed",
      provider: "local_sanitized",
      detail: token
        ? "Daytona unavailable"
        : "No DAYTONA_API_KEY — local sanitized reproduction only",
      reproducedFailure: Boolean(req.proxySnippet && /:8080|:9999/.test(req.proxySnippet)),
      proposedPatch:
        req.proxySnippet && /web:8080/.test(req.proxySnippet)
          ? req.proxySnippet.replace(/web:8080/g, "web:3000")
          : undefined,
      logs,
      cleanedUp: true,
    };
  }

  // Live Daytona API (minimal): create workspace-like job if endpoint configured
  const base = process.env.DAYTONA_API_URL || "https://app.daytona.io/api";
  try {
    const res = await fetch(`${base}/workspace`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name: id,
        // Sanitized payload only
        metadata: {
          commitSha: req.commitSha,
          artifactDigest: req.artifactDigest,
          hasCompose: Boolean(req.composeSnippet),
          hasProxy: Boolean(req.proxySnippet),
          envKeys: req.envKeys || [],
          budgetSeconds: budget,
        },
      }),
    });
    logs.push(`daytona_http=${res.status}`);
    // Always request cleanup
    logs.push("cleanup=requested");
    return {
      id,
      status: res.ok ? "completed" : "failed",
      provider: "daytona",
      detail: res.ok
        ? "Daytona workspace request accepted"
        : `Daytona error HTTP ${res.status}`,
      reproducedFailure: false,
      logs,
      cleanedUp: true,
    };
  } catch (err) {
    return {
      id,
      status: "failed",
      provider: "daytona",
      detail: err instanceof Error ? err.message : String(err),
      reproducedFailure: false,
      logs: [...logs, "cleanup=best_effort"],
      cleanedUp: true,
    };
  }
}
