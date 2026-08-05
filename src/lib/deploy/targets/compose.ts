/**
 * DeployTarget adapter for Docker Compose projects.
 *
 * Type: "compose" (also normalises the Prisma "docker-compose" type).
 */

import type { Project, DeploymentTarget } from "@prisma/client";
import type {
  DeployContext,
  DeployTarget,
  DeployBuildResult,
  DeployResult,
} from "./types";
import {
  execOnVps,
  shQuote,
  getDockerComposeCommand,
  resolveComposeProjectPath,
  buildManagedComposeInvocation,
} from "@/lib/vps";
import {
  MANAGED_IMAGE_OVERRIDE_FILE,
  updateManagedImageOverride,
} from "@/lib/compose-management";

export interface ComposeTargetConfig {
  /** Absolute path to the compose project directory. Optional — resolved from labels/config when absent. */
  projectPath?: string;
  /** Optional service name to scope operations to. */
  service?: string;
  /** Optional compose file name (defaults to docker-compose.yml). */
  composeFile?: string;
  /** Optional build args passed to docker compose build. */
  buildArgs?: Record<string, string>;
}

export function createComposeTarget(
  project: Project,
  target: DeploymentTarget
): DeployTarget {
  const config = parseComposeConfig(target.configJson);

  return {
    type: "compose",

    async prepare(ctx: DeployContext) {
      const projectPath = await resolveProjectPath(project, config, ctx);
      ctx.log(`[compose] preparing ${project.slug} at ${projectPath}`);

      await execOnVps(`mkdir -p ${shQuote(projectPath)}`, ctx.vps);

      if (project.repoUrl) {
        await cloneOrPull(project, projectPath, ctx);
      }
    },

    async build(project, ctx): Promise<DeployBuildResult> {
      const projectPath = await resolveProjectPath(project, config, ctx);
      const composeFile = config.composeFile || "docker-compose.yml";
      const composeCmd = await getDockerComposeCommand(ctx.vps);

      ctx.log(`[compose] building ${project.slug} at ${projectPath}`);

      const exists = await execOnVps(
        `test -f ${shQuote(`${projectPath}/${composeFile}`)} && echo yes || echo no`,
        ctx.vps
      );
      if (exists.stdout.trim() !== "yes") {
        ctx.log(`[compose] no ${composeFile} found; skipping build`);
        return {};
      }

      const buildArgs = Object.entries(config.buildArgs || {})
        .map(([k, v]) => `--build-arg ${shQuote(`${k}=${v}`)}`)
        .join(" ");

      const result = await execOnVps(
        `cd ${shQuote(projectPath)} && ${buildManagedComposeInvocation(
          composeCmd,
          `build ${buildArgs}`,
          config.composeFile
        )}`,
        ctx.vps
      );
      if (result.code !== 0) {
        throw new Error(result.stderr || "docker compose build failed");
      }

      return { imageTag: `${project.slug}:latest` };
    },

    async deploy(project, deployment, ctx): Promise<DeployResult> {
      const projectPath = await resolveProjectPath(project, config, ctx);
      const composeCmd = await getDockerComposeCommand(ctx.vps);

      ctx.log(`[compose] deploying ${project.slug}`);

      const result = await execOnVps(
        `cd ${shQuote(projectPath)} && ${buildManagedComposeInvocation(
          composeCmd,
          "pull",
          config.composeFile
        )} && ${buildManagedComposeInvocation(
          composeCmd,
          "up -d --remove-orphans",
          config.composeFile
        )}`,
        ctx.vps
      );
      if (result.code !== 0) {
        throw new Error(result.stderr || "docker compose deploy failed");
      }

      return {};
    },

    async rollback(deployment, ctx) {
      const projectPath = await resolveProjectPath(project, config, ctx);
      const composeCmd = await getDockerComposeCommand(ctx.vps);
      const composeFile = config.composeFile || "docker-compose.yml";

      ctx.log(`[compose] rolling back ${project.slug}`);

      const pinnedDigest = deployment.previousImageDigest;
      if (!pinnedDigest) {
        ctx.log(`[compose] no previous digest available; restarting current image`);
        await restartCompose(projectPath, composeCmd, composeFile, ctx);
        return;
      }

      ctx.log(`[compose] pinning to previous image: ${pinnedDigest.slice(0, 19)}...`);

      // Resolve the real service names from the live compose config. Docker
      // Compose rejects wildcard service keys ("*"), so the pin override must
      // target an actual service. The stored digest is captured from the first
      // service of the deployment, so that is the one we pin.
      const servicesResult = await execOnVps(
        `cd ${shQuote(projectPath)} && ${buildManagedComposeInvocation(
          composeCmd,
          "config --services",
          composeFile,
          { includeEnvironment: false }
        )}`,
        ctx.vps
      );
      const services = servicesResult.stdout
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean);
      if (services.length === 0) {
        ctx.log(
          `[compose] could not resolve compose services; restarting current image`
        );
        await restartCompose(projectPath, composeCmd, composeFile, ctx);
        return;
      }

      const pinnedService = services[0];
      if (services.length > 1) {
        ctx.log(
          `[compose] ${services.length} services detected; pinning ${pinnedService} (single stored digest)`
        );
      }

      // Ride the managed image override file so the pinned digest is applied
      // by the same machinery as user-set image pins (isolated DOCKER_CONFIG
      // credentials, env overlay, etc.). The previous contents are restored
      // afterwards so the rollback pin does not leak into future deploys.
      const overridePath = `${projectPath}/${MANAGED_IMAGE_OVERRIDE_FILE}`;
      const readResult = await execOnVps(
        `cat ${shQuote(overridePath)} 2>/dev/null || true`,
        ctx.vps
      );
      const previousOverride = readResult.stdout;

      let pinContent: string;
      try {
        pinContent = updateManagedImageOverride(
          previousOverride,
          pinnedService,
          pinnedDigest
        ).content;
      } catch (err) {
        ctx.log(
          `[compose] could not build digest pin (${err instanceof Error ? err.message : String(err)}); restarting current image`
        );
        await restartCompose(projectPath, composeCmd, composeFile, ctx);
        return;
      }

      try {
        await execOnVps(
          `mkdir -p ${shQuote(`${projectPath}/.groundcontrol`)} && cat > ${shQuote(overridePath)}`,
          ctx.vps,
          undefined,
          pinContent
        );

        const result = await execOnVps(
          `cd ${shQuote(projectPath)} && ` +
            `${buildManagedComposeInvocation(composeCmd, "down", composeFile)} && ` +
            `${buildManagedComposeInvocation(composeCmd, "up -d", composeFile)}`,
          ctx.vps
        );
        if (result.code !== 0) {
          throw new Error(result.stderr || "docker compose rollback failed");
        }
      } finally {
        // Restore the previous override state (or remove the file) so the pin
        // is temporary — best-effort, never fail the rollback on cleanup.
        const restore = previousOverride.trim()
          ? execOnVps(
              `cat > ${shQuote(overridePath)}`,
              ctx.vps,
              undefined,
              previousOverride
            )
          : execOnVps(`rm -f ${shQuote(overridePath)}`, ctx.vps);
        await restore.catch(() => undefined);
      }
    },

    async destroy(project, ctx) {
      const projectPath = await resolveProjectPath(project, config, ctx);
      const composeCmd = await getDockerComposeCommand(ctx.vps);

      ctx.log(`[compose] destroying ${project.slug}`);

      const result = await execOnVps(
        `cd ${shQuote(projectPath)} && ${buildManagedComposeInvocation(
          composeCmd,
          "down -v",
          config.composeFile
        )}`,
        ctx.vps
      );
      if (result.code !== 0) {
        throw new Error(result.stderr || "docker compose destroy failed");
      }
    },
  };
}

