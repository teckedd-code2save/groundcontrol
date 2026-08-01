import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { isRepositoryComposeTemplate, isStaticTemplate, loadTemplate, resolveTemplate, validateComposeDocument } from "@/lib/template-engine";
import { getActiveVps, getSystemConfig, shQuote } from "@/lib/vps";
import { execOnTarget } from "@/lib/host-exec";
import { provisionCustomDomain } from "@/lib/deploy/cloudflare-links";
import { prisma } from "@/lib/prisma";
import { resolveTemplateSource } from "@/lib/template-source";
import { persistTemplateDeployment } from "@/lib/template-deployment-state";
import { stopCloudflaredConnector } from "@/lib/bootstrap";
import {
  materializeEnvFile,
  parseEnvSchema,
  setLocalEnvValues,
  upsertEnvProfileForProject,
  validateEnv,
  type EnvSchemaEntry,
} from "@/lib/env-management";
import {
  evaluateSourceRequirements,
  type SourceTreeProbe,
} from "@/lib/template-source-requirements";
import { inferDeploymentName, slugifyDeploymentName } from "@/lib/deployment-identity";
import { deploymentVerificationStatus, parsePublicEndpointCheck } from "@/lib/deployment-verification";
import {
  inspectRepositoryCompose,
  normalizeRepositoryComposePath,
  repositoryComposeEnvSchema,
  type RepositoryComposeInspection,
} from "@/lib/repository-compose";
import { getVpsPublicIp } from "@/lib/k8s/utils";

