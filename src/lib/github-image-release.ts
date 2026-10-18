import { parse, stringify } from "yaml";
import {
  assertComposeServiceName,
  assertDockerImageReference,
  MANAGED_IMAGE_OVERRIDE_FILE,
} from "./compose-management";
import { buildManagedComposeInvocation, shQuote } from "./vps";

/**
 * Image-mode release: build a specific commit SHA, tag the built images with
 * the SHA, push them to the container registry, and verify the artifacts.
 *
 * This is the missing half of the ssh-compose-release playbook inside
 * GroundControl. `deployment.source.deploy` runs `docker compose build`
 * in-place (git-mode) and never publishes an immutable, SHA-tagged image;
 * `deployment.redeploy` only pulls existing tags. Neither can *produce* a
 * pushable, revision-addressed image. This module does.
 */

export type ReleaseImage = {
  service: string;
  /** The SHA-tagged image reference that was pushed, e.g. ghcr.io/org/app:abc123. */
  ref: string;
};

/** Validate a release SHA (full 40-64 char hex commit id). Lowercased. */
export function normalizeReleaseSha(value: unknown): string {
  const sha = String(value || "").trim().toLowerCase();
  if (!/^[a-f0-9]{40,64}$/.test(sha)) {
    throw new Error("releaseSha must be a full 40-64 character commit SHA");
  }
  return sha;
}

/**
 * Strip a tag or digest from a Docker image reference, returning the
 * repository portion (registry + namespace + name). Returns null when the
 * reference has no pushable registry target (a bare local name such as
 * `nginx` or `myapp`).
 */
