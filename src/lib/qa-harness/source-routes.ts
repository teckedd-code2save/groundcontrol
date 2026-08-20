import type { SourceFile, SourceRoute } from "./types";

const HTTP_METHODS = new Set([
  "get",
  "post",
  "put",
  "patch",
  "delete",
  "head",
  "options",
]);

const AUTH_MARKERS = ["authenticate", "requireauth", "authmiddleware", "requirelogin", "mustauth"];

interface CallSite {
  object: "app" | "router";
  verb: string;
  args: string[];
  line: number;
}

function lineOf(source: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index; i += 1) {
    if (source[i] === "\n") line += 1;
  }
  return line;
}

function splitTopLevelArgs(raw: string): string[] {
  const args: string[] = [];
  let depth = 0;
  let current = "";
  let quote: string | null = null;
  for (let i = 0; i < raw.length; i += 1) {
    const ch = raw[i];
    if (quote) {
      current += ch;
      if (ch === "\\") {
        current += raw[i + 1] || "";
        i += 1;
        continue;
      }
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === "`") {
      quote = ch;
      current += ch;
      continue;
    }
    if (ch === "(" || ch === "[" || ch === "{") depth += 1;
    if (ch === ")" || ch === "]" || ch === "}") depth -= 1;
    if (ch === "," && depth === 0) {
      args.push(current.trim());
      current = "";
      continue;
    }
    current += ch;
  }
  if (current.trim()) args.push(current.trim());
  return args;
}

function extractCalls(source: string): CallSite[] {
  const calls: CallSite[] = [];
  const pattern = /\b(app|router)\s*\.\s*([A-Za-z_$][\w$]*)\s*\(/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(source))) {
    const object = match[1] as "app" | "router";
    const verb = match[2];
    const open = match.index + match[0].length - 1;
    let depth = 0;
    let i = open;
    let quote: string | null = null;
    for (; i < source.length; i += 1) {
      const ch = source[i];
      if (quote) {
        if (ch === "\\") {
          i += 1;
          continue;
        }
        if (ch === quote) quote = null;
        continue;
      }
      if (ch === "'" || ch === '"' || ch === "`") {
        quote = ch;
        continue;
      }
      if (ch === "(") depth += 1;
      if (ch === ")") {
        depth -= 1;
        if (depth === 0) break;
      }
    }
    calls.push({
      object,
      verb,
      args: splitTopLevelArgs(source.slice(open + 1, i)),
      line: lineOf(source, match.index),
    });
    pattern.lastIndex = i;
  }
  return calls;
}

