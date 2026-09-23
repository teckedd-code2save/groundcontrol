import { Daytona, type Sandbox } from "@daytona/sdk";
import { randomUUID } from "node:crypto";
import { loadDaytonaRuntimeConfig } from "./intelligence/daytona";
import { sourceAccessForDeployment, normalizeSourceBranch } from "./github-source-deploy";
import { loadGithubRegistryPublishCredential } from "./github-registry";
import { shQuote } from "./vps";
import { exactSourceRevision, imageBuildCommand, planDaytonaImages, redactBuildEvidence, repositoryPath, type ReleaseBuildPolicy } from "./daytona-release-plan";

export type DaytonaReleaseArtifact = {
  repository: string; branch: string; commitSha: string; sandboxId: string;
  images: Record<string, string>; tags: Record<string, string>; cleanedUp: true;
};

export const START_DOCKER = `set -eu
if ! docker info >/dev/null 2>&1; then
  dockerd --host=unix:///var/run/docker.sock --storage-driver=vfs >/tmp/gc-docker.log 2>&1 &
  gc_try=0
  until docker info >/dev/null 2>&1; do
    gc_try=$((gc_try+1))
    if [ "$gc_try" -ge 40 ]; then tail -n 30 /tmp/gc-docker.log; exit 1; fi
    sleep 1
  done
fi
docker version --format '{{.Server.Version}}'`;

async function boundedGithubBytes(url: string, token: string, maxBytes: number): Promise<Buffer> {
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "User-Agent": "GroundControl" },
    signal: AbortSignal.timeout(90_000),
  });
  if (!response.ok || !response.body) throw new Error(`GitHub source request failed (HTTP ${response.status}).`);
  const chunks: Uint8Array[] = [];
  let size = 0;
  const reader = response.body.getReader();
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.byteLength;
      if (size > maxBytes) throw new Error("Repository source exceeds the remote build size limit.");
      chunks.push(next.value);
    }
  } finally { await reader.cancel().catch(() => undefined); }
  return Buffer.concat(chunks);
}

