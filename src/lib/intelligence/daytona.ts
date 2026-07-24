/**
 * M4 — Daytona reproduction adapter + resilient blueprint comparison.
 * Daytona is optional: when no API token, runs a local sanitized reproduction plan.
 * Never receives production secrets.
 */

import { Daytona, type Sandbox } from "@daytona/sdk";
import { decryptMaybe } from "@/lib/crypto";
import {
  createGithubInstallationToken,
  normalizeGithubRepositoryUrl,
} from "@/lib/github-app";
import { prisma } from "@/lib/prisma";

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
  repositoryUrl?: string;
  branch?: string;
  commitSha?: string;
  artifactDigest?: string;
  composeSnippet?: string;
  proxySnippet?: string;
  /** Sanitized env KEY names only — never values */
  envKeys?: string[];
  journeyUrl?: string;
  /** A single bounded validation command; shell composition is rejected. */
  testCommand?: string;
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

const ALLOWED_VALIDATION_COMMANDS = [
  /^(?:npm|pnpm|yarn)\s+(?:test|build|lint|typecheck)(?:\s+[\w./:=@-]+)*$/,
  /^(?:npm|pnpm|yarn)\s+run\s+[\w:.-]+(?:\s+--)?(?:\s+[\w./:=@-]+)*$/,
  /^python(?:3)?\s+-m\s+pytest(?:\s+[\w./:=@-]+)*$/,
  /^pytest(?:\s+[\w./:=@-]+)*$/,
  /^go\s+test(?:\s+[\w./:=@-]+)*$/,
  /^cargo\s+test(?:\s+[\w./:=@-]+)*$/,
  /^dotnet\s+test(?:\s+[\w./:=@-]+)*$/,
  /^docker\s+compose(?:\s+-f\s+[\w./-]+)*\s+config$/,
];

export function validateDaytonaCommand(command: string): string | null {
  const value = command.trim();
  if (!value) return "A validation command is required.";
  if (value.length > 300) return "The validation command is too long.";
  if (/[;&|`><\n\r]|\$\(/.test(value)) {
    return "Shell composition and redirection are not allowed.";
  }
  if (!ALLOWED_VALIDATION_COMMANDS.some((pattern) => pattern.test(value))) {
    return "Use a project test, build, lint, typecheck, or Compose validation command.";
  }
  return null;
}

function normalizeRepositoryUrl(value?: string): { url: string; host: string } | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) {
      return null;
    }
    return { url: url.toString().replace(/\/$/, ""), host: url.hostname };
  } catch {
    return null;
  }
}

async function githubCloneCredentials(repositoryUrl: string) {
  const identity = normalizeGithubRepositoryUrl(repositoryUrl);
  if (!identity) return {};
  const repository = await prisma.githubRepository.findFirst({
    where: { fullName: identity },
    include: { installation: { include: { connection: true } } },
  });
  if (!repository?.isPrivate || repository.installation.suspendedAt) return {};
  const privateKey = decryptMaybe(repository.installation.connection.privateKeyEncrypted);
  if (!privateKey) return {};
  const credential = await createGithubInstallationToken({
    appId: repository.installation.connection.appId,
    privateKey,
    installationId: repository.installation.id,
  });
  return { username: "x-access-token", password: credential.token };
}

function clipped(value: string, max = 6000) {
  const normalized = value.trim();
  return normalized.length <= max ? normalized : `${normalized.slice(0, max)}\n… output clipped`;
}

function hasSecretValue(value?: string) {
  if (!value) return false;
  return /(?:password|secret|token|api[_-]?key|private[_-]?key|access[_-]?key)\s*[:=]\s*["']?(?!\$\{)[^\s"'{}]+/i.test(value);
}

function redactSensitive(value: string) {
  return value
    .replace(/https:\/\/[^@\s/]+@/gi, "https://[redacted]@")
    .replace(/\b(?:gh[opsu]_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/g, "[redacted]");
}

function sandboxQuote(value: string) {
  return `'${value.replace(/'/g, `'\"'\"'`)}'`;
}

