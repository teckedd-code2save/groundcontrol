import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { execOnVps, getActiveVps, getSystemConfig, shQuote } from "@/lib/vps";
import { handleApiError } from "@/lib/errors";

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

export async function POST(req: NextRequest) {
  try {
    requireAuth(req);
    const body = await req.json();
    const sourcePath = String(body.sourcePath || "").replace(/\/+$/, "");
    const sourceSlug = String(body.sourceSlug || "deployment");
    const newSlug = slugify(body.newSlug || `${sourceSlug}-copy`);
    const copyEnv = body.envStrategy === "copy" || body.copyEnv === true;

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

    await execOnVps(`mkdir -p ${shQuote(templateRoot)}`, vps);

    const result = await execOnVps(
      [
        `set -eu`,
        `src=${shQuote(sourcePath)}`,
        `dst=${shQuote(targetPath)}`,
        `if [ ! -d "$src" ]; then echo "Source path does not exist: $src" >&2; exit 2; fi`,
        `if [ -e "$dst" ]; then echo "Target already exists: $dst" >&2; exit 3; fi`,
        `compose=""`,
        `for f in docker-compose.yml docker-compose.yaml compose.yml compose.yaml; do if [ -f "$src/$f" ]; then compose="$f"; break; fi; done`,
        `if [ -z "$compose" ]; then echo "Source has no compose file" >&2; exit 4; fi`,
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
  "envStrategy": ${JSON.stringify(copyEnv ? "copy" : "blank")},
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
