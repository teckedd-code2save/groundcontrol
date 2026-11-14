import { createHash } from "node:crypto";
import { parse, stringify } from "yaml";
import { planAgentFirstDeploy, type FirstDeployPlanInput } from "./agent-first-deploy-plan";
import { execOnWorkloadTarget } from "./host-exec";
import { shQuote, type VpsConnection } from "./vps";
import { probePublicUrl } from "./agent-health";
export interface ApprovedFirstDeployRecipe extends FirstDeployPlanInput {
  recipeHash: string;
  health: { service: string; port: number; path: string };
  budget: { maxServices: number; cpusPerService: number; memoryMbPerService: number; pidsPerService: number; timeoutSeconds: number };
  allowUnboundedBuildResources: boolean;
  publicUrl?: string;
}
type Evidence = { phase: string; deploymentPath: string; composePath: string; composeProject: string; commitSha: string };
export type FirstDeployResult = Evidence & { success: boolean; status: "success" | "failed" | "uncertain"; error?: string; loopbackVerified: boolean; publicVerified: boolean; hostMutation: "none" | "possible" | "confirmed" };
type Deps = { run?: typeof execOnWorkloadTarget; publicProbe?: typeof probePublicUrl };
const sha = (value: string) => createHash("sha256").update(value).digest("hex");
const within = (value: number, min: number, max: number) => Number.isFinite(value) && value >= min && value <= max;
/** No side effects. Acceptance MUST persist/hash this complete recipe, not just recipeHash. */
export function prepareFirstDeployExecution(recipe: ApprovedFirstDeployRecipe) {
  const plan = planAgentFirstDeploy(recipe);
  if (!plan.readyForOwnerReview || recipe.recipeHash !== plan.recipeHash) throw new Error("Approved source/Compose recipe changed or has unresolved review blockers.");
  const b = recipe.budget;
  if (!b || !Number.isInteger(b.maxServices) || !within(b.maxServices,1,10) || !within(b.cpusPerService,.1,2) || !Number.isInteger(b.memoryMbPerService) || !within(b.memoryMbPerService,128,2048) || !Number.isInteger(b.pidsPerService) || !within(b.pidsPerService,16,512) || !Number.isInteger(b.timeoutSeconds) || !within(b.timeoutSeconds,30,600) || plan.services.length > b.maxServices) throw new Error("Choose a valid explicit runtime budget and execution wait timeout.");
  const h = recipe.health;
  if (!h || !plan.services.includes(h.service) || !Number.isInteger(h.port) || !within(h.port,1024,65535) || !/^\/[A-Za-z0-9/_.-]*$/.test(h.path) || h.path.length > 200) throw new Error("Choose an approved service, unprivileged loopback port and HTTP health path.");
  if (recipe.composeYaml.includes("$")) throw new Error("Environment interpolation is not supported for first launch; resolve configuration in the reviewed recipe.");
  if (recipe.publicUrl) { const u = new URL(recipe.publicUrl); if (u.protocol !== "https:" || u.username || u.password || u.hash || u.search) throw new Error("Public verification requires an existing credential-free HTTPS URL."); }
  const doc = parse(recipe.composeYaml);
  let selected = false;
  let healthContainerPort = 0;
  for (const [name, service] of Object.entries(doc.services) as [string, Record<string, unknown>][]) {
    if (service.build && recipe.allowUnboundedBuildResources !== true) throw new Error("Approve host source builds explicitly: build CPU/RAM are not isolated; the execution wait is bounded but daemon-side builds may continue after timeout.");
    if (service.env_file || service.environment) throw new Error("Owner environment provisioning is not implemented for first launch; remove environment values or use the existing deployment workflow.");
    if (service.deploy) throw new Error("Resolve deploy directives into the approved runtime budget before first launch.");
    if (service.ports !== undefined && !Array.isArray(service.ports)) throw new Error("Published ports must be an explicit list of loopback TCP mappings.");
    for (const port of (service.ports || []) as unknown[]) {
      if (typeof port !== "string" || !/^127\.0\.0\.1:\d{1,5}:\d{1,5}$/.test(port)) throw new Error("Every published port must be an explicit 127.0.0.1:host:container TCP mapping; no public binds are opened.");
      const [,host,container] = port.split(":");
      if (!within(Number(host),1024,65535) || !within(Number(container),1,65535)) throw new Error("Invalid published port.");
      if (name === h.service && Number(host) === h.port) { selected = true; healthContainerPort = Number(container); }
    }
    service.cpus = b.cpusPerService;
    service.mem_limit = `${b.memoryMbPerService}m`;
    service.memswap_limit = `${b.memoryMbPerService}m`;
    service.pids_limit = b.pidsPerService;
    service.restart = "no";
    if (service.build) {
      const build = typeof service.build === "string" ? { context: service.build } : service.build as Record<string, unknown>;
      build.context = `${plan.deploymentPath}/${recipe.composeFile.includes("/") ? recipe.composeFile.slice(0,recipe.composeFile.lastIndexOf("/")+1) : ""}${String(build.context || ".")}`;
      service.build = build;
      service.image = `gc-first-launch-${sha(recipe.proposalId).slice(0,24)}-${sha(name).slice(0,12)}:${recipe.commitSha}`;
    }
  }
  if (!selected) throw new Error("The approved health port must be published by the selected service on loopback.");
  const effectiveYaml = stringify(doc);
  if (Buffer.byteLength(effectiveYaml, "utf8") > 32 * 1024) throw new Error("Effective Compose configuration exceeds the 32 KiB first-launch limit. Reduce the workload recipe or use the existing operator deployment workflow.");
  return { plan, healthContainerPort, effectiveYaml, composeProject: `gcf_${sha(recipe.proposalId).slice(0,24)}`, composePath: `${plan.deploymentPath}/.groundcontrol/effective-compose.yml` };
}
/** Caller owns authorization, durable single claim and terminal DB state. Never automatically retry this function. */
export async function executeAgentFirstDeploy(recipe: ApprovedFirstDeployRecipe, vps: VpsConnection, recordEvidence: (evidence: Evidence) => Promise<void>, deps: Deps = {}): Promise<FirstDeployResult> {
  const prepared = prepareFirstDeployExecution(recipe); // reject before any host action
  if (!vps) throw new Error("An explicitly approved host is required.");
  const run = deps.run || execOnWorkloadTarget;
  const evidence: Evidence = { phase: "prepared", deploymentPath: prepared.plan.deploymentPath, composePath: prepared.composePath, composeProject: prepared.composeProject, commitSha: recipe.commitSha };
  let loopbackVerified = false;
  let hostMutation: FirstDeployResult["hostMutation"] = "none";
  const result = (status: FirstDeployResult["status"], error?: string): FirstDeployResult => ({ ...evidence, success: status === "success", status, error, loopbackVerified, publicVerified: false, hostMutation });
  const deadline = Date.now() + recipe.budget.timeoutSeconds * 1000;
  const command = async (phase: string, shell: string) => {
    evidence.phase = phase;
    await recordEvidence({ ...evidence });
    const seconds = Math.floor((deadline-Date.now())/1000);
    if (seconds < 1) throw new Error("Execution wait deadline reached; builds may continue on the Docker daemon. Inspect before retrying.");
    if (phase === "checkout_started") hostMutation = "possible";
    return run(`timeout -k 5s ${seconds}s sh -c ${shQuote(shell)}`,vps,undefined,undefined,{ timeout: seconds*1000+5000 });
  };
  const path = shQuote(evidence.deploymentPath);
  try {
    evidence.phase = "prerequisite_check";
    await recordEvidence({ ...evidence });
    // Read-only, including on hosts missing timeout itself. Do not trust arbitrary output as an error message.
    const preflight = await run([
      "set -eu",
      "for tool in timeout git docker sha256sum curl base64 find cut; do command -v \"$tool\" >/dev/null 2>&1 || { printf 'missing-tool:%s' \"$tool\"; exit 1; }; done",
      "docker compose version >/dev/null 2>&1 || { printf 'missing-compose'; exit 1; }",
      "docker info >/dev/null 2>&1 || { printf 'docker-unavailable'; exit 1; }",
      "parent=/; for p in /srv /srv/groundcontrol /srv/groundcontrol/deployments; do if [ -L \"$p\" ]; then printf 'unsafe-path'; exit 1; elif [ -e \"$p\" ]; then test -d \"$p\" || { printf 'unsafe-path'; exit 1; }; parent=$p; else break; fi; done",
      "test -w \"$parent\" && test -x \"$parent\" || { printf 'unwritable-parent'; exit 1; }",
      `if [ -e ${path} ] || [ -L ${path} ]; then printf 'path-collision'; exit 1; fi`,
      "printf prerequisites-ready",
    ].join("\n"), vps, undefined, undefined, { timeout: 15000 });
    if (preflight.code !== 0 || preflight.stdout.trim() !== "prerequisites-ready") {
      const key = preflight.stdout.trim();
      const missing = /^missing-tool:(timeout|git|docker|sha256sum|curl|base64|find|cut)$/.exec(key);
      const messages: Record<string, string> = {
        "missing-compose": "Install the Docker Compose v2 plugin through server tooling setup, then request a new first launch.",
        "docker-unavailable": "Docker is not reachable by the configured host account. Finish Docker setup and verify daemon access before requesting a new first launch; permissions were not changed.",
        "unsafe-path": "The managed deployment hierarchy contains a symlink or non-directory. Ask the owner to resolve /srv/groundcontrol/deployments before launching; nothing was changed.",
        "unwritable-parent": "The configured host account cannot create the managed deployment directory. Ask the owner to prepare writable /srv/groundcontrol/deployments through installer setup; no sudo or permission changes were attempted.",
        "path-collision": "This proposal's deployment directory already exists. Inspect the prior attempt; existing content will not be deleted or reused.",
      };
      return result("failed", missing ? `Required host tool ${missing[1]} is missing. Install it through server tooling setup before requesting a new first launch; nothing was changed.` : messages[key] || "Could not verify host prerequisites. Check host connectivity and tooling setup before launching; no checkout was attempted.");
    }
    // Create only the fixed managed hierarchy, rechecking each component immediately before use.
    const checkout = await command("checkout_started", ["set -eu", "umask 077", "command -v timeout >/dev/null", "command -v git >/dev/null", "command -v docker >/dev/null", "command -v sha256sum >/dev/null", "command -v curl >/dev/null", "for p in /srv /srv/groundcontrol /srv/groundcontrol/deployments; do test ! -L \"$p\"; if [ ! -e \"$p\" ]; then mkdir \"$p\"; fi; test -d \"$p\" && test ! -L \"$p\"; done", `mkdir ${path}`, `cd ${path}`, "export GIT_CONFIG_NOSYSTEM=1 GIT_CONFIG_GLOBAL=/dev/null GIT_TERMINAL_PROMPT=0", "git -c core.hooksPath=/dev/null init -q", `git remote add origin ${shQuote(prepared.plan.source.repositoryUrl+".git")}`, `git -c core.hooksPath=/dev/null fetch --depth 1 origin ${shQuote(recipe.commitSha)}`, "git -c core.hooksPath=/dev/null checkout --detach FETCH_HEAD", `test "$(git rev-parse HEAD)" = ${shQuote(recipe.commitSha)}`, "test -z \"$(find . -type l -print -quit)\"", `test "$(sha256sum ${shQuote(recipe.composeFile)} | cut -d ' ' -f 1)" = ${shQuote(sha(recipe.composeYaml))}`, "test ! -e .groundcontrol", "mkdir .groundcontrol", `printf %s ${shQuote(Buffer.from(prepared.effectiveYaml).toString("base64"))} | base64 -d > ${shQuote(evidence.composePath)}`].join("\n"));
    if (checkout.code === 124 || checkout.code === 137) return result("uncertain", "Checkout wait timed out. Inspect reserved files and running processes before retrying.");
    if (checkout.code !== 0) return result("failed","Source checkout, exclusive path reservation or immutable recipe verification failed. Existing files were not removed; inspect before retrying.");
    hostMutation = "confirmed";
    const compose = `docker compose --project-directory ${path} --env-file /dev/null -p ${shQuote(evidence.composeProject)} -f ${shQuote(evidence.composePath)}`;
    const config = await command("compose_validation_started", `set -eu\ncd ${path}\n${compose} config --quiet`);
    if (config.code === 124 || config.code === 137) return result("uncertain", "Compose validation wait timed out. Inspect before retrying.");
    if (config.code !== 0) return result("failed","Effective Compose configuration failed validation; no application was launched.");
    const launch = await command("launch_started", `set -eu\ncd ${path}\n${compose} up -d --build --wait --wait-timeout ${Math.max(1,Math.floor((deadline-Date.now())/1000))}`);
    if (launch.code !== 0) return result("uncertain","Compose did not confirm readiness. Containers or builds may exist; inspect before any retry.");
    const ownership = await command("runtime_ownership_check", `set -eu\nids=$(${compose} ps -q ${shQuote(recipe.health.service)})\ncase "$ids" in ''|*[!a-f0-9]*) exit 1;; esac\ndocker inspect --format '{{index .Config.Labels "com.docker.compose.project"}}|{{index .Config.Labels "com.docker.compose.service"}}|{{.State.Running}}|{{json .NetworkSettings.Ports}}' "$ids"`);
    const fields = ownership.stdout.trim().split("|");
    let ownedPort = false;
    try {
      const bindings = JSON.parse(fields[3] || "null")?.[`${prepared.healthContainerPort}/tcp`];
      ownedPort = Array.isArray(bindings) && bindings.some((binding: { HostIp?: string; HostPort?: string }) => binding.HostIp === "127.0.0.1" && binding.HostPort === String(recipe.health.port));
    } catch { /* invalid evidence must not become success */ }
    if (ownership.code !== 0 || fields.length !== 4 || fields[0] !== evidence.composeProject || fields[1] !== recipe.health.service || fields[2] !== "true" || !ownedPort) return result("failed", "The selected running service and loopback port could not be tied to this deployment. Do not trust unrelated endpoint responses; inspect the runtime.");
    const health = await command("health_verification_started", `set -eu\ncode=$(curl --noproxy '*' -sS -o /dev/null --max-time 10 -w '%{http_code}' ${shQuote(`http://127.0.0.1:${recipe.health.port}${recipe.health.path}`)})\ncase "$code" in 2[0-9][0-9]) printf verified;; *) exit 1;; esac`);
    if (health.code !== 0 || health.stdout.trim() !== "verified") return result("failed","Runtime started but the approved application health endpoint did not pass. Workload was not deleted.");
    loopbackVerified = true;
    if (recipe.publicUrl) {
      const probe = await (deps.publicProbe || probePublicUrl)(recipe.publicUrl);
      if (!probe.checked || probe.healthy !== true) return result("failed","Application passed loopback health but existing public HTTPS was not verified.");
      return { ...result("success"), publicVerified: true };
    }
    return result("success");
  } catch { return result("uncertain","Execution outcome could not be confirmed. Inspect the reserved path and runtime before retrying; automatic replay is prohibited."); }
}
