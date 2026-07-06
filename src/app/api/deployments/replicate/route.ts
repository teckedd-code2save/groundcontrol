import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { execOnVps, getActiveVps, getSystemConfig, shQuote } from "@/lib/vps";
import { handleApiError } from "@/lib/errors";
import { parse, stringify } from "yaml";

function slugify(value: unknown): string {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function normalizeRoot(value: string): string {
  return value.replace(/\/+$/, "") || "/";
}

function composeFileName(sourcePath: string): string {
  return [
    `set -eu`,
    `src=${shQuote(sourcePath)}`,
    `compose=""`,
    `for f in docker-compose.yml docker-compose.yaml compose.yml compose.yaml; do if [ -f "$src/$f" ]; then compose="$f"; break; fi; done`,
    `if [ -z "$compose" ]; then echo "Source has no compose file" >&2; exit 4; fi`,
    `printf '%s' "$compose"`,
  ].join("\n");
}

function assertServiceName(value: unknown): string {
  const serviceName = String(value || "").trim();
  if (!/^[A-Za-z0-9_.-]+$/.test(serviceName)) throw new Error("serviceName must be a compose service name");
  return serviceName;
}

function buildResourceReplicaOverride(composeContent: string, serviceName: string, newServiceName: string) {
  const doc = parse(composeContent) as Record<string, unknown> | null;
  const services = doc && typeof doc === "object" && doc.services && typeof doc.services === "object" && !Array.isArray(doc.services)
    ? doc.services as Record<string, unknown>
    : null;
  if (!services) throw new Error("Compose file has no parseable services mapping");
  const rawService = services[serviceName];
  if (!rawService || typeof rawService !== "object" || Array.isArray(rawService)) {
    throw new Error(`Service ${serviceName} was not found in compose`);
  }
  const service = JSON.parse(JSON.stringify(rawService)) as Record<string, unknown>;
  delete service.container_name;
  delete service.ports;
  service.profiles = ["groundcontrol-replicas"];
  service.labels = [
    ...stringList(service.labels),
    "groundcontrol.replica=true",
    `groundcontrol.replica.source=${serviceName}`,
  ];

  const volumes: Record<string, unknown> = {};
  if (Array.isArray(service.volumes)) {
    service.volumes = service.volumes.map((entry) => {
      const text = String(entry);
      const [source, ...rest] = text.split(":");
      if (!source || source.startsWith(".") || source.startsWith("/") || rest.length === 0) return text;
      const nextSource = `${newServiceName}_${source}`;
      volumes[nextSource] = {};
      return [nextSource, ...rest].join(":");
    });
  }

  return stringify({
    services: {
      [newServiceName]: service,
    },
    ...(Object.keys(volumes).length > 0 ? { volumes } : {}),
  });
}

function stringList(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.map((entry) => String(entry || "")).filter(Boolean);
  return [];
}

export async function POST(req: NextRequest) {
  try {
    requireAuth(req);
    const body = await req.json();
    const mode = String(body.mode || "clone-deployment");
    const sourcePath = String(body.sourcePath || "").replace(/\/+$/, "");
    const sourceSlug = String(body.sourceSlug || "deployment");
    const newSlug = slugify(body.newSlug || `${sourceSlug}-copy`);
    const envStrategy = String(body.envStrategy || "blank");
    const copyEnv = envStrategy === "copy" || body.copyEnv === true;

    if (!sourcePath.startsWith("/")) {
      return NextResponse.json({ error: "sourcePath must be an absolute VPS path" }, { status: 400 });
    }
    if (!newSlug) {
      return NextResponse.json({ error: "newSlug is required" }, { status: 400 });
    }

    const vps = await getActiveVps();
    const config = await getSystemConfig();
    const templateRoot = normalizeRoot(config.templateDeploymentRoot || "/srv/groundcontrol/deployments");
    const targetPath = `${templateRoot}/${newSlug}`;

    const composeProbe = await execOnVps(composeFileName(sourcePath), vps);
    if (composeProbe.code !== 0) {
      return NextResponse.json({ error: composeProbe.stderr || composeProbe.stdout || "Source has no compose file" }, { status: 400 });
    }
    const compose = composeProbe.stdout.trim();
    const composePath = `${sourcePath}/${compose}`;

    if (mode === "scale-component") {
      const serviceName = assertServiceName(body.serviceName);
      const replicas = Math.max(1, Math.min(50, Number(body.replicas || 2)));
      const result = await execOnVps(
        [
          `set -eu`,
          `cd ${shQuote(sourcePath)}`,
          `docker compose -f ${shQuote(compose)} config --services | grep -Fx ${shQuote(serviceName)} >/dev/null`,
          `docker compose -f ${shQuote(compose)} up -d --scale ${shQuote(`${serviceName}=${replicas}`)} ${shQuote(serviceName)}`,
        ].join("\n"),
        vps
      );
      if (result.code !== 0) {
        return NextResponse.json({ error: result.stderr || result.stdout || "Scale replication failed" }, { status: 400 });
      }
      return NextResponse.json({
        success: true,
        mode,
        message: `Scaled ${serviceName} to ${replicas} replica${replicas === 1 ? "" : "s"}.`,
        output: result.stdout,
      });
    }

    if (mode === "replicate-resource") {
      const serviceName = assertServiceName(body.serviceName);
      const resourceType = String(body.resourceType || "resource").replace(/[^a-z0-9-]/gi, "").toLowerCase() || "resource";
      const dataStrategy = String(body.dataStrategy || "empty");
      if (!["empty", "share", "clone", "external"].includes(dataStrategy)) {
        return NextResponse.json({ error: "Unsupported data strategy" }, { status: 400 });
      }
      if (dataStrategy === "clone") {
        return NextResponse.json({ error: "Clone-from-backup requires a configured backup source before it can run" }, { status: 400 });
      }
      if (dataStrategy === "external") {
        return NextResponse.json({ error: "External resource replication needs a target connection string" }, { status: 400 });
      }
      const composeRead = await execOnVps(`cat ${shQuote(composePath)}`, vps);
      if (composeRead.code !== 0) {
        return NextResponse.json({ error: composeRead.stderr || "Unable to read compose file" }, { status: 400 });
      }
      const newServiceName = slugify(String(body.newServiceName || `${serviceName}-${resourceType || "replica"}`));
      const override = buildResourceReplicaOverride(composeRead.stdout, serviceName, newServiceName);
      const overridePath = `${sourcePath}/.groundcontrol/replication/${newServiceName}.compose.yml`;
      const result = await execOnVps(
        [
          `set -eu`,
          `mkdir -p ${shQuote(`${sourcePath}/.groundcontrol/replication`)}`,
          `cat > ${shQuote(overridePath)} << 'GCEOF'`,
          override.replace(/\n?$/, "\n") + `GCEOF`,
          `cd ${shQuote(sourcePath)}`,
          `docker compose -f ${shQuote(compose)} -f ${shQuote(overridePath)} --profile groundcontrol-replicas config >/dev/null`,
          dataStrategy === "share"
            ? `printf '%s\\n' 'Prepared shared resource wiring plan for ${newServiceName}; no new container was started.'`
            : `docker compose -f ${shQuote(compose)} -f ${shQuote(overridePath)} --profile groundcontrol-replicas up -d ${shQuote(newServiceName)}`,
        ].join("\n"),
        vps
      );
      if (result.code !== 0) {
        await execOnVps(`rm -f ${shQuote(overridePath)}`, vps).catch(() => undefined);
        return NextResponse.json({ error: result.stderr || result.stdout || "Resource replication failed" }, { status: 400 });
      }
      return NextResponse.json({
        success: true,
        mode,
        serviceName,
        newServiceName,
        resourceType,
        dataStrategy,
        message: dataStrategy === "share"
          ? `Prepared shared ${resourceType} wiring for ${serviceName}.`
          : `Replicated ${serviceName} as ${newServiceName}. Update dependent env and redeploy affected services.`,
        output: result.stdout,
      });
    }

    if (mode !== "clone-deployment") {
      return NextResponse.json({ error: "Unsupported replication mode" }, { status: 400 });
    }

    const result = await execOnVps(
      [
        `set -eu`,
        `src=${shQuote(sourcePath)}`,
        `dst=${shQuote(targetPath)}`,
        `if [ ! -d "$src" ]; then echo "Source path does not exist: $src" >&2; exit 2; fi`,
        `if [ -e "$dst" ]; then echo "Target already exists: $dst" >&2; exit 3; fi`,
        `compose=${shQuote(compose)}`,
        `cd "$src"`,
        `docker compose -f "$compose" config >/dev/null`,
        `mkdir -p "$dst/.groundcontrol"`,
        `cp "$src/$compose" "$dst/docker-compose.yml"`,
        `if [ -f "$src/.env.schema" ]; then cp "$src/.env.schema" "$dst/.env.schema"; else touch "$dst/.env.schema"; fi`,
        copyEnv
          ? `if [ -f "$src/.env" ]; then cp "$src/.env" "$dst/.env" && chmod 600 "$dst/.env"; fi`
          : `: > "$dst/.env" && chmod 600 "$dst/.env"`,
        `cat > "$dst/.groundcontrol/replication-plan.json" << 'GCEOF'
{
  "managedBy": "groundcontrol",
  "operation": "replicate",
  "sourcePath": ${JSON.stringify(sourcePath)},
  "targetPath": ${JSON.stringify(targetPath)},
  "sourceSlug": ${JSON.stringify(sourceSlug)},
  "slug": ${JSON.stringify(newSlug)},
  "envStrategy": ${JSON.stringify(envStrategy)},
  "domainStrategy": "never-reuse",
  "dataStrategy": "empty-or-external-by-default",
  "createdAt": ${JSON.stringify(new Date().toISOString())}
}
GCEOF`,
        `printf '%s' "$dst"`,
      ].join("\n"),
      vps
    );

    if (result.code !== 0) {
      return NextResponse.json({ error: result.stderr || result.stdout || "Replication failed" }, { status: 400 });
    }

    return NextResponse.json({
      success: true,
      targetPath,
      slug: newSlug,
      copiedEnv: copyEnv,
      message: `Created isolated deployment copy at ${targetPath}. Review .env, ports, domains, and volumes before starting it.`,
    });
  } catch (err) {
    return handleApiError(err);
  }
}
