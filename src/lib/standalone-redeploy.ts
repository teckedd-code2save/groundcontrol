import { execOnWorkloadTarget } from "./host-exec";
import { shQuote, type VpsConnection } from "./vps";
import { prisma } from "./prisma";
import { assertStandaloneSnapshot, parseStandaloneRecipe, type ContainerSnapshot } from "./standalone-recipe";
import type { agentOperationTarget } from "./agent-operation-target";

async function inspect(id: string, vps: VpsConnection): Promise<ContainerSnapshot> {
  const result = await execOnWorkloadTarget(`docker inspect --type container --format '{{json .}}' ${shQuote(id)}`, vps);
  if (result.code !== 0) throw new Error("Container inspection failed; inspect the operation evidence before retrying.");
  try { return JSON.parse(result.stdout); }
  catch { throw new Error("Docker returned incomplete container evidence."); }
}

/** Recreate only GC's captured, mount-free local-image contract. Never infer an imported run command. */
export async function redeployStandalone(target: NonNullable<Awaited<ReturnType<typeof agentOperationTarget>>>, options: { verificationAttempts?: number; pause?: () => Promise<void> } = {}) {
  const { deployment, operation, vps } = target;
  const recipe = parseStandaloneRecipe(deployment);
  if (!recipe || !deployment.containerName) return { success: false, error: "No captured standalone recreate recipe is available." };
  const originalName = deployment.containerName;
  const original = await inspect(recipe.containerId, vps);
  try { assertStandaloneSnapshot(original, recipe, originalName); }
  catch { return { success: false, error: "The enrolled container changed since recipe capture. No mutation was performed." }; }
  if (original.State.Paused || original.State.Restarting || original.State.Dead || original.State.Status !== (original.State.Running ? "running" : "exited")) return { success: false, error: "The original container is not in a stable running or stopped state. No mutation was performed." };
  const suffix = operation.id.replace(/[^a-zA-Z0-9_-]/g, "");
  const candidateName = `gc-candidate-${suffix}`;
  const previousName = `gc-previous-${suffix}`;
  let candidateId: string | null = null;
  let applied = false;
  const evidence = () => ({ previousContainerId: recipe.containerId, candidateId, candidateName, previousName, containerName: originalName, imageId: recipe.imageId });
  const record = async (phase: string) => prisma.agentOperation.update({ where: { id: operation.id }, data: { evidenceJson: JSON.stringify({ ...evidence(), phase }) } });
  const run = async (command: string) => {
    const result = await execOnWorkloadTarget(command, vps, undefined, undefined, { timeout: 120_000 });
    // A killed or timed-out process does not establish whether Docker applied the request.
    if ([124, 137, 143].includes(result.code)) throw new Error("Docker command outcome is uncertain.");
    return result;
  };
  const rollback = async () => {
    await record("standalone_rollback");
    try {
      const old = await inspect(recipe.containerId, vps);
      if (![originalName, previousName].some((name) => old.Name === `/${name}`)) throw new Error("Original identity changed during rollback.");
      assertStandaloneSnapshot(old, recipe, old.Name.slice(1));
      if (candidateId) {
        const candidate = await inspect(candidateId, vps);
        if (candidate.Id !== candidateId || ![originalName, candidateName].some((name) => candidate.Name === `/${name}`)) throw new Error("Replacement identity changed during rollback.");
        if ((await run(`docker rm -f ${shQuote(candidateId)}`)).code !== 0) throw new Error("Could not remove the failed replacement.");
      }
      if (old.Name !== `/${originalName}` && (await run(`docker rename ${shQuote(recipe.containerId)} ${shQuote(originalName)}`)).code !== 0) throw new Error("Could not restore the original name.");
      if (original.State.Running && (await run(`docker start ${shQuote(recipe.containerId)}`)).code !== 0) throw new Error("Could not restart the original container.");
      const restored = await inspect(recipe.containerId, vps);
      assertStandaloneSnapshot(restored, recipe, originalName);
      if (restored.State.Running !== original.State.Running) throw new Error("Original runtime state was not restored.");
      return { success: false, applied, rollbackVerified: true, error: "Replacement failed; the original container and its prior running state were restored.", ...evidence() };
    } catch {
      return { uncertain: true, applied, rollbackVerified: false, error: "Rollback could not be verified. Inspect both recorded container IDs before retrying.", ...evidence() };
    }
  };

  await record("standalone_prepare");
  const create = await run(`docker create --pull never --name ${shQuote(candidateName)} --hostname ${shQuote(recipe.hostname)} --label ${shQuote(`io.groundcontrol.project=${recipe.projectId}`)} --label ${shQuote(`io.groundcontrol.deployment=${recipe.deploymentId}`)} -p ${shQuote(`127.0.0.1:${recipe.hostPort}:${recipe.containerPort}`)} ${shQuote(recipe.imageId)}`);
  if (create.code !== 0) return { uncertain: true, applied: false, error: "Replacement creation did not complete. The original container was not stopped; inspect the candidate name before retrying.", ...evidence() };
  candidateId = create.stdout.trim();
  if (!/^[a-f0-9]{64}$/.test(candidateId)) throw new Error("No exact replacement container ID was returned.");
  await record("standalone_candidate_created");
  const candidate = await inspect(candidateId, vps);
  if (candidate.Id !== candidateId || candidate.Name !== `/${candidateName}`) return { uncertain: true, applied: false, error: "Replacement ownership could not be confirmed. No existing container was stopped or removed.", ...evidence() };
  try { assertStandaloneSnapshot(candidate, recipe, candidateName, candidateId); }
  catch {
    if ((await run(`docker rm ${shQuote(candidateId)}`)).code !== 0) return { uncertain: true, applied: false, error: "Replacement configuration differed and its cleanup was not confirmed. The original was not stopped.", ...evidence() };
    return { success: false, applied: false, error: "Replacement configuration differed from the captured recipe. The original was not stopped.", ...evidence() };
  }

  // Recheck after preparation so a replaced original is never stopped by name.
  try {
    const currentOriginal = await inspect(recipe.containerId, vps);
    assertStandaloneSnapshot(currentOriginal, recipe, originalName);
    if (currentOriginal.State.Running !== original.State.Running || currentOriginal.State.Paused || currentOriginal.State.Restarting || currentOriginal.State.Dead) throw new Error("Original runtime state changed during preparation.");
  }
  catch { return { uncertain: true, applied: false, error: "Original identity could not be reconfirmed. Inspect the prepared candidate before retrying.", ...evidence() }; }
  await record("standalone_switching");
  if (original.State.Running && (await run(`docker stop ${shQuote(recipe.containerId)}`)).code !== 0) return rollback();
  applied = true;
  if ((await run(`docker rename ${shQuote(recipe.containerId)} ${shQuote(previousName)}`)).code !== 0) return rollback();
  if ((await run(`docker rename ${shQuote(candidateId)} ${shQuote(originalName)}`)).code !== 0) return rollback();
  if ((await run(`docker start ${shQuote(candidateId)}`)).code !== 0) return rollback();
  await record("standalone_verifying");
  // Docker's normal healthcheck interval alone can be 30s; allow startup probes
  // to run before treating an otherwise-running replacement as unverified.
  const attempts = Math.max(1, Math.min(300, options.verificationAttempts ?? 300));
  const pause = options.pause || (() => new Promise<void>((resolve) => setTimeout(resolve, 1000)));
  let verified = false;
  for (let attempt = 0; attempt < attempts; attempt++) {
    const current = await inspect(candidateId, vps);
    try { assertStandaloneSnapshot(current, recipe, originalName, candidateId); } catch { return rollback(); }
    if (current.State.Running && !current.State.Paused && !current.State.Restarting && !current.State.Dead && (!current.State.Health || current.State.Health.Status === "healthy")) { verified = true; break; }
    if (!current.State.Running || current.State.Health?.Status === "unhealthy") break;
    if (attempt < attempts - 1) await pause();
  }
  if (!verified) return rollback();
  const metadata = JSON.parse(deployment.metadataJson);
  const updated = await prisma.enrolledDeployment.updateMany({
    where: { id: deployment.id, metadataJson: deployment.metadataJson },
    data: { status: "active", lastSeenAt: new Date(), metadataJson: JSON.stringify({ ...metadata, recreateRecipe: { ...recipe, containerId: candidateId }, previousContainerId: recipe.containerId }) },
  });
  if (updated.count !== 1) return { uncertain: true, applied: true, error: "Replacement is running but enrollment changed during execution. Reconcile the recorded container IDs.", ...evidence() };
  await record("standalone_verified");
  // Keep the stopped original, including its writable layer, for operator recovery.
  return { success: true, applied: true, runtimeVerified: true, publicVerified: false, previousContainerRetained: true, ...evidence() };
}