export function releaseImageRepository(currentRef: string): string | null {
  let repo = currentRef.trim();
  // Strip a digest first (repo@sha256:...).
  repo = repo.replace(/@sha256:[a-f0-9]{64}$/i, "");
  // Strip a tag: the last ':' that appears after the last '/' (a ':' before
  // the last '/' is a registry host:port, not a tag).
  const lastSlash = repo.lastIndexOf("/");
  const lastColon = repo.lastIndexOf(":");
  if (lastColon > lastSlash) repo = repo.slice(0, lastColon);
  // Normalize the implicit Docker Hub library prefix away so `nginx` is a
  // bare name and therefore correctly rejected below.
  repo = repo.replace(/^docker\.io\/library\//, "");
  if (!repo || !repo.includes("/")) return null;
  return repo;
}

/**
 * Derive the SHA-tagged reference for a service's current image. Throws for
 * local-only references that cannot be pushed to a registry.
 */
export function releaseImageReference(currentRef: string, sha: string): string {
  const repo = releaseImageRepository(currentRef);
  if (!repo) {
    throw new Error(
      `Cannot derive a registry image reference for "${currentRef}". ` +
        `Give the service an explicit image with a registry (e.g. ghcr.io/org/app) before releasing.`
    );
  }
  return `${repo}:${sha}`;
}

/**
 * Extract the services that are built from source (have a `build:` context)
 * and already declare an `image:` reference, from the effective `docker compose
 * config` output. Services that only pull an external image are excluded —
 * they are consumed, not produced.
 */
export function buildableServiceImages(effectiveCompose: string): Record<string, string> {
  const parsed = parseComposeDocument(effectiveCompose);
  const services = parsed?.services;
  if (!services || typeof services !== "object" || Array.isArray(services)) return {};
  const result: Record<string, string> = {};
  for (const [name, config] of Object.entries(services)) {
    if (!config || typeof config !== "object") continue;
    const record = config as Record<string, unknown>;
    const hasBuild = Boolean(record.build);
    const image = typeof record.image === "string" ? record.image.trim() : "";
    if (hasBuild && image) result[name] = image;
  }
  return result;
}

function parseComposeDocument(content: string): { services?: Record<string, Record<string, unknown>> } | null {
  if (!content.trim()) return null;
  const parsed = parse(content) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  return parsed as { services?: Record<string, Record<string, unknown>> };
}

export type ServiceBuildInfo = {
  image: string;
  context?: string;
  dockerfile?: string;
};

/**
 * Like buildableServiceImages, but also captures each service's build context
 * and dockerfile so an off-host builder can reproduce the same build without
 * re-deriving it from the Compose file.
 */
export function buildableServiceBuildInfo(effectiveCompose: string): Record<string, ServiceBuildInfo> {
  const parsed = parseComposeDocument(effectiveCompose);
  const services = parsed?.services;
  if (!services || typeof services !== "object" || Array.isArray(services)) return {};
  const result: Record<string, ServiceBuildInfo> = {};
  for (const [name, config] of Object.entries(services)) {
    if (!config || typeof config !== "object") continue;
    const record = config as Record<string, unknown>;
    const build = record.build;
    const image = typeof record.image === "string" ? record.image.trim() : "";
    if (!build || !image) continue;
    let context: string | undefined;
    let dockerfile: string | undefined;
    if (typeof build === "string") {
      context = build;
    } else if (build && typeof build === "object") {
      const b = build as Record<string, unknown>;
      if (typeof b.context === "string") context = b.context;
      if (typeof b.dockerfile === "string") dockerfile = b.dockerfile;
    }
    result[name] = { image, context, dockerfile };
  }
  return result;
}

/**
 * Map each service to its canonical deployment-wide image env var, e.g.
 * `image: ${API_IMAGE}` → `{ web: "API_IMAGE" }`. This is the key that the
 * release must update in `.env` (via setLocalEnvValues) so the canonical image
 * reference and the managed override never diverge.
 */
export function composeImageEnvKeys(rawCompose: string): Record<string, string> {
  const document = parseComposeDocument(rawCompose);
  const services = document?.services;
  if (!services || typeof services !== "object" || Array.isArray(services)) return {};
  const result: Record<string, string> = {};
  for (const [name, config] of Object.entries(services)) {
    if (!config || typeof config !== "object") continue;
    const image = (config as Record<string, unknown>).image;
    if (typeof image === "string") {
      const match = image.trim().match(/^\$\{([A-Za-z_][A-Za-z0-9_]*)\}$/);
      if (match) result[name] = match[1];
    }
  }
  return result;
}

/**
 * Build the managed image override that tags each buildable service's image
 * with the release SHA. Returns the YAML override content plus the resolved
 * per-service references.
 */
export function buildReleaseImageOverride(
  currentImages: Record<string, string>,
  sha: string
): { content: string; refs: Record<string, string> } {
  const refs: Record<string, string> = {};
  const services: Record<string, { image: string }> = {};
  for (const [service, currentRef] of Object.entries(currentImages)) {
    const name = assertComposeServiceName(service);
    const ref = releaseImageReference(currentRef, sha);
    assertDockerImageReference(ref);
    refs[name] = ref;
    services[name] = { image: ref };
  }
  if (Object.keys(services).length === 0) {
    throw new Error(
      "No buildable services with a registry-backed image reference were found. " +
        "Add an explicit `image:` to each service's `build:` block before releasing."
    );
  }
  return { content: stringify({ services }, { lineWidth: 0 }), refs };
}

/**
 * POSIX-sh command that builds the release images (tagged with the SHA via the
 * managed image override) and pushes them to the registry. Reuses
 * `buildManagedComposeInvocation` so the managed override file and the isolated
 * `DOCKER_CONFIG` (where the GHCR login lives) are both honored.
 */
export function buildReleaseBuildPushCommand(input: {
  projectPath: string;
  composeCommand: string;
  composeFile: string;
  services: string[];
}): string {
  const serviceArgs = input.services.length
    ? input.services.map((service) => shQuote(assertComposeServiceName(service))).join(" ")
    : "";
  const build = buildManagedComposeInvocation(
    input.composeCommand,
    `build${serviceArgs ? ` ${serviceArgs}` : ""}`,
    input.composeFile,
    { includeEnvironment: false }
  );
  const push = buildManagedComposeInvocation(
    input.composeCommand,
    `push${serviceArgs ? ` ${serviceArgs}` : ""}`,
    input.composeFile,
    { includeEnvironment: false }
  );
  return ["set -eu", `cd ${shQuote(input.projectPath)}`, build, push].join("\n");
}

/**
 * POSIX-sh command that captures the pushed digest and architecture for each
 * reference. Prints `digest=<repo@sha256:...>` and `arch=<...>` lines that the
 * server parses to build the verification result.
 */
export function buildReleaseVerifyCommand(refs: Record<string, string>): string {
  const lines: string[] = ["set -eu"];
  for (const [service, ref] of Object.entries(refs)) {
    const name = assertComposeServiceName(service);
    const safeRef = assertDockerImageReference(ref);
    lines.push(
      `gc_digest=$(docker image inspect --format '{{index .RepoDigests 0}}' ${shQuote(safeRef)} 2>/dev/null || true)`,
      `gc_arch=$(docker image inspect --format '{{.Architecture}}' ${shQuote(safeRef)} 2>/dev/null || true)`,
      `printf 'service=%s ref=%s digest=%s arch=%s\\n' ${shQuote(name)} ${shQuote(safeRef)} "$gc_digest" "$gc_arch"`
    );
  }
  return lines.join("\n");
}

/**
 * Parse the output of {@link buildReleaseVerifyCommand} into structured image
 * evidence, failing when a pushed image is missing, has no digest, or is not
 * amd64.
 */
export function parseReleaseVerifyOutput(
  output: string,
  refs: Record<string, string>
): { service: string; ref: string; digest: string | null }[] {
  const images: { service: string; ref: string; digest: string | null }[] = [];
  const byService = new Map(Object.entries(refs));
  for (const line of output.split("\n")) {
    const match = line.match(/^service=(\S+) ref=(\S+) digest=(\S*) arch=(\S*)$/);
    if (!match) continue;
    const [, service, ref, digest, arch] = match;
    if (byService.get(service) !== ref) {
      throw new Error(`Unexpected release image evidence for ${service}: ${ref}`);
    }
    if (arch !== "amd64") {
      throw new Error(`Release image ${service} has architecture "${arch}", expected amd64.`);
    }
    if (!digest || !/@sha256:[a-f0-9]{64}$/i.test(digest)) {
      throw new Error(`Release image ${service} was pushed without a verifiable digest.`);
    }
    if (releaseImageRepository(digest) !== releaseImageRepository(ref)) {
      throw new Error(`Release image ${service} has a digest for a different repository.`);
    }
    images.push({ service, ref, digest });
    byService.delete(service);
  }
  if (byService.size > 0) {
    throw new Error(
      `Release verification did not observe pushed images for: ${[...byService.keys()].join(", ")}.`
    );
  }
  return images;
}

/**
 * Build the managed image override that pins each service to an exact
 * `repo@sha256:<digest>`. This is the release half of the playbook: deploy a
 * previously-built artifact by its immutable digest, not a mutable tag.
 */
export function buildDigestImageOverride(
  images: { service: string; digest: string }[]
): { content: string; refs: Record<string, string> } {
  const refs: Record<string, string> = {};
  const services: Record<string, { image: string }> = {};
  for (const { service, digest } of images) {
    const name = assertComposeServiceName(service);
    const ref = assertDockerImageReference(digest);
    if (!/@sha256:[a-f0-9]{64}$/i.test(ref)) {
      throw new Error(`Release digest for ${name} must be a full sha256 digest.`);
    }
    refs[name] = ref;
    services[name] = { image: ref };
  }
  if (Object.keys(services).length === 0) {
    throw new Error("No release images were provided.");
  }
  return { content: stringify({ services }, { lineWidth: 0 }), refs };
}

/** Validate an explicit test command. Returns null when absent. */
export function normalizeTestCommand(value: unknown): string | null {
  const cmd = String(value || "").trim();
  if (!cmd) return null;
  if (cmd.length > 1000) throw new Error("testCommand must be 1000 characters or fewer");
  return cmd;
}

/**
 * POSIX-sh command that runs the test command in a throwaway container built
 * from the released image. Exit 0 is the pass signal; stdout/stderr are the
 * evidence. The test command must be self-contained inside the image.
 */
export function buildRunTestsCommand(image: string, testCommand: string): string {
  return `DOCKER_CONFIG="\${HOME}/.groundcontrol/docker" docker run --rm --entrypoint sh ${shQuote(image)} -lc ${shQuote(testCommand)}`;
}

/**
 * POSIX-sh command that ensures a resource-capped BuildKit builder exists. The
 * buildkitd container is created with the docker-container driver (an isolated
 * daemon, not the host daemon) and then capped with CPU/memory limits so a
 * build cannot hijack the production box.
 */
export function buildEnsureBuildkitBuilderCommand(
  builder: string,
  cpus: string,
  memory: string
): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(builder)) throw new Error("Invalid BuildKit builder name");
  return [
    "set -eu",
    'export DOCKER_CONFIG="${HOME}/.groundcontrol/docker"',
    `if ! docker buildx inspect ${shQuote(builder)} >/dev/null 2>&1; then`,
    `  docker buildx create --name ${shQuote(builder)} --driver docker-container --driver-opt ${shQuote(`cpu-quota=${Number(cpus) * 100000}`)} --driver-opt ${shQuote(`memory=${memory}`)} --driver-opt ${shQuote(`memory-swap=${memory}`)}`,
    "fi",
    `docker buildx inspect --bootstrap ${shQuote(builder)}`,
    `docker update --cpus ${shQuote(cpus)} --memory ${shQuote(memory)} --memory-swap ${shQuote(memory)} ${shQuote(`buildx_buildkit_${builder}0`)}`,
  ].join("\n");
}

