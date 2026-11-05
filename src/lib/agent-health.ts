import { isIP } from "node:net";
import { lookup } from "node:dns/promises";
import { shQuote, getDockerComposeCommand, buildManagedComposeInvocation, type VpsConnection } from "@/lib/vps";
import { composeDirectory, deploymentRuntime, jsonObject, type AgentRuntimeDeployment } from "./agent-runtime-capabilities";
import { execOnWorkloadTarget } from "./host-exec";

export async function agentComposeCommand(deployment: AgentRuntimeDeployment, vps: VpsConnection, args: string) {
  const directory = composeDirectory(deployment);
  if (!directory) throw new Error("No Compose directory is recorded.");
  const command = await getDockerComposeCommand(vps, execOnWorkloadTarget);
  const project = jsonObject(deployment.metadataJson).composeProject;
  const namedCommand = typeof project === "string" && project ? `${command} -p ${shQuote(project)}` : command;
  return `cd ${shQuote(directory)} && ${buildManagedComposeInvocation(namedCommand, args, deployment.composePath || undefined)}`;
}

export async function runtimeHealth(deployment: AgentRuntimeDeployment, vps: VpsConnection | null) {
  const kind = deploymentRuntime(deployment);
  const unknown = (reason: string) => ({ kind, checked: false, healthy: null, containers: [], reason });
  if (kind === "static") return unknown("Static files have no container runtime; consult the public endpoint result.");
  if (kind === "unsupported") return unknown("No runtime health adapter is available.");
  if (!vps) return unknown("No deployment host is recorded.");
  try {
    let names: string[];
    if (kind === "container") names = [deployment.containerName!];
    else {
      const ids = await execOnWorkloadTarget(await agentComposeCommand(deployment, vps, "ps -a -q"), vps);
      if (ids.code !== 0) return unknown("Compose runtime could not be inspected.");
      names = ids.stdout.trim().split(/\s+/).filter(Boolean);
      if (names.some((id) => !/^[a-f0-9]{12,64}$/.test(id))) return unknown("Compose returned invalid container identifiers.");
    }
    if (!names.length) return { kind, checked: true, healthy: false, containers: [], reason: "No runtime containers were found." };
    // Request only health evidence, never container environment or host secrets.
    const inspected = await execOnWorkloadTarget(`docker inspect --format '{{json .Name}}|{{json .Config.Image}}|{{json .State.Status}}|{{if .State.Health}}{{json .State.Health.Status}}{{else}}null{{end}}' ${names.map(shQuote).join(" ")}`, vps);
    if (inspected.code !== 0) return unknown("The enrolled container runtime could not be inspected.");
    const containers = inspected.stdout.trim().split("\n").filter(Boolean).map((line) => {
      const [name, image, state, health] = line.split("|").map((part) => JSON.parse(part));
      return { name: String(name).replace(/^\//, ""), image: String(image), state: String(state), health: health as string | null };
    });
    if (containers.length !== names.length) return unknown("Incomplete container inspection evidence.");
    return { kind, checked: true, healthy: containers.every((c) => c.state === "running" && (!c.health || c.health === "healthy")), containers };
  } catch {
    return unknown("Runtime inspection failed; health is unknown.");
  }
}

export function overallHealth(runtime: { kind: string; healthy: boolean | null }, publicProbe: { checked: boolean; healthy?: boolean }) {
  if (runtime.healthy === false || (publicProbe.checked && publicProbe.healthy === false)) return false;
  if (runtime.kind === "static") return publicProbe.checked ? publicProbe.healthy ?? null : null;
  // A reachable endpoint alone does not verify an unknown container runtime.
  if (runtime.healthy !== true || !publicProbe.checked) return null;
  return publicProbe.healthy === true;
}

function isPrivateAddress(address: string): boolean {
  const normalized = address.replace(/^::ffff:/, "");
  if (normalized === "::1") return true;
  if (isIP(normalized) === 4) {
    const [a, b] = normalized.split(".").map(Number);
    return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
  }
  return /^(?:fc|fd|fe8|fe9|fea|feb)/i.test(normalized);
}

export async function probePublicUrl(value: string | null) {
  if (!value) return { checked: false, reason: "No public URL recorded" };
  try {
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || isPrivateAddress(url.hostname) || url.hostname === "localhost") {
      return { checked: false, reason: "Public verification URL is not eligible for external probing" };
    }
    const addresses = await lookup(url.hostname, { all: true });
    if (!addresses.length || addresses.some((address) => isPrivateAddress(address.address))) {
      return { checked: false, reason: "Public verification URL resolves to a private address" };
    }
    const response = await fetch(url, { method: "GET", redirect: "manual", signal: AbortSignal.timeout(8000) });
    return {
      checked: true,
      url: url.toString(),
      status: response.status,
      healthy: response.status >= 200 && response.status < 300,
    };
  } catch (error) {
    return { checked: true, healthy: false, error: error instanceof Error ? error.message : String(error) };
  }
}
