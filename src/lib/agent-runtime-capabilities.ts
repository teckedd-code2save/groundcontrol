import { parseStandaloneRecipe, standaloneRecipeIdentity } from "./standalone-recipe";
import { createHash } from "node:crypto";
import path from "node:path";

export interface AgentRuntimeDeployment {
  id?: number;
  projectGroupId?: number | null;
  kind: string;
  vpsConfigId?: number | null;
  sourcePath?: string | null;
  composePath?: string | null;
  containerName?: string | null;
  metadataJson?: string | null;
  legacyProject?: {
    id: number; path: string; category: string; dockerCompose?: string | null;
    envVars?: string | null; outputDir?: string | null; buildCommand?: string | null;
  } | null;
  githubRepositories?: unknown[];
}

export function jsonObject(value?: string | null): Record<string, unknown> {
  try { const parsed = JSON.parse(value || "{}"); return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {}; }
  catch { return {}; }
}

export function deploymentRuntime(deployment: AgentRuntimeDeployment) {
  if (deployment.kind === "source") return "unsupported";
  if (deployment.kind === "static" || deployment.legacyProject?.category === "static") return "static";
  if (deployment.kind === "compose" || deployment.composePath || deployment.legacyProject?.dockerCompose) return "compose";
  if (deployment.kind === "container" && deployment.containerName) return "container";
  return "unsupported";
}

export function composeDirectory(deployment: AgentRuntimeDeployment) {
  const directory = deployment.composePath ? path.posix.dirname(deployment.composePath) : deployment.sourcePath || deployment.legacyProject?.path || null;
  return directory && safeAbsolutePath(directory) ? directory : null;
}

function safeAbsolutePath(value: string) {
  return value.startsWith("/") && path.posix.resolve(value) !== "/" && !value.split("/").includes("..") && !/[\x00-\x1f]/.test(value);
}

// Template sites record the source separately from the published document root.
// Older templates did not persist the build recipe: never guess it from a folder.
export function staticRecipe(deployment: AgentRuntimeDeployment) {
  const project = deployment.legacyProject;
  if (!project) return null;
  const config = jsonObject(project.envVars);
  const source = config.source as { sourcePath?: string } | undefined;
  const sourcePath = (typeof source?.sourcePath === "string" && source.sourcePath) || deployment.sourcePath || project.path;
  const staticDir = typeof config.staticDir === "string" ? config.staticDir : project.path;
  const backup = config.publishRecipe as { version?: unknown; sourcePath?: unknown; staticDir?: unknown; outputDir?: unknown; buildCommand?: unknown } | undefined;
  // Recover only exact persisted choices. Template defaults and package scripts
  // cannot establish what an operator selected for an older deployment.
  const recorded = backup?.version === 1 && backup.sourcePath === sourcePath && backup.staticDir === staticDir && typeof backup.outputDir === "string" && typeof backup.buildCommand === "string"
    ? { outputDir: backup.outputDir, buildCommand: backup.buildCommand } : null;
  if (config.templateName && project.outputDir == null && !recorded) return null;
  if (project.outputDir == null && project.buildCommand != null && recorded && project.buildCommand !== recorded.buildCommand) return null;
  const outputDir = project.outputDir ?? recorded?.outputDir ?? ".";
  const buildCommand = project.outputDir != null ? project.buildCommand : recorded?.buildCommand ?? project.buildCommand;
  if (![sourcePath, staticDir].every(safeAbsolutePath)) return null;
  if (path.posix.isAbsolute(outputDir) || outputDir.split("/").includes("..")) return null;
  const outputPath = path.posix.resolve(sourcePath, outputDir);
  const root = path.posix.resolve(staticDir);
  // Copying a directory onto itself (or a child/parent) can destroy source.
  if (outputPath === root || outputPath.startsWith(`${root}/`) || root.startsWith(`${outputPath}/`)) return null;
  return { sourcePath, staticDir: root, outputPath, buildCommand: buildCommand || null };
}

export function runtimeCapabilities(deployment: AgentRuntimeDeployment) {
  const runtime = deploymentRuntime(deployment);
  const enrollment = jsonObject(JSON.stringify(jsonObject(deployment.metadataJson).agentEnrollment));
  const enrolledByAgent = Boolean(jsonObject(deployment.metadataJson).agentEnrollment);
  const firstLaunchReady = enrolledByAgent && enrollment.firstLaunchState === "pending" && typeof enrollment.recipeHash === "string" && /^[a-f0-9]{64}$/.test(enrollment.recipeHash) && process.env.GC_AGENT_ENROLLMENT_PROPOSALS === "1";
  const host = Boolean(deployment.vpsConfigId);
  const compose = runtime === "compose" && Boolean(composeDirectory(deployment));
  const publish = runtime === "static" && Boolean(staticRecipe(deployment));
  const recreate = runtime === "container" && Boolean(parseStandaloneRecipe(deployment));
  const linkedSource = Boolean(deployment.githubRepositories?.length);
  const support = (supported: boolean, reason: string) => ({ supported: host && supported, reason: !host ? "No deployment host is recorded." : supported ? null : reason });
  const ongoing = (supported: boolean, reason: string) => support(!enrolledByAgent && supported, enrolledByAgent ? "This workload requires its owner-approved first-launch recipe; ordinary deployment mutations are not enabled." : reason);
  return {
    runtime,
    ...(enrolledByAgent ? { firstLaunchRecipeHash: enrollment.recipeHash, firstLaunchState: enrollment.firstLaunchState } : {}),
    operations: {
      "deployment.first_launch": support(firstLaunchReady, "An enabled, pending owner-approved enrollment recipe is required; completed or uncertain launches cannot be replayed."),
      "deployment.restart": support((!enrolledByAgent || enrollment.firstLaunchState === "success") && (compose || runtime === "container"), "This runtime has no supported container restart operation."),
      "deployment.redeploy": ongoing(compose || publish || recreate, runtime === "container" ? "No recreate specification is recorded for this standalone container; use deployment.restart." : "A saved source, build recipe and separate static document root are required."),
      "deployment.source.deploy": ongoing((compose || publish) && linkedSource, "A deployable runtime and a linked GitHub repository are required."),
      "deployment.build_publish": ongoing(compose && linkedSource, "Image builds require a Compose deployment and a linked GitHub repository."),
      "deployment.release": ongoing(compose, "Digest releases require a Compose deployment."),
    },
  };
}

export function requireRuntimeOperation(deployment: AgentRuntimeDeployment, name: string) {
  const capabilities = runtimeCapabilities(deployment);
  const operation = capabilities.operations[name as keyof typeof capabilities.operations];
  if (!operation?.supported) throw new Error(`${name} is unsupported: ${operation?.reason || "Unknown runtime operation."}`);
}

export function runtimeIdentity(deployment: AgentRuntimeDeployment) {
  // Hash recipes because they may contain operator-owned build commands or paths.
  return createHash("sha256").update(JSON.stringify({
    runtime: deploymentRuntime(deployment), host: deployment.vpsConfigId,
    source: deployment.sourcePath, compose: deployment.composePath,
    container: deployment.containerName, composeProject: jsonObject(deployment.metadataJson).composeProject,
    project: deployment.legacyProject?.id, directory: composeDirectory(deployment),
    static: deploymentRuntime(deployment) === "static" ? staticRecipe(deployment) : null,
    enrollmentRecipe: jsonObject(JSON.stringify(jsonObject(deployment.metadataJson).agentEnrollment)).recipeHash,
    standalone: standaloneRecipeIdentity(parseStandaloneRecipe(deployment)),
  })).digest("hex");
}
