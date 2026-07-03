#!/usr/bin/env node

const baseUrl = requiredEnv("GC_BASE_URL").replace(/\/+$/, "");
const zoneId = process.env.CLOUDFLARE_ZONE_ID || undefined;
const zoneName = process.env.VALIDATION_ZONE || "serendepify.com";
const cookieFromEnv = process.env.GC_COOKIE || process.env.GC_TOKEN && `gc_token=${process.env.GC_TOKEN}`;

let cookie = cookieFromEnv || "";

const defaultSpecs = [
  {
    slug: "gc-company-site",
    domain: `gc-company-site.${zoneName}`,
    repoUrl: "https://github.com/teckedd-code2save/company-site.git",
    branch: "main",
    appPort: "80",
    hostPort: "13101",
    healthPath: "/",
  },
  {
    slug: "gc-groundcontrol",
    domain: `gc-groundcontrol.${zoneName}`,
    repoUrl: "https://github.com/teckedd-code2save/groundcontrol.git",
    branch: "main",
    appPort: "3000",
    hostPort: "13102",
    healthPath: "/",
    inputs: {
      database_url: "file:/app/prisma/prod.db",
    },
  },
  {
    slug: "gc-urbanize",
    domain: `gc-urbanize.${zoneName}`,
    repoUrl: "https://github.com/teckedd-code2save/urbanize.git",
    branch: "main",
    appPort: "8080",
    hostPort: "13103",
    healthPath: "/",
    inputs: {
      database_url: "postgresql://urbanize_user:urbanize_pass@db:5432/urbanize",
      redis_url: "redis://redis:6379",
    },
  },
];

const specs = process.env.VALIDATION_REPOS_JSON
  ? JSON.parse(process.env.VALIDATION_REPOS_JSON)
  : defaultSpecs;

if (!Array.isArray(specs) || specs.length === 0) {
  throw new Error("VALIDATION_REPOS_JSON must be a non-empty array when provided");
}

function requiredEnv(key) {
  const value = process.env[key];
  if (!value) {
    console.error(`Missing ${key}`);
    process.exit(2);
  }
  return value;
}

function captureCookies(headers) {
  const setCookie = headers.getSetCookie ? headers.getSetCookie() : [];
  const captured = setCookie.map((value) => value.split(";")[0]).join("; ");
  if (captured) cookie = captured;
}

async function loginIfNeeded() {
  if (cookie) return;

  const username = requiredEnv("GC_USERNAME");
  const password = requiredEnv("GC_PASSWORD");
  console.log(`[validate] logging in to ${baseUrl}`);
  const login = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  captureCookies(login.headers);
  if (!login.ok || !cookie) {
    throw new Error(`Login failed with ${login.status}: ${await login.text()}`);
  }
}

async function request(path, options = {}) {
  const res = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: {
      "content-type": "application/json",
      ...(cookie ? { cookie } : {}),
      ...(options.headers || {}),
    },
  });
  const text = await res.text();
  let body;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  if (!res.ok) {
    throw new Error(`${options.method || "GET"} ${path} failed with ${res.status}: ${text}`);
  }
  return body;
}

async function ensureProductionReady() {
  console.log(`[validate] checking VPS, zones, tunnels, and templates`);
  const [me, vps, templates, tunnels] = await Promise.all([
    request("/api/auth/me"),
    request("/api/vps"),
    request("/api/templates"),
    request("/api/cloudflare/tunnels").catch((err) => ({ tunnels: [], error: err.message })),
  ]);

  const activeVps = Array.isArray(vps) ? vps.find((item) => item.isActive) : vps;
  if (!activeVps) throw new Error("No active VPS returned by /api/vps");

  const templateList = Array.isArray(templates?.templates) ? templates.templates : [];
  const templateNames = templateList.map((template) => template._filename || template.name);
  for (const name of ["vps-caddy-source-build", "cloudflare-tunnel-private-apps"]) {
    if (!templateNames.includes(name)) {
      throw new Error(`${name} template is not available in production`);
    }
  }

  return { me, activeVps, templates: templateNames, tunnels: tunnels.tunnels || [] };
}

async function deploySourceSpec(spec) {
  const branch = spec.branch || "main";
  const inputs = {
    app_slug: spec.slug,
    domain: spec.domain,
    repo_url: spec.repoUrl,
    repo_branch: branch,
    app_port: String(spec.appPort || "3000"),
    host_port: String(spec.hostPort || "13050"),
    health_path: spec.healthPath || "/",
    ...(spec.inputs || {}),
  };

  console.log(`[validate] source deploy ${spec.slug}: ${spec.repoUrl}#${branch} -> ${spec.domain}`);
  const deployment = await request("/api/templates/deploy", {
    method: "POST",
    body: JSON.stringify({
      templateName: "vps-caddy-source-build",
      repoUrl: spec.repoUrl,
      branch,
      domain: spec.domain,
      createDns: true,
      zoneId,
      proxied: true,
      inputs,
      envVars: Object.entries(spec.env || {}).map(([key, value]) => ({ key, value: String(value) })),
    }),
  });

  assertTemplateDeployment(deployment, spec);
  await assertPersisted(deployment.deploymentId);
  const health = await checkPublicUrl(spec.domain);

  return {
    slug: spec.slug,
    domain: spec.domain,
    deploymentId: deployment.deploymentId,
    projectId: deployment.projectId,
    targetId: deployment.targetId,
    commitSha: deployment.source.commitSha,
    dns: deployment.dns,
    health,
  };
}