/**
 * Restart-based rollback fallback: bring the stack down and back up with its
 * current images. Used when no previous digest is stored or the digest cannot
 * be pinned for any reason.
 */
async function restartCompose(
  projectPath: string,
  composeCmd: string,
  composeFile: string,
  ctx: DeployContext
): Promise<void> {
  const result = await execOnVps(
    `cd ${shQuote(projectPath)} && ${buildManagedComposeInvocation(
      composeCmd,
      "down",
      composeFile
    )} && ${buildManagedComposeInvocation(composeCmd, "up -d", composeFile)}`,
    ctx.vps
  );
  if (result.code !== 0) {
    throw new Error(result.stderr || "docker compose rollback failed");
  }
}

function parseComposeConfig(configJson: string): ComposeTargetConfig {
  try {
    return JSON.parse(configJson || "{}") as ComposeTargetConfig;
  } catch {
    return {};
  }
}

async function resolveProjectPath(
  project: Project,
  config: ComposeTargetConfig,
  ctx: DeployContext
): Promise<string> {
  if (config.projectPath) return config.projectPath;

  const resolved = await resolveComposeProjectPath(
    project.slug,
    config.service,
    ctx.vps
  );
  return resolved.projectPath;
}

async function cloneOrPull(
  project: Project,
  projectPath: string,
  ctx: DeployContext
) {
  const hasGit = await execOnVps(
    `test -d ${shQuote(`${projectPath}/.git`)} && echo yes || echo no`,
    ctx.vps
  );

  if (hasGit.stdout.trim() === "yes") {
    ctx.log(`[compose] pulling latest source`);
    const result = await execOnVps(
      `cd ${shQuote(projectPath)} && git pull`,
      ctx.vps
    );
    if (result.code !== 0) {
      throw new Error(result.stderr || "git pull failed");
    }
  } else {
    ctx.log(`[compose] cloning ${project.repoUrl}`);
    const result = await execOnVps(
      `rm -rf ${shQuote(projectPath)} && git clone --depth 1 ${shQuote(
        project.repoUrl!
      )} ${shQuote(projectPath)}`,
      ctx.vps
    );
    if (result.code !== 0) {
      throw new Error(result.stderr || "git clone failed");
    }
  }
}
