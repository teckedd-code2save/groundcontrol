import {
  getSystemConfig,
  shQuote,
  type VpsConnection,
} from "@/lib/vps";
import { execOnTargetStrict } from "@/lib/host-exec";
import { parse } from "yaml";

/**
 * A single service declared inside a compose file.
 */
export interface ComposeServiceInfo {
  name: string;
  image?: string;
  build?: boolean;
  ports?: string[];
  environment?: string[];
  envFiles?: string[];
  labels?: string[];
  volumes?: string[];
  networks?: string[];
  dependsOn?: string[];
}

/**
 * A discovered project = a directory that contains a compose file.
 *
 * `slug` is unique across the scan. For nested projects we prefix the parent
 * directory name (e.g. `agent-flow/RentAWeekend`) so two projects named the
 * same under different parents don't collide.
 */
export interface ScannedProject {
  slug: string;
  /** Bare directory name (no parent prefix). */
  dirName: string;
  /** Human friendly name. */
  name: string;
  /** Absolute path to the project directory. */
  path: string;
  /** Absolute path to the compose file. */
  composePath: string;
  /** Parent directory name if this project is nested under a container dir. */
  parent: string | null;
  services: ComposeServiceInfo[];
  valid: boolean;
  parseError?: string;
  managed: boolean;
  /** Best-guess domain from the compose (label/env), if discoverable. */
  domain?: string;
  hasGit: boolean;
}

export interface ProjectScanResult {
  projects: ScannedProject[];
  /** Top-level dirs under projectRoot that have NO compose file anywhere inside. */
  plainDirs: string[];
  /** Set when the scan command itself failed / returned nothing. */
  error?: string;
}

const COMPOSE_FILENAMES = [
  "docker-compose.yml",
  "docker-compose.yaml",
  "compose.yml",
  "compose.yaml",
];

const MAX_DEPTH = 3;

/**
 * Single sh/BusyBox-portable command that locates every compose file under
 * `root` up to MAX_DEPTH and prints, for each one, the absolute compose path
 * plus whether a `.git` dir lives in the same directory. We avoid GNU-only
 * `find -printf`; instead `find ... -name <glob> -type f` (POSIX) emits one
 * path per line, and we annotate git presence in a small shell loop.
 *
 * Output line format (tab separated):
 *   <composePath>\t<hasGit:1|0>
 */
function buildFindCommand(root: string): string {
  const nameExpr = COMPOSE_FILENAMES.map((n) => `-name ${shQuote(n)}`).join(" -o ");
  // -maxdepth is supported by both GNU and BusyBox find. Wrap the name tests in
  // \( ... \) so the -o chain binds correctly alongside -type f.
  const find = `find ${shQuote(root)} -maxdepth ${MAX_DEPTH} -type f \\( ${nameExpr} \\) 2>/dev/null`;
  // For each compose file, emit "path\t1" if a sibling .git exists, else "...\t0".
  return `${find} | while IFS= read -r f; do d=$(dirname "$f"); if [ -e "$d/.git" ]; then printf '%s\\t1\\n' "$f"; else printf '%s\\t0\\n' "$f"; fi; done`;
}

/**
 * Fallback when `find` is unavailable or produced nothing: walk up to depth 3
 * with nested globbing. Pure POSIX sh. Emits the same "<path>\t<git>" rows.
 */
function buildFallbackCommand(root: string): string {
  const names = COMPOSE_FILENAMES.map((n) => shQuote(n)).join(" ");
  return [
    `root=${shQuote(root)};`,
    `emit() { if [ -e "$1/.git" ]; then printf '%s/%s\\t1\\n' "$1" "$2"; else printf '%s/%s\\t0\\n' "$1" "$2"; fi; };`,
    `for n in ${names}; do`,
    `  for d1 in "$root"/*; do`,
    `    [ -d "$d1" ] || continue;`,
    `    [ -f "$d1/$n" ] && emit "$d1" "$n";`,
    `    for d2 in "$d1"/*; do`,
    `      [ -d "$d2" ] || continue;`,
    `      [ -f "$d2/$n" ] && emit "$d2" "$n";`,
    `      for d3 in "$d2"/*; do`,
    `        [ -d "$d3" ] || continue;`,
    `        [ -f "$d3/$n" ] && emit "$d3" "$n";`,
    `      done;`,
    `    done;`,
    `  done;`,
    `done`,
  ].join(" ");
}

/** List immediate child directory names of root (POSIX, with ls fallback). */
function buildTopDirsCommand(root: string): string {
  return (
    `find ${shQuote(root)} -mindepth 1 -maxdepth 1 -type d 2>/dev/null | while IFS= read -r d; do basename "$d"; done; ` +
    `[ -z "$(find ${shQuote(root)} -mindepth 1 -maxdepth 1 -type d 2>/dev/null)" ] && ls -1 ${shQuote(root)} 2>/dev/null || true`
  );
}

function normalizeRoot(root: string): string {
  return (root || "/opt").replace(/\/+$/, "");
}

