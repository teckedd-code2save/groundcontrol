import { shQuote } from "./vps";

/**
 * Drive Docker Agentic Platform (Docker Sandboxes) via the `sbx` CLI for
 * isolated, off-host image builds. The `sbx` binary and its Docker Hub auth
 * live on the managed host; GroundControl shells out to them through its
 * host-exec path, so an image build never runs on the production workload.
 *
 * A sandbox is amd64 (`--platform linux/amd64`) so the produced image matches
 * the x86_64 deployment host without cross-compilation.
 *
 * The flow is split into two phases so the repo is cloned once and each unique
 * image ref is then built in its own step:
 *   1. clone  — reads the Git source token over stdin, clones @SHA.
 *   2. build  — reads the GHCR token over stdin, logs in, builds, pushes.
 */

export type SandboxCloneSpec = {
  /** HTTPS clone URL, e.g. https://github.com/org/repo.git */
  repoUrl: string;
  /** Exact commit to build. */
  commitSha: string;
};

export type SandboxBuildSpec = {
  /** SHA-tagged image ref to build + push, e.g. ghcr.io/org/app:abc123. */
  ref: string;
  /** GHCR username for the registry login. */
  username: string;
  /** Registry host (default ghcr.io). */
  registry?: string;
  /** Build context relative to the repo root (default "."). */
  context?: string;
  /** Dockerfile relative to the context (default "Dockerfile"). */
  dockerfile?: string;
};

/** Create a cloud sandbox. Prints the sandbox id (sbx_...) on stdout. */
export function buildSbxCreateCommand(name: string): string {
  return "sbx --cloud create shell --platform linux/amd64 --name " + shQuote(name);
}

/** Remove a cloud sandbox. */
export function buildSbxRmCommand(sandboxId: string): string {
  return "sbx --cloud rm --force " + shQuote(sandboxId);
}

/** Execute a POSIX-sh script inside the sandbox. */
export function buildSbxExecCommand(sandboxId: string, script: string): string {
  return "sbx --cloud exec " + shQuote(sandboxId) + " sh -c " + shQuote(script);
}

/** Extract the sandbox id (sbx_...) from `sbx --cloud create` output. */
export function parseSandboxId(output: string): string | null {
  const match = output.match(/sbx_[a-z0-9]+/);
  return match ? match[0] : null;
}

/**
 * Phase 1: read the Git source token over stdin and clone the exact commit to
 * /tmp/repo. The token is injected into the clone URL at runtime and never
 * appears in the command text.
 */
export function buildSandboxCloneScript(spec: SandboxCloneSpec): string {
  const repoHost = spec.repoUrl.replace(/^https:\/\//, "");
  const clone = 'git clone "https://x-access-token:$GC_GIT_TOKEN@' + repoHost + '" /tmp/repo';
  return [
    "set -eu",
    "IFS= read -r GC_GIT_TOKEN",
    "export GIT_TERMINAL_PROMPT=0",
    clone,
    "cd /tmp/repo",
    "git checkout " + spec.commitSha,
    'test "$(git rev-parse HEAD)" = "' + spec.commitSha + '"',
  ].join("\n");
}

/**
 * Phase 2: read the GHCR token over stdin, log in, build the service's context,
 * push, and print the digest. `dockerfile` is compose-relative (to the
 * context), so a non-default dockerfile is anchored to the context path.
 */
export function buildSandboxBuildScript(spec: SandboxBuildSpec): string {
  const registry = spec.registry || "ghcr.io";
  const contextPath = spec.context || ".";
  const dockerfileFlag =
    spec.dockerfile && spec.dockerfile !== "Dockerfile"
      ? " -f " + shQuote(contextPath + "/" + spec.dockerfile)
      : "";
  return [
    "set -eu",
    "IFS= read -r GC_GHCR_TOKEN",
    "printf '%s\\n' \"$GC_GHCR_TOKEN\" | docker login " + shQuote(registry) + " -u " + shQuote(spec.username) + " --password-stdin >/dev/null 2>&1",
    "cd /tmp/repo",
    "docker build -t " + shQuote(spec.ref) + dockerfileFlag + " " + shQuote(contextPath),
    "docker push " + shQuote(spec.ref),
    "docker image inspect " + shQuote(spec.ref) + " --format '{{index .RepoDigests 0}}'",
  ].join("\n");
}