async function ensureTunnel() {
  let tunnels = (await request("/api/cloudflare/tunnels")).tunnels || [];
  let active = tunnels.find((tunnel) =>
    ["active", "healthy"].includes(String(tunnel.connectorStatus || tunnel.status).toLowerCase()) && tunnel.hasToken
  );
  if (active) return active;

  const name = `gc-validation-${Date.now()}`;
  console.log(`[validate] creating Cloudflare tunnel ${name}`);
  const created = await request("/api/cloudflare/tunnels", {
    method: "POST",
    body: JSON.stringify({ name }),
  });
  active = created.tunnel;
  if (!active?.id) throw new Error(`Tunnel create response did not include id: ${JSON.stringify(created)}`);
  return active;
}

async function deployTunnelProof(tunnel) {
  const slug = process.env.VALIDATION_TUNNEL_SLUG || "gc-tunnel-proof";
  const domain = process.env.VALIDATION_TUNNEL_DOMAIN || `gc-tunnel-proof.${zoneName}`;
  const hostPort = process.env.VALIDATION_TUNNEL_HOST_PORT || "13120";

  console.log(`[validate] tunnel deploy ${slug}: ${domain} -> ${tunnel.id}`);
  const deployment = await request("/api/templates/deploy", {
    method: "POST",
    body: JSON.stringify({
      templateName: "cloudflare-tunnel-private-apps",
      domain,
      createDns: true,
      zoneId,
      proxied: true,
      tunnelId: tunnel.id,
      tunnelService: "http://app:80",
      inputs: {
        app_slug: slug,
        domain,
        app_image: "nginxdemos/hello:latest",
        app_port: "80",
        app_host_port: hostPort,
        health_path: "/",
      },
    }),
  });

  if (!deployment.success) throw new Error(`Tunnel deployment failed: ${JSON.stringify(deployment)}`);
  if (deployment.tunnelId !== tunnel.id) {
    throw new Error(`Tunnel deployment used ${deployment.tunnelId}, expected ${tunnel.id}`);
  }
  if (!Array.isArray(deployment.dns) || deployment.dns.length === 0) {
    throw new Error("Tunnel deployment response did not include DNS records");
  }
  const cnameTarget = `${tunnel.id}.cfargotunnel.com`;
  if (!deployment.dns.some((record) => record.content === cnameTarget)) {
    throw new Error(`Tunnel DNS did not point at ${cnameTarget}: ${JSON.stringify(deployment.dns)}`);
  }
  await assertPersisted(deployment.deploymentId);
  const health = await checkPublicUrl(domain);

  return {
    slug,
    domain,
    tunnelId: tunnel.id,
    deploymentId: deployment.deploymentId,
    dns: deployment.dns,
    tunnelConfig: deployment.tunnelConfig || null,
    health,
  };
}

function assertTemplateDeployment(deployment, spec) {
  if (!deployment.success) throw new Error(`Template deploy failed for ${spec.slug}: ${JSON.stringify(deployment)}`);
  if (!deployment.source?.commitSha) throw new Error(`${spec.slug}: response did not include source commitSha`);
  if (!deployment.deploymentId || !deployment.projectId || !deployment.targetId) {
    throw new Error(`${spec.slug}: response did not include persisted project/target/deployment IDs`);
  }
  if (!Array.isArray(deployment.dns) || deployment.dns.length === 0) {
    throw new Error(`${spec.slug}: response did not include DNS records`);
  }
  if (!deployment.dns.some((record) => record.name === spec.domain)) {
    throw new Error(`${spec.slug}: DNS records do not include ${spec.domain}: ${JSON.stringify(deployment.dns)}`);
  }
}

async function assertPersisted(deploymentId) {
  console.log(`[validate] checking persisted deployment ${deploymentId}`);
  const rows = await request("/api/deployments");
  const persisted = rows.find((row) => row.id === deploymentId);
  if (!persisted) throw new Error(`Deployment ${deploymentId} was not returned by /api/deployments`);
  if (persisted.status !== "success") throw new Error(`Deployment ${deploymentId} status is ${persisted.status}`);
}

async function checkPublicUrl(domain) {
  console.log(`[validate] checking public URL https://${domain}/`);
  const res = await fetch(`https://${domain}/`, { method: "GET", redirect: "manual" });
  if (res.status < 200 || res.status >= 500) {
    throw new Error(`Public URL ${domain} health check failed with ${res.status}`);
  }
  return { status: res.status, location: res.headers.get("location") || null };
}

await loginIfNeeded();
const readiness = await ensureProductionReady();
const sourceDeployments = [];
for (const spec of specs) {
  sourceDeployments.push(await deploySourceSpec(spec));
}
const tunnel = await ensureTunnel();
const tunnelDeployment = await deployTunnelProof(tunnel);

console.log(JSON.stringify({
  ok: true,
  baseUrl,
  user: readiness.me.username || readiness.me.id || null,
  sourceDeployments,
  tunnelDeployment,
}, null, 2));