function deriveName(dirName: string): string {
  return dirName
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (l) => l.toUpperCase())
    .trim();
}

/**
 * Parse a compose file's `services:` block. Extends the approach used in
 * api/projects/compose/route.ts to also collect `ports` lists and any
 * Caddy/virtual-host label that hints at a domain.
 */
export function parseComposeServices(content: string): {
  services: ComposeServiceInfo[];
  domain?: string;
  valid: boolean;
  error?: string;
} {
  let doc: Record<string, unknown>;
  try {
    const parsed = parse(content) as Record<string, unknown> | null;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { services: [], valid: false, error: "Compose YAML must be an object" };
    }
    if (!parsed.services || typeof parsed.services !== "object" || Array.isArray(parsed.services)) {
      return { services: [], valid: false, error: "Compose file services must be a mapping" };
    }
    if (Object.keys(parsed.services as Record<string, unknown>).length === 0) {
      return { services: [], valid: false, error: "Compose file declared no services" };
    }
    doc = parsed;
  } catch (err) {
    return { services: [], valid: false, error: err instanceof Error ? err.message : "Compose YAML parse failed" };
  }

  const rawServices = doc.services as Record<string, unknown>;
  const services = Object.entries(rawServices).flatMap(([name, value]) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return [];
    const service = value as Record<string, unknown>;
    return [{
      name,
      image: typeof service.image === "string" ? service.image : undefined,
      build: service.build !== undefined,
      ports: normalizeStringList(service.ports),
      environment: normalizeEnvironmentKeys(service.environment),
      envFiles: normalizeStringList(service.env_file),
      labels: normalizeLabelList(service.labels),
      volumes: normalizeStringList(service.volumes),
      networks: normalizeStringList(service.networks),
      dependsOn: normalizeStringList(service.depends_on),
    }];
  });
  const domain = findDomainFromCompose(doc);

  return {
    services,
    domain,
    valid: services.length > 0,
    error: services.length > 0 ? undefined : "Compose file declared no parseable services",
  };
}

function normalizeStringList(value: unknown): string[] {
  if (typeof value === "string") return [value].filter(Boolean);
  if (Array.isArray(value)) {
    return value
      .map((entry) => {
        if (typeof entry === "string" || typeof entry === "number") return String(entry);
        if (entry && typeof entry === "object") return JSON.stringify(entry);
        return "";
      })
      .filter(Boolean);
  }
  if (value && typeof value === "object") return Object.keys(value as Record<string, unknown>);
  return [];
}

function normalizeEnvironmentKeys(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .map((entry) => String(entry || "").split("=")[0]?.trim())
      .filter(Boolean);
  }
  if (value && typeof value === "object") return Object.keys(value as Record<string, unknown>);
  return [];
}

function normalizeLabelList(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((entry) => String(entry || "")).filter(Boolean);
  if (value && typeof value === "object") {
    return Object.entries(value as Record<string, unknown>).map(([key, entry]) => `${key}=${String(entry ?? "")}`);
  }
  return [];
}

