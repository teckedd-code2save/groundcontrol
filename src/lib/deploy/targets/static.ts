/**
 * DeployTarget adapter for static sites served by Caddy.
 *
 * Type: "static"
 */

import type { Project, DeploymentTarget } from "@prisma/client";
import type {
  DeployContext,
  DeployTarget,
  DeployBuildResult,
  DeployResult,
} from "./types";
import { execOnVps, shQuote, getSystemConfig } from "@/lib/vps";

export interface StaticTargetConfig {
  /** Domain to serve the static site on. Falls back to project.domain. */
  domain?: string;
  /** Extra Caddy directives appended inside the site block. */
  extraCaddy?: string;
}

export function createStaticTarget(
  project: Project,
  target: DeploymentTarget
): DeployTarget {
  const config = parseStaticConfig(target.configJson);

  return {
    type: "static",

    async prepare(ctx: DeployContext) {
      const workingDir = getWorkingDir(project);
      ctx.log(`[static] preparing ${project.slug} at ${workingDir}`);

      await execOnVps(`mkdir -p ${shQuote(workingDir)}`, ctx.vps);

      if (project.repoUrl) {
        await cloneOrPull(project, workingDir, ctx);
      }
    },

    async build(project, ctx): Promise<DeployBuildResult> {
      const workingDir = getWorkingDir(project);
      if (!project.buildCommand) {
        ctx.log(`[static] no buildCommand configured; skipping build`);
        return { outputDir: project.outputDir || "." };
      }

      ctx.log(`[static] building ${project.slug}: ${project.buildCommand}`);
      const result = await execOnVps(
        `cd ${shQuote(workingDir)} && ${project.buildCommand}`,
        ctx.vps
      );
      if (result.code !== 0) {
        throw new Error(result.stderr || "static build failed");
      }

      return { outputDir: project.outputDir || "." };
    },

    async deploy(project, _deployment, ctx): Promise<DeployResult> {
      const workingDir = getWorkingDir(project);
      const outputDir = project.outputDir || ".";
      const systemConfig = await getSystemConfig();
      const staticDir = `${systemConfig.staticRoot.replace(/\/$/, "")}/${
        project.slug
      }`;
      const sitesDir = systemConfig.caddySitesDir;
      const caddyFile = systemConfig.caddyFile;
      const domain = config.domain || project.domain;

      ctx.log(`[static] deploying ${project.slug} to ${staticDir}`);

      // Backup previous deployment for rollback.
      await execOnVps(
        `rm -rf ${shQuote(`${staticDir}.prev`)} && if [ -d ${shQuote(
          staticDir
        )} ]; then mv ${shQuote(staticDir)} ${shQuote(`${staticDir}.prev`)}; fi`,
        ctx.vps
      );

      const sourcePath = `${workingDir}/${outputDir}`;
      const copy = await execOnVps(
        `rm -rf ${shQuote(staticDir)} && mkdir -p ${shQuote(
          staticDir
        )} && cp -Rp ${shQuote(`${sourcePath}/.`)} ${shQuote(`${staticDir}/`)}`,
        ctx.vps
      );
      if (copy.code !== 0) {
        throw new Error(copy.stderr || "failed to copy static output");
      }

      if (domain) {
        await writeCaddySite(
          {
            sitesDir,
            caddyFile,
            domain,
            staticDir,
            extra: config.extraCaddy || "",
          },
          ctx
        );
      }

      return { publicUrl: domain ? `https://${domain}` : undefined };
    },

    async rollback(_deployment, ctx) {
      const systemConfig = await getSystemConfig();
      const staticDir = `${systemConfig.staticRoot.replace(/\/$/, "")}/${
        project.slug
      }`;
      const prevDir = `${staticDir}.prev`;

      ctx.log(`[static] rolling back ${project.slug}`);

      const hasPrev = await execOnVps(
        `test -d ${shQuote(prevDir)} && echo yes || echo no`,
        ctx.vps
      );
      if (hasPrev.stdout.trim() !== "yes") {
        throw new Error("no previous static deployment to roll back to");
      }

      await execOnVps(
        `rm -rf ${shQuote(`${staticDir}.failed`)} && mv ${shQuote(
          staticDir
        )} ${shQuote(`${staticDir}.failed`)} && mv ${shQuote(
          prevDir
        )} ${shQuote(staticDir)}`,
        ctx.vps
      );

      await reloadCaddy(systemConfig.caddyFile, ctx);
    },

    async destroy(project, ctx) {
      const systemConfig = await getSystemConfig();
      const staticDir = `${systemConfig.staticRoot.replace(/\/$/, "")}/${
        project.slug
      }`;
      const sitesDir = systemConfig.caddySitesDir;
      const caddyFile = systemConfig.caddyFile;
      const domain = config.domain || project.domain;

      ctx.log(`[static] destroying ${project.slug}`);

      await execOnVps(
        `rm -rf ${shQuote(staticDir)} ${shQuote(`${staticDir}.prev`)}`,
        ctx.vps
      );

      if (domain) {
        await execOnVps(
          `rm -f ${shQuote(`${sitesDir}/${siteFileName(domain)}`)}`,
          ctx.vps
        );
        await reloadCaddy(caddyFile, ctx);
      }
    },
  };
}

