#!/usr/bin/env node

const required = [
  "GC_BASE_URL",
  "GC_USERNAME",
  "GC_PASSWORD",
  "VALIDATION_REPO_URL",
  "VALIDATION_DOMAIN",
];

for (const key of required) {
  if (!process.env[key]) {
    console.error(`Missing ${key}`);
    process.exit(2);
  }
}

const baseUrl = process.env.GC_BASE_URL.replace(/\/+$/, "");
const username = process.env.GC_USERNAME;
const password = process.env.GC_PASSWORD;
const repoUrl = process.env.VALIDATION_REPO_URL;
const branch = process.env.VALIDATION_REPO_BRANCH || "main";
const domain = process.env.VALIDATION_DOMAIN;
const zoneId = process.env.CLOUDFLARE_ZONE_ID || undefined;
const slug = process.env.VALIDATION_SLUG || `gc-validate-${Date.now()}`;
const appPort = process.env.VALIDATION_APP_PORT || "3000";
const hostPort = process.env.VALIDATION_HOST_PORT || "13050";
const healthPath = process.env.VALIDATION_HEALTH_PATH || "/";

let cookie = "";

function captureCookies(headers) {
  const setCookie = headers.getSetCookie ? headers.getSetCookie() : [];
  cookie = setCookie.map((value) => value.split(";")[0]).join("; ");
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

console.log(`[validate] checking VPS, zones, and templates`);
const [vps, templates] = await Promise.all([
  request("/api/vps"),
  request("/api/templates"),
]);

const activeVps = Array.isArray(vps) ? vps.find((item) => item.isActive) : vps;
if (!activeVps) {
  throw new Error("No active VPS returned by /api/vps");
}

const templateList = Array.isArray(templates?.templates) ? templates.templates : [];
const templateNames = templateList.map((template) => template._filename || template.name);
if (!templateNames.includes("vps-caddy-source-build")) {
  throw new Error("vps-caddy-source-build template is not available in production");
}

console.log(`[validate] deploying ${repoUrl}#${branch} as ${slug}`);
const deployment = await request("/api/templates/deploy", {
  method: "POST",
  body: JSON.stringify({
    templateName: "vps-caddy-source-build",
    repoUrl,
    branch,
    domain,
    createDns: true,
    zoneId,
    proxied: true,
    inputs: {
      app_slug: slug,
      domain,
      repo_url: repoUrl,
      repo_branch: branch,
      app_port: appPort,
      host_port: hostPort,
      health_path: healthPath,
    },
  }),
});

if (!deployment.success) {
  throw new Error(`Template deploy failed: ${JSON.stringify(deployment)}`);
}
if (!deployment.source?.commitSha) {
  throw new Error("Deployment response did not include a source commitSha");
}
if (!deployment.deploymentId || !deployment.projectId || !deployment.targetId) {
  throw new Error("Deployment response did not include persisted project/target/deployment IDs");
}
if (!Array.isArray(deployment.dns) || deployment.dns.length === 0) {
  throw new Error("Deployment response did not include DNS records");
}

console.log(`[validate] checking persisted deployment ${deployment.deploymentId}`);
const rows = await request("/api/deployments");
const persisted = rows.find((row) => row.id === deployment.deploymentId);
if (!persisted) {
  throw new Error(`Deployment ${deployment.deploymentId} was not returned by /api/deployments`);
}
if (persisted.status !== "success") {
  throw new Error(`Persisted deployment status is ${persisted.status}`);
}

console.log(`[validate] checking public URL https://${domain}/`);
const health = await fetch(`https://${domain}/`, { method: "HEAD" });
if (!health.ok) {
  throw new Error(`Public URL health check failed with ${health.status}`);
}

console.log(JSON.stringify({
  ok: true,
  slug,
  domain,
  deploymentId: deployment.deploymentId,
  projectId: deployment.projectId,
  targetId: deployment.targetId,
  commitSha: deployment.source.commitSha,
  dns: deployment.dns,
  healthStatus: health.status,
}, null, 2));
