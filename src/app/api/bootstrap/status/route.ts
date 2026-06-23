import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { isRunningInContainer, canInstallHostPackages, getComponentStatus } from "@/lib/bootstrap";

const TOOLS = [
  "docker",
  "caddy",
  "nginx",
  "node",
  "git",
  "cloudflared",
  "postgres",
  "redis",
  "traefik",
  "certbot",
  "k3s",
  "kubectl",
  "helm",
  "terraform",
];

export async function GET(req: NextRequest) {
  try {
    await requireAuth(req);

    const [inContainer, hostPackagesAllowed, ...statuses] = await Promise.all([
      isRunningInContainer(),
      canInstallHostPackages(),
      ...TOOLS.map((tool) => getComponentStatus(tool)),
    ]);

    const components: Record<string, { installed: boolean; running?: boolean; version?: string }> = {};
    TOOLS.forEach((tool, idx) => {
      components[tool] = statuses[idx];
    });

    return NextResponse.json({
      inContainerLocalMode: inContainer,
      hostPackagesAllowed,
      components,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
