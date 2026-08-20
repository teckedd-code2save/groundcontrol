import { promises as fs } from "node:fs";
import path from "node:path";
import { execOnVps, shQuote } from "@/lib/vps";
import type { SourceFile } from "./types";

const MAX_FILES = 60;
const MAX_BYTES_PER_FILE = 200_000;
const FILE_MARKER = "__GC_QA_FILE__";

const ENTRY_NAMES = new Set([
  "app.ts",
  "app.js",
  "server.ts",
  "server.js",
  "index.ts",
  "index.js",
  "route.ts",
  "route.js",
]);

const EXCLUDED_SEGMENTS = new Set([
  "node_modules",
  "dist",
  ".next",
  "build",
  ".git",
]);

function candidateRouteFile(relativePath: string): boolean {
  const normalized = relativePath.replace(/\\/g, "/");
  const segments = normalized.split("/");
  if (segments.some((segment) => EXCLUDED_SEGMENTS.has(segment))) return false;
  const base = segments[segments.length - 1] || "";
  if (ENTRY_NAMES.has(base)) return true;
  return segments.includes("routes");
}

function normalizeRoot(root: string): string | null {
  const value = root.trim();
  if (!value) return null;
  return value.startsWith("/") ? value : path.resolve(value);
}

export async function loadSourceFilesFromLocal(root: string): Promise<SourceFile[]> {
  const absolute = normalizeRoot(root);
  if (!absolute) return [];

  let entries: string[];
  try {
    entries = await fs.readdir(absolute, { recursive: true, encoding: "utf8" });
  } catch {
    return [];
  }

  const files: SourceFile[] = [];
  for (const entry of entries) {
    if (files.length >= MAX_FILES) break;
    const normalized = entry.replace(/\\/g, "/");
    if (!candidateRouteFile(normalized)) continue;
    const fullPath = path.join(absolute, entry);
    let stat;
    try {
      stat = await fs.stat(fullPath);
    } catch {
      continue;
    }
    if (!stat.isFile() || stat.size > MAX_BYTES_PER_FILE) continue;
    try {
      const content = await fs.readFile(fullPath, "utf8");
      files.push({ path: normalized, content });
    } catch {
      // Skip unreadable files.
    }
  }
  return files;
}

export async function loadSourceFilesFromHost(root: string): Promise<SourceFile[]> {
  const absolute = normalizeRoot(root);
  if (!absolute) return [];

  const command = [
    `find ${shQuote(absolute)} -type f \\( -name 'app.ts' -o -name 'app.js' -o -name 'server.ts' -o -name 'server.js' -o -name 'index.ts' -o -name 'index.js' -o -name 'route.ts' -o -name 'route.js' -o -path '*/routes/*' \\)`,
    `-not -path '*/node_modules/*' -not -path '*/dist/*' -not -path '*/.next/*' -not -path '*/build/*' -not -path '*/.git/*' 2>/dev/null`,
    `| head -200 | while IFS= read -r f; do printf '${FILE_MARKER} %s\\n' "$f"; cat "$f" 2>/dev/null; printf '\\n'; done`,
  ].join(" ");

  let stdout = "";
  let code = 0;
  try {
    const result = await execOnVps(command);
    stdout = result.stdout;
    code = result.code;
  } catch {
    return [];
  }
  if (code !== 0 && !stdout.trim()) return [];

  const files: SourceFile[] = [];
  const lines = stdout.split("\n");
  let currentPath: string | null = null;
  let currentLines: string[] = [];

  const flush = () => {
    if (!currentPath || files.length >= MAX_FILES) {
      currentPath = null;
      currentLines = [];
      return;
    }
    const relative = currentPath.replace(/\\/g, "/").replace(new RegExp(`^${absolute.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/`), "");
    files.push({ path: relative, content: currentLines.join("\n") });
    currentLines = [];
    currentPath = null;
  };

  for (const line of lines) {
    if (line.startsWith(`${FILE_MARKER} `)) {
      flush();
      currentPath = line.slice(FILE_MARKER.length + 1).trim();
      currentLines = [];
    } else if (currentPath) {
      currentLines.push(line);
    }
  }
  flush();

  return files;
}

export async function loadSourceFiles(root: string): Promise<SourceFile[]> {
  const localFiles = await loadSourceFilesFromLocal(root);
  if (localFiles.length > 0) return localFiles;
  return loadSourceFilesFromHost(root);
}
