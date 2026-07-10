/**
 * Managed template deployments under templateDeploymentRoot
 * (default: /srv/groundcontrol/deployments).
 *
 * Single source of truth for list / resolve / inspect / delete used by both
 * the AI agent tools and /api/deployments/delete-managed.
 */

import { getSystemConfig, getActiveVps, shQuote, type VpsConnection } from "./vps";
import { execOnTarget } from "./host-exec";
import { prisma } from "./prisma";

export const DEFAULT_MANAGED_ROOT = "/srv/groundcontrol/deployments";

export const COMPOSE_FILENAMES = [
  "docker-compose.yml",
  "docker-compose.yaml",
  "compose.yml",
  "compose.yaml",
] as const;

export type ManagedDeployment = {
  slug: string;
  path: string;
  composePath: string;
};

export type ResolveResult =
  | { ok: true; deployment: ManagedDeployment }
  | { ok: false; error: string; root: string; existing: string[]; lookedFor: string };

export type DeleteResult =
  | {
      ok: true;
      slug: string;
      path: string;
      composeOutput: string;
      removed: boolean;
      dbCleanup?: string;
    }
  | {
      ok: false;
      error: string;
      root?: string;
      existing?: string[];
      lookedFor?: string;
    };

export type InspectResult =
  | {
      ok: true;
      slug: string;
      path: string;
      composePath: string;
      compose: string;
      containers: string;
    }
  | {
      ok: false;
      error: string;
      root?: string;
      existing?: string[];
      lookedFor?: string;
    };

export type PreviewDeleteResult =
  | {
      ok: true;
      slug: string;
      path: string;
      composePath: string;
      containers: string;
      impact: string[];
    }
  | {
      ok: false;
      error: string;
      root?: string;
      existing?: string[];
      lookedFor?: string;
    };

function normalizeRoot(value: string): string {
  return value.replace(/\/+$/, "") || "/";
}

/** Pure helpers — unit-tested without a VPS. */

export function getManagedRootFromConfig(templateDeploymentRoot?: string | null): string {
  return normalizeRoot(templateDeploymentRoot || DEFAULT_MANAGED_ROOT);
}

/**
 * Normalize user/AI input to a deployment slug (directory basename).
 * Accepts: "gc-tunnel-proof", "/srv/.../gc-tunnel-proof", trailing slashes.
 * Rejects path traversal.
 */
export function normalizeDeploymentSlug(input: string): string | null {
  const raw = String(input || "").trim();
  if (!raw) return null;
  if (raw.includes("..")) return null;

  // Absolute or relative path → basename
  const cleaned = raw.replace(/\/+$/, "");
  const parts = cleaned.split("/").filter(Boolean);
  const slug = parts[parts.length - 1] || "";
  if (!slug) return null;
  // Basic safety: no null bytes / shell metacharacters that would break paths
  if (/[\0\n\r]/.test(slug)) return null;
  return slug;
}

/**
 * If input is an absolute path under managed root, return that path's basename
 * after verifying it lives under root; otherwise treat as slug.
 */
export function slugFromInput(input: string, root: string): string | null {
  const raw = String(input || "").trim().replace(/\/+$/, "");
  if (!raw) return null;
  if (raw.includes("..")) return null;

  const managedRoot = normalizeRoot(root);
  if (raw.startsWith("/")) {
    if (raw === managedRoot) return null;
    if (raw.startsWith(`${managedRoot}/`)) {
      const rest = raw.slice(managedRoot.length + 1);
      // Only allow one level under root for managed deployments
      const first = rest.split("/").filter(Boolean)[0];
      return first || null;
    }
    // Absolute path outside root — still try basename (caller may pass full path
    // from list_deployments on a different root config)
    return normalizeDeploymentSlug(raw);
  }
  return normalizeDeploymentSlug(raw);
}

/** Redact secrets from compose YAML / tool output before showing to the model. */
export function redactComposeSecrets(text: string): string {
  if (!text) return text;
  let out = text;

  // Cloudflare tunnel tokens and other JWTs / base64 tokens in "token <value>"
  out = out.replace(
    /(tunnel\s+--[^\n]*--token\s+)([A-Za-z0-9_\-+=/.]{20,})/gi,
    "$1[REDACTED_TOKEN]"
  );
  out = out.replace(
    /(token[=:\s]+)([A-Za-z0-9_\-+=/.]{40,})/gi,
    "$1[REDACTED_TOKEN]"
  );

  // eyJ… JWT-like blobs
  out = out.replace(/\beyJ[A-Za-z0-9_\-+=/.]{20,}\b/g, "[REDACTED_JWT]");

  // Common secret env assignments
  const secretKeys =
    "APP_SECRET|SECRET|PASSWORD|PASSWD|TOKEN|API_KEY|APIKEY|PRIVATE_KEY|ACCESS_KEY|AUTH_TOKEN|CF_API|CLOUDFLARE";
  out = out.replace(
    new RegExp(`((?:${secretKeys})\\s*[=:]\\s*)([^\\s"'\\n]+)`, "gi"),
    "$1[REDACTED]"
  );
  out = out.replace(
    new RegExp(`((?:${secretKeys})\\s*:\\s*["'])([^"']+)(["'])`, "gi"),
    "$1[REDACTED]$3"
  );

  return out;
}

