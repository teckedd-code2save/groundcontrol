import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { getActiveVps, execOnVps, shQuote } from "@/lib/vps";
import { prisma } from "@/lib/prisma";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireAuth(req);
  if (user instanceof NextResponse) return user;

  try {
    const { id } = await params;
    const deployment = await prisma.deployment.findUnique({
      where: { id: Number(id) },
      include: { project: true },
    });
    if (!deployment) return NextResponse.json({ error: "Deployment not found" }, { status: 404 });

    const vps = await getActiveVps();
    if (!vps) return NextResponse.json({ error: "No active VPS" }, { status: 400 });

    const slug = deployment.project.slug;
    const deployPath = `/srv/groundcontrol/deployments/${slug}`;
    const result = await execOnVps(`cat ${shQuote(`${deployPath}/docker-compose.yml`)} 2>/dev/null || echo "compose file not found"`, vps);

    return NextResponse.json({
      compose: result.stdout || "Not available",
      path: deployPath,
      slug,
      repoUrl: `https://github.com/teckedd-code2save/${slug}`,
      commitSha: deployment.commitSha,
    });
  } catch (err) {
    return NextResponse.json({ compose: "Error fetching compose", error: String(err) });
  }
}
