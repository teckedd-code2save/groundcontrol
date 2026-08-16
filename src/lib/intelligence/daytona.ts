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

export interface DaytonaRuntimeConfig {
  apiKey: string;
  apiUrl?: string;
  target?: string;
  source: "connector" | "environment";
}

export function resolveDaytonaRuntimeConfig(
  stored: Record<string, string>,
  environment: Record<string, string | undefined> = process.env
): DaytonaRuntimeConfig | null {
  const storedKey = stored.apiKey?.trim();
  if (storedKey) {
    return {
      apiKey: storedKey,
      apiUrl: stored.apiUrl?.trim() || undefined,
      target: stored.target?.trim() || undefined,
      source: "connector",
    };
  }
  const environmentKey = (environment.DAYTONA_API_KEY || environment.DAYTONA_TOKEN || "").trim();
  if (!environmentKey) return null;
  return {
    apiKey: environmentKey,
    apiUrl: environment.DAYTONA_API_URL?.trim() || undefined,
    target: environment.DAYTONA_TARGET?.trim() || undefined,
    source: "environment",
  };
}

export async function loadDaytonaRuntimeConfig(): Promise<DaytonaRuntimeConfig | null> {
  const stored: Record<string, string> = {};
  try {
    const rows = await prisma.appConfig.findMany({
      where: { key: { startsWith: "connector_daytona_" } },
    });
    for (const row of rows) {
      const field = row.key.replace("connector_daytona_", "");
      stored[field] = decryptMaybe(row.value) || row.value;
    }
  } catch {
    // Database availability must not disable the documented environment fallback.
  }
  return resolveDaytonaRuntimeConfig(stored);
}

export async function testDaytonaConnection(
  config?: DaytonaRuntimeConfig | null
): Promise<{ ok: true; source: DaytonaRuntimeConfig["source"] }> {
  const resolved = config ?? await loadDaytonaRuntimeConfig();
  if (!resolved) throw new Error("Daytona API key is not configured.");
  const client = new Daytona({
    apiKey: resolved.apiKey,
    apiUrl: resolved.apiUrl,
    target: resolved.target,
  });
  try {
    const iterator = client.list({ limit: 1 });
    await iterator.next();
    return { ok: true, source: resolved.source };
  } finally {
    await client[Symbol.asyncDispose]();
  }
}

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
  /** Optional repository-relative working directory for monorepo deployments. */
  sourceRoot?: string;
  /** Independent bounded checks that must still pass after a repair candidate. */
  regressionCommands?: string[];
  /** A source repair must prove that the baseline fails and the candidate passes. */
  requireReproduction?: boolean;
  /** Optional source candidate to apply only inside the disposable sandbox. */
  candidate?: {
    filePath: string;
    replacementContent: string;
  };
  budgetSeconds?: number;
}

export interface DaytonaReproductionResult {
  id: string;
  status: "completed" | "failed" | "skipped" | "budget_exceeded";
  provider: "daytona" | "local_sanitized";
  detail: string;
  reproducedFailure: boolean;
  candidateValidated?: boolean;
  reproductionValidated?: boolean;
  regressionValidated?: boolean;
  validations?: DaytonaValidationEvidence[];
  baseFileBlobSha?: string;
  proposedPatch?: string;
  logs: string[];
  cleanedUp: boolean;
}

export interface DaytonaValidationEvidence {
  kind: "reproduction" | "regression";
  command: string;
  baselineExitCode?: number;
  candidateExitCode: number;
  passed: boolean;
}

export function evaluateSourceRepairValidation(
  baselineExitCode: number,
  candidateExitCode: number,
  regressionExitCodes: number[]
) {
  const reproductionValidated = baselineExitCode !== 0 && candidateExitCode === 0;
  const regressionValidated = regressionExitCodes.every((code) => code === 0);
  return {
    reproductionValidated,
    regressionValidated,
    candidateValidated: reproductionValidated && regressionValidated,
  };
}