export async function getManagedRoot(): Promise<string> {
  try {
    const config = await getSystemConfig();
    return getManagedRootFromConfig(config.templateDeploymentRoot);
  } catch {
    return DEFAULT_MANAGED_ROOT;
  }
}

async function exec(
  command: string,
  vps?: VpsConnection | null
): Promise<{ stdout: string; stderr: string; code: number }> {
  return execOnTarget(command, vps);
}

/** List managed deployment directories that contain a compose file. */
export async function listManagedDeployments(
  vps?: VpsConnection | null
): Promise<{ root: string; deployments: ManagedDeployment[] }> {
  const root = await getManagedRoot();
  const conn = vps ?? (await getActiveVps());

  const nameExpr = COMPOSE_FILENAMES.map((n) => `-name ${shQuote(n)}`).join(" -o ");
  // maxdepth 2: root/slug/compose.yml
  const cmd = [
    `root=${shQuote(root)}`,
    `if [ ! -d "$root" ]; then echo ""; exit 0; fi`,
    `find "$root" -mindepth 2 -maxdepth 2 -type f \\( ${nameExpr} \\) 2>/dev/null | while IFS= read -r f; do`,
    `  dir=$(dirname "$f")`,
    `  printf '%s\\t%s\\n' "$(basename "$dir")" "$f"`,
    `done`,
  ].join("\n");

  const result = await exec(cmd, conn);
  const bySlug = new Map<string, ManagedDeployment>();

  for (const line of result.stdout.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const [slug, composePath] = trimmed.split("\t");
    if (!slug || !composePath) continue;
    const path = composePath.replace(/\/[^/]+$/, "");
    // Prefer docker-compose.yml over compose.yaml when duplicates
    const existing = bySlug.get(slug);
    if (!existing) {
      bySlug.set(slug, { slug, path, composePath });
    } else {
      const pref = (p: string) => {
        const base = p.split("/").pop() || "";
        const idx = (COMPOSE_FILENAMES as readonly string[]).indexOf(base);
        return idx === -1 ? 99 : idx;
      };
      if (pref(composePath) < pref(existing.composePath)) {
        bySlug.set(slug, { slug, path, composePath });
      }
    }
  }

  const deployments = Array.from(bySlug.values()).sort((a, b) =>
    a.slug.localeCompare(b.slug)
  );
  return { root, deployments };
}

/**
 * Resolve a slug or path to a managed deployment.
 * Fail closed — never invent a sibling match.
 */
export async function resolveManagedDeployment(
  input: string,
  vps?: VpsConnection | null
): Promise<ResolveResult> {
  const root = await getManagedRoot();
  const conn = vps ?? (await getActiveVps());
  const slug = slugFromInput(input, root);
  const lookedFor = String(input || "").trim();

  const listExisting = async (): Promise<string[]> => {
    const { deployments } = await listManagedDeployments(conn);
    return deployments.map((d) => d.slug);
  };

  if (!slug) {
    return {
      ok: false,
      error: `Invalid deployment identifier: ${lookedFor || "(empty)"}`,
      root,
      existing: await listExisting(),
      lookedFor,
    };
  }

  // 1) Direct path check for each compose filename
  const directChecks = COMPOSE_FILENAMES.map(
    (name) =>
      `f=${shQuote(`${root}/${slug}/${name}`)}; if [ -f "$f" ]; then printf '%s\\n' "$f"; exit 0; fi`
  ).join("\n");
  const direct = await exec(
    `${directChecks}\n# not found\nexit 0`,
    conn
  );
  const directPath = direct.stdout.trim().split("\n").filter(Boolean)[0];
  if (directPath) {
    return {
      ok: true,
      deployment: {
        slug,
        path: `${root}/${slug}`,
        composePath: directPath,
      },
    };
  }

  // 2) Case-insensitive basename match among listed deployments
  const { deployments } = await listManagedDeployments(conn);
  const lower = slug.toLowerCase();
  const match = deployments.find((d) => d.slug.toLowerCase() === lower);
  if (match) {
    return { ok: true, deployment: match };
  }

  return {
    ok: false,
    error: `Deployment "${slug}" not found under ${root}.`,
    root,
    existing: deployments.map((d) => d.slug),
    lookedFor: slug,
  };
}

export async function inspectManagedDeployment(
  input: string,
  vps?: VpsConnection | null
): Promise<InspectResult> {
  const conn = vps ?? (await getActiveVps());
  const resolved = await resolveManagedDeployment(input, conn);
  if (!resolved.ok) {
    return {
      ok: false,
      error: resolved.error,
      root: resolved.root,
      existing: resolved.existing,
      lookedFor: resolved.lookedFor,
    };
  }

  const { deployment } = resolved;
  const [composeResult, statusResult] = await Promise.all([
    exec(`cat ${shQuote(deployment.composePath)} 2>/dev/null || true`, conn),
    exec(
      `cd ${shQuote(deployment.path)} && (docker compose ps --format json 2>/dev/null || docker-compose ps 2>/dev/null || echo "No containers running")`,
      conn
    ),
  ]);

  return {
    ok: true,
    slug: deployment.slug,
    path: deployment.path,
    composePath: deployment.composePath,
    compose: redactComposeSecrets(composeResult.stdout || ""),
    containers: statusResult.stdout || "",
  };
}

