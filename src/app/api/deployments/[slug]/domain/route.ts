import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { handleApiError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import { getActiveVps, scanProjects } from "@/lib/vps";
import { parseDomainInput, switchDeploymentDomain } from "@/lib/domain-switch";

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ slug: string }> }
) {
  try {
    requireAuth(req);
    const { slug } = await ctx.params;
    const body = (await req.json()) as {
      domain?: string;
      zoneId?: string;
      upstream?: string;
      removeOld?: boolean;
    };

    const parsed = parseDomainInput(body.domain);
    if (!parsed.domain) {
      return NextResponse.json({ error: parsed.error || "Enter a valid domain." }, { status: 400 });
    }

    const deployment = await prisma.enrolledDeployment.findUnique({
      where: { slug },
      include: { legacyProject: true },
    });
    if (!deployment) return NextResponse.json({ error: "Deployment not found" }, { status: 404 });

    const vps = await getActiveVps();
    const { caddySites } = await scanProjects(vps);
    const currentDomain = (deployment.legacyProject?.domain || "").toLowerCase();
    const currentSite = caddySites.find(
      (site) => String(site.domain || "").toLowerCase() === currentDomain
    );

    const upstream = String(body.upstream || "").trim() || currentSite?.proxy || "";
    if (!upstream) {
      return NextResponse.json(
        { error: "Could not resolve the current proxy upstream. Provide an upstream (host:port)." },
        { status: 400 }
      );
    }

    const result = await switchDeploymentDomain({
      domain: parsed.domain,
      zoneId: String(body.zoneId || "").trim() || undefined,
      upstream,
      vps,
      removeOldSitePath: body.removeOld === true ? currentSite?.file || null : null,
    });

    let metadata: Record<string, unknown> = {};
    try {
      metadata = JSON.parse(deployment.metadataJson || "{}");
    } catch {}
    metadata.manualPublicUrl = result.publicUrl;
    metadata.identityUpdatedAt = new Date().toISOString();

    await prisma.enrolledDeployment.update({
      where: { id: deployment.id },
      data: { metadataJson: JSON.stringify(metadata) },
    });

    if (deployment.legacyProject) {
      await prisma.project.update({
        where: { id: deployment.legacyProject.id },
        data: { domain: result.domain },
      });
    }

    return NextResponse.json({
      success: true,
      domain: result.domain,
      publicUrl: result.publicUrl,
      recordId: result.recordId,
      recordName: result.recordName,
      sitePath: result.sitePath,
      upstream,
    });
  } catch (err) {
    return handleApiError(err);
  }
}
