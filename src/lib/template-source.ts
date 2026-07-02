import { installGit } from "./bootstrap";
import { execOnVps, shQuote, type VpsConnection } from "./vps";

export type TemplateSourceKind = "empty" | "git" | "local";

export interface TemplateSourceInput {
  repoUrl?: string | null;
  branch?: string | null;
  localPath?: string | null;
  deployPath: string;
  vps?: VpsConnection | null;
}

export interface TemplateSourceResolution {
  kind: TemplateSourceKind;
  sourcePath: string;
  buildContext: string;
  repoUrl?: string;
  requestedRef?: string;
  branch?: string;
  commitSha?: string;
  defaultBranch?: string;
}

type ExecOnVps = typeof execOnVps;
type InstallGit = typeof installGit;

export interface TemplateSourceDeps {
  exec?: ExecOnVps;
  installGit?: InstallGit;
}

export async function resolveTemplateSource(
  input: TemplateSourceInput,
  deps: TemplateSourceDeps = {}
): Promise<TemplateSourceResolution> {
  const run = deps.exec || execOnVps;
  const install = deps.installGit || installGit;
  const repoUrl = clean(input.repoUrl);
  const localPath = clean(input.localPath);
  const requestedRef = clean(input.branch) || "main";

  await run(`mkdir -p ${shQuote(input.deployPath)}`, input.vps);

  if (repoUrl) {
    await ensureGitAvailable(input.vps, run, install);
    return resolveGitSource({
      repoUrl,
      requestedRef,
      deployPath: input.deployPath,
      vps: input.vps,
      run,
    });
  }

  if (localPath) {
    const exists = await run(`test -d ${shQuote(localPath)} && echo yes || echo no`, input.vps);
    if (exists.stdout.trim() !== "yes") {
      throw new Error(`Local source path does not exist on VPS: ${localPath}`);
    }

    return {
      kind: "local",
      sourcePath: localPath,
      buildContext: localPath,
    };
  }

  return {
    kind: "empty",
    sourcePath: input.deployPath,
    buildContext: ".",
  };
}

async function ensureGitAvailable(vps: VpsConnection | null | undefined, run: ExecOnVps, install: InstallGit) {
  const gitCheck = await run(`command -v git >/dev/null 2>&1 && echo yes || echo no`, vps);
  if (gitCheck.stdout.trim() === "yes") return;

  const installed = await install(vps);
  if (!installed.success) {
    throw new Error(installed.error || installed.output || "Git is not installed on the VPS and could not be auto-installed");
  }

  const recheck = await run(`command -v git >/dev/null 2>&1 && echo yes || echo no`, vps);
  if (recheck.stdout.trim() !== "yes") {
    throw new Error("Git install completed, but git is still not available on PATH");
  }
}

async function resolveGitSource({
  repoUrl,
  requestedRef,
  deployPath,
  vps,
  run,
}: {
  repoUrl: string;
  requestedRef: string;
  deployPath: string;
  vps?: VpsConnection | null;
  run: ExecOnVps;
}): Promise<TemplateSourceResolution> {
  const script = [
    `set -eu`,
    `repo=${shQuote(repoUrl)}`,
    `ref=${shQuote(requestedRef)}`,
    `path=${shQuote(deployPath)}`,
    `if [ -d "$path/.git" ]; then`,
    `  cd "$path"`,
    `  existing="$(git config --get remote.origin.url || true)"`,
    `  if [ "$existing" != "$repo" ]; then`,
    `    echo "Deployment path already contains a different git remote: $existing" >&2`,
    `    exit 42`,
    `  fi`,
    `else`,
    `  rm -rf "$path"`,
    `  git clone "$repo" "$path"`,
    `  cd "$path"`,
    `fi`,
    `git fetch origin --prune --tags`,
    `if git rev-parse --verify --quiet "origin/$ref^{commit}" >/dev/null; then`,
    `  git checkout -B "$ref" "origin/$ref"`,
    `elif git rev-parse --verify --quiet "$ref^{commit}" >/dev/null; then`,
    `  git checkout --detach "$ref"`,
    `else`,
    `  echo "Git ref not found: $ref" >&2`,
    `  exit 43`,
    `fi`,
    `commit="$(git rev-parse HEAD)"`,
    `branch="$(git branch --show-current || true)"`,
    `default_branch="$(git remote show origin 2>/dev/null | sed -n 's/^[[:space:]]*HEAD branch: //p' | head -1 || true)"`,
    `printf 'GC_SOURCE_COMMIT=%s\\nGC_SOURCE_BRANCH=%s\\nGC_SOURCE_DEFAULT_BRANCH=%s\\n' "$commit" "$branch" "$default_branch"`,
  ].join("\n");

  const result = await run(script, vps);
  if (result.code !== 0) {
    throw new Error(result.stderr || result.stdout || "Git source validation failed");
  }

  const metadata = parseKeyValueOutput(result.stdout);
  return {
    kind: "git",
    sourcePath: deployPath,
    buildContext: ".",
    repoUrl,
    requestedRef,
    branch: metadata.GC_SOURCE_BRANCH || undefined,
    commitSha: metadata.GC_SOURCE_COMMIT || undefined,
    defaultBranch: metadata.GC_SOURCE_DEFAULT_BRANCH || undefined,
  };
}

function parseKeyValueOutput(output: string): Record<string, string> {
  const parsed: Record<string, string> = {};
  for (const line of output.split("\n")) {
    const match = line.match(/^(GC_SOURCE_[A-Z_]+)=(.*)$/);
    if (match) parsed[match[1]] = match[2];
  }
  return parsed;
}

function clean(value: string | null | undefined): string {
  return String(value || "").trim();
}
