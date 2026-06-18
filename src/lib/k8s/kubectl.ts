import { execOnVps, shQuote, type VpsConnection } from "@/lib/vps";

export const KUBECONFIG_PATH = "/etc/rancher/k3s/k3s.yaml";

export function getKubectlPrefix(): string {
  return `export KUBECONFIG=${shQuote(KUBECONFIG_PATH)};`;
}

function looksLikeYaml(input: string): boolean {
  const trimmed = input.trim();
  return (
    trimmed.includes("\n") ||
    trimmed.startsWith("apiVersion:") ||
    trimmed.startsWith("kind:")
  );
}

export async function runKubectl(
  yamlOrArgs: string,
  vps?: VpsConnection | null
) {
  const prefix = getKubectlPrefix();

  if (looksLikeYaml(yamlOrArgs)) {
    const result = await execOnVps(
      `printf '%s' ${shQuote(yamlOrArgs)} | ${prefix} kubectl apply -f -`,
      vps
    );
    if (result.code !== 0) {
      throw new Error(result.stderr || "kubectl apply failed");
    }
    return result;
  }

  const result = await execOnVps(`${prefix} kubectl ${yamlOrArgs}`, vps);
  if (result.code !== 0) {
    throw new Error(result.stderr || `kubectl ${yamlOrArgs} failed`);
  }
  return result;
}

export async function getIngressHost(
  namespace: string,
  name: string,
  vps?: VpsConnection | null
): Promise<string | undefined> {
  const prefix = getKubectlPrefix();
  const result = await execOnVps(
    `${prefix} kubectl get ingress ${shQuote(name)} -n ${shQuote(
      namespace
    )} -o jsonpath=${shQuote(
      "{.status.loadBalancer.ingress[0].hostname}{.status.loadBalancer.ingress[0].ip}"
    )} 2>/dev/null || echo ""`,
    vps
  );
  const host = result.stdout.trim();
  return host || undefined;
}

export async function getServiceUrl(
  namespace: string,
  name: string,
  vps?: VpsConnection | null
): Promise<string | undefined> {
  const prefix = getKubectlPrefix();
  const hostResult = await execOnVps(
    `${prefix} kubectl get service ${shQuote(name)} -n ${shQuote(
      namespace
    )} -o jsonpath=${shQuote(
      "{.status.loadBalancer.ingress[0].hostname}{.status.loadBalancer.ingress[0].ip}"
    )} 2>/dev/null || echo ""`,
    vps
  );
  const host = hostResult.stdout.trim();
  if (!host) return undefined;

  const portResult = await execOnVps(
    `${prefix} kubectl get service ${shQuote(name)} -n ${shQuote(
      namespace
    )} -o jsonpath=${shQuote("{.spec.ports[0].port}")} 2>/dev/null || echo ""`,
    vps
  );
  const port = portResult.stdout.trim();
  return port ? `http://${host}:${port}` : `http://${host}`;
}
