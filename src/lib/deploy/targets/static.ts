/**
 * DeployTarget adapter for static sites served by a reverse proxy.
 *
 * Type: "static"
 *
 * The site files are copied into `staticRoot/<slug>` and the active reverse
 * proxy is detected on the host: Caddy gets a Caddyfile site block (the
 * default edge), Nginx gets an Nginx server block. Hosts without either
 * proxy fall back to the Caddy behavior so externally-managed edges keep
 * receiving a usable Caddyfile.
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
  getSystemConfig,
  type VpsConnection,
} from "@/lib/vps";

export interface StaticTargetConfig {
  /** Domain to serve the static site on. Falls back to project.domain. */
  domain?: string;
  /** Extra Caddy directives appended inside the site block. */
  extraCaddy?: string;
  /** Extra Nginx directives appended inside the server block. */
  extraNginx?: string;
}

export type ReverseProxy = "caddy" | "nginx" | "none";

/**
 * Detect the reverse proxy installed on the target host.
 *
 * Runs a single read-only POSIX sh command so Caddy-only, Nginx-only, and
 * dual-proxy layouts all resolve in one round trip. Caddy wins ties because
 * it is GroundControl's default edge, and "none" keeps the legacy Caddy
 * behavior for externally-managed hosts.
 */
export async function detectReverseProxy(
  vps: VpsConnection | null
): Promise<ReverseProxy> {
  const result = await execOnVps(
    `if command -v caddy >/dev/null 2>&1; then echo caddy; elif command -v nginx >/dev/null 2>&1; then echo nginx; else echo none; fi`,
    vps
  );
  const proxy = result.stdout.trim();
  return proxy === "caddy" || proxy === "nginx" ? proxy : "none";
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

      let publicUrl: string | undefined;
      if (domain) {
        const proxy = await detectReverseProxy(ctx.vps);
        ctx.log(`[static] reverse proxy detected: ${proxy}`);

        if (proxy === "nginx") {
          await writeNginxSite(
            {
              sitesDir: systemConfig.nginxSitesDir,
              domain,
              staticDir,
              extra: config.extraNginx || "",
            },
            ctx
          );
          // The generated server block listens on :80; TLS can be layered on
          // later with certbot. Report the URL the block actually serves.
          publicUrl = `http://${domain}`;
        } else {
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
          publicUrl = `https://${domain}`;
        }
      }

      return { publicUrl };
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

      const proxy = await detectReverseProxy(ctx.vps);
      if (proxy === "caddy") {
        await reloadCaddy(systemConfig.caddyFile, ctx);
      }
      // Nginx serves static files from disk per request, so a directory swap
      // needs no reload. The site config file itself is unchanged by rollback.
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
        const proxy = await detectReverseProxy(ctx.vps);
        if (proxy === "nginx") {
          const { filePath, sitesEnabledDir } = nginxConfigPaths(
            systemConfig.nginxSitesDir,
            domain
          );
          const symlinkPath = sitesEnabledDir
            ? `${sitesEnabledDir}/${nginxFileName(domain)}`
            : null;
          await execOnVps(
            `rm -f ${shQuote(filePath)}${
              symlinkPath ? ` ${shQuote(symlinkPath)}` : ""
            }`,
            ctx.vps
          );

          // Only reload if the remaining config validates; a pre-existing
          // broken config elsewhere must not block teardown.
          const test = await execOnVps(`nginx -t 2>&1`, ctx.vps);
          if (test.code === 0) {
            await reloadNginx(ctx);
          } else {
            ctx.log(
              `[static] nginx -t failed after config removal; not reloading: ${
                test.stderr || test.stdout
              }`
            );
          }
        } else {
          await execOnVps(
            `rm -f ${shQuote(`${sitesDir}/${siteFileName(domain)}`)}`,
            ctx.vps
          );
          await reloadCaddy(caddyFile, ctx);
        }
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

interface NginxSiteParams {
  sitesDir: string;
  domain: string;
  staticDir: string;
  extra: string;
}

/**
 * Render an Nginx server block for a static site.
 *
 * The block serves the site over HTTP on :80. TLS is intentionally left to
 * certbot (or an outer edge) so this stays valid on Nginx-only layouts where
 * certificate provisioning is the operator's choice.
 */
export function nginxServerBlock(
  params: Omit<NginxSiteParams, "sitesDir">
): string {
  const { domain, staticDir, extra } = params;
  const extraLines = extra
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => `    ${line}`)
    .join("\n");

  return [
    "server {",
    "    listen 80;",
    `    server_name ${domain};`,
    "",
    `    root ${staticDir};`,
    "    index index.html;",
    "",
    "    location / {",
    "        try_files $uri $uri/ =404;",
    "    }",
    "",
    "    gzip on;",
    ...(extraLines ? [extraLines] : []),
    "}",
    "",
  ].join("\n");
}