function normalizeDomain(value: unknown): string {
  return String(value || "").trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
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

async function enrolTemplateDeployment(args: {
  projectId: number;
  name: string;
  slug: string;
  kind: string;
  sourcePath: string;
  composePath?: string;
  vpsConfigId: number;
  templateName: string;
}) {
  return prisma.enrolledDeployment.upsert({
    where: { legacyProjectId: args.projectId },
    create: {
      name: args.name,
      slug: args.slug,
      kind: args.kind,
      managementMode: "managed",
      sourcePath: args.sourcePath,
      composePath: args.composePath,
      status: "active",
      lastSeenAt: new Date(),
      vpsConfigId: args.vpsConfigId,
      legacyProjectId: args.projectId,
      metadataJson: JSON.stringify({ source: "template", templateName: args.templateName }),
    },
    update: {
      name: args.name,
      kind: args.kind,
      sourcePath: args.sourcePath,
      composePath: args.composePath,
      managementMode: "managed",
      status: "active",
      lastSeenAt: new Date(),
      metadataJson: JSON.stringify({ source: "template", templateName: args.templateName }),
    },
  });
}

interface CloudflareZone {
  id: string;
  name?: string;
}

async function verifyPublicEndpoints(domains: string[], vps: Awaited<ReturnType<typeof getActiveVps>>, healthPath = "/") {
  const checks = [];
  const path = healthPath.startsWith("/") ? healthPath : `/${healthPath}`;
  for (const domain of domains) {
    const probe = await execOnTarget(
      `curl -k -sS -o /dev/null --max-time 15 -w '%{http_code}|%{remote_ip}' ${shQuote(`https://${domain}${path}`)} 2>&1 || true`,
      vps
    );
    checks.push(parsePublicEndpointCheck(domain, probe.stdout.trim() || probe.stderr.trim()));
  }
  return checks;
}

async function ensurePublishedPortsAvailable(ports: string[], vps: Awaited<ReturnType<typeof getActiveVps>>) {
  for (const port of Array.from(new Set(ports.filter((value) => /^\d+$/.test(value))))) {
    const result = await execOnTarget(`(ss -tln 2>/dev/null || netstat -tln 2>/dev/null || true) | grep -E '[:.]${port}[[:space:]]' || true`, vps);
    if (result.stdout.trim()) {
      throw new Error(`Host port ${port} is already in use. Change the repository Compose port before deploying.`);
    }
  }
}

async function verifyRepositoryComposeRuntime(args: {
  runtimePath: string;
  composeProject: string;
  composeFile: string;
  services: string[];
  vps: NonNullable<Awaited<ReturnType<typeof getActiveVps>>>;
}) {
  const composeFileArg = `-f ${shQuote(args.composeFile)}`;
  const services = args.services.map(shQuote).join(" ");
  const command = [
    `cd ${shQuote(args.runtimePath)}`,
    "compose_cmd=$(if docker compose version >/dev/null 2>&1; then printf 'docker compose'; elif command -v docker-compose >/dev/null 2>&1; then printf 'docker-compose'; fi)",
    "if [ -z \"$compose_cmd\" ]; then echo '[verify] Docker Compose is unavailable' >&2; exit 127; fi",
    "deadline=$(($(date +%s) + 120))",
    "while :; do",
    "  failures=''",
    `  for service in ${services}; do`,
    `    container_id=$($compose_cmd -p ${shQuote(args.composeProject)} ${composeFileArg} ps -a -q \"$service\" 2>/dev/null | head -n 1)`,
    "    if [ -z \"$container_id\" ]; then failures=\"$failures\\n$service: container was not created\"; continue; fi",
    "    state=$(docker inspect --format '{{.State.Status}}|{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}|{{.State.ExitCode}}|{{.HostConfig.RestartPolicy.Name}}' \"$container_id\" 2>&1)",
    "    status=$(printf '%s' \"$state\" | cut -d '|' -f 1)",
    "    health=$(printf '%s' \"$state\" | cut -d '|' -f 2)",
    "    exit_code=$(printf '%s' \"$state\" | cut -d '|' -f 3)",
    "    restart=$(printf '%s' \"$state\" | cut -d '|' -f 4)",
    "    if [ \"$status\" = running ] && { [ \"$health\" = healthy ] || [ \"$health\" = none ]; }; then continue; fi",
    "    if [ \"$status\" = exited ] && [ \"$exit_code\" = 0 ] && [ \"$restart\" = no ]; then continue; fi",
    "    failures=\"$failures\\n$service: status=$status health=$health exit=$exit_code restart=$restart\"",
    "  done",
    "  if [ -z \"$failures\" ]; then printf '[verify] Complete Compose service graph is operational\\n'; exit 0; fi",
    "  if [ $(date +%s) -ge $deadline ]; then printf '[verify] Compose service graph did not become operational:%b\\n' \"$failures\" >&2; exit 1; fi",
    "  sleep 3",
    "done",
  ].join("\n");
  return execOnTarget(command, args.vps);
}

async function requireVpsPublicIp(vps: NonNullable<Awaited<ReturnType<typeof getActiveVps>>>) {
  const publicIp = await getVpsPublicIp(vps);
  if (!/^\d+\.\d+\.\d+\.\d+$/.test(publicIp)) {
    throw new Error("Could not determine the VPS public IPv4 address required for the Cloudflare A record.");
  }
  return publicIp;
}

function isCloudflareZone(value: unknown): value is CloudflareZone {
  return Boolean(value && typeof value === "object" && typeof (value as { id?: unknown }).id === "string");
}

async function ensureNoPortCollisions(compose: string, vps: Awaited<ReturnType<typeof getActiveVps>>) {
  for (const port of collectHostPorts(compose)) {
    const result = await execOnTarget(`(ss -tln 2>/dev/null || netstat -tln 2>/dev/null || true) | grep -E '[:.]${port}[[:space:]]' || true`, vps);
    if (result.stdout.trim()) {
      throw new Error(`Host port ${port} is already in use. Choose a different template host port.`);
    }
  }
}

async function writeProxyConfig(type: string, config: string, path: string, vps: Awaited<ReturnType<typeof getActiveVps>>) {
  if (!config.trim()) return { path: "", output: "" };
  await execOnTarget(`mkdir -p ${shQuote(path.replace(/\/[^/]+$/, ""))} && cat > ${shQuote(path)} << 'GCEOF'\n${config}\nGCEOF`, vps);
  if (type === "caddy") {
    const result = await execOnTarget(`caddy validate --config /etc/caddy/Caddyfile && (systemctl reload caddy 2>/dev/null || service caddy reload 2>/dev/null || caddy reload --config /etc/caddy/Caddyfile)`, vps);
    if (result.code !== 0) throw new Error(result.stderr || result.stdout || "Caddy validation/reload failed");
    return { path, output: result.stdout || result.stderr };
  }
  if (type === "nginx") {
    const result = await execOnTarget(`nginx -t && (systemctl reload nginx 2>/dev/null || service nginx reload 2>/dev/null || nginx -s reload)`, vps);
    if (result.code !== 0) throw new Error(result.stderr || result.stdout || "Nginx validation/reload failed");
    return { path, output: result.stdout || result.stderr };
  }
  return { path, output: "proxy config generated; Traefik uses Docker labels" };
}

async function readInfisicalProjectRef(sourcePath: string, vps: Awaited<ReturnType<typeof getActiveVps>>): Promise<string> {
  const result = await execOnTarget(`cat ${shQuote(`${sourcePath}/.infisical.json`)} 2>/dev/null || true`, vps);
  if (!result.stdout.trim()) return "";
  try {
    const parsed = JSON.parse(result.stdout) as { workspaceId?: unknown; projectId?: unknown };
    return typeof parsed.workspaceId === "string"
      ? parsed.workspaceId
      : typeof parsed.projectId === "string"
        ? parsed.projectId
        : "";
  } catch {
    return "";
  }
}

export async function POST(req: NextRequest) {
  const user = await requireAuth(req);
  if (user instanceof NextResponse) return user;

  try {
    const body = await req.json();
    const { templateName, deploymentName, inputs = {}, envVars = [], repoUrl, branch, ghcrImage, localPath, domain, createDns, zoneId, proxied, tunnelId } = body;

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
    // Safety net: if the domain is a bare hostname (no dot), try to
    // resolve it against the selected Cloudflare zone.
    if (allInputs["domain"] && !allInputs["domain"].includes(".") && zoneId) {
      try {
        const { listZones } = await import("@/lib/cloudflare");
        const zones = await listZones();
        const zone = zones.find((z: any) => String(z.id) === String(zoneId));
        if (zone?.name) {
          allInputs["domain"] = `${allInputs["domain"]}.${zone.name}`;
        }
      } catch { /* best-effort */ }
    }
    for (const [key, value] of Object.entries(allInputs)) {
      if (key === "domain" || key.endsWith("_domain")) allInputs[key] = normalizeDomain(value);
    }
    for (const ev of (envVars || [])) {
      if (ev.key) allInputs[`env_${ev.key}`] = ev.value || "";
    }

    const staticMode = isStaticTemplate(template);
    const repositoryComposeMode = isRepositoryComposeTemplate(template);
    const repositoryComposeFile = repositoryComposeMode
      ? normalizeRepositoryComposePath(allInputs.compose_file || "docker-compose.yml")
      : "docker-compose.yml";
    const systemConfig = await getSystemConfig();
    const templateRoot = String(systemConfig.templateDeploymentRoot || "/srv/groundcontrol/deployments").replace(/\/+$/, "");
    const staticRoot = String(systemConfig.staticRoot || "/var/www").replace(/\/+$/, "");
    const inferredName = inferDeploymentName({
      explicitName: deploymentName,
      repoUrl,
      localPath,
      image: ghcrImage,
      domain: domain || allInputs.domain,
      templateName,
    });
    const slug = slugifyDeploymentName(inferredName);
    const composeProject = staticMode ? "" : `gc_${slug.replace(/-/g, "_")}`.slice(0, 63);
    const deployPath = `${templateRoot}/${slug}`;
    const staticDir = `${staticRoot}/${slug}`;
    if (staticMode) {
      allInputs.static_dir = staticDir;
      if (!allInputs.output_dir) allInputs.output_dir = ".";
    }

    let resolved = resolveTemplate(template, allInputs);
    if (!staticMode && !repositoryComposeMode) {
      const composeValidation = validateComposeDocument(resolved.dockerCompose);
      if (!composeValidation.ok) {
        return NextResponse.json({ success: false, error: composeValidation.error }, { status: 400 });
      }
    }

    // Deploy to VPS
    const vps = await getActiveVps();
    const startTime = Date.now();

    if (!vps) {
      return NextResponse.json({
        success: false, error: "No active VPS connected. Go to Settings → VPS to connect a server.",
      }, { status: 400 });
    }

    // Static / source-build need real source early — fail with a clear message.
    if (staticMode || repositoryComposeMode || template.services.some((s) => s.build)) {
      if (!repoUrl && !localPath) {
        return NextResponse.json({
          success: false,
          error: staticMode
            ? "Static Site needs a Git repository URL or a local path on the VPS."
            : repositoryComposeMode
              ? "Existing Compose needs a Git repository URL or a local path containing the Compose file."
              : "Source Build needs a Git repository URL or a local path with a Dockerfile.",
        }, { status: 400 });
      }
    }

    await execOnTarget(`mkdir -p ${shQuote(templateRoot)}`, vps);
    const source = await resolveTemplateSource({ repoUrl, branch, localPath, deployPath, vps })
      .catch((err) => ({ error: err instanceof Error ? err.message : "Source validation failed" }));
    if ("error" in source) {
      return NextResponse.json({ success: false, error: source.error }, { status: 400 });
    }

    // Probe source tree on VPS and re-check template requirements before compose/static publish
    {
      const list = await execOnTarget(
        `cd ${shQuote(source.sourcePath)} && ls -1A 2>/dev/null | head -200`,
        vps
      );
      const rootFiles = new Set<string>();
      const paths = new Set<string>();
      for (const line of list.stdout.split("\n").map((l) => l.trim()).filter(Boolean)) {
        rootFiles.add(line);
        rootFiles.add(line.toLowerCase());
        paths.add(line);
      }
      for (const f of Array.from(new Set(["Dockerfile", "dockerfile", "index.html", "package.json", "dist/index.html", "build/index.html", "out/index.html", repositoryComposeFile]))) {
        const r = await execOnTarget(`test -e ${shQuote(`${source.sourcePath}/${f}`)} && echo yes || echo no`, vps);
        if (r.stdout.trim() === "yes") {
          paths.add(f);
          const base = f.split("/").pop()!;
          rootFiles.add(base);
          rootFiles.add(base.toLowerCase());
        }
      }
      const tree: SourceTreeProbe = { paths, rootFiles };
      const sourceMode = repoUrl ? "github" : localPath ? "local" : ghcrImage ? "ghcr" : "none";
      const reqCheck = evaluateSourceRequirements(template, tree, {
        sourceMode,
        hasImage: Boolean(ghcrImage),
        outputDir: allInputs.output_dir || ".",
        buildCommand: allInputs.build_command || "",
        composeFile: repositoryComposeFile,
      });
      if (!reqCheck.ok) {
        return NextResponse.json({
          success: false,
          error: reqCheck.errors[0] || "Source does not meet template requirements",
          errors: reqCheck.errors,
          checks: reqCheck.checks,
          suggestion:
            reqCheck.plan.requiresDockerfile && (paths.has("index.html") || rootFiles.has("index.html"))
              ? "This looks like a static HTML site. Use the VPS Caddy Static Site template instead."
              : undefined,
        }, { status: 400 });
      }
    }

    let runtimePath = deployPath;
    let composeContent = resolved.dockerCompose;
    let composeInspection: RepositoryComposeInspection | null = null;
    let envSchemaContent = resolved.envSchema;
    let envSchemaEntries: EnvSchemaEntry[] = parseEnvSchema(envSchemaContent);
    const envValues = Object.fromEntries(
      (envVars || [])
        .filter((entry: { key: string }) => entry.key)
        .map((entry: { key: string; value: string }) => [String(entry.key), String(entry.value || "")])
    );

    if (repositoryComposeMode) {
      runtimePath = source.sourcePath;
      const composeRead = await execOnTarget(
        `cat ${shQuote(`${runtimePath}/${repositoryComposeFile}`)} 2>/dev/null || true`,
        vps
      );
      if (!composeRead.stdout.trim()) {
        return NextResponse.json({
          success: false,
          error: `Compose file not found after source checkout: ${repositoryComposeFile}`,
        }, { status: 400 });
      }

      composeContent = composeRead.stdout;
      const composeValidation = validateComposeDocument(composeContent);
      if (!composeValidation.ok) {
        return NextResponse.json({ success: false, error: composeValidation.error }, { status: 400 });
      }
      composeInspection = inspectRepositoryCompose(composeContent);
      allInputs.public_service = allInputs.public_service || composeInspection.suggestedPublicService || "";
      allInputs.public_port = allInputs.public_port || composeInspection.suggestedPublicPort || "";
      if (!allInputs.public_service || !composeInspection.services.includes(allInputs.public_service)) {
        return NextResponse.json({
          success: false,
          error: `Public service "${allInputs.public_service || "(not selected)"}" was not found. Available services: ${composeInspection.services.join(", ")}.`,
        }, { status: 400 });
      }
      const selectedPort = composeInspection.publishedPorts.find((port) =>
        port.service === allInputs.public_service && port.hostPort === allInputs.public_port
      );
      if (!selectedPort) {
        const available = composeInspection.publishedPorts
          .filter((port) => port.service === allInputs.public_service)
          .map((port) => `${port.hostPort}:${port.containerPort}`)
          .join(", ");
        return NextResponse.json({
          success: false,
          error: available
            ? `Published port ${allInputs.public_port || "(not selected)"} does not belong to ${allInputs.public_service}. Available: ${available}.`
            : `Service ${allInputs.public_service} has no published host port. Publish it in the repository Compose file before attaching a public domain.`,
        }, { status: 400 });
      }

      resolved = resolveTemplate(template, allInputs);
      envSchemaContent = repositoryComposeEnvSchema(composeInspection.environment);
      envSchemaEntries = composeInspection.environment.map((entry) => ({
        key: entry.key,
        required: entry.required,
        defaultValue: entry.defaultValue,
      }));
      const envValidation = validateEnv(envSchemaEntries, envValues);
      if (!envValidation.ok) {
        return NextResponse.json({
          success: false,
          error: `Required deployment configuration is missing: ${envValidation.missing.join(", ")}.`,
          missingEnvironment: envValidation.missing,
        }, { status: 400 });
      }
    }

    const manifest = JSON.stringify({
      ...JSON.parse(resolved.manifest),
      slug,
      deploymentRoot: runtimePath,
      composeProject: composeProject || null,
      staticDir: staticMode ? staticDir : null,
      source,
      repositoryCompose: composeInspection ? {
        file: repositoryComposeFile,
        services: composeInspection.services,
        publishedPorts: composeInspection.publishedPorts,
        publicService: allInputs.public_service,
        publicPort: allInputs.public_port,
      } : null,
    }, null, 2);

    // ── Static site path: no Docker Compose ──
    if (staticMode) {
      const outputDir = (allInputs.output_dir || ".").replace(/^\.\/+/, "") || ".";
      const buildCommand = (allInputs.build_command || "").trim();

      if (buildCommand) {
        const build = await execOnTarget(
          `cd ${shQuote(source.sourcePath)} && ${buildCommand}`,
          vps
        );
        if (build.code !== 0) {
          return NextResponse.json({
            success: false,
            error: build.stderr || build.stdout || "Static site build command failed",
            upOutput: build,
          }, { status: 500 });
        }
      }

      const publishFrom =
        outputDir === "."
          ? source.sourcePath
          : `${source.sourcePath}/${outputDir}`;
      const hasOut = await execOnTarget(`test -d ${shQuote(publishFrom)} && echo yes || echo no`, vps);
      if (hasOut.stdout.trim() !== "yes") {
        return NextResponse.json({
          success: false,
          error: `Publish directory not found: ${publishFrom}. Check output_dir${buildCommand ? " after build" : ""}.`,
        }, { status: 400 });
      }

      const publish = await execOnTarget(
        `rm -rf ${shQuote(`${staticDir}.prev`)} && ` +
          `if [ -d ${shQuote(staticDir)} ]; then mv ${shQuote(staticDir)} ${shQuote(`${staticDir}.prev`)}; fi && ` +
          `mkdir -p ${shQuote(staticDir)} && ` +
          `cp -a ${shQuote(`${publishFrom}/.`)} ${shQuote(`${staticDir}/`)} && ` +
          `mkdir -p ${shQuote(`${deployPath}/.groundcontrol`)} && ` +
          `cat > ${shQuote(`${deployPath}/.groundcontrol/manifest.json`)} << 'GCEOF'\n${manifest}\nGCEOF`,
        vps
      );
      if (publish.code !== 0) {
        return NextResponse.json({
          success: false,
          error: publish.stderr || publish.stdout || "Failed to publish static files",
          upOutput: publish,
        }, { status: 500 });
      }

      const proxyPath = template.reverse_proxy.type === "caddy"
        ? resolved.proxyConfigPath
            .replace("/etc/caddy/sites/app.conf", `/etc/caddy/sites/${slug}.caddy`)
            .replace(/\.conf$/, ".caddy")
        : resolved.proxyConfigPath.replace("/etc/nginx/sites-available/app", `/etc/nginx/sites-available/${slug}`);
      const proxyResult = await writeProxyConfig(template.reverse_proxy.type, resolved.proxyConfig, proxyPath, vps);

      let dnsResult: unknown = null;
      const domains = collectDomains(allInputs);
      if (createDns && domains.length > 0) {
        try {
          const { listZones } = await import("@/lib/cloudflare");
          const zones: CloudflareZone[] = (await listZones()).flatMap((zone) =>
            isCloudflareZone(zone)
              ? [{ id: zone.id, name: typeof zone.name === "string" ? zone.name : undefined }]
              : []
          );
          const records = [];
          const publicIp = await requireVpsPublicIp(vps);
          for (const recordName of domains) {
            const requestedZoneId = String(zoneId || "").trim();
            const zone: CloudflareZone | undefined = requestedZoneId
              ? zones.find((candidate) => candidate.id === requestedZoneId)
              : zones.find((z) => Boolean(z.name) && recordName.endsWith(String(z.name)));
            if (!zone) {
              throw new Error(`No connected Cloudflare zone matches ${recordName}. Select its zone before deploying.`);
            }
            if (zone.name && recordName !== zone.name && !recordName.endsWith(`.${zone.name}`)) {
              throw new Error(`${recordName} does not belong to the selected Cloudflare zone ${zone.name}.`);
            }
            records.push(await provisionCustomDomain({
              subdomain: recordName,
              zoneId: String(zone.id),
              targetHost: publicIp,
              recordType: "A",
              proxied: proxied === true,
            }));
          }
          dnsResult = records;
        } catch (err) {
          dnsResult = { error: err instanceof Error ? err.message : "DNS provisioning failed" };
        }
      }

      const healthResults = await verifyPublicEndpoints(domains, vps);
      const verification = deploymentVerificationStatus(domains, dnsResult, healthResults);

      const persisted = await persistTemplateDeployment({
        slug,
        templateName,
        deployPath,
        composeProject: "",
        source,
        domains,
        composeYml: "",
        proxyConfig: resolved.proxyConfig,
        proxyConfigPath: proxyPath,
        proxyOutput: proxyResult,
        dnsResult,
        healthResults,
        upOutput: publish,
        manifest,
        vpsConfigId: vps.id,
        durationMs: Date.now() - startTime,
        status: verification.status,
        category: "static",
        targetType: "static",
        staticDir,
      });
      await enrolTemplateDeployment({
        projectId: persisted.projectId,
        name: slug,
        slug,
        kind: "static",
        sourcePath: deployPath,
        vpsConfigId: vps.id,
        templateName,
      });

      return NextResponse.json({
        success: verification.publicVerified,
        deployed: true,
        status: verification.status,
        publicVerified: verification.publicVerified,
        error: verification.error,
        ...persisted,
        deployPath,
        staticDir,
        slug,
        composeProject: null,
        upOutput: publish,
        dns: dnsResult,
        proxy: proxyResult,
        health: healthResults,
        composeYml: "",
        proxyConfig: resolved.proxyConfig,
        proxyConfigPath: proxyPath,
        manifest,
        source,
        enrolled: true,
        message: verification.publicVerified
          ? `Published and publicly verified ${slug}${domains.length ? ` at ${domains.map((d) => `https://${d}`).join(", ")}` : ""}.`
          : `Published ${slug} to the host, but its public endpoint is not reachable yet.`,
      }, { status: verification.publicVerified ? 200 : 502 });
    }

    const existingDeployment = await execOnTarget(`test -f ${shQuote(`${runtimePath}/.groundcontrol/manifest.json`)} && echo yes || echo no`, vps);
    if (existingDeployment.stdout.trim() !== "yes") {
      if (composeInspection) {
        await ensurePublishedPortsAvailable(composeInspection.publishedPorts.map((port) => port.hostPort), vps);
      } else {
        await ensureNoPortCollisions(composeContent, vps);
      }
    }

    // Write docker-compose.yml
    // Auto-inject tunnel tokens from Settings if template references {{tunnel_token}}
    const requestedTunnelId = String(tunnelId || "").trim();
    const selectedTunnel = requestedTunnelId
      ? await prisma.cloudflareTunnel.findFirst({ where: { tunnelId: requestedTunnelId } })
      : null;
    if (requestedTunnelId && !selectedTunnel) {
      return NextResponse.json({ success: false, error: `Cloudflare tunnel not found: ${requestedTunnelId}` }, { status: 400 });
    }
    const usesTunnelToken = !repositoryComposeMode && composeContent.includes("{{tunnel_token}}");
    if (usesTunnelToken) {
      if (!requestedTunnelId) {
        return NextResponse.json({ success: false, error: "Template requires a saved Cloudflare tunnel. Select a tunnel before deploying." }, { status: 400 });
      }
      try {
        const tunnel = selectedTunnel;
        if (tunnel?.tunnelSecret) {
          composeContent = composeContent.replace(/\{\{tunnel_token\}\}/g, tunnel.tunnelSecret || "");
        }
      } catch {}
      if (composeContent.includes("{{tunnel_token}}")) {
        return NextResponse.json({ success: false, error: "Template requires a Cloudflare tunnel token, but no saved tunnel token is available." }, { status: 400 });
      }
    }

    if (repositoryComposeMode) {
      await execOnTarget(`mkdir -p ${shQuote(`${runtimePath}/.groundcontrol`)} && cat > ${shQuote(`${runtimePath}/.env.schema`)} << 'GCEOF'\n${envSchemaContent}\nGCEOF\ncat > ${shQuote(`${runtimePath}/.groundcontrol/manifest.json`)} << 'GCEOF'\n${manifest}\nGCEOF`, vps);
    } else {
      await execOnTarget(`mkdir -p ${shQuote(`${runtimePath}/.groundcontrol`)} && cat > ${shQuote(`${runtimePath}/docker-compose.yml`)} << 'GCEOF'\n${composeContent}\nGCEOF\ncat > ${shQuote(`${runtimePath}/.env.schema`)} << 'GCEOF'\n${envSchemaContent}\nGCEOF\ncat > ${shQuote(`${runtimePath}/.groundcontrol/manifest.json`)} << 'GCEOF'\n${manifest}\nGCEOF`, vps);
    }

    // Write .env. Compose fails if env_file points at a missing file, so create
    // an empty file when the template references .env even without user envs.
    const envFile = (envVars || [])
      .filter((e: { key: string }) => e.key)
      .map((e: { key: string; value: string }) => `${e.key}=${e.value || ""}`)
      .join("\n");
    if (envFile || composeContent.includes("env_file:")) {
      await materializeEnvFile(runtimePath, envValues, vps);
    }

    // Deploy
    const composeCmd = `if docker compose version >/dev/null 2>&1; then printf 'docker compose'; elif command -v docker-compose >/dev/null 2>&1; then printf 'docker-compose'; else printf ''; fi`;
    const composeManagedTunnelConnector = usesTunnelToken ? `${composeProject}-cloudflared-1` : "";
    if (usesTunnelToken && selectedTunnel?.connectorId && selectedTunnel.connectorId !== composeManagedTunnelConnector) {
      await stopCloudflaredConnector(selectedTunnel.connectorId).catch(() => undefined);
    }

    const composeFileArgs = repositoryComposeMode ? ` -f ${shQuote(repositoryComposeFile)}` : "";
    const repositoryBuild = repositoryComposeMode
      ? ` && printf '[build] Building repository services\\n' && $compose_cmd -p ${shQuote(composeProject)}${composeFileArgs} build --pull`
      : "";
    const upResult = await execOnTarget(
      `cd ${shQuote(runtimePath)} && compose_cmd=$(${composeCmd}) && ` +
      `if [ -z "$compose_cmd" ]; then echo "docker compose plugin or docker-compose is required" >&2; exit 127; fi && ` +
      `printf '[validate] Rendering effective Compose model\\n' && ` +
      `$compose_cmd -p ${shQuote(composeProject)}${composeFileArgs} config >/tmp/${composeProject}.compose.yml` +
      repositoryBuild +
      ` && printf '[pull] Resolving service images\\n' && $compose_cmd -p ${shQuote(composeProject)}${composeFileArgs} pull` +
      ` && printf '[deploy] Recreating complete Compose stack\\n' && $compose_cmd -p ${shQuote(composeProject)}${composeFileArgs} up -d --remove-orphans 2>&1`,
      vps
    );
    if (upResult.code !== 0) {
      const evidence = [upResult.stderr, upResult.stdout].filter(Boolean).join("\n").trim();
      return NextResponse.json({
        success: false,
        error: evidence || "Compose stopped without returning terminal evidence.",
        upOutput: upResult,
      }, { status: 500 });
    }

    const runtimeVerification = composeInspection
      ? await verifyRepositoryComposeRuntime({
          runtimePath,
          composeProject,
          composeFile: repositoryComposeFile,
          services: composeInspection.services,
          vps,
        })
      : null;

    const proxyPath = template.reverse_proxy.type === "caddy"
      ? resolved.proxyConfigPath
        .replace("/etc/caddy/sites/app.conf", `/etc/caddy/sites/${slug}.caddy`)
        .replace(/\.conf$/, ".caddy")
      : resolved.proxyConfigPath.replace("/etc/nginx/sites-available/app", `/etc/nginx/sites-available/${slug}`);
    const proxyResult = await writeProxyConfig(template.reverse_proxy.type, resolved.proxyConfig, proxyPath, vps);

    // Cloudflare DNS
    let dnsResult: unknown = null;
    let tunnelConfigResult: unknown = null;
    const domains = collectDomains(allInputs);
    if (createDns && domains.length > 0) {
      try {
        const { listZones } = await import("@/lib/cloudflare");
        const zones: CloudflareZone[] = (await listZones()).flatMap((zone) =>
          isCloudflareZone(zone)
            ? [{ id: zone.id, name: typeof zone.name === "string" ? zone.name : undefined }]
            : []
        );
        const records = [];
        const dnsTunnelId = selectedTunnel?.tunnelId || requestedTunnelId;
        const publicIp = dnsTunnelId ? "" : await requireVpsPublicIp(vps);
        if (dnsTunnelId) {
          const { updateTunnelConfiguration } = await import("@/lib/cloudflare");
          const tunnelService = String(body.tunnelService || `http://app:${allInputs.app_port || allInputs.port || "80"}`);
          tunnelConfigResult = await updateTunnelConfiguration(
            dnsTunnelId,
            domains.map((recordName) => ({ hostname: recordName, service: tunnelService }))
          );
          await prisma.cloudflareTunnel.updateMany({
            where: { tunnelId: dnsTunnelId },
            data: {
              domains: domains.join(","),
              connectorId: composeManagedTunnelConnector || selectedTunnel?.connectorId || null,
              status: composeManagedTunnelConnector ? "active" : undefined,
              configJson: JSON.stringify({ ingress: domains.map((recordName) => ({ hostname: recordName, service: tunnelService })) }),
            },
          }).catch(() => undefined);
        }
        for (const recordName of domains) {
          const requestedZoneId = String(zoneId || "").trim();
          const zone: CloudflareZone | undefined = requestedZoneId
            ? zones.find((candidate) => candidate.id === requestedZoneId)
            : zones.find((z) => Boolean(z.name) && recordName.endsWith(String(z.name)));
          if (!zone) {
            throw new Error(`No connected Cloudflare zone matches ${recordName}. Select its zone before deploying.`);
          }
          if (zone.name && recordName !== zone.name && !recordName.endsWith(`.${zone.name}`)) {
            throw new Error(`${recordName} does not belong to the selected Cloudflare zone ${zone.name}.`);
          }
          records.push(await provisionCustomDomain({
            subdomain: recordName,
            zoneId: String(zone.id),
            targetHost: dnsTunnelId ? `${dnsTunnelId}.cfargotunnel.com` : publicIp,
            recordType: dnsTunnelId ? "CNAME" : "A",
            proxied: dnsTunnelId ? proxied !== false : proxied === true,
          }));
        }
        dnsResult = records;
      } catch (err) {
        dnsResult = { error: err instanceof Error ? err.message : "DNS provisioning failed" };
      }
    }

    const healthResults = await verifyPublicEndpoints(domains, vps, allInputs.health_path || "/");
    const verification = deploymentVerificationStatus(domains, dnsResult, healthResults);
    const runtimeVerified = !runtimeVerification || runtimeVerification.code === 0;
    const deployedSuccessfully = runtimeVerified && verification.publicVerified;
    const deploymentStatus = runtimeVerified ? verification.status : "failed";
    const runtimeError = runtimeVerified
      ? null
      : [runtimeVerification?.stderr, runtimeVerification?.stdout].filter(Boolean).join("\n").trim()
        || "The Compose service graph did not become operational.";
    const deploymentError = runtimeError || verification.error;
    const deploymentOutput = runtimeVerification ? { compose: upResult, runtime: runtimeVerification } : upResult;

    const persisted = await persistTemplateDeployment({
      slug,
      templateName,
      deployPath: runtimePath,
      composeProject,
      source,
      domains,
      composeYml: composeContent,
      proxyConfig: resolved.proxyConfig,
      proxyConfigPath: proxyPath,
      proxyOutput: proxyResult,
      dnsResult,
      tunnelConfigResult,
      healthResults,
      upOutput: deploymentOutput,
      manifest,
      tunnelId: selectedTunnel?.tunnelId || requestedTunnelId || null,
      vpsConfigId: vps.id,
      durationMs: Date.now() - startTime,
      status: deploymentStatus,
    });
    const envProfile = await upsertEnvProfileForProject({
      projectId: persisted.projectId,
      deploymentId: persisted.deploymentId,
      schema: envSchemaEntries,
      providerType: "local",
      projectRef: await readInfisicalProjectRef(source.sourcePath, vps),
    });
    if (Object.keys(envValues).length > 0) {
      await setLocalEnvValues(envProfile.id, envValues, envSchemaEntries);
    }
    const envValidation = validateEnv(envSchemaEntries, envValues);
    await prisma.deploymentEnvProfile.update({
      where: { id: envProfile.id },
      data: {
        status: envValidation.ok ? "synced" : "missing",
        lastHash: envValidation.hash,
        lastSyncedAt: Object.keys(envValues).length > 0 ? new Date() : null,
        lastError: envValidation.ok ? null : `Missing: ${envValidation.missing.join(", ")}`,
      },
    });
    await prisma.deployment.update({
      where: { id: persisted.deploymentId },
      data: {
        envProfileId: envProfile.id,
        envProviderType: envProfile.providerType,
        envHash: envValidation.hash,
        envStatus: envValidation.ok ? "valid" : "missing",
      },
    });
    await enrolTemplateDeployment({
      projectId: persisted.projectId,
      name: slug,
      slug,
      kind: "compose",
      sourcePath: runtimePath,
      composePath: `${runtimePath}/${repositoryComposeMode ? repositoryComposeFile : "docker-compose.yml"}`,
      vpsConfigId: vps.id,
      templateName,
    });

    return NextResponse.json({
      success: deployedSuccessfully,
      deployed: true,
      status: deploymentStatus,
      publicVerified: verification.publicVerified,
      runtimeVerified,
      error: deploymentError,
      ...persisted,
      deployPath: runtimePath,
      slug,
      composeProject,
      upOutput: deploymentOutput,
      runtimeVerification,
      dns: dnsResult,
      tunnelConfig: tunnelConfigResult,
      proxy: proxyResult,
      health: healthResults,
      composeYml: composeContent,
      proxyConfig: resolved.proxyConfig,
      proxyConfigPath: proxyPath,
      manifest,
      source,
      tunnelId: selectedTunnel?.tunnelId || requestedTunnelId || null,
      enrolled: true,
      message: deployedSuccessfully
        ? `Deployed and publicly verified ${slug}${domains.length ? ` at ${domains.map((d) => `https://${d}`).join(", ")}` : ""}.`
        : runtimeError
          ? `Deployed ${slug}, but the complete Compose service graph is not operational: ${runtimeError}`
          : `Deployed ${slug} to the host, but its public endpoint is not reachable yet.`,
    }, { status: deployedSuccessfully ? 200 : 502 });
  } catch (err) {
    return NextResponse.json({
      success: false, error: err instanceof Error ? err.message : "Deploy failed",
    }, { status: 500 });
  }
}