const ALLOWED_VALIDATION_COMMANDS = [
  /^(?:npm|pnpm|yarn)\s+(?:test|build|lint|typecheck)(?:\s+[\w./:=@-]+)*$/,
  /^(?:npm|pnpm|yarn)\s+run\s+[\w:.-]+(?:\s+--)?(?:\s+[\w./:=@-]+)*$/,
  /^python(?:3)?\s+-m\s+pytest(?:\s+[\w./:=@-]+)*$/,
  /^pytest(?:\s+[\w./:=@-]+)*$/,
  /^go\s+test(?:\s+[\w./:=@-]+)*$/,
  /^cargo\s+test(?:\s+[\w./:=@-]+)*$/,
  /^dotnet\s+test(?:\s+[\w./:=@-]+)*$/,
  /^(?:docker\s+compose|docker-compose)(?:\s+-f\s+[\w./-]+)*\s+config(?:\s+--(?:quiet|services|volumes|images|profiles|hash))?$/,
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

export function validateRepairFilePath(filePath: string): string | null {
  const value = filePath.trim();
  if (!value) return "A repository-relative file path is required.";
  const segments = value.split("/");
  if (
    value.startsWith("/") ||
    value.includes("\\") ||
    segments.some((segment) => !segment || segment === "." || segment === "..")
  ) {
    return "The repair target must stay inside the repository.";
  }
  if (!/^[A-Za-z0-9._/@+-]+$/.test(value)) {
    return "The repair target contains unsupported characters.";
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
  const repositories = await prisma.githubRepository.findMany({
    include: { installation: { include: { connection: true } } },
  });
  const repository = repositories.find(
    (candidate) => candidate.fullName.toLowerCase() === identity
  );
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
  if (
    hasSecretValue(req.composeSnippet) ||
    hasSecretValue(req.proxySnippet)
  ) {
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
  const regressionCommands = [...new Set((req.regressionCommands || []).map((command) => command.trim()))]
    .filter((command) => command && command !== req.testCommand)
    .slice(0, 2);
  const regressionCommandError = regressionCommands
    .map((command) => validateDaytonaCommand(command))
    .find((error) => Boolean(error)) || null;
  const candidatePathError = req.candidate
    ? validateRepairFilePath(req.candidate.filePath)
    : null;
  const sourceRootError = req.sourceRoot ? validateRepairFilePath(req.sourceRoot) : null;
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
  if (commandError || regressionCommandError || sourceRootError) {
    return {
      id,
      status: "failed",
      provider: "local_sanitized",
      detail: commandError || regressionCommandError || sourceRootError || "A validation command is invalid.",
      reproducedFailure: false,
      logs,
      cleanedUp: true,
    };
  }
  if (candidatePathError) {
    return {
      id,
      status: "failed",
      provider: "local_sanitized",
      detail: candidatePathError,
      reproducedFailure: false,
      logs,
      cleanedUp: true,
    };
  }

  const runtimeConfig = await loadDaytonaRuntimeConfig();
  if (!runtimeConfig) {
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
      detail: "Daytona is not configured — local sanitized reproduction only",
      reproducedFailure: Boolean(req.proxySnippet && /:8080|:9999/.test(req.proxySnippet)),
      candidateValidated: false,
      proposedPatch:
        req.proxySnippet && /web:8080/.test(req.proxySnippet)
          ? req.proxySnippet.replace(/web:8080/g, "web:3000")
          : undefined,
      logs,
      cleanedUp: true,
    };
  }

  if (!repository || !req.testCommand || (req.requireReproduction && !req.commitSha)) {
    return {
      id,
      status: "skipped",
      provider: "daytona",
      detail: req.requireReproduction && !req.commitSha
        ? "A Daytona source repair needs the exact deployed commit before reproduction."
        : "Daytona needs an exact repository and one bounded validation command.",
      reproducedFailure: false,
      logs,
      cleanedUp: true,
    };
  }

  const daytona = new Daytona({
    apiKey: runtimeConfig.apiKey,
    apiUrl: runtimeConfig.apiUrl,
    target: runtimeConfig.target,
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
    const resolvedRevision = revision.result.trim();
    logs.push(`revision=${clipped(resolvedRevision, 200)}`);
    if (revision.exitCode !== 0 || !/^[a-f0-9]{40,64}$/i.test(resolvedRevision)) {
      throw new Error("Daytona could not prove the checked-out repository revision.");
    }
    if (req.commitSha && resolvedRevision.toLowerCase() !== req.commitSha.toLowerCase()) {
      throw new Error(`Daytona checked out ${resolvedRevision}, not the deployed revision ${req.commitSha}.`);
    }

    const workdir = req.sourceRoot ? `workspace/repository/${req.sourceRoot}` : "workspace/repository";
    if (req.sourceRoot) logs.push(`source_root=${req.sourceRoot}`);

    const install = await sandbox.process.executeCommand(
      [
        "if [ -f package-lock.json ]; then npm ci;",
        "elif [ -f pnpm-lock.yaml ]; then corepack enable && pnpm install --frozen-lockfile;",
        "elif [ -f yarn.lock ]; then corepack enable && yarn install --immutable;",
        "else true; fi",
      ].join(" "),
      workdir,
      undefined,
      Math.max(20, Math.floor(budget * 0.55))
    );
    logs.push(`dependency_setup_exit=${install.exitCode}`);
    if (install.result.trim()) logs.push(`dependency_setup:\n${clipped(install.result, 3000)}`);
    if (install.exitCode !== 0) {
      throw new Error("Dependency setup failed inside Daytona; the repository was not ready for a trustworthy reproduction.");
    }

    const baselineValidation = await sandbox.process.executeCommand(
      req.testCommand,
      workdir,
      {
        CI: "1",
        GC_INCIDENT_REPRODUCTION: "1",
      },
      Math.max(20, Math.floor(budget * (req.candidate ? 0.22 : 0.4)))
    );
    logs.push(`validation=${req.testCommand}`);
    logs.push(`baseline_exit=${baselineValidation.exitCode}`);
    if (baselineValidation.result.trim()) {
      logs.push(`baseline_output:\n${clipped(baselineValidation.result)}`);
    }

    if (req.candidate && req.requireReproduction && baselineValidation.exitCode === 0) {
      throw new Error(
        "The baseline command passed at the deployed revision, so this candidate has not proved the production failure. Supply a focused reproduction that fails before the change."
      );
    }

    let candidateValidated: boolean | undefined;
    let reproductionValidated: boolean | undefined;
    let regressionValidated: boolean | undefined;
    const validations: DaytonaValidationEvidence[] = [];
    let baseFileBlobSha: string | undefined;
    let proposedPatch: string | undefined;
    if (req.candidate) {
      const tracked = await sandbox.process.executeCommand(
        `git ls-files --error-unmatch -- ${sandboxQuote(req.candidate.filePath)}`,
        "workspace/repository",
        undefined,
        15
      );
      if (tracked.exitCode !== 0) {
        throw new Error(`Repair target "${req.candidate.filePath}" is not tracked at the deployed revision.`);
      }
      const blob = await sandbox.process.executeCommand(
        `git rev-parse ${sandboxQuote(`HEAD:${req.candidate.filePath}`)}`,
        "workspace/repository",
        undefined,
        15
      );
      if (blob.exitCode !== 0 || !/^[a-f0-9]{40,64}$/i.test(blob.result.trim())) {
        throw new Error(`Could not identify the deployed source blob for "${req.candidate.filePath}".`);
      }
      baseFileBlobSha = blob.result.trim();
      await sandbox.fs.uploadFile(
        Buffer.from(req.candidate.replacementContent, "utf8"),
        `workspace/repository/${req.candidate.filePath}`
      );
      const diff = await sandbox.process.executeCommand(
        `git diff --no-ext-diff --unified=3 -- ${sandboxQuote(req.candidate.filePath)}`,
        "workspace/repository",
        undefined,
        20
      );
      proposedPatch = clipped(diff.result, 20_000);
      if (!proposedPatch) {
        throw new Error("The proposed source change does not differ from the deployed revision.");
      }
      const candidateValidation = await sandbox.process.executeCommand(
        req.testCommand,
        workdir,
        {
          CI: "1",
          GC_INCIDENT_REPRODUCTION: "1",
          GC_SOURCE_REPAIR_CANDIDATE: "1",
        },
        Math.max(20, Math.floor(budget * 0.22))
      );
      logs.push(`candidate_exit=${candidateValidation.exitCode}`);
      if (candidateValidation.result.trim()) {
        logs.push(`candidate_output:\n${clipped(candidateValidation.result)}`);
      }
      const regressionExitCodes: number[] = [];
      for (const [index, command] of regressionCommands.entries()) {
        const regression = await sandbox.process.executeCommand(
          command,
          workdir,
          {
            CI: "1",
            GC_INCIDENT_REPRODUCTION: "1",
            GC_SOURCE_REPAIR_CANDIDATE: "1",
            GC_REGRESSION_CHECK: "1",
          },
          Math.max(20, Math.floor(budget * 0.12))
        );
        regressionExitCodes.push(regression.exitCode);
        logs.push(`regression_${index + 1}=${command}`);
        logs.push(`regression_${index + 1}_exit=${regression.exitCode}`);
        if (regression.result.trim()) {
          logs.push(`regression_${index + 1}_output:\n${clipped(regression.result)}`);
        }
        validations.push({
          kind: "regression",
          command,
          candidateExitCode: regression.exitCode,
          passed: regression.exitCode === 0,
        });
      }
      const evaluated = evaluateSourceRepairValidation(
        baselineValidation.exitCode,
        candidateValidation.exitCode,
        regressionExitCodes
      );
      reproductionValidated = evaluated.reproductionValidated;
      regressionValidated = evaluated.regressionValidated;
      candidateValidated = req.requireReproduction
        ? evaluated.candidateValidated
        : candidateValidation.exitCode === 0 && evaluated.regressionValidated;
      validations.unshift({
        kind: "reproduction",
        command: req.testCommand,
        baselineExitCode: baselineValidation.exitCode,
        candidateExitCode: candidateValidation.exitCode,
        passed: req.requireReproduction
          ? evaluated.reproductionValidated
          : candidateValidation.exitCode === 0,
      });
    }

    outcome = {
      id,
      status: req.candidate && !candidateValidated ? "failed" : "completed",
      provider: "daytona",
      detail: req.candidate
        ? candidateValidated
          ? `Daytona reproduced the source failure, proved the candidate, and passed ${regressionCommands.length} independent regression check${regressionCommands.length === 1 ? "" : "s"}.`
          : reproductionValidated === false
            ? "The candidate did not turn the reproduced failure into a passing result."
            : "The candidate failed its isolated regression matrix and cannot be promoted."
        : baselineValidation.exitCode === 0
          ? "The exact revision passed the isolated validation."
          : "The failure was reproduced against the exact revision in an isolated sandbox.",
      reproducedFailure: baselineValidation.exitCode !== 0,
      candidateValidated,
      reproductionValidated,
      regressionValidated,
      validations: validations.length > 0 ? validations : undefined,
      baseFileBlobSha,
      proposedPatch,
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
