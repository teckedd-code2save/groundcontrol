import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { loadTemplate, resolveTemplate, validateComposeDocument } from "@/lib/template-engine";
import { getActiveVps, execOnVps, getSystemConfig, shQuote } from "@/lib/vps";
import { provisionCustomDomain } from "@/lib/deploy/cloudflare-links";
import { prisma } from "@/lib/prisma";

function normalizeDomain(value: unknown): string {
  return String(value || "").trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
}

function slugify(value: unknown): string {
  return String(value || "deployment")
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "deployment";
}

function collectDomains(inputs: Record<string, string>): string[] {
  return Object.entries(inputs)
    .filter(([key]) => key === "domain" || key.endsWith("_domain"))
    .map(([, value]) => normalizeDomain(value))
    .filter(Boolean);
}

function collectHostPorts(compose: string): string[] {
  const matches = compose.match(/127\.0\.0\.1:(\d+):/g) || [];
  return Array.from(new Set(matches.map((match) => match.match(/:(\d+):/)?.[1]).filter(Boolean) as string[]));
}

async function ensureNoPortCollisions(compose: string, vps: Awaited<ReturnType<typeof getActiveVps>>) {
  for (const port of collectHostPorts(compose)) {
    const result = await execOnVps(`(ss -tln 2>/dev/null || netstat -tln 2>/dev/null || true) | grep -E '[:.]${port}[[:space:]]' || true`, vps);
    if (result.stdout.trim()) {
      throw new Error(`Host port ${port} is already in use. Choose a different template host port.`);
    }
  }
}

async function writeProxyConfig(type: string, config: string, path: string, vps: Awaited<ReturnType<typeof getActiveVps>>) {
  if (!config.trim()) return { path: "", output: "" };
  await execOnVps(`mkdir -p ${shQuote(path.replace(/\/[^/]+$/, ""))} && cat > ${shQuote(path)} << 'GCEOF'\n${config}\nGCEOF`, vps);
  if (type === "caddy") {
    const result = await execOnVps(`caddy validate --config /etc/caddy/Caddyfile && (systemctl reload caddy 2>/dev/null || service caddy reload 2>/dev/null || caddy reload --config /etc/caddy/Caddyfile)`, vps);
    if (result.code !== 0) throw new Error(result.stderr || result.stdout || "Caddy validation/reload failed");
    return { path, output: result.stdout || result.stderr };
  }
  if (type === "nginx") {
    const result = await execOnVps(`nginx -t && (systemctl reload nginx 2>/dev/null || service nginx reload 2>/dev/null || nginx -s reload)`, vps);
    if (result.code !== 0) throw new Error(result.stderr || result.stdout || "Nginx validation/reload failed");
    return { path, output: result.stdout || result.stderr };
  }
  return { path, output: "proxy config generated; Traefik uses Docker labels" };
}