function findDomainFromCompose(doc: Record<string, unknown>): string | undefined {
  const text = JSON.stringify(doc);
  const match =
    text.match(/(?:caddy|VIRTUAL_HOST|virtual_host|hostname)["']?\s*[:=]\s*["']?([a-z0-9.-]+\.[a-z]{2,})/i) ||
    text.match(/Host\(`([a-z0-9.-]+\.[a-z]{2,})`\)/i);
  return match?.[1];
}

/**
 * Recursively scan the VPS filesystem for projects (compose-bearing dirs).
 *
 * Strategy:
 *  1. One `find` pass to list every compose file (with git flag).
 *  2. If that yields nothing, retry with a pure-sh fallback walker.
 *  3. Batch-read every compose file in one `cat` pass, parse services.
 *  4. List top-level dirs and subtract those that contributed a project to
 *     surface "plain" folders so nothing is hidden.
 *
 * All failures degrade gracefully to an empty result with `error` set.
 */
export async function scanProjectsTree(
  vps?: VpsConnection | null
): Promise<ProjectScanResult> {
  let config: { projectRoot: string; templateDeploymentRoot?: string | null };
  try {
    config = await getSystemConfig();
  } catch (err: unknown) {
    return { projects: [], plainDirs: [], error: err instanceof Error ? err.message : "config error" };
  }
  const root = normalizeRoot(config.projectRoot);
  const managedRoot = normalizeRoot(config.templateDeploymentRoot || "/srv/groundcontrol/deployments");
  const scanRoots = Array.from(new Set([root, managedRoot].filter(Boolean)));

  // --- 1 & 2: locate compose files ---
  let rows: { composePath: string; hasGit: boolean }[] = [];
  let scanError: string | undefined;
  try {
    const outputs = [];
    for (const scanRoot of scanRoots) {
      let out = await execOnTargetStrict(buildFindCommand(scanRoot), vps);
      if (!out.stdout.trim()) {
        out = await execOnTargetStrict(buildFallbackCommand(scanRoot), vps);
      }
      outputs.push(out);
      if (out.code !== 0 && !out.stdout.trim() && !scanError) {
        scanError = out.stderr?.trim() || `scan exited ${out.code} for ${scanRoot}`;
      }
    }
    rows = outputs
      .map((out) => out.stdout)
      .join("\n")
      .trim()
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean)
      .map((line) => {
        const [composePath, git] = line.split("\t");
        return { composePath: (composePath || "").trim(), hasGit: git?.trim() === "1" };
      })
      .filter((r) => r.composePath.startsWith("/"));
  } catch (err: unknown) {
    return { projects: [], plainDirs: [], error: err instanceof Error ? err.message : "scan failed" };
  }

  // De-dup by parent directory: a dir with both .yml and .yaml counts once,
  // preferring the conventional filename order.
  const byDir = new Map<string, { composePath: string; hasGit: boolean }>();
  const order = (p: string) => {
    const base = p.split("/").pop() || "";
    const idx = COMPOSE_FILENAMES.indexOf(base);
    return idx === -1 ? 99 : idx;
  };
  for (const row of rows) {
    const dir = row.composePath.replace(/\/[^/]+$/, "");
    const existing = byDir.get(dir);
    if (!existing || order(row.composePath) < order(existing.composePath)) {
      byDir.set(dir, row);
    }
  }

  // --- 3: read every compose file in one pass ---
  const dirs = Array.from(byDir.keys());
  const contentByDir = new Map<string, string>();
  if (dirs.length > 0) {
    // Emit a delimiter on its own line BEFORE each file. Critical: many compose
    // files omit a trailing newline, so `cat a; echo ===; cat b` glues the last
    // line of `a` onto the delimiter and the split fails — projects then look
    // "invalid" with 0 components (seen on optimi + groundcontrol-bootstrap).
    const catScript = dirs
      .map((dir) => {
        const file = byDir.get(dir)!.composePath;
        return (
          `printf '\\n===PROJECT:%s===\\n' ${shQuote(dir)}; ` +
          `cat ${shQuote(file)} 2>/dev/null || true; ` +
          `printf '\\n'`
        );
      })
      .join("; ");
    try {
      const catOut = await execOnTargetStrict(catScript, vps);
      const chunks = catOut.stdout.split(/^===PROJECT:(.+?)===$/m);
      // chunks: ["…", dir1, content1, dir2, content2, ...]
      for (let i = 1; i < chunks.length; i += 2) {
        const dir = chunks[i].trim();
        const content = (chunks[i + 1] ?? "").replace(/^\n/, "");
        contentByDir.set(dir, content);
      }
    } catch {
      // Non-fatal: projects will just have empty service lists.
    }
  }

  // --- assemble projects ---
  const usedTopDirs = new Set<string>();
  const slugCounts = new Map<string, number>();
  const projects: ScannedProject[] = [];

  for (const dir of dirs) {
    const meta = byDir.get(dir)!;
    const baseRoot = dir === managedRoot || dir.startsWith(managedRoot + "/") ? managedRoot : root;
    const rel = dir.startsWith(baseRoot + "/") ? dir.slice(baseRoot.length + 1) : dir;
    const parts = rel.split("/").filter(Boolean);
    const dirName = parts[parts.length - 1] || dir;
    const parent = parts.length > 1 ? parts[parts.length - 2] : null;
    // Track which top-level dir this project belongs to.
    if (parts.length > 0) usedTopDirs.add(parts[0]);

    let slug = parent ? `${parent}/${dirName}` : dirName;
    // Guard against any residual duplicate slugs.
    const count = slugCounts.get(slug) || 0;
    slugCounts.set(slug, count + 1);
    if (count > 0) slug = `${slug}-${count}`;

    const content = contentByDir.get(dir) || "";
    const parsed = parseComposeServices(content);

    projects.push({
      slug,
      dirName,
      name: deriveName(dirName),
      path: dir,
      composePath: meta.composePath,
      parent,
      services: parsed.services,
      domain: parsed.domain,
      hasGit: meta.hasGit,
      valid: parsed.valid,
      parseError: parsed.error,
      managed: dir === managedRoot || dir.startsWith(managedRoot + "/"),
    });
  }

  // --- 4: surface plain (compose-less) top-level dirs ---
  let plainDirs: string[] = [];
  try {
    const topOut = await execOnTargetStrict(buildTopDirsCommand(root), vps);
    const topDirs = Array.from(
      new Set(
        topOut.stdout
          .trim()
          .split("\n")
          .map((d) => d.trim())
          .filter(Boolean)
      )
    );
    plainDirs = topDirs.filter((d) => !usedTopDirs.has(d));
  } catch {
    // ignore — plainDirs stays empty
  }

  projects.sort((a, b) => a.slug.localeCompare(b.slug));

  return { projects, plainDirs, error: scanError };
}
