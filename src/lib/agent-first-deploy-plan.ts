import { createHash } from "node:crypto";
import { posix } from "node:path";
import { parseDocument } from "yaml";

export interface FirstDeployPlanInput {
  proposalId: string;
  repositoryUrl: string;
  commitSha: string;
  composeFile: string;
  composeYaml: string;
}
export interface FirstDeployBlocker { field: string; message: string }
export interface FirstDeployPlan {
  readyForOwnerReview: boolean;
  source: { repositoryUrl: string; commitSha: string; composeFile: string };
  /** Must be reserved exclusively and checked for pre-existing content before execution. */
  deploymentPath: string;
  recipeHash: string;
  services: string[];
  blockers: FirstDeployBlocker[];
  limitations: string[];
}
const record = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const isRecord = (value: unknown) => value !== null && typeof value === "object" && !Array.isArray(value);
const dynamic = (value: string) => value.includes("$");
function relativePath(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 512 &&
    !dynamic(value) && !/[\\\x00-\x1f\x7f:]/.test(value) && !value.startsWith("/") && !value.startsWith("~") &&
    !value.split("/").includes("..");
}

/** A conservative static review, NOT a sandbox or authorization to execute repository code. */
export function planAgentFirstDeploy(input: FirstDeployPlanInput): FirstDeployPlan {
  const blockers: FirstDeployBlocker[] = [];
  const block = (field: string, message: string) => blockers.push({ field, message });
  let repositoryUrl = "";
  try {
    const url = new URL(input.repositoryUrl);
    const parts = url.pathname.replace(/\/$/, "").split("/").slice(1);
    const owner = parts[0];
    const name = (parts[1] || "").replace(/\.git$/i, "");
    if (url.protocol !== "https:" || url.hostname !== "github.com" || url.port || url.username || url.password || url.search || url.hash || parts.length !== 2 || !/^[A-Za-z0-9][A-Za-z0-9-]{0,38}$/.test(owner) || !/^[A-Za-z0-9_.-]{1,100}$/.test(name) || [".", ".."].includes(name)) throw new Error();
    repositoryUrl = `https://github.com/${owner}/${name}`;
  } catch { block("repositoryUrl", "Use an exact HTTPS github.com/owner/repository URL without credentials or query parameters."); }
  const commitSha = input.commitSha.trim().toLowerCase();
  if (!/^[a-f0-9]{40}$/.test(commitSha)) block("commitSha", "Resolve and approve the full 40-character GitHub commit SHA; branches and tags can move.");
  if (!/^[A-Za-z0-9_-]{8,160}$/.test(input.proposalId)) block("proposalId", "Use a persisted server-generated proposal identity.");
  if (!relativePath(input.composeFile) || !/\.ya?ml$/i.test(input.composeFile)) block("composeFile", "Choose a repository-relative Compose YAML file without traversal or variable expansion.");
  const deploymentPath = `/srv/groundcontrol/deployments/proposal-${createHash("sha256").update(input.proposalId).digest("hex")}`;
  let doc: Record<string, unknown> = {};
  if (Buffer.byteLength(input.composeYaml, "utf8") > 256 * 1024) block("composeYaml", "Compose file exceeds the 256 KiB review limit.");
  else {
    try {
      const parsed = parseDocument(input.composeYaml, { uniqueKeys: true });
      if (parsed.errors.length) throw new Error();
      const value: unknown = parsed.toJS({ maxAliasCount: 50 });
      if (!isRecord(value)) throw new Error();
      doc = record(value);
    } catch { block("composeYaml", "Provide valid Compose YAML with unique keys and bounded aliases."); }
  }
  for (const key of ["include", "configs", "secrets"]) if (key in doc) block(key, `The first-deploy review does not support ${key}; resolve it explicitly before approval.`);
  const services = record(doc.services);
  if (!isRecord(doc.services) || !Object.keys(services).length) block("services", "Declare at least one Compose service.");
  if (Object.keys(services).length > 20) block("services", "Limit the initial deployment to 20 services.");
  for (const [name, raw] of Object.entries(services)) {
    const field = `services.${name}`;
    if (!/^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(name) || !isRecord(raw)) { block(field, "Use a valid service name and a service mapping."); continue; }
    const svc = record(raw);
    // Reject these features rather than trying to prove a privileged variation safe.
    for (const key of ["extends", "devices", "device_cgroup_rules", "cap_add", "security_opt", "use_api_socket", "volumes_from", "provider", "post_start", "pre_stop", "credential_spec", "container_name", "cgroup", "cgroup_parent", "sysctls", "gpus", "develop", "profiles", "scale"]) {
      if (key in svc) block(`${field}.${key}`, `Remove ${key} from this initial deployment or use a separately reviewed operator workflow.`);
    }
    if ("privileged" in svc && svc.privileged !== false) block(`${field}.privileged`, "Privileged containers are not supported.");
    for (const key of ["network_mode", "pid", "ipc", "uts", "userns_mode"]) if (key in svc) block(`${field}.${key}`, `Explicit ${key} is not supported; use isolated default namespaces.`);
    if ("extra_hosts" in svc) block(`${field}.extra_hosts`, "Remove extra_hosts, including host-gateway mappings, from the initial deployment.");
    const reservations = record(record(record(svc.deploy).resources).reservations);
    if ("devices" in reservations) block(`${field}.deploy.resources.reservations.devices`, "Device reservations are not supported in the initial deployment.");
    if ("env_file" in svc) block(`${field}.env_file`, "Supply reviewed environment key names through GroundControl rather than unreviewed env_file paths.");
    if (svc.build !== undefined) {
      const build = typeof svc.build === "string" ? { context: svc.build } : record(svc.build);
      if (!isRecord(svc.build) && typeof svc.build !== "string") block(`${field}.build`, "Use a repository-local build context.");
      if (!relativePath(build.context ?? ".")) block(`${field}.build.context`, "Build context must stay inside the pinned repository, without remote URLs or traversal.");
      if (build.dockerfile !== undefined && !relativePath(build.dockerfile)) block(`${field}.build.dockerfile`, "Dockerfile must stay inside the repository build context.");
      for (const key of ["args", "cache_from", "cache_to", "tags", "additional_contexts", "dockerfile_inline", "ssh", "secrets", "entitlements", "privileged", "network", "extra_hosts"]) if (key in build) block(`${field}.build.${key}`, `Build ${key} needs a separate operator review and is not supported here.`);
    }
    if (svc.volumes !== undefined && !Array.isArray(svc.volumes)) block(`${field}.volumes`, "Volumes must be an explicit list of anonymous or declared named volumes.");
    for (const volume of Array.isArray(svc.volumes) ? svc.volumes : []) {
      if (typeof volume === "string") {
        const parts = volume.split(":");
        if (dynamic(volume) || parts.length > 3 || (parts.length > 1 && !/^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(parts[0]))) block(`${field}.volumes`, "Host bind mounts and variable-expanded mounts are not supported; use declared named volumes.");
        else if (parts.length > 1 && !(parts[0] in record(doc.volumes))) block(`${field}.volumes`, `Declare named volume ${parts[0]} explicitly.`);
        const target = parts.length === 1 ? parts[0] : parts[1];
        if (!target.startsWith("/") || /docker\.sock|containerd\.sock/i.test(target)) block(`${field}.volumes`, "Use an absolute container mount target, not a runtime socket.");
      } else {
        const mount = record(volume);
        if (!isRecord(volume) || mount.type !== "volume" || typeof mount.source !== "string" || !/^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(mount.source) || !(mount.source in record(doc.volumes)) || typeof mount.target !== "string" || !mount.target.startsWith("/") || dynamic(mount.target) || /docker\.sock|containerd\.sock/i.test(mount.target)) block(`${field}.volumes`, "Only declared named-volume mounts with absolute non-socket container targets are supported.");
      }
    }
  }
  for (const kind of ["volumes", "networks"]) for (const [name, value] of Object.entries(record(doc[kind]))) {
    const config = record(value);
    if (!/^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(name) || (value !== null && !isRecord(value)) || Object.keys(config).some(key => key !== "labels")) block(`${kind}.${name}`, `Use a project-scoped ${kind === "volumes" ? "volume" : "network"}; external names, drivers and driver options are not supported.`);
  }
  const source = { repositoryUrl, commitSha, composeFile: relativePath(input.composeFile) ? posix.normalize(input.composeFile) : "" };
  const recipeHash = createHash("sha256").update(JSON.stringify({ version: 1, proposalId: input.proposalId, source, composeYaml: input.composeYaml })).digest("hex");
  return { readyForOwnerReview: blockers.length === 0, source, deploymentPath, recipeHash, services: Object.keys(services), blockers, limitations: [
    "Static screening is not a sandbox: images, Dockerfiles and application code can execute untrusted code. Owner review and authorization are still required.",
    "Resolve symlinks and verify all build and mount paths against the pinned checkout before execution. Reserve an empty deployment path exclusively; never delete or reuse existing content.",
    "Ports, resource budgets, secrets, image digests, health checks and trusted public HTTPS still need explicit review and runtime verification. No host action or access grant has been performed.",
  ] };
}