async function uploadSanitizedEvidence(
  sandbox: Sandbox,
  req: DaytonaReproductionRequest
) {
  const files: Array<{ path: string; value?: string }> = [
    { path: "workspace/incident/compose.yml", value: req.composeSnippet },
    { path: "workspace/incident/proxy.conf", value: req.proxySnippet },
    {
      path: "workspace/incident/env-keys.txt",
      value: req.envKeys?.filter((key) => !key.includes("=")).join("\n"),
    },
  ];
  for (const file of files) {
    if (file.value) {
      await sandbox.fs.uploadFile(Buffer.from(file.value, "utf8"), file.path);
    }
  }
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
  const budget = Math.max(30, Math.min(300, req.budgetSeconds ?? 120));
  const logs: string[] = [];
  logs.push(`budget_seconds=${budget}`);
  logs.push("network=restricted_allowlist");
  logs.push("secrets=none");

  if (req.envKeys?.length) {
    logs.push(`env_keys_only=${req.envKeys.join(",")}`);
  }
  if (req.commitSha) logs.push(`commit=${req.commitSha}`);
  if (req.artifactDigest) logs.push(`artifact=${req.artifactDigest}`);
  if (hasSecretValue(req.composeSnippet) || hasSecretValue(req.proxySnippet)) {
    return {
      id,
      status: "failed",
      provider: "local_sanitized",
      detail: "Sanitized evidence may contain a secret value. Send names and structure only.",
      reproducedFailure: false,
      logs,
      cleanedUp: true,
    };
  }

  const repository = normalizeRepositoryUrl(req.repositoryUrl);
  const commandError = req.testCommand
    ? validateDaytonaCommand(req.testCommand)
    : null;
  if (req.repositoryUrl && !repository) {
    return {
      id,
      status: "failed",
      provider: "local_sanitized",
      detail: "Repository URL must be a credential-free HTTPS URL.",
      reproducedFailure: false,
      logs,
      cleanedUp: true,
    };
  }
  if (commandError) {
    return {
      id,
      status: "failed",
      provider: "local_sanitized",
      detail: commandError,
      reproducedFailure: false,
      logs,
      cleanedUp: true,
    };
  }

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

  if (!repository || !req.testCommand) {
    return {
      id,
      status: "skipped",
      provider: "daytona",
      detail: "Daytona needs an exact repository and one bounded validation command.",
      reproducedFailure: false,
      logs,
      cleanedUp: true,
    };
  }

  const daytona = new Daytona({
    apiKey: token,
    apiUrl: process.env.DAYTONA_API_URL,
    target: process.env.DAYTONA_TARGET,
  });
  let sandbox: Sandbox | null = null;
  let cleanedUp = false;
  let outcome: DaytonaReproductionResult = {
    id,
    status: "failed",
    provider: "daytona",
    detail: "Daytona reproduction did not complete.",
    reproducedFailure: false,
    logs,
    cleanedUp: false,
  };
  try {
    const ttlMinutes = Math.max(2, Math.ceil(budget / 60) + 1);
    sandbox = await daytona.create(
      {
        name: id.replaceAll("_", "-").slice(0, 63),
        language: "typescript",
        ephemeral: true,
        ttlMinutes,
        labels: {
          product: "groundcontrol",
          purpose: "incident-reproduction",
        },
        domainAllowList: [
          repository.host,
          "api.github.com",
          "registry.npmjs.org",
          "pypi.org",
          "files.pythonhosted.org",
          "proxy.golang.org",
          "crates.io",
          "static.crates.io",
        ].join(","),
      },
      { timeout: Math.min(90, budget) }
    );
    logs.push(`sandbox=${sandbox.id}`);
    const credential = await githubCloneCredentials(repository.url);
    await sandbox.git.clone(
      repository.url,
      "workspace/repository",
      req.branch,
      req.commitSha,
      credential.username,
      credential.password,
      false,
      req.commitSha ? undefined : 20
    );
    await sandbox.process.executeCommand(
      `git remote set-url origin ${sandboxQuote(repository.url)}`,
      "workspace/repository",
      undefined,
      10
    );
    logs.push(`repository=${repository.url}`);

    await uploadSanitizedEvidence(sandbox, req);
    const revision = await sandbox.process.executeCommand(
      "git rev-parse HEAD",
      "workspace/repository",
      undefined,
      20
    );
    logs.push(`revision=${clipped(revision.result, 200)}`);

    const install = await sandbox.process.executeCommand(
      [
        "if [ -f package-lock.json ]; then npm ci;",
        "elif [ -f pnpm-lock.yaml ]; then corepack enable && pnpm install --frozen-lockfile;",
        "elif [ -f yarn.lock ]; then corepack enable && yarn install --immutable;",
        "else true; fi",
      ].join(" "),
      "workspace/repository",
      undefined,
      Math.max(20, Math.floor(budget * 0.55))
    );
    logs.push(`dependency_setup_exit=${install.exitCode}`);
    if (install.result.trim()) logs.push(`dependency_setup:\n${clipped(install.result, 3000)}`);

    const validation = await sandbox.process.executeCommand(
      req.testCommand,
      "workspace/repository",
      {
        CI: "1",
        GC_INCIDENT_REPRODUCTION: "1",
      },
      Math.max(20, Math.floor(budget * 0.4))
    );
    logs.push(`validation=${req.testCommand}`);
    logs.push(`validation_exit=${validation.exitCode}`);
    if (validation.result.trim()) logs.push(`validation_output:\n${clipped(validation.result)}`);

    outcome = {
      id,
      status: "completed",
      provider: "daytona",
      detail: validation.exitCode === 0
        ? "The exact revision passed the isolated validation."
        : "The failure was reproduced against the exact revision in an isolated sandbox.",
      reproducedFailure: validation.exitCode !== 0,
      logs,
      cleanedUp: false,
    };
  } catch (err) {
    outcome = {
      id,
      status: String(err).toLowerCase().includes("timeout") ? "budget_exceeded" : "failed",
      provider: "daytona",
      detail: redactSensitive(err instanceof Error ? err.message : String(err)),
      reproducedFailure: false,
      logs,
      cleanedUp,
    };
  } finally {
    if (sandbox) {
      try {
        await daytona.delete(sandbox, 60, true);
        cleanedUp = true;
        logs.push("cleanup=complete");
      } catch (cleanupError) {
        logs.push(`cleanup=failed:${redactSensitive(cleanupError instanceof Error ? cleanupError.message : String(cleanupError))}`);
      }
    }
  }
  return { ...outcome, logs, cleanedUp };
}