function nginxFileName(domain: string): string {
  return domain.replace(/[^a-zA-Z0-9._-]/g, "_") + ".conf";
}

interface NginxConfigPaths {
  /** Absolute path of the site's server-block file. */
  filePath: string;
  /**
   * sites-enabled directory when the host uses the Debian/Ubuntu
   * sites-available + sites-enabled layout; null for conf.d-style layouts
   * where the file itself is loaded.
   */
  sitesEnabledDir: string | null;
}

function nginxConfigPaths(sitesDir: string, domain: string): NginxConfigPaths {
  const filePath = `${sitesDir.replace(/\/$/, "")}/${nginxFileName(domain)}`;
  const sitesEnabledDir = /sites-available\/?$/.test(sitesDir)
    ? sitesDir.replace(/sites-available\/?$/, "sites-enabled")
    : null;
  return { filePath, sitesEnabledDir };
}

async function writeNginxSite(params: NginxSiteParams, ctx: DeployContext) {
  const { sitesDir, domain, staticDir, extra } = params;
  const { filePath, sitesEnabledDir } = nginxConfigPaths(sitesDir, domain);

  await execOnVps(`mkdir -p ${shQuote(sitesDir)}`, ctx.vps);

  const block = nginxServerBlock({ domain, staticDir, extra });

  // Keep a backup of any existing site file so a failed `nginx -t` can be
  // rolled back instead of leaving the proxy with a half-written config.
  await execOnVps(
    `if [ -f ${shQuote(filePath)} ]; then cp ${shQuote(filePath)} ${shQuote(
      `${filePath}.bak`
    )}; fi`,
    ctx.vps
  );

  const write = await execOnVps(
    `cat > ${shQuote(filePath)} <<'EOF'\n${block}EOF`,
    ctx.vps
  );
  if (write.code !== 0) {
    throw new Error(write.stderr || "failed to write Nginx site block");
  }

  // Debian/Ubuntu layouts only load sites-enabled/*, so symlink the new site
  // in. conf.d/ files are loaded directly and need no link.
  if (sitesEnabledDir) {
    await execOnVps(
      `mkdir -p ${shQuote(sitesEnabledDir)} && ln -sf ${shQuote(
        filePath
      )} ${shQuote(`${sitesEnabledDir}/${nginxFileName(domain)}`)}`,
      ctx.vps
    );
  }

  // Validate before reloading: a broken Nginx config takes down every site
  // behind the proxy, not just this one.
  const test = await execOnVps(`nginx -t 2>&1`, ctx.vps);
  if (test.code !== 0) {
    const restore = await execOnVps(
      `if [ -f ${shQuote(`${filePath}.bak`)} ]; then mv ${shQuote(
        `${filePath}.bak`
      )} ${shQuote(filePath)}; else rm -f ${shQuote(filePath)}; fi`,
      ctx.vps
    );
    if (restore.code !== 0) {
      ctx.log(
        `[static] failed to restore previous Nginx config: ${
          restore.stderr || restore.stdout
        }`
      );
    }
    throw new Error(
      `nginx -t failed; site config not applied: ${test.stderr || test.stdout}`
    );
  }

  await execOnVps(`rm -f ${shQuote(`${filePath}.bak`)}`, ctx.vps);
  await reloadNginx(ctx);
}

async function reloadNginx(ctx: DeployContext) {
  const reload = await execOnVps(
    `systemctl reload nginx 2>/dev/null || nginx -s reload 2>/dev/null || true`,
    ctx.vps
  );
  // Reload failures are logged but not fatal; the config passed `nginx -t`
  // above and a subsequent reload will pick it up.
  if (reload.code !== 0) {
    ctx.log(`[static] nginx reload warning: ${reload.stderr || reload.stdout}`);
  }
}