export async function POST(req: NextRequest) {
  const user = await requireAuth(req);
  if (user instanceof NextResponse) return user;

  try {
    const body = await req.json();
    const { templateName, inputs = {}, envVars = [], repoUrl, branch, ghcrImage, localPath, domain, createDns, zoneId, proxied } = body;

    if (!templateName) {
      return NextResponse.json({ success: false, error: "templateName is required" }, { status: 400 });
    }

    const template = await loadTemplate(`${templateName}.yml`);
    if (!template) {
      return NextResponse.json({ success: false, error: `Template "${templateName}" not found` }, { status: 404 });
    }

    const allInputs: Record<string, string> = { ...inputs };
    if (repoUrl) allInputs["repo_url"] = repoUrl;
    if (branch) allInputs["repo_branch"] = branch;
    if (ghcrImage) allInputs["ghcr_image"] = ghcrImage;
    if (localPath) allInputs["repo_dir"] = localPath;
    if (domain) allInputs["domain"] = normalizeDomain(domain);
    for (const [key, value] of Object.entries(allInputs)) {
      if (key === "domain" || key.endsWith("_domain")) allInputs[key] = normalizeDomain(value);
    }
    for (const ev of (envVars || [])) {
      if (ev.key) allInputs[`env_${ev.key}`] = ev.value || "";
    }

    const resolved = resolveTemplate(template, allInputs);
    const composeValidation = validateComposeDocument(resolved.dockerCompose);
    if (!composeValidation.ok) {
      return NextResponse.json({ success: false, error: composeValidation.error }, { status: 400 });
    }

    // Deploy to VPS
    const systemConfig = await getSystemConfig();
    const templateRoot = String(systemConfig.templateDeploymentRoot || "/srv/groundcontrol/deployments").replace(/\/+$/, "");
    const slug = slugify(inputs.app_slug || domain || allInputs.domain || templateName);
    const composeProject = `gc_${slug.replace(/-/g, "_")}`.slice(0, 63);
    const deployPath = `${templateRoot}/${slug}`;
    const manifest = JSON.stringify({
      ...JSON.parse(resolved.manifest),
      deploymentRoot: deployPath,
      composeProject,
    }, null, 2);
    const vps = await getActiveVps();

    if (!vps) {
      return NextResponse.json({
        success: false, error: "No active VPS connected. Go to Settings → VPS to connect a server.",
      }, { status: 400 });
    }

    await execOnVps(`mkdir -p ${shQuote(templateRoot)}`, vps);

    // Clone repo if provided
    if (repoUrl) {
      // Check if git is installed, install if missing
      const gitCheck = await execOnVps(`command -v git >/dev/null 2>&1 && echo yes || echo no`, vps);
      if (gitCheck.stdout.trim() === "no") {
        const installResult = await execOnVps(`(apt-get update -qq && apt-get install -y -qq git >/dev/null 2>&1) || (apk add --quiet git) || (yum install -y -q git) || true`, vps);
        const recheck = await execOnVps(`command -v git >/dev/null 2>&1 && echo yes || echo no`, vps);
        if (recheck.stdout.trim() === "no") {
          return NextResponse.json({ success: false, error: "Git is not installed on the VPS and could not be auto-installed. Install git manually: apt-get install git" }, { status: 400 });
        }
      }
      const ref = String(branch || "main");
      const cloneResult = await execOnVps(`cd ${shQuote(deployPath)} 2>/dev/null || (mkdir -p ${shQuote(deployPath)} && git clone ${shQuote(repoUrl)} ${shQuote(deployPath)}) && cd ${shQuote(deployPath)} && git fetch --all --prune && git checkout ${shQuote(ref)} && git pull --ff-only`, vps);
      if (cloneResult.code !== 0) {
        return NextResponse.json({ success: false, error: cloneResult.stderr || cloneResult.stdout || "Git source validation failed" }, { status: 400 });
      }
    } else if (localPath) {
      const localResult = await execOnVps(`test -d ${shQuote(localPath)} && echo yes || echo no`, vps);
      if (localResult.stdout.trim() !== "yes") {
        return NextResponse.json({ success: false, error: `Local source path does not exist on VPS: ${localPath}` }, { status: 400 });
      }
      await execOnVps(`mkdir -p ${shQuote(deployPath)}`, vps);
    } else {
      await execOnVps(`mkdir -p ${shQuote(deployPath)}`, vps);
    }

    const usesBuild = template.services.some((service) => service.build);
    if (usesBuild) {
      const dockerfile = await execOnVps(`test -f ${shQuote(deployPath)}/Dockerfile && echo yes || echo no`, vps);
      if (dockerfile.stdout.trim() !== "yes") {
        return NextResponse.json({ success: false, error: `Template requires a Dockerfile, but none was found at ${deployPath}/Dockerfile` }, { status: 400 });
      }
    }

    const existingDeployment = await execOnVps(`test -f ${shQuote(deployPath)}/docker-compose.yml && echo yes || echo no`, vps);
    if (existingDeployment.stdout.trim() !== "yes") {
      await ensureNoPortCollisions(resolved.dockerCompose, vps);
    }

    // Write docker-compose.yml
    // Auto-inject tunnel tokens from Settings if template references {{tunnel_token}}
    let composeContent = resolved.dockerCompose;
    if (composeContent.includes("{{tunnel_token}}")) {
      try {
        const tunnel = await (prisma as any).cloudflareTunnel.findFirst({ orderBy: { createdAt: "desc" } });
        if (tunnel) {
          composeContent = composeContent.replace(/\{\{tunnel_token\}\}/g, tunnel.token);
        }
      } catch {}
    }

    await execOnVps(`mkdir -p ${shQuote(deployPath)}/.groundcontrol && cat > ${shQuote(deployPath)}/docker-compose.yml << 'GCEOF'\n${composeContent}\nGCEOF\ncat > ${shQuote(deployPath)}/.env.schema << 'GCEOF'\n${resolved.envSchema}\nGCEOF\ncat > ${shQuote(deployPath)}/.groundcontrol/manifest.json << 'GCEOF'\n${manifest}\nGCEOF`, vps);

    // Write .env
    if (envVars && envVars.length > 0) {
      const envFile = envVars.filter((e: { key: string }) => e.key).map((e: { key: string; value: string }) => `${e.key}=${e.value || ""}`).join("\n");
      if (envFile) {
        await execOnVps(`cat > ${shQuote(deployPath)}/.env << 'GCEOF'\n${envFile}\nGCEOF`, vps);
        await execOnVps(`chmod 600 ${shQuote(deployPath)}/.env`, vps);
      }
    }

    // Deploy
    const composeCmd = `if docker compose version >/dev/null 2>&1; then printf 'docker compose'; elif command -v docker-compose >/dev/null 2>&1; then printf 'docker-compose'; else printf ''; fi`;
    const upResult = await execOnVps(`cd ${shQuote(deployPath)} && compose_cmd=$(${composeCmd}) && if [ -z "$compose_cmd" ]; then echo "docker compose plugin or docker-compose is required" >&2; exit 127; fi && $compose_cmd -p ${shQuote(composeProject)} config >/tmp/${composeProject}.compose.yml && $compose_cmd -p ${shQuote(composeProject)} pull && $compose_cmd -p ${shQuote(composeProject)} up -d --remove-orphans 2>&1`, vps);
    if (upResult.code !== 0) {
      return NextResponse.json({ success: false, error: upResult.stderr || upResult.stdout || "docker compose up failed", upOutput: upResult }, { status: 500 });
    }

    const proxyPath = resolved.proxyConfigPath.replace("/etc/caddy/sites/app.conf", `/etc/caddy/sites/${slug}.caddy`).replace("/etc/nginx/sites-available/app", `/etc/nginx/sites-available/${slug}`);
    const proxyResult = await writeProxyConfig(template.reverse_proxy.type, resolved.proxyConfig, proxyPath, vps);

    // Cloudflare DNS
    let dnsResult: unknown = null;
    const domains = collectDomains(allInputs);
    if (createDns && domains.length > 0) {
      try {
        const { listZones } = await import("@/lib/cloudflare");
        const zones = await listZones();
        const records = [];
        for (const recordName of domains) {
          const zone = zoneId
            ? { id: zoneId }
            : (zones as any[]).find((z: any) => recordName.endsWith(z.name));
          if (zone) {
            records.push(await provisionCustomDomain({
              subdomain: recordName,
              zoneId: String((zone as any).id),
              targetHost: vps.host,
              recordType: "A",
              proxied: proxied !== false,
            }));
          }
        }
        dnsResult = records;
      } catch (err) {
        dnsResult = { error: err instanceof Error ? err.message : "DNS provisioning failed" };
      }
    }

    const healthResults = [];
    for (const recordName of domains) {
      const health = await execOnVps(`curl -k -fsS -I --max-time 15 ${shQuote(`https://${recordName}/`)} 2>&1 | head -n 1 || true`, vps);
      healthResults.push({ domain: recordName, result: health.stdout.trim() || health.stderr.trim() });
    }

    return NextResponse.json({
      success: true,
      deployPath,
      slug,
      composeProject,
      upOutput: upResult,
      dns: dnsResult,
      proxy: proxyResult,
      health: healthResults,
      composeYml: resolved.dockerCompose,
      proxyConfig: resolved.proxyConfig,
      proxyConfigPath: proxyPath,
      manifest,
      message: `Deployed ${slug} to ${deployPath}. ${domains.length ? `Served at ${domains.map((d) => `https://${d}`).join(", ")}` : ""}`,
    });
  } catch (err) {
    return NextResponse.json({
      success: false, error: err instanceof Error ? err.message : "Deploy failed",
    }, { status: 500 });
  }
}
