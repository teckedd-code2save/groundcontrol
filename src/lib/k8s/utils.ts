/**
 * Kubernetes / k3s helpers shared across the deploy pipeline and API routes.
 */

import { execOnVps, shQuote, getActiveVps, type VpsConnection } from "@/lib/vps";
import { getServerIp } from "@/lib/bootstrap";
import type { K8sList, K8sNamespace, K8sService } from "./types";

export const K3S_KUBECONFIG = "/etc/rancher/k3s/k3s.yaml";

/**
 * Prefix any kubectl invocation with the k3s kubeconfig path.
 */
export function kubectlCommand(args: string): string {
  return `KUBECONFIG=${shQuote(K3S_KUBECONFIG)} kubectl ${args}`;
}

/**
 * Run kubectl on the target VPS using the k3s kubeconfig.
 */
export async function execKubectl(
  args: string,
  vps?: VpsConnection | null
): Promise<{ stdout: string; stderr: string; code: number }> {
  const conn = vps || (await getActiveVps().catch(() => null));
  if (!conn) {
    throw new Error("No VPS configured");
  }
  return execOnVps(kubectlCommand(args), conn);
}

/**
 * Resolve the public IP address of the active/target VPS.
 * Prefers external IP discovery services, falling back to the local interface
 * IP returned by {@link getServerIp} (the same logic used by /api/vps/ip).
 */
export async function getVpsPublicIp(vps?: VpsConnection | null): Promise<string> {
  const conn = vps || (await getActiveVps().catch(() => null));
  if (!conn) return "";

  const publicServices = ["ifconfig.me", "api.ipify.org", "icanhazip.com"];
  for (const svc of publicServices) {
    const res = await execOnVps(
      `curl -s --max-time 5 ${shQuote(svc)} 2>/dev/null || echo ""`,
      conn
    );
    const ip = res.stdout.trim();
    if (ip && /^\d+\.\d+\.\d+\.\d+$/.test(ip)) {
      return ip;
    }
  }

  return getServerIp(conn);
}

/**
 * List k3s namespaces whose names start with the GroundControl prefix.
 */
export async function listGcNamespaces(vps?: VpsConnection | null) {
  const res = await execKubectl("get namespaces -o json", vps);
  if (res.code !== 0) {
    throw new Error(res.stderr || "kubectl get namespaces failed");
  }
  const data = safeParseJson<K8sList<K8sNamespace>>(res.stdout);
  const items = Array.isArray(data?.items) ? data.items : [];
  return items.filter(
    (ns) => typeof ns?.metadata?.name === "string" && ns.metadata.name.startsWith("gc-")
  );
}

/**
 * Get the first LoadBalancer or NodePort URL for a k3s service, or null.
 */
export async function getK3sServiceUrl(
  namespace: string,
  name: string,
  vps?: VpsConnection | null
): Promise<string | null> {
  const res = await execKubectl(
    `get service ${shQuote(name)} -n ${shQuote(namespace)} -o json`,
    vps
  );
  if (res.code !== 0) return null;
  const svc = safeParseJson<K8sService>(res.stdout);

  const lb = svc?.status?.loadBalancer?.ingress?.[0];
  if (lb?.hostname) return `https://${lb.hostname}`;
  if (lb?.ip) return `https://${lb.ip}`;

  const ports = svc?.spec?.ports || [];
  const nodePort = ports.find((p) => typeof p.nodePort === "number")?.nodePort;
  if (nodePort) {
    const host = await getVpsPublicIp(vps);
    if (host) return `http://${host}:${nodePort}`;
  }

  return null;
}

/**
 * Get a NodePort or ingress-controller port suitable for a quick tunnel preview.
 * Returns the first NodePort found for the project's service, falling back to 80
 * so the tunnel points at the k3s ingress controller (e.g. Traefik).
 */
export async function getK3sPreviewPort(
  projectSlug: string,
  vps?: VpsConnection | null
): Promise<number | null> {
  const namespace = `gc-${projectSlug}`;
  const res = await execKubectl(
    `get service ${shQuote(projectSlug)} -n ${shQuote(namespace)} -o json`,
    vps
  );
  if (res.code === 0) {
    const svc = safeParseJson<K8sService>(res.stdout);
    const ports = svc?.spec?.ports || [];
    const nodePort = ports.find((p) => typeof p.nodePort === "number")?.nodePort;
    if (typeof nodePort === "number") return nodePort;
  }

  // Default to the ingress controller HTTP port on the host network.
  return 80;
}

function safeParseJson<T>(json?: string | null): T | null {
  if (!json) return null;
  try {
    return JSON.parse(json) as T;
  } catch {
    return null;
  }
}
