import { shQuote } from "./vps";

/**
 * Drive Docker Agentic Platform (Docker Sandboxes) via the `sbx` CLI for
 * isolated, off-host image builds. The `sbx` binary and its Docker Hub auth
 * live on the managed host; GroundControl shells out to them through its
 * host-exec path, so an image build never runs on the production workload.
 *
 * A sandbox is amd64 (`--platform linux/amd64`) so the produced image matches
 * the x86_64 deployment host without cross-compilation.
 */

export type SandboxBuildSpec = {
  /** HTTPS clone URL, e.g. https://github.com/org/repo.git */
  repoUrl: string;
  /** Exact commit to build. */
  commitSha: string;
  /** SHA-tagged image ref to build + push, e.g. ghcr.io/org/app:abc123. */
  ref: string;
  dockerfile?: string;
  context?: string;
};

/** Create a cloud sandbox. Prints the sandbox id (sbx_...) on stdout. */
export function buildSbxCreateCommand(name: string): string {
  return `sbx --cloud create shell --platform linux/amd64 --name ${shQuote(name)}`;
}

/** Remove a cloud sandbox. */
export function buildSbxRmCommand(sandboxId: string): string {
  return `sbx --cloud rm --force ${shQuote(sandboxId)}`;
}

/** Execute a POSIX-sh script inside the sandbox. */
export function buildSbxExecCommand(sandboxId: string, script: string): string {
  return `sbx --cloud exec ${shQuote(sandboxId)} sh -c ${shQuote(script)}`;
}

/**
 * The build script that runs inside the sandbox: clone the exact commit, build,
 * push, and print the digest. The GHCR login is performed separately (the
 * token is piped via stdin, never embedded in the command text) so it does not
 * appear in process listings or sandbox logs.
 */
export function buildSandboxBuildScript(spec: SandboxBuildSpec): string {
  const dockerfile = spec.dockerfile ? ` -f ${shQuote(spec.dockerfile)}` : "";
  const context = spec.context ? ` ${shQuote(spec.context)}` : " .";
  return [
    "set -e",
    `git clone ${shQuote(spec.repoUrl)} /tmp/repo`,
    "cd /tmp/repo",
    `git checkout ${spec.commitSha}`,
    `test "$(git rev-parse HEAD)" = "${spec.commitSha}"`,
    `docker build -t ${shQuote(spec.ref)}${dockerfile}${context}`,
    `docker push ${shQuote(spec.ref)}`,
    `docker image inspect ${shQuote(spec.ref)} --format '{{index .RepoDigests 0}}'`,
  ].join(" && ");
}

/** GHCR login command run inside the sandbox; the token is piped via stdin. */
export function buildSandboxRegistryLoginCommand(registry: string, username: string): string {
  return `printf '%s' "$GC_REGISTRY_TOKEN" | docker login ${shQuote(registry)} -u ${shQuote(username)} --password-stdin`;
}

/** Extract the sandbox id (sbx_...) from `sbx --cloud create` output. */
export function parseSandboxId(output: string): string | null {
  const match = output.match(/sbx_[a-z0-9]+/);
  return match ? match[0] : null;
}