function parseStaticConfig(configJson: string): StaticTargetConfig {
  try {
    return JSON.parse(configJson || "{}") as StaticTargetConfig;
  } catch {
    return {};
  }
}

function getWorkingDir(project: Project): string {
  return project.path || `/opt/${project.slug}`;
}

async function cloneOrPull(
  project: Project,
  workingDir: string,
  ctx: DeployContext
) {
  const hasGit = await execOnVps(
    `test -d ${shQuote(`${workingDir}/.git`)} && echo yes || echo no`,
    ctx.vps
  );

  if (hasGit.stdout.trim() === "yes") {
    ctx.log(`[static] pulling latest source`);
    const result = await execOnVps(
      `cd ${shQuote(workingDir)} && git pull`,
      ctx.vps
    );
    if (result.code !== 0) {
      throw new Error(result.stderr || "git pull failed");
    }
  } else {
    ctx.log(`[static] cloning ${project.repoUrl}`);
    const result = await execOnVps(
      `rm -rf ${shQuote(workingDir)} && git clone --depth 1 ${shQuote(
        project.repoUrl!
      )} ${shQuote(workingDir)}`,
      ctx.vps
    );
    if (result.code !== 0) {
      throw new Error(result.stderr || "git clone failed");
    }
  }
}

interface CaddySiteParams {
  sitesDir: string;
  caddyFile: string;
  domain: string;
  staticDir: string;
  extra: string;
}

async function writeCaddySite(params: CaddySiteParams, ctx: DeployContext) {
  const { sitesDir, caddyFile, domain, staticDir, extra } = params;

  await execOnVps(`mkdir -p ${shQuote(sitesDir)}`, ctx.vps);

  const block = `${domain} {
  root * ${staticDir}
  file_server
  encode gzip
${extra ? extra.split("\n").map((l) => "  " + l).join("\n") + "\n" : ""}}
`;

  const result = await execOnVps(
    `cat > ${shQuote(`${sitesDir}/${siteFileName(domain)}`)} <<'EOF'\n${block}EOF`,
    ctx.vps
  );
  if (result.code !== 0) {
    throw new Error(result.stderr || "failed to write Caddy site block");
  }

  await reloadCaddy(caddyFile, ctx);
}

async function reloadCaddy(caddyFile: string, ctx: DeployContext) {
  const reload = await execOnVps(
    `caddy reload --config ${shQuote(caddyFile)} 2>/dev/null || systemctl reload caddy 2>/dev/null || caddy reload 2>/dev/null || true`,
    ctx.vps
  );
  // Caddy reload failures are logged but not fatal; the site file is already
  // written and a subsequent Caddy load will pick it up.
  if (reload.code !== 0) {
    ctx.log(`[static] caddy reload warning: ${reload.stderr || reload.stdout}`);
  }
}

function siteFileName(domain: string): string {
  return domain.replace(/[^a-zA-Z0-9._-]/g, "_") + ".caddy";
}
