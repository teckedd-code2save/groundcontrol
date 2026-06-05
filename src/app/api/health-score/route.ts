import { NextRequest, NextResponse } from "next/server";
import { getSystemStats, getDockerContainers, getDockerStats, execOnVps, getSystemConfig } from "@/lib/vps";
import { requireAuth } from "@/lib/auth";

export async function GET(req: NextRequest) {
  try {
    await requireAuth(req);
    const config = await getSystemConfig();

    const [stats, containers, containerStats] = await Promise.all([
      getSystemStats(),
      getDockerContainers(),
      getDockerStats(),
    ]);

    const memPercent = parseFloat(stats.memory.percent);
    const diskPercent = parseFloat(stats.disk.percent);
    const loadAvg = stats.load[0] || 0;
    const cpuCount = stats.cpuCount || 1;

    const running = containers.filter((c) => c.state === "running").length;
    const total = containers.length;
    const unhealthy = containers.filter((c) => c.status.includes("unhealthy")).length;

    // Container health score (0-40)
    let containerScore = 40;
    if (total > 0) {
      const runningRatio = running / total;
      containerScore = Math.round(40 * runningRatio);
      if (unhealthy > 0) containerScore -= unhealthy * 5;
    }
    containerScore = Math.max(0, containerScore);

    // System health score (0-30)
    let systemScore = 30;
    if (memPercent > 90) systemScore -= 12;
    else if (memPercent > 80) systemScore -= 6;
    else if (memPercent > 70) systemScore -= 2;

    if (diskPercent > 90) systemScore -= 12;
    else if (diskPercent > 80) systemScore -= 6;
    else if (diskPercent > 70) systemScore -= 2;

    const loadRatio = loadAvg / cpuCount;
    if (loadRatio > 2) systemScore -= 6;
    else if (loadRatio > 1.5) systemScore -= 3;
    else if (loadRatio > 1) systemScore -= 1;

    systemScore = Math.max(0, systemScore);

    // Proxy health score (0-20)
    let proxyScore = 20;
    const caddyStatus = await execOnVps("systemctl is-active caddy 2>/dev/null || echo 'inactive'");
    if (caddyStatus.stdout.trim() !== "active") proxyScore -= 15;

    // Check SSL cert expiry (rough check)
    if (config.certDomain) {
      const certCheck = await execOnVps(
        `openssl x509 -in /etc/caddy/certs/${config.certDomain}.crt -noout -dates 2>/dev/null || echo 'notfound'`
      );
      if (certCheck.stdout.includes("notAfter")) {
        const notAfter = certCheck.stdout.match(/notAfter=(.+)/);
        if (notAfter) {
          const expiry = new Date(notAfter[1]);
          const daysUntil = Math.floor((expiry.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
          if (daysUntil < 7) proxyScore -= 5;
        }
      }
    }
    proxyScore = Math.max(0, proxyScore);

    // Security score (0-10)
    let securityScore = 10;
    // Check if SSH password auth is enabled (heuristic)
    const sshConfig = await execOnVps("grep -i '^PasswordAuthentication yes' /etc/ssh/sshd_config 2>/dev/null || echo 'safe'");
    if (sshConfig.stdout.includes("yes")) securityScore -= 5;

    // Check for exposed sensitive ports
    const exposedPorts = await execOnVps("ss -tlnp | grep -E ':(22|23|25|110|143|3306|5432|6379|27017|9200)' 2>/dev/null || echo 'safe'");
    if (!exposedPorts.stdout.includes("safe")) {
      const lines = exposedPorts.stdout.trim().split("\n").filter((l) => l.includes("LISTEN"));
      securityScore -= Math.min(lines.length * 2, 5);
    }
    securityScore = Math.max(0, securityScore);

    const totalScore = containerScore + systemScore + proxyScore + securityScore;

    // Auto-fix suggestions
    const fixes: { label: string; action: string; target?: string; href?: string }[] = [];

    if (unhealthy > 0) {
      const unhealthyNames = containers
        .filter((c) => c.status.includes("unhealthy"))
        .map((c) => c.name);
      unhealthyNames.forEach((name) => {
        fixes.push({ label: `Restart ${name}`, action: "restart", target: name, href: "/containers" });
      });
    }

    if (diskPercent > 80) {
      fixes.push({ label: "Prune Docker system", action: "prune", href: "/containers" });
    }

    if (memPercent > 85 && containerStats.length > 0) {
      const topMem = [...containerStats].sort((a, b) => {
        const getMem = (s: string) => parseFloat(s.replace(/[^0-9.]/g, "")) || 0;
        return getMem(b.mem) - getMem(a.mem);
      })[0];
      if (topMem) {
        fixes.push({ label: `Restart top memory consumer (${topMem.name})`, action: "restart", target: topMem.name, href: "/containers" });
      }
    }

    if (total > 0 && running < total) {
      const stopped = containers.filter((c) => c.state !== "running").map((c) => c.name);
      stopped.forEach((name) => {
        fixes.push({ label: `Start ${name}`, action: "start", target: name, href: "/containers" });
      });
    }

    return NextResponse.json({
      score: totalScore,
      max: 100,
      breakdown: {
        containers: { score: containerScore, max: 40 },
        system: { score: systemScore, max: 30 },
        proxy: { score: proxyScore, max: 20 },
        security: { score: securityScore, max: 10 },
      },
      metrics: {
        memPercent,
        diskPercent,
        loadRatio: loadAvg / cpuCount,
        runningContainers: running,
        totalContainers: total,
        unhealthyContainers: unhealthy,
      },
      fixes: fixes.slice(0, 5),
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
