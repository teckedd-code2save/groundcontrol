import { execOnVps, shQuote, type VpsConnection, getActiveVps } from "./vps";
import { execOnTarget, canExecOnHost } from "./host-exec";

async function detectOsFamily(vps?: VpsConnection | null): Promise<"alpine" | "debian" | "other"> {
  const conn = vps || (await getActiveVps().catch(() => null));
  if (!conn) return "other";
  const result = await execOnTarget("cat /etc/os-release 2>/dev/null || echo 'ID=unknown'", conn);
  const id = result.stdout
    .split("\n")
    .find((l) => l.startsWith("ID="))
    ?.replace(/^ID=/, "")
    .replace(/["']/g, "")
    .toLowerCase() || "unknown";
  if (id.includes("alpine")) return "alpine";
  if (id.includes("debian") || id.includes("ubuntu")) return "debian";
  return "other";
}

/**
 * Detect whether this GroundControl process is running inside a container.
 * This matters because local-mode `execOnVps` runs commands in this process'
 * namespace, so host package managers (apk/apt) will target the container
 * filesystem and either fail or install packages in the wrong place.
 */
export async function isRunningInContainer(vps?: VpsConnection | null): Promise<boolean> {
  const conn = vps || (await getActiveVps().catch(() => null));
  if (!conn) return false;

  // SSH mode always runs on the real host.
  if (!conn.isLocal) return false;

  const checks = await Promise.all([
    execOnVps("test -f /.dockerenv && echo yes || echo no", conn),
    execOnVps("cat /proc/1/cgroup 2>/dev/null | tr '\\n' ' ' || echo ''", conn),
  ]);

  if (checks[0].stdout.trim() === "yes") return true;
  const cgroup = checks[1].stdout.toLowerCase();
  if (/docker|containerd|kubepod|lxc|podman/.test(cgroup)) return true;
  return false;
}

/**
 * Host package installs (apk, apt) only make sense when commands execute on the
 * real host OS. In local container mode they target the container filesystem.
 */
export async function canInstallHostPackages(vps?: VpsConnection | null): Promise<{ ok: boolean; reason?: string }> {
  const conn = vps || (await getActiveVps().catch(() => null));
  if (!conn) return { ok: false, reason: "No VPS configured." };

  if (!conn.isLocal) return { ok: true };

  const inContainer = await isRunningInContainer(conn);
  if (inContainer) {
    if (await canExecOnHost()) {
      return { ok: true };
    }
    return {
      ok: false,
      reason:
        "GroundControl is running inside a Docker container, so host package managers (apk/apt) cannot target the host OS. " +
        "Run GroundControl directly on the host, or manage the host via SSH, to install host packages.",
    };
  }

  return { ok: true };
}

export interface BootstrapResult {
  success: boolean;
  output: string;
  error: string;
}

const HOST_PACKAGE_BLOCKED =
  "GroundControl is running inside a Docker container, so host package managers cannot target the host OS. " +
  "Run GroundControl directly on the host, or manage the host via SSH, to install host packages.";

/**
 * Install Docker using the official convenience script when possible,
 * falling back to distribution package managers.
 */
export async function installDocker(vps?: VpsConnection | null): Promise<BootstrapResult> {
  const conn = vps || (await getActiveVps().catch(() => null));
  if (!conn) return { success: false, output: "", error: "No VPS configured" };

  const allowed = await canInstallHostPackages(conn);
  if (!allowed.ok) return { success: false, output: "", error: allowed.reason || HOST_PACKAGE_BLOCKED };

  const os = await detectOsFamily(conn);

  if (os === "alpine") {
    const result = await execOnTarget("apk add --no-cache docker docker-cli-compose 2>&1", conn);
    return { success: result.code === 0, output: result.stdout, error: result.stderr };
  }

  if (os === "debian") {
    const script = `curl -fsSL https://get.docker.com -o get-docker.sh && sh get-docker.sh 2>&1`;
    const result = await execOnTarget(script, conn);
    return { success: result.code === 0, output: result.stdout, error: result.stderr };
  }

  // Generic fallback: try the official script.
  const script = `curl -fsSL https://get.docker.com -o get-docker.sh && sh get-docker.sh 2>&1`;
  const result = await execOnTarget(script, conn);
  return { success: result.code === 0, output: result.stdout, error: result.stderr };
}

/**
 * Install Caddy via the official repository for Debian/Ubuntu/Alpine,
 * or download the static binary as a last resort.
 */
export async function installCaddy(vps?: VpsConnection | null): Promise<BootstrapResult> {
  const conn = vps || (await getActiveVps().catch(() => null));
  if (!conn) return { success: false, output: "", error: "No VPS configured" };

  const allowed = await canInstallHostPackages(conn);
  if (!allowed.ok) return { success: false, output: "", error: allowed.reason || HOST_PACKAGE_BLOCKED };

  const os = await detectOsFamily(conn);

  if (os === "debian") {
    const script = `apt-get install -y debian-keyring debian-archive-keyring apt-transport-https && \
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg && \
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | tee /etc/apt/sources.list.d/caddy-stable.list && \
apt-get update && apt-get install -y caddy 2>&1`;
    const result = await execOnTarget(script, conn);
    return { success: result.code === 0, output: result.stdout, error: result.stderr };
  }

  if (os === "alpine") {
    const result = await execOnTarget("apk add --no-cache caddy 2>&1", conn);
    return { success: result.code === 0, output: result.stdout, error: result.stderr };
  }

  // Static binary fallback.
  const arch = await execOnTarget("uname -m", conn);
  const goArch = arch.stdout.trim() === "aarch64" ? "arm64" : arch.stdout.trim() === "x86_64" ? "amd64" : arch.stdout.trim();
  const script = `curl -Lo /usr/local/bin/caddy "https://github.com/caddyserver/caddy/releases/latest/download/caddy_linux_${shQuote(goArch)}" && \
chmod +x /usr/local/bin/caddy && /usr/local/bin/caddy version 2>&1`;
  const result = await execOnTarget(script, conn);
  return { success: result.code === 0, output: result.stdout, error: result.stderr };
}

/**
 * Install Nginx via the distribution package manager or static binary fallback.
 */
export async function installNginx(vps?: VpsConnection | null): Promise<BootstrapResult> {
  const conn = vps || (await getActiveVps().catch(() => null));
  if (!conn) return { success: false, output: "", error: "No VPS configured" };

  const allowed = await canInstallHostPackages(conn);
  if (!allowed.ok) return { success: false, output: "", error: allowed.reason || HOST_PACKAGE_BLOCKED };

  const os = await detectOsFamily(conn);

  if (os === "debian") {
    const result = await execOnTarget("apt-get update && apt-get install -y nginx 2>&1", conn);
    return { success: result.code === 0, output: result.stdout, error: result.stderr };
  }

  if (os === "alpine") {
    const result = await execOnTarget("apk add --no-cache nginx 2>&1", conn);
    return { success: result.code === 0, output: result.stdout, error: result.stderr };
  }

  // Static binary fallback (official mainline prebuilt).
  const arch = await execOnTarget("uname -m", conn);
  const goArch = arch.stdout.trim() === "aarch64" ? "arm64" : arch.stdout.trim() === "x86_64" ? "amd64" : arch.stdout.trim();
  const script = `curl -Lo /tmp/nginx.tar.gz "https://nginx.org/download/nginx-1.26.2-linux-${shQuote(goArch)}.tar.gz" 2>&1 && \
tar -xzf /tmp/nginx.tar.gz -C /usr/local/bin --strip-components=1 2>&1 && nginx -v 2>&1`;
  const result = await execOnTarget(script, conn);
  return { success: result.code === 0, output: result.stdout, error: result.stderr };
}

/**
 * Install Node.js via the official NodeSource repository (Debian/Ubuntu) or apk (Alpine).
 */
export async function installNode(vps?: VpsConnection | null): Promise<BootstrapResult> {
  const conn = vps || (await getActiveVps().catch(() => null));
  if (!conn) return { success: false, output: "", error: "No VPS configured" };

  const allowed = await canInstallHostPackages(conn);
  if (!allowed.ok) return { success: false, output: "", error: allowed.reason || HOST_PACKAGE_BLOCKED };

  const os = await detectOsFamily(conn);

  if (os === "debian") {
    const script = `curl -fsSL https://deb.nodesource.com/setup_20.x | bash - && apt-get install -y nodejs 2>&1`;
    const result = await execOnTarget(script, conn);
    return { success: result.code === 0, output: result.stdout, error: result.stderr };
  }

  if (os === "alpine") {
    const result = await execOnTarget("apk add --no-cache nodejs npm 2>&1", conn);
    return { success: result.code === 0, output: result.stdout, error: result.stderr };
  }

  // Generic fallback: try NodeSource script.
  const script = `curl -fsSL https://deb.nodesource.com/setup_20.x | bash - && apt-get install -y nodejs 2>&1`;
  const result = await execOnTarget(script, conn);
  return { success: result.code === 0, output: result.stdout, error: result.stderr };
}

/**
 * Install Git via the distribution package manager.
 */
export async function installGit(vps?: VpsConnection | null): Promise<BootstrapResult> {
  const conn = vps || (await getActiveVps().catch(() => null));
  if (!conn) return { success: false, output: "", error: "No VPS configured" };

  const allowed = await canInstallHostPackages(conn);
  if (!allowed.ok) return { success: false, output: "", error: allowed.reason || HOST_PACKAGE_BLOCKED };

  const os = await detectOsFamily(conn);

  if (os === "debian") {
    const result = await execOnTarget("apt-get update && apt-get install -y git 2>&1", conn);
    return { success: result.code === 0, output: result.stdout, error: result.stderr };
  }

  if (os === "alpine") {
    const result = await execOnTarget("apk add --no-cache git 2>&1", conn);
    return { success: result.code === 0, output: result.stdout, error: result.stderr };
  }

  const result = await execOnTarget("command -v git || (curl -fsSL https://raw.githubusercontent.com/git/git/master/INSTALL 2>/dev/null) 2>&1", conn);
  return { success: result.code === 0, output: result.stdout, error: result.stderr };
}

/**
 * Pull a container image. Works in both SSH and local container mode because it
 * uses the mounted host Docker socket.
 */
async function pullImage(image: string, vps?: VpsConnection | null): Promise<BootstrapResult> {
  const conn = vps || (await getActiveVps().catch(() => null));
  if (!conn) return { success: false, output: "", error: "No VPS configured" };
  const result = await execOnVps(`docker pull ${image} 2>&1`, conn);
  return { success: result.code === 0, output: result.stdout, error: result.stderr };
}

/**
 * Install the cloudflared daemon binary to /usr/local/bin/cloudflared.
 * Idempotent: skips if cloudflared is already present.
 */
export async function installCloudflared(vps?: VpsConnection | null): Promise<BootstrapResult> {
  const conn = vps || (await getActiveVps().catch(() => null));
  if (!conn) return { success: false, output: "", error: "No VPS configured" };

  const allowed = await canInstallHostPackages(conn);
  if (!allowed.ok) return { success: false, output: "", error: allowed.reason || HOST_PACKAGE_BLOCKED };

  if (await isCloudflaredInstalled(conn)) {
    return { success: true, output: "cloudflared is already installed", error: "" };
  }

  const arch = await execOnTarget("uname -m", conn);
  const goArch =
    arch.stdout.trim() === "aarch64" ? "arm64" : arch.stdout.trim() === "x86_64" ? "amd64" : arch.stdout.trim();
  const script = `curl -Lo /usr/local/bin/cloudflared "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-${shQuote(
    goArch
  )}" && chmod +x /usr/local/bin/cloudflared && /usr/local/bin/cloudflared version 2>&1`;
  const result = await execOnTarget(script, conn);
  return { success: result.code === 0, output: result.stdout, error: result.stderr };
}

/**
 * Install the Terraform binary to /usr/local/bin/terraform.
 * Idempotent: skips if Terraform is already present.
 */
export async function installTerraform(vps?: VpsConnection | null): Promise<BootstrapResult> {
  const conn = vps || (await getActiveVps().catch(() => null));
  if (!conn) return { success: false, output: "", error: "No VPS configured" };

  const allowed = await canInstallHostPackages(conn);
  if (!allowed.ok) return { success: false, output: "", error: allowed.reason || HOST_PACKAGE_BLOCKED };

  if (await isTerraformInstalled(conn)) {
    return { success: true, output: "Terraform is already installed", error: "" };
  }

  const arch = await execOnTarget("uname -m", conn);
  const tfArch =
    arch.stdout.trim() === "aarch64" ? "arm64" : arch.stdout.trim() === "x86_64" ? "amd64" : arch.stdout.trim();
  const script = `VERSION=$(curl -s https://checkpoint-api.hashicorp.com/v1/check/terraform | sed -n 's/.*"current_version":"\\([^"]*\\)".*/\\1/p') && \
curl -Lo /tmp/terraform.zip "https://releases.hashicorp.com/terraform/\${VERSION}/terraform_\${VERSION}_linux_${shQuote(
    tfArch
  )}.zip" && \
unzip -o /tmp/terraform.zip -d /usr/local/bin && chmod +x /usr/local/bin/terraform && /usr/local/bin/terraform version 2>&1`;
  const result = await execOnTarget(script, conn);
  return { success: result.code === 0, output: result.stdout, error: result.stderr };
}

export async function installPostgres(vps?: VpsConnection | null): Promise<BootstrapResult> {
  return pullImage("postgres:16-alpine", vps);
}

export async function installRedis(vps?: VpsConnection | null): Promise<BootstrapResult> {
  return pullImage("redis:7-alpine", vps);
}

export async function installTraefik(vps?: VpsConnection | null): Promise<BootstrapResult> {
  return pullImage("traefik:v3", vps);
}

export async function installCertbot(vps?: VpsConnection | null): Promise<BootstrapResult> {
  return pullImage("certbot/certbot:latest", vps);
}

export async function getServerIp(vps?: VpsConnection | null): Promise<string> {
  const conn = vps || (await getActiveVps().catch(() => null));
  if (!conn) return "";
  const res = await execOnVps(
    `hostname -I 2>/dev/null | awk '{print $1}' || ip route get 1 2>/dev/null | awk '{print $7; exit}' || echo ""`
  );
  return res.stdout.trim();
}

export async function isDockerInstalled(vps?: VpsConnection | null): Promise<boolean> {
  const conn = vps || (await getActiveVps().catch(() => null));
  if (!conn) return false;
  const res = await execOnTarget("docker --version 2>/dev/null >/dev/null && echo yes || echo no", conn);
  return res.stdout.trim() === "yes";
}

export async function isCaddyInstalled(vps?: VpsConnection | null): Promise<boolean> {
  const conn = vps || (await getActiveVps().catch(() => null));
  if (!conn) return false;
  const res = await execOnTarget("caddy version 2>/dev/null >/dev/null && echo yes || echo no", conn);
  return res.stdout.trim() === "yes";
}

export async function isNginxInstalled(vps?: VpsConnection | null): Promise<boolean> {
  const conn = vps || (await getActiveVps().catch(() => null));
  if (!conn) return false;
  const res = await execOnTarget("nginx -v 2>/dev/null >/dev/null && echo yes || echo no", conn);
  return res.stdout.trim() === "yes";
}

export async function isNodeInstalled(vps?: VpsConnection | null): Promise<boolean> {
  const conn = vps || (await getActiveVps().catch(() => null));
  if (!conn) return false;
  const res = await execOnTarget("node --version 2>/dev/null >/dev/null && echo yes || echo no", conn);
  return res.stdout.trim() === "yes";
}

export async function isGitInstalled(vps?: VpsConnection | null): Promise<boolean> {
  const conn = vps || (await getActiveVps().catch(() => null));
  if (!conn) return false;
  const res = await execOnTarget("git --version 2>/dev/null >/dev/null && echo yes || echo no", conn);
  return res.stdout.trim() === "yes";
}

export async function isImagePulled(image: string, vps?: VpsConnection | null): Promise<boolean> {
  const conn = vps || (await getActiveVps().catch(() => null));
  if (!conn) return false;
  const res = await execOnVps(`docker images -q ${image} 2>/dev/null | head -n 1`, conn);
  return res.stdout.trim().length > 0;
}

export async function isK3sInstalled(vps?: VpsConnection | null): Promise<boolean> {
  const conn = vps || (await getActiveVps().catch(() => null));
  if (!conn) return false;
  const res = await execOnTarget("k3s --version 2>/dev/null >/dev/null && echo yes || echo no", conn);
  return res.stdout.trim() === "yes";
}

export async function isKubectlInstalled(vps?: VpsConnection | null): Promise<boolean> {
  const conn = vps || (await getActiveVps().catch(() => null));
  if (!conn) return false;
  const res = await execOnTarget("kubectl version --client 2>/dev/null >/dev/null && echo yes || echo no", conn);
  return res.stdout.trim() === "yes";
}

export async function isHelmInstalled(vps?: VpsConnection | null): Promise<boolean> {
  const conn = vps || (await getActiveVps().catch(() => null));
  if (!conn) return false;
  const res = await execOnTarget("helm version 2>/dev/null >/dev/null && echo yes || echo no", conn);
  return res.stdout.trim() === "yes";
}

export async function isTerraformInstalled(vps?: VpsConnection | null): Promise<boolean> {
  const conn = vps || (await getActiveVps().catch(() => null));
  if (!conn) return false;
  const res = await execOnTarget("terraform version 2>/dev/null >/dev/null && echo yes || echo no", conn);
  return res.stdout.trim() === "yes";
}

export async function isCloudflaredInstalled(vps?: VpsConnection | null): Promise<boolean> {
  const conn = vps || (await getActiveVps().catch(() => null));
  if (!conn) return false;
  const res = await execOnTarget("cloudflared version 2>/dev/null >/dev/null && echo yes || echo no", conn);
  return res.stdout.trim() === "yes";
}

/**
 * Install k3s via the official installer. Idempotent: skips if k3s is already present.
 */
export async function installK3s(vps?: VpsConnection | null): Promise<BootstrapResult> {
  const conn = vps || (await getActiveVps().catch(() => null));
  if (!conn) return { success: false, output: "", error: "No VPS configured" };

  const allowed = await canInstallHostPackages(conn);
  if (!allowed.ok) return { success: false, output: "", error: allowed.reason || HOST_PACKAGE_BLOCKED };

  if (await isK3sInstalled(conn)) {
    return { success: true, output: "k3s is already installed", error: "" };
  }

  const script = `curl -sfL https://get.k3s.io | sh - 2>&1`;
  const result = await execOnTarget(script, conn);
  return { success: result.code === 0, output: result.stdout, error: result.stderr };
}

/**
 * Install kubectl by downloading the static binary to /usr/local/bin/kubectl.
 * Idempotent: skips if kubectl is already present.
 */
export async function installKubectl(vps?: VpsConnection | null): Promise<BootstrapResult> {
  const conn = vps || (await getActiveVps().catch(() => null));
  if (!conn) return { success: false, output: "", error: "No VPS configured" };

  const allowed = await canInstallHostPackages(conn);
  if (!allowed.ok) return { success: false, output: "", error: allowed.reason || HOST_PACKAGE_BLOCKED };

  if (await isKubectlInstalled(conn)) {
    return { success: true, output: "kubectl is already installed", error: "" };
  }

  const arch = await execOnTarget("uname -m", conn);
  const kubeArch = arch.stdout.trim() === "aarch64" ? "arm64" : arch.stdout.trim() === "x86_64" ? "amd64" : arch.stdout.trim();
  const script = `curl -Lo /usr/local/bin/kubectl "https://dl.k8s.io/release/$(curl -Ls https://dl.k8s.io/release/stable.txt)/bin/linux/${shQuote(kubeArch)}/kubectl" && \
chmod +x /usr/local/bin/kubectl && /usr/local/bin/kubectl version --client 2>&1`;
  const result = await execOnTarget(script, conn);
  return { success: result.code === 0, output: result.stdout, error: result.stderr };
}

/**
 * Install Helm by downloading the static binary to /usr/local/bin/helm.
 * Idempotent: skips if helm is already present.
 */
export async function installHelm(vps?: VpsConnection | null): Promise<BootstrapResult> {
  const conn = vps || (await getActiveVps().catch(() => null));
  if (!conn) return { success: false, output: "", error: "No VPS configured" };

  const allowed = await canInstallHostPackages(conn);
  if (!allowed.ok) return { success: false, output: "", error: allowed.reason || HOST_PACKAGE_BLOCKED };

  if (await isHelmInstalled(conn)) {
    return { success: true, output: "helm is already installed", error: "" };
  }

  const arch = await execOnTarget("uname -m", conn);
  const helmArch = arch.stdout.trim() === "aarch64" ? "arm64" : arch.stdout.trim() === "x86_64" ? "amd64" : arch.stdout.trim();
  const script = `curl -fsSL -o /tmp/get_helm.sh https://raw.githubusercontent.com/helm/helm/main/scripts/get-helm-3 && \
chmod 700 /tmp/get_helm.sh && \
DESIRED_VERSION=v3.14.0 /tmp/get_helm.sh 2>&1 || \
(export HELM_INSTALL_DIR=/usr/local/bin && curl -fsSL https://get.helm.sh/helm-v3.14.0-linux-${shQuote(helmArch)}.tar.gz | tar -xzO linux-${shQuote(helmArch)}/helm > /usr/local/bin/helm && chmod +x /usr/local/bin/helm) 2>&1 && \
/usr/local/bin/helm version 2>&1`;
  const result = await execOnTarget(script, conn);
  return { success: result.code === 0, output: result.stdout, error: result.stderr };
}

export async function getCloudflaredContainerStatus(
  connectorName: string,
  vps?: VpsConnection | null
): Promise<{ running: boolean; status?: string }> {
  const conn = vps || (await getActiveVps().catch(() => null));
  if (!conn) return { running: false };
  const res = await execOnVps(
    `docker ps --filter "name=${shQuote(connectorName)}" --format "{{.Names}}|{{.Status}}|{{.State}}" 2>/dev/null || echo ""`
  );
  const line = res.stdout.trim().split("\n")[0];
  if (!line) return { running: false };
  const [, status, state] = line.split("|");
  return { running: state === "running", status };
}

export async function startCloudflaredConnector(
  connectorName: string,
  tunnelToken: string,
  vps?: VpsConnection | null
): Promise<BootstrapResult> {
  const conn = vps || (await getActiveVps().catch(() => null));
  if (!conn) return { success: false, output: "", error: "No VPS configured" };

  const cmd = [
    "docker rm -f",
    shQuote(connectorName),
    "2>/dev/null || true",
    "&&",
    "docker run -d --name",
    shQuote(connectorName),
    "--restart unless-stopped",
    "cloudflare/cloudflared:latest",
    "tunnel run --token",
    shQuote(tunnelToken),
  ].join(" ");
  const result = await execOnVps(cmd, conn);
  return { success: result.code === 0, output: result.stdout, error: result.stderr };
}

export async function stopCloudflaredConnector(
  connectorName: string,
  vps?: VpsConnection | null
): Promise<BootstrapResult> {
  const conn = vps || (await getActiveVps().catch(() => null));
  if (!conn) return { success: false, output: "", error: "No VPS configured" };
  const cmd = `docker stop ${shQuote(connectorName)} 2>/dev/null || true && docker rm ${shQuote(connectorName)} 2>/dev/null || true`;
  const result = await execOnVps(cmd, conn);
  return { success: result.code === 0, output: result.stdout, error: result.stderr };
}

/** @deprecated Use startCloudflaredConnector with a pre-fetched tunnel token. */
export async function runCloudflaredConnector(
  connectorName: string,
  tunnelId: string,
  tunnelSecret: string,
  vps?: VpsConnection | null
): Promise<BootstrapResult> {
  const token = Buffer.from(JSON.stringify({ a: tunnelId, s: tunnelSecret, id: tunnelId })).toString("base64url");
  return startCloudflaredConnector(connectorName, token, vps);
}
