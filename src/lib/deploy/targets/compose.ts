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
} from "@/lib/vps";

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
        `cd ${shQuote(projectPath)} && ${composeCmd} ${fileFlag(
          config.composeFile
        )} build ${buildArgs}`,
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
        `cd ${shQuote(projectPath)} && ${composeCmd} ${fileFlag(
          config.composeFile
        )} pull && ${composeCmd} ${fileFlag(
          config.composeFile
        )} up -d --remove-orphans`,
        ctx.vps
      );
      if (result.code !== 0) {
        throw new Error(result.stderr || "docker compose deploy failed");
      }

      return {};
    },

    async rollback(_deployment, ctx) {
      const projectPath = await resolveProjectPath(project, config, ctx);
      const composeCmd = await getDockerComposeCommand(ctx.vps);

      ctx.log(`[compose] rolling back ${project.slug}`);

      // Pragmatic rollback: restart the stack. If an imageTag was pinned
      // previously this will still restart with the previous image until the
      // next build+deploy cycle.
      const result = await execOnVps(
        `cd ${shQuote(projectPath)} && ${composeCmd} ${fileFlag(
          config.composeFile
        )} down && ${composeCmd} ${fileFlag(config.composeFile)} up -d`,
        ctx.vps
      );
      if (result.code !== 0) {
        throw new Error(result.stderr || "docker compose rollback failed");
      }
    },

    async destroy(project, ctx) {
      const projectPath = await resolveProjectPath(project, config, ctx);
      const composeCmd = await getDockerComposeCommand(ctx.vps);

      ctx.log(`[compose] destroying ${project.slug}`);

      const result = await execOnVps(
        `cd ${shQuote(projectPath)} && ${composeCmd} ${fileFlag(
          config.composeFile
        )} down -v`,
        ctx.vps
      );
      if (result.code !== 0) {
        throw new Error(result.stderr || "docker compose destroy failed");
      }
    },
  };
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

function fileFlag(composeFile?: string): string {
  if (!composeFile) return "";
  return `-f ${shQuote(composeFile)}`;
}
