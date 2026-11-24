import { installGit } from "./bootstrap";
import { execOnTarget } from "./host-exec";
import { shQuote, type VpsConnection } from "./vps";

export type TemplateSourceKind = "empty" | "git" | "local";

export interface TemplateSourceInput {
  repoUrl?: string | null;
  branch?: string | null;
  localPath?: string | null;
  deployPath: string;
  vps?: VpsConnection | null;
  gitToken?: string;
  githubRepositoryId?: string;
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
  githubRepositoryId?: string;
}

type ExecOnTarget = typeof execOnTarget;
type InstallGit = typeof installGit;

export interface TemplateSourceDeps {
  exec?: ExecOnTarget;
  installGit?: InstallGit;
}

export async function resolveTemplateSource(
  input: TemplateSourceInput,
  deps: TemplateSourceDeps = {}
): Promise<TemplateSourceResolution> {
  const run = deps.exec || execOnTarget;
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
      gitToken: input.gitToken,
      githubRepositoryId: input.githubRepositoryId,
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

async function ensureGitAvailable(vps: VpsConnection | null | undefined, run: ExecOnTarget, install: InstallGit) {
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
  gitToken,
  githubRepositoryId,
}: {
  repoUrl: string;
  requestedRef: string;
  deployPath: string;
  vps?: VpsConnection | null;
  run: ExecOnTarget;
  gitToken?: string;
  githubRepositoryId?: string;
}): Promise<TemplateSourceResolution> {
  const script = [
    `set -eu`,
    `export GIT_TERMINAL_PROMPT=0`,
    ...(gitToken ? [
      "umask 077",
      "IFS= read -r GC_GITHUB_TOKEN",
      "export GC_GITHUB_TOKEN",
      "gc_askpass=$(mktemp /tmp/gc-git-askpass.XXXXXX)",
      "trap 'rm -f \"$gc_askpass\"' EXIT HUP INT TERM",
      "cat > \"$gc_askpass\" <<'GCASKPASS'",
      "#!/bin/sh",
      `case "$1" in *Username*) echo x-access-token ;; *) printf '%s\\n' "$GC_GITHUB_TOKEN" ;; esac`,
      "GCASKPASS",
      "chmod 700 \"$gc_askpass\"",
      "export GIT_ASKPASS=\"$gc_askpass\"",
    ] : []),
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
    `  if [ -e "$path" ]; then rmdir "$path"; fi`,
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

  const result = gitToken ? await run(script, vps, undefined, `${gitToken}\n`) : await run(script, vps);
  if (result.code !== 0) {
    const detail = result.stderr || result.stdout || "Git source validation failed";
    throw new Error(gitToken ? detail.split(gitToken).join("[REDACTED]") : detail);
  }

  const metadata = parseKeyValueOutput(result.stdout);
  return {
    kind: "git",
    sourcePath: deployPath,
    buildContext: ".",
    repoUrl,
    requestedRef,
    githubRepositoryId,
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
