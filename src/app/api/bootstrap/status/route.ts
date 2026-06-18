import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import {
  isRunningInContainer,
  canInstallHostPackages,
  isDockerInstalled,
  isCaddyInstalled,
  isNginxInstalled,
  isNodeInstalled,
  isGitInstalled,
  isImagePulled,
  isK3sInstalled,
  isKubectlInstalled,
  isHelmInstalled,
} from "@/lib/bootstrap";

export async function GET(req: NextRequest) {
  try {
    await requireAuth(req);

    const [
      inContainer,
      hostPackagesAllowed,
      docker,
      caddy,
      nginx,
      node,
      git,
      cloudflared,
      postgres,
      redis,
      traefik,
      certbot,
      k3s,
      kubectl,
      helm,
    ] = await Promise.all([
      isRunningInContainer(),
      canInstallHostPackages(),
      isDockerInstalled(),
      isCaddyInstalled(),
      isNginxInstalled(),
      isNodeInstalled(),
      isGitInstalled(),
      isImagePulled("cloudflare/cloudflared:latest"),
      isImagePulled("postgres:16-alpine"),
      isImagePulled("redis:7-alpine"),
      isImagePulled("traefik:v3"),
      isImagePulled("certbot/certbot:latest"),
      isK3sInstalled(),
      isKubectlInstalled(),
      isHelmInstalled(),
    ]);

    return NextResponse.json({
      inContainerLocalMode: inContainer,
      hostPackagesAllowed,
      installed: {
        docker,
        caddy,
        nginx,
        node,
        git,
        cloudflared,
        postgres,
        redis,
        traefik,
        certbot,
        k3s,
        kubectl,
        helm,
      },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
