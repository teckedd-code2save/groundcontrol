import {
  execOnVps,
  getSystemConfig,
  shQuote,
  type VpsConnection,
} from "@/lib/vps";

/**
 * A single service declared inside a compose file.
 */
export interface ComposeServiceInfo {
  name: string;
  image?: string;
  build?: boolean;
  ports?: string[];
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
} {
  const services: ComposeServiceInfo[] = [];
  const lines = content.split("\n");
  let inServices = false;
  let current: ComposeServiceInfo | null = null;
  let serviceIndent = -1;
  let collectingPorts = false;
  let portsIndent = -1;
  let domain: string | undefined;

  const finalize = () => {
    if (current) services.push(current);
    current = null;
    collectingPorts = false;
  };

  for (const rawLine of lines) {
    const line = rawLine.replace(/\r/g, "");
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const indent = line.length - line.replace(/^\s*/, "").length;

    // Domain heuristic: Caddy / virtual-host / traefik labels anywhere in file.
    if (!domain) {
      const domainMatch =
        trimmed.match(
          /(?:caddy|VIRTUAL_HOST|virtual_host|hostname)["']?\s*[:=]\s*["']?([a-z0-9.-]+\.[a-z]{2,})/i
        ) || trimmed.match(/Host\(`([a-z0-9.-]+\.[a-z]{2,})`\)/i);
      if (domainMatch) domain = domainMatch[1];
    }

    // Top-level key detection (indent 0).
    if (indent === 0 && /^[a-zA-Z0-9_-]+:/.test(trimmed)) {
      if (/^services:/.test(trimmed)) {
        finalize();
        inServices = true;
        serviceIndent = -1;
        continue;
      }
      // A different top-level key ends the services section.
      finalize();
      inServices = false;
      continue;
    }

    if (!inServices) continue;

    // Determine the service-name indent the first time we see a child of services:.
    if (serviceIndent === -1 && indent > 0 && /^[a-zA-Z0-9_.-]+:/.test(trimmed)) {
      serviceIndent = indent;
    }

    // A service name line (bare "name:" at the service indent).
    if (indent === serviceIndent && /^[a-zA-Z0-9_.-]+:\s*$/.test(trimmed)) {
      finalize();
      current = { name: trimmed.replace(/:\s*$/, "") };
      continue;
    }

    if (!current) continue;

    // Anything at or above the service indent that isn't a service name ends
    // the current service's property block.
    if (indent <= serviceIndent) {
      collectingPorts = false;
      continue;
    }

    // ports list items
    if (collectingPorts) {
      if (indent > portsIndent && trimmed.startsWith("-")) {
        const p = trimmed
          .replace(/^-\s*/, "")
          .replace(/^["']|["']$/g, "")
          .trim();
        if (p) (current.ports ||= []).push(p);
        continue;
      }
      collectingPorts = false;
    }

    const propMatch = trimmed.match(/^([a-zA-Z0-9_-]+):\s*(.*)$/);
    if (!propMatch) continue;
    const key = propMatch[1];
    const value = propMatch[2].trim();

    if (key === "image") {
      current.image = value.replace(/^["']|["']$/g, "");
    } else if (key === "build") {
      current.build = true;
    } else if (key === "ports") {
      if (value && value.startsWith("[")) {
        // inline list: ["80:80", "443:443"]
        const inner = value.replace(/^\[|\]$/g, "");
        inner
          .split(",")
          .map((s) => s.replace(/["'\s]/g, ""))
          .filter(Boolean)
          .forEach((p) => (current!.ports ||= []).push(p));
      } else {
        collectingPorts = true;
        portsIndent = indent;
      }
    }
  }

  finalize();
  return { services, domain };
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
  let config: any;
  try {
    config = await getSystemConfig();
  } catch (err: any) {
    return { projects: [], plainDirs: [], error: err?.message || "config error" };
  }
  const root = normalizeRoot(config.projectRoot);

  // --- 1 & 2: locate compose files ---
  let rows: { composePath: string; hasGit: boolean }[] = [];
  let scanError: string | undefined;
  try {
    let out = await execOnVps(buildFindCommand(root), vps);
    if (!out.stdout.trim()) {
      out = await execOnVps(buildFallbackCommand(root), vps);
    }
    rows = out.stdout
      .trim()
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean)
      .map((line) => {
        const [composePath, git] = line.split("\t");
        return { composePath: (composePath || "").trim(), hasGit: git?.trim() === "1" };
      })
      .filter((r) => r.composePath.startsWith("/"));
    if (out.code !== 0 && rows.length === 0) {
      scanError = out.stderr?.trim() || `scan exited ${out.code}`;
    }
  } catch (err: any) {
    return { projects: [], plainDirs: [], error: err?.message || "scan failed" };
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
    // Emit a delimiter + content per file so we can split reliably.
    const catScript = dirs
      .map((dir) => {
        const file = byDir.get(dir)!.composePath;
        return `echo "===PROJECT:${dir}==="; cat ${shQuote(file)} 2>/dev/null || true`;
      })
      .join("; ");
    try {
      const catOut = await execOnVps(catScript, vps);
      const chunks = catOut.stdout.split(/^===PROJECT:(.+?)===$/m);
      // chunks: ["", dir1, content1, dir2, content2, ...]
      for (let i = 1; i < chunks.length; i += 2) {
        const dir = chunks[i].trim();
        const content = chunks[i + 1] ?? "";
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
    const rel = dir.startsWith(root + "/") ? dir.slice(root.length + 1) : dir;
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
    });
  }

  // --- 4: surface plain (compose-less) top-level dirs ---
  let plainDirs: string[] = [];
  try {
    const topOut = await execOnVps(buildTopDirsCommand(root), vps);
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