function moduleIdentity(rawPath: string): string {
  let value = rawPath.replace(/\\/g, "/");
  const srcIndex = value.indexOf("/src/");
  if (srcIndex !== -1) {
    value = value.slice(srcIndex + "/src/".length);
  } else {
    value = value.replace(/^\.\//, "").replace(/^@\//, "");
    if (value.startsWith("src/")) value = value.slice("src/".length);
  }
  return value.replace(/\.(ts|tsx|js|jsx|mjs|cjs)$/, "");
}

function firstStringLiteral(args: string[]): string | null {
  const value = args[0]?.trim();
  if (!value) return null;
  const match = value.match(/^(['"`])([\s\S]*)\1$/);
  return match ? match[2] : null;
}

function hasAuthMarker(args: string[]): boolean {
  return args
    .slice(1)
    .some((arg) => AUTH_MARKERS.some((marker) => arg.toLowerCase().includes(marker)));
}

function joinPath(prefix: string | null | undefined, path: string): string {
  const rawPath = path.trim();
  const suffix = rawPath === "/" ? "" : rawPath.startsWith("/") ? rawPath : `/${rawPath}`;
  if (!prefix) return suffix || "/";
  const base = prefix.replace(/\/+$/, "");
  if (!suffix) return base || "/";
  return `${base}/${suffix.replace(/^\/+/, "")}`.replace(/\/{2,}/g, "/");
}

function routeFileModule(path: string): string {
  return moduleIdentity(path);
}

/**
 * Deterministic route discovery from repository source. It understands:
 *  - Express-style `router.<verb>("/path")` with `app.use("/prefix", nameRouter)`
 *    mounts, plus direct `app.<verb>("/path")` routes.
 *  - Next.js App Router `**\/route.ts` handlers (exported GET/POST/...).
 *  - Generic route files containing `router.<verb>("/path")` even without a
 *    detected mount (path is then emitted as declared).
 */
export function scanSourceRoutes(files: SourceFile[]): SourceRoute[] {
  const imports = new Map<string, string>();
  const mounts = new Map<string, string>();
  const routes: SourceRoute[] = [];
  const seen = new Set<string>();

  for (const file of files) {
    const importPattern = /\bimport\s+([A-Za-z_$][\w$]*)\s+from\s+['"]([^'"]+)['"]/g;
    let importMatch: RegExpExecArray | null;
    while ((importMatch = importPattern.exec(file.content))) {
      imports.set(importMatch[1], moduleIdentity(importMatch[2]));
    }
  }

  for (const file of files) {
    for (const call of extractCalls(file.content)) {
      if (call.object !== "app") continue;
      const prefix = firstStringLiteral(call.args);
      if (call.verb === "use" && prefix != null) {
        const trailing = call.args[call.args.length - 1]?.trim();
        const alias = trailing?.match(/^([A-Za-z_$][\w$]*)$/)?.[1];
        if (alias && imports.has(alias)) {
          mounts.set(imports.get(alias) as string, prefix);
        }
        continue;
      }
      if (HTTP_METHODS.has(call.verb.toLowerCase()) && prefix != null) {
        addRoute(routes, seen, {
          method: call.verb.toUpperCase(),
          path: prefix,
          filePath: file.path,
          line: call.line,
          auth: hasAuthMarker(call.args),
        });
      }
    }
  }

  for (const file of files) {
    if (isNextRouteFile(file.path)) {
      const dir = nextRouteDir(file.path);
      for (const method of exportedHandlers(file.content)) {
        addRoute(routes, seen, {
          method,
          path: dir || "/",
          filePath: file.path,
          line: 1,
        });
      }
      continue;
    }

    const module = routeFileModule(file.path);
    const prefix = mounts.get(module);
    for (const call of extractCalls(file.content)) {
      if (call.object !== "router") continue;
      if (!HTTP_METHODS.has(call.verb.toLowerCase())) continue;
      const path = firstStringLiteral(call.args);
      if (path == null) continue;
      const fullPath = prefix != null ? joinPath(prefix, path) : path;
      addRoute(routes, seen, {
        method: call.verb.toUpperCase(),
        path: fullPath,
        filePath: file.path,
        line: call.line,
        mountPrefix: prefix ?? undefined,
        auth: hasAuthMarker(call.args),
      });
    }
  }

  return routes;
}

function addRoute(
  routes: SourceRoute[],
  seen: Set<string>,
  route: SourceRoute
) {
  const key = `${route.method} ${route.path}`;
  if (seen.has(key)) return;
  seen.add(key);
  routes.push(route);
}

function isNextRouteFile(path: string): boolean {
  const normalized = path.replace(/\\/g, "/");
  return /(?:^|\/)(?:app|src\/app)\/.*\/route\.(ts|tsx|js|jsx)$/.test(normalized)
    || /(?:^|\/)(?:app|src\/app)\/route\.(ts|tsx|js|jsx)$/.test(normalized);
}

function nextRouteDir(path: string): string | null {
  const normalized = path.replace(/\\/g, "/");
  const match = normalized.match(/(?:^|\/)(?:app|src\/app)(\/.*)?\/route\.(?:ts|tsx|js|jsx)$/);
  if (!match) return null;
  const dir = match[1] || "/";
  return dir.startsWith("/") ? dir : `/${dir}`;
}

function exportedHandlers(content: string): string[] {
  const methods: string[] = [];
  const pattern = /export\s+(?:async\s+)?function\s+(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\b/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(content))) {
    methods.push(match[1].toUpperCase());
  }
  return Array.from(new Set(methods));
}