export async function previewDeleteManagedDeployment(
  input: string,
  vps?: VpsConnection | null
): Promise<PreviewDeleteResult> {
  const conn = vps ?? (await getActiveVps());
  const resolved = await resolveManagedDeployment(input, conn);
  if (!resolved.ok) {
    return {
      ok: false,
      error: resolved.error,
      root: resolved.root,
      existing: resolved.existing,
      lookedFor: resolved.lookedFor,
    };
  }

  const { deployment } = resolved;
  const statusResult = await exec(
    `cd ${shQuote(deployment.path)} && (docker compose ps -a 2>/dev/null || docker-compose ps -a 2>/dev/null || echo "(compose ps unavailable)")`,
    conn
  );

  const impact = [
    `Stop and remove compose services in ${deployment.path}`,
    `Delete deployment directory ${deployment.path}`,
    `Compose project name defaults to directory name (no invented -p flag)`,
  ];
  if (/cloudflared/i.test(statusResult.stdout || "")) {
    impact.push("cloudflared tunnel connector will be stopped");
  }

  return {
    ok: true,
    slug: deployment.slug,
    path: deployment.path,
    composePath: deployment.composePath,
    containers: statusResult.stdout || "",
    impact,
  };
}

async function cleanupDbForDeployment(slug: string, path: string): Promise<string> {
  try {
    const projects = await prisma.project.findMany({
      where: {
        OR: [{ slug }, { path }],
      },
      select: { id: true, slug: true },
    });
    if (projects.length === 0) return "no matching Project rows";

    const ids = projects.map((p) => p.id);
    // Cascades handle deployments / env profiles via schema
    await prisma.project.deleteMany({ where: { id: { in: ids } } });
    return `removed Project rows: ${projects.map((p) => p.slug).join(", ")}`;
  } catch (err) {
    return `db cleanup skipped: ${err instanceof Error ? err.message : String(err)}`;
  }
}

/**
 * Tear down a managed deployment: compose down (in-directory), rm -rf, optional DB cleanup.
 * Never falls back to deleting a random sibling.
 */
export async function deleteManagedDeployment(
  input: string,
  options: { deleteVolumes?: boolean; cleanupDb?: boolean } = {},
  vps?: VpsConnection | null
): Promise<DeleteResult> {
  const conn = vps ?? (await getActiveVps());
  if (!conn) {
    return { ok: false, error: "No active VPS connected." };
  }

  const resolved = await resolveManagedDeployment(input, conn);
  if (!resolved.ok) {
    return {
      ok: false,
      error: resolved.error,
      root: resolved.root,
      existing: resolved.existing,
      lookedFor: resolved.lookedFor,
    };
  }

  const { deployment } = resolved;
  const deleteVolumes = options.deleteVolumes === true;
  const volFlag = deleteVolumes ? " -v" : "";

  // cwd-based down — matches UI path; do NOT invent -p project names
  const teardown = [
    `set -u`,
    `dir=${shQuote(deployment.path)}`,
    `if [ ! -d "$dir" ]; then echo "Deployment path does not exist: $dir" >&2; exit 2; fi`,
    `compose_cmd=""`,
    `if docker compose version >/dev/null 2>&1; then compose_cmd="docker compose";`,
    `elif command -v docker-compose >/dev/null 2>&1; then compose_cmd="docker-compose"; fi`,
    `compose_out=""`,
    `if [ -n "$compose_cmd" ]; then`,
    `  cd "$dir" && compose_out=$($compose_cmd down${volFlag} 2>&1) || true`,
    `  printf '%s\\n' "$compose_out"`,
    `else`,
    `  echo "docker compose not available; removing directory only"`,
    `fi`,
    `rm -rf "$dir"`,
    `if [ -d "$dir" ]; then echo "Failed to remove $dir" >&2; exit 3; fi`,
    `printf 'Deleted %s\\n' "$dir"`,
  ].join("\n");

  const result = await exec(teardown, conn);
  if (result.code !== 0) {
    return {
      ok: false,
      error: result.stderr || result.stdout || "Delete failed",
      lookedFor: deployment.slug,
    };
  }

  let dbCleanup: string | undefined;
  if (options.cleanupDb !== false) {
    dbCleanup = await cleanupDbForDeployment(deployment.slug, deployment.path);
  }

  return {
    ok: true,
    slug: deployment.slug,
    path: deployment.path,
    composeOutput: result.stdout || "",
    removed: true,
    dbCleanup,
  };
}

/** Format resolve failure for AI tools (includes existing slugs). */
export function formatResolveFailure(
  result: Extract<ResolveResult, { ok: false }>
): string {
  const existing =
    result.existing.length > 0
      ? `Existing deployments: ${result.existing.join(", ")}`
      : `No deployments found under ${result.root}`;
  return `${result.error}\n${existing}`;
}