/** Publish directly from BuildKit, then pull the exact tags for verification/tests. */
export function buildBuildkitBuildPushCommand(input: {
  projectPath: string;
  composeFile: string;
  builder: string;
  refs: Record<string, string>;
  buildInfo?: Record<string, ServiceBuildInfo>;
}): string {
  const override = `${input.projectPath}/${MANAGED_IMAGE_OVERRIDE_FILE}`;
  const services = Object.keys(input.refs).map((service) => shQuote(assertComposeServiceName(service)));
  if (!services.length) throw new Error("No build services selected");
  const refs = [...new Set(Object.values(input.refs).map(assertDockerImageReference))];
  // Bake resolves relative contexts from cwd, unlike Compose's file-relative
  // resolution. Use Compose's already-resolved paths for the selected targets.
  const paths = Object.keys(input.refs).flatMap((service) => {
    const info = input.buildInfo?.[service];
    return [info?.context ? `--set ${shQuote(`${service}.context=${info.context}`)}` : "",
      info?.dockerfile ? `--set ${shQuote(`${service}.dockerfile=${info.dockerfile}`)}` : ""].filter(Boolean);
  }).join(" ");
  return [
    "set -eu",
    'export DOCKER_CONFIG="${HOME}/.groundcontrol/docker"',
    `cd ${shQuote(input.projectPath)}`,
    `docker buildx bake --builder ${shQuote(input.builder)} --progress plain -f ${shQuote(input.composeFile)} -f ${shQuote(override)} --set '*.platform=linux/amd64' ${paths} --push ${services.join(" ")}`,
    ...refs.map((ref) => `docker pull --platform linux/amd64 ${shQuote(ref)}`),
  ].join("\n");
}
