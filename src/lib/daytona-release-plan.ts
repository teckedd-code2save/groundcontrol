import path from "node:path";
import { parse } from "yaml";
import { assertComposeServiceName } from "./compose-management";
import { shQuote } from "./vps";

export type ReleaseBuildPolicy = {
  provider: "host" | "daytona";
  imagePrefix: string;
  builderImage: string;
  timeoutSeconds: number;
};

export const DEFAULT_BUILDER_IMAGE = "docker:28.3.3-dind";

export function parseReleaseBuildPolicy(value: unknown): ReleaseBuildPolicy {
  const input = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const provider = input.provider || "host";
  if (provider !== "host" && provider !== "daytona") throw new Error("Unknown release build provider.");
  const imagePrefix = String(input.imagePrefix || "").trim();
  if (provider === "daytona" && !/^ghcr\.io\/[a-z0-9][a-z0-9-]*\/[a-z0-9][a-z0-9._/-]*$/.test(imagePrefix)) {
    throw new Error("Daytona releases require a GHCR image prefix, such as ghcr.io/owner/app.");
  }
  const builderImage = String(input.builderImage || DEFAULT_BUILDER_IMAGE).trim();
  // This is an administrator-selected builder image, never a command supplied by repository source.
  if (!/^[a-z0-9][a-z0-9./_-]*(?::[A-Za-z0-9._-]+|@sha256:[a-f0-9]{64})$/.test(builderImage)) {
    throw new Error("Choose a versioned builder image or immutable digest.");
  }
  const timeoutSeconds = Number(input.timeoutSeconds ?? 900);
  if (!Number.isInteger(timeoutSeconds) || timeoutSeconds < 120 || timeoutSeconds > 900) {
    throw new Error("Remote build timeout must be between 120 and 900 seconds.");
  }
  return { provider, imagePrefix, builderImage, timeoutSeconds };
}

export function exactSourceRevision(value: unknown): string {
  const sha = String(value || "").trim().toLowerCase();
  if (!/^[a-f0-9]{40}$/.test(sha)) throw new Error("An exact GitHub commit SHA is required.");
  return sha;
}

export function repositoryPath(value: unknown, base = "."): string {
  const input = String(value || ".");
  if (/[$\x00-\x1f\\]/.test(input) || path.posix.isAbsolute(input) || /^[a-z]+:/i.test(input)) {
    throw new Error("Build paths must be literal paths inside the repository.");
  }
  const result = path.posix.normalize(path.posix.join(base, input));
  if (result === ".." || result.startsWith("../")) throw new Error("Build path escapes the repository.");
  return result;
}

export type ServiceImageBuild = { service: string; context: string; dockerfile: string; target?: string; tag: string };

/** Read source Compose, never the host's interpolated runtime environment. */
export function planDaytonaImages(input: {
  compose: string; composePath: string; policy: ReleaseBuildPolicy; commitSha: string; services?: string[];
}): ServiceImageBuild[] {
  const sha = exactSourceRevision(input.commitSha);
  const document = parse(input.compose) as Record<string, unknown>;
  if (!document || typeof document !== "object" || Array.isArray(document) || document.include) {
    throw new Error("Remote builds require a standalone repository Compose file.");
  }
  const services = document.services as Record<string, Record<string, unknown>>;
  if (!services || typeof services !== "object" || Array.isArray(services)) throw new Error("Compose has no services.");
  const selected = input.services?.length ? input.services.map(assertComposeServiceName) : Object.keys(services);
  if (selected.some(name => !services[name])) throw new Error("A selected Compose service does not exist.");
  const base = path.posix.dirname(repositoryPath(input.composePath));
  const result: ServiceImageBuild[] = [];
  for (const service of selected) {
    assertComposeServiceName(service);
    const definition = services[service];
    if (definition.extends) throw new Error(`Remote build cannot resolve extends for ${service}.`);
    if (!definition.build) continue;
    if (definition.platform && definition.platform !== "linux/amd64") throw new Error("The builder currently supports linux/amd64.");
    const build = typeof definition.build === "string" ? { context: definition.build } : definition.build as Record<string, unknown>;
    if (!build || typeof build !== "object" || Array.isArray(build)) throw new Error(`Invalid build for ${service}.`);
    const unsupported = Object.keys(build).filter(key => !["context", "dockerfile", "target"].includes(key));
    if (unsupported.length) throw new Error(`Remote build does not yet support ${service}: ${unsupported.join(", ")}. Runtime values are never used as build arguments.`);
    const context = repositoryPath(build.context, base);
    const dockerfile = repositoryPath(build.dockerfile || "Dockerfile", context);
    const target = build.target ? String(build.target) : undefined;
    if (target && !/^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(target)) throw new Error("Invalid Dockerfile target.");
    result.push({ service, context, dockerfile, target, tag: `${input.policy.imagePrefix}-${service.toLowerCase()}:${sha}` });
  }
  if (!result.length) throw new Error("The selected services have no repository Dockerfiles to build.");
  if (new Set(result.map(build => build.tag)).size !== result.length) throw new Error("Service names collide in the registry image namespace.");
  return result;
}

export function imageBuildCommand(build: ServiceImageBuild, repository: string, commitSha: string): string {
  const root = "/tmp/gc-source";
  return [
    // Resolve symlinks before Docker sees the build context or Dockerfile.
    `gc_context=$(realpath ${shQuote(`${root}/${build.context}`)})`,
    `gc_dockerfile=$(realpath ${shQuote(`${root}/${build.dockerfile}`)})`,
    `case "$gc_context/" in ${root}/*) ;; *) exit 45;; esac`,
    `case "$gc_dockerfile" in ${root}/*) ;; *) exit 45;; esac`,
    `docker build --platform linux/amd64 --label ${shQuote(`org.opencontainers.image.revision=${exactSourceRevision(commitSha)}`)} --label ${shQuote(`org.opencontainers.image.source=https://github.com/${repository}`)} --tag ${shQuote(build.tag)} --file "$gc_dockerfile"${build.target ? ` --target ${shQuote(build.target)}` : ""} "$gc_context"`,
  ].join("\n");
}

export function redactBuildEvidence(value: string, secrets: string[] = []): string {
  let output = value;
  for (const secret of secrets.filter(Boolean)) output = output.split(secret).join("[REDACTED]");
  return output.replace(/(?:gh[pousr]_[A-Za-z0-9_]+|github_pat_[A-Za-z0-9_]+)/g, "[REDACTED]")
    .replace(/(authorization\s*[:=]\s*|Bearer\s+)\S+/gi, "$1[REDACTED]").slice(-8000);
}
