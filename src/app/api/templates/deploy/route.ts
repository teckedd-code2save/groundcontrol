import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { loadTemplate, resolveTemplate, generatePreview } from "@/lib/template-engine";
import { getActiveVps, execOnVps, shQuote } from "@/lib/vps";

export async function POST(req: NextRequest) {
  const user = await requireAuth(req);
  if (user instanceof NextResponse) return user;

  try {
    const body = await req.json();
    const { templateName, inputs = {}, envVars = [], repoUrl, domain, createDns } = body;

    if (!templateName) {
      return NextResponse.json({ success: false, error: "templateName is required" }, { status: 400 });
    }

    const template = await loadTemplate(`${templateName}.yml`);
    if (!template) {
      return NextResponse.json({ success: false, error: `Template "${templateName}" not found` }, { status: 404 });
    }

    const allInputs: Record<string, string> = { ...inputs };
    if (repoUrl) allInputs["repo_url"] = repoUrl;
    for (const ev of (envVars || [])) {
      if (ev.key) allInputs[`env_${ev.key}`] = ev.value || "";
    }

    const resolved = resolveTemplate(template, allInputs);

    // Deploy to VPS
    const deployPath = `/opt/${templateName}`;
    const vps = await getActiveVps();

    if (!vps) {
      return NextResponse.json({
        success: false, error: "No active VPS connected. Go to Settings → VPS to connect a server.",
      }, { status: 400 });
    }

    // Clone repo if provided
    if (repoUrl) {
      await execOnVps(`cd ${shQuote(deployPath)} 2>/dev/null || (mkdir -p ${shQuote(deployPath)} && git clone ${shQuote(repoUrl)} ${shQuote(deployPath)}) && cd ${shQuote(deployPath)} && git pull`, vps);
    } else {
      await execOnVps(`mkdir -p ${shQuote(deployPath)}`, vps);
    }

    // Write docker-compose.yml
    const escapedCompose = resolved.dockerCompose.replace(/'/g, "'\\''");
    await execOnVps(`cat > ${shQuote(deployPath)}/docker-compose.yml << 'GCEOF'\n${resolved.dockerCompose}\nGCEOF`, vps);

    // Write .env
    if (envVars && envVars.length > 0) {
      const envFile = envVars.filter((e: { key: string }) => e.key).map((e: { key: string; value: string }) => `${e.key}=${e.value || ""}`).join("\n");
      if (envFile) {
        await execOnVps(`cat > ${shQuote(deployPath)}/.env << 'GCEOF'\n${envFile}\nGCEOF`, vps);
      }
    }

    // Deploy
    const upResult = await execOnVps(`cd ${shQuote(deployPath)} && docker compose up -d --build 2>&1`, vps);

    // Cloudflare DNS
    let dnsResult: unknown = null;
    if (createDns && domain) {
      try {
        const { listZones, createDnsRecord } = await import("@/lib/cloudflare");
        const zones = await listZones();
        const zone = (zones as any[]).find((z: any) => domain.endsWith(z.name));
        if (zone) {
          dnsResult = await createDnsRecord(zone.id, {
            type: "A", name: domain, content: vps.host, ttl: 120, proxied: false,
          });
        }
      } catch { dnsResult = null; }
    }

    return NextResponse.json({
      success: true,
      deployPath,
      upOutput: upResult,
      dns: dnsResult,
      message: `Deployed to ${deployPath}. ${domain ? `Served at https://${domain}` : ""}`,
    });
  } catch (err) {
    return NextResponse.json({
      success: false, error: err instanceof Error ? err.message : "Deploy failed",
    }, { status: 500 });
  }
}