/** Build source in Daytona; this function has no host execution capability. */
export async function buildDaytonaRelease(input: {
  deploymentId: number; branch?: string; commitSha?: string; composePath: string;
  policy: ReleaseBuildPolicy; services?: string[]; evidence: (line: string) => Promise<void>;
}): Promise<DaytonaReleaseArtifact> {
  if (input.policy.provider !== "daytona") throw new Error("Daytona release policy is not enabled.");
  const config = await loadDaytonaRuntimeConfig();
  if (!config) throw new Error("Daytona is not configured. Production builds are not a fallback.");
  const access = await sourceAccessForDeployment(input.deploymentId);
  const registry = await loadGithubRegistryPublishCredential();
  const branch = normalizeSourceBranch(input.branch, access.repository.defaultBranch);
  const repository = access.repository.fullName;
  const ref = input.commitSha ? exactSourceRevision(input.commitSha) : branch;
  const api = `https://api.github.com/repos/${repository}`;
  const commit = JSON.parse((await boundedGithubBytes(`${api}/commits/${encodeURIComponent(ref)}`, access.token, 2_000_000)).toString()) as { sha: string };
  const commitSha = exactSourceRevision(commit.sha);
  if (input.commitSha && commitSha !== ref) throw new Error("GitHub returned a different source revision.");
  const composePath = repositoryPath(input.composePath);
  const sourceFile = JSON.parse((await boundedGithubBytes(`${api}/contents/${composePath.split("/").map(encodeURIComponent).join("/")}?ref=${commitSha}`, access.token, 2_000_000)).toString()) as { encoding: string; content: string };
  if (sourceFile.encoding !== "base64" || !sourceFile.content) throw new Error("The exact source Compose file could not be read.");
  const builds = planDaytonaImages({ compose: Buffer.from(sourceFile.content, "base64").toString(), composePath, policy: input.policy, commitSha, services: input.services });
  const archive = await boundedGithubBytes(`${api}/tarball/${commitSha}`, access.token, 32 * 1024 * 1024);
  const client = new Daytona({ apiKey: config.apiKey, apiUrl: config.apiUrl, target: config.target });
  const auth = Buffer.from(`${registry.username}:${registry.token}`).toString("base64");
  const secrets = [access.token, registry.token, config.apiKey, auth];
  const started = Date.now();
  const remaining = () => {
    const seconds = Math.floor(input.policy.timeoutSeconds - (Date.now() - started) / 1000);
    if (seconds <= 0) throw new Error("Daytona release exceeded its time budget.");
    return seconds;
  };
  let sandbox: Sandbox | null = null;
  let result: Omit<DaytonaReleaseArtifact, "cleanedUp"> | undefined;
  let failure: Error | undefined;
  const evidence = (line: string) => input.evidence(redactBuildEvidence(line, secrets));
  try {
    await evidence(`[build] Creating Daytona Docker builder for ${repository}@${commitSha}`);
    sandbox = await client.create({
      name: `gc-release-${input.deploymentId}-${randomUUID().slice(0, 12)}`,
      image: input.policy.builderImage, resources: { cpu: 2, memory: 4, disk: 10 }, user: "root",
      public: false, ephemeral: true, autoStopInterval: 5, autoDeleteInterval: 0,
      ttlMinutes: Math.ceil(input.policy.timeoutSeconds / 60) + 3,
      labels: { product: "groundcontrol", purpose: "release-build", deployment: String(input.deploymentId), revision: commitSha },
    }, { timeout: Math.min(120, remaining()) });
    const box = sandbox;
    await evidence(`[build] sandbox=${box.id} cpu=${box.cpu} memoryGiB=${box.memory} diskGiB=${box.disk}`);
    const run = async (command: string, phase: string) => {
      const response = await box.process.executeCommand(command, undefined, { CI: "1", DOCKER_BUILDKIT: "1" }, remaining());
      await evidence(`[${phase}] ${response.result}`);
      if (response.exitCode !== 0) throw new Error(`Daytona ${phase} failed (exit ${response.exitCode}). ${redactBuildEvidence(response.result, secrets).slice(-1500)}`);
      return response.result;
    };
    await run(START_DOCKER, "builder");
    await box.fs.uploadFile(archive, "/tmp/gc-source.tar.gz", Math.min(60, remaining()));
    await run("set -eu; mkdir -p /tmp/gc-source; tar -xzf /tmp/gc-source.tar.gz -C /tmp/gc-source --strip-components=1; rm /tmp/gc-source.tar.gz", "source");
    for (const build of builds) {
      await evidence(`[build] service=${build.service} image=${build.tag}`);
      await run(`set -eu\n${imageBuildCommand(build, repository, commitSha)}`, "build");
    }
    // Credentials arrive after repository Dockerfiles have finished executing and live outside all build contexts.
    await run("mkdir -p /tmp/gc-registry && chmod 700 /tmp/gc-registry", "publish");
    await box.fs.uploadFile(Buffer.from(JSON.stringify({ auths: { "ghcr.io": { auth } } })), "/tmp/gc-registry/config.json", Math.min(30, remaining()));
    const images: Record<string, string> = {};
    const tags: Record<string, string> = {};
    for (const build of builds) {
      await run(`set -eu; chmod 600 /tmp/gc-registry/config.json; DOCKER_CONFIG=/tmp/gc-registry docker push ${shQuote(build.tag)}`, "publish");
      const output = await run(`docker image inspect --format '{{json .RepoDigests}}' ${shQuote(build.tag)}`, "digest");
      const digests = JSON.parse(output.trim()) as string[];
      const name = build.tag.slice(0, build.tag.lastIndexOf(":"));
      const digest = digests.find(value => value.startsWith(`${name}@sha256:`));
      if (!digest || !/^ghcr\.io\/[a-z0-9._/-]+@sha256:[a-f0-9]{64}$/.test(digest)) throw new Error(`No immutable registry digest for ${build.service}.`);
      images[build.service] = digest;
      tags[build.service] = build.tag;
    }
    await run("rm -rf /tmp/gc-registry", "cleanup");
    result = { repository, branch, commitSha, sandboxId: box.id, images, tags };
  } catch (error) {
    failure = new Error(redactBuildEvidence(error instanceof Error ? error.message : "Remote build failed.", secrets));
  } finally {
    if (sandbox) {
      try { await client.delete(sandbox, 45, true); await evidence(`[cleanup] Deleted Daytona sandbox ${sandbox.id}`); }
      catch { failure = new Error(`Daytona cleanup is unconfirmed for sandbox ${sandbox.id}. Production replacement is blocked; TTL remains active.`); }
    }
    await client[Symbol.asyncDispose]().catch(() => { failure ||= new Error("Daytona client cleanup failed; release completion is unconfirmed."); });
  }
  if (failure) throw failure;
  if (!result) throw new Error("Daytona did not produce a complete release.");
  return { ...result, cleanedUp: true };
}
