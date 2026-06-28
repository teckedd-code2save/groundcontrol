// src/lib/deep-probe.ts
//
// Unified deep probe that discovers everything about the target VPS:
// OS, Docker, reverse proxy, running containers, projects, and generates
// a list of clarifying questions for anything it couldn't determine.

import { probeServerLayout, type ServerLayout } from "./server-probe";
import { getHostCapabilities } from "./host-capabilities";
import { probeContainers, type DiscoveredContainer } from "./probe-containers";
import { probeReverseProxy, type DiscoveredProxy } from "./probe-reverse-proxy";
import { probeProjects, type DiscoveredProject } from "./probe-projects";

export interface DiscoveryQuestion {
  id: string;
  category: "paths" | "proxy" | "dns" | "access" | "other";
  question: string;
  context: string;
  suggestions: string[];
}

export interface DeepProbeResult {
  layout: ServerLayout | null;
  reverseProxy: DiscoveredProxy;
  containers: DiscoveredContainer[];
  projects: DiscoveredProject[];
  questions: DiscoveryQuestion[];
  summary: string;
  error?: string;
}

export async function deepProbe(): Promise<DeepProbeResult> {
  const [layout, host, containers, reverseProxy, projects] = await Promise.all([
    probeServerLayout().catch(() => null),
    getHostCapabilities().catch(() => null),
    probeContainers().catch(() => [] as DiscoveredContainer[]),
    probeReverseProxy().catch(() => ({ 
      type: "none" as const, configPaths: [], listening: { port80: false, port443: false } 
    })),
    probeProjects().catch(() => [] as DiscoveredProject[]),
  ]);

  const questions = generateQuestions(layout, reverseProxy, containers, projects);

  const summary = buildSummary(layout, reverseProxy, containers, projects, questions);

  return { layout, reverseProxy, containers, projects, questions, summary };
}

function generateQuestions(
  layout: ServerLayout | null,
  proxy: DiscoveredProxy,
  containers: DiscoveredContainer[],
  projects: DiscoveredProject[]
): DiscoveryQuestion[] {
  const questions: DiscoveryQuestion[] = [];

  // Proxy running but config not found
  if (proxy.type !== "none" && proxy.type !== "unknown" && proxy.configPaths.length === 0) {
    questions.push({
      id: "proxy-config-path",
      category: "proxy",
      question: `I found ${proxy.type} running, but can't locate its configuration. Where is it?`,
      context: `${proxy.type} process detected, config not in standard paths`,
      suggestions: proxy.type === "traefik"
        ? ["/opt/traefik/traefik.yml", "/home/deploy/traefik.yml", "Docker labels only, no file config"]
        : proxy.type === "caddy"
        ? ["/etc/caddy/Caddyfile", "/etc/caddy/sites/*"]
        : ["/etc/nginx/nginx.conf", "/etc/nginx/conf.d/*"],
    });
  }

  // Unknown process on 80/443
  if (proxy.type === "unknown") {
    questions.push({
      id: "unknown-proxy",
      category: "proxy",
      question: "Something is listening on port 80/443 but I can't identify it. What reverse proxy do you use?",
      context: "Process on port 80/443 doesn't match known proxy processes",
      suggestions: ["Caddy", "Nginx", "Traefik", "HAProxy", "Apache", "None — my app listens directly", "I don't know"],
    });
  }

  // No reverse proxy found
  if (proxy.type === "none" && !proxy.listening.port80 && !proxy.listening.port443) {
    questions.push({
      id: "no-proxy",
      category: "proxy",
      question: "No reverse proxy detected. Do you use one, or do your apps listen directly?",
      context: "No proxy process found, nothing listening on 80/443",
      suggestions: ["I don't use a reverse proxy", "Caddy", "Nginx", "Traefik", "Cloudflare Tunnel", "I'll set one up later"],
    });
  }

  // Containers without compose project labels
  const manualContainers = containers.filter(c => !c.composeProject);
  if (manualContainers.length > 0 && manualContainers.length <= 5) {
    questions.push({
      id: "manual-containers",
      category: "other",
      question: `Found ${manualContainers.length} container(s) without compose labels: ${manualContainers.map(c => c.name).join(", ")}. How are these managed?`,
      context: `Containers: ${manualContainers.map(c => `${c.name} (${c.image})`).join(", ")}`,
      suggestions: ["Docker run commands / scripts", "Systemd services", "Portainer", "They're part of a compose project but labels are missing"],
    });
  }

  // Compose projects but no running containers for them
  for (const proj of projects) {
    const hasRunning = containers.some(c => 
      c.composeProject?.toLowerCase() === proj.path.split("/").pop()?.toLowerCase()
    );
    if (!hasRunning && proj.composeServices.length > 0) {
      questions.push({
        id: `project-down-${proj.path.split("/").pop()}`,
        category: "other",
        question: `Found compose project "${proj.path}" with services [${proj.composeServices.join(", ")}] but no running containers. Should this be running?`,
        context: `Project at ${proj.path} has compose file but no live containers`,
        suggestions: ["Yes, start it", "No, it's intentional", "It's a template/reference"],
      });
      break; // Only ask once about the first stopped project
    }
  }

  return questions;
}

function buildSummary(
  layout: ServerLayout | null,
  proxy: DiscoveredProxy,
  containers: DiscoveredContainer[],
  projects: DiscoveredProject[],
  questions: DiscoveryQuestion[]
): string {
  const lines: string[] = [];

  if (layout) {
    lines.push(`OS: ${layout.osName || "unknown"} (${layout.osFamily})`);
    lines.push(`Docker: ${layout.dockerAvailable ? "installed" : "not installed"}`);
  }
  
  lines.push(`Reverse proxy: ${proxy.type === "none" ? "none" : proxy.type + (proxy.configPaths.length ? ` at ${proxy.configPaths[0]}` : "")}`);
  lines.push(`Containers: ${containers.length} running`);
  
  if (projects.length > 0) {
    const projectNames = projects.map(p => p.path.split("/").pop()).join(", ");
    lines.push(`Projects: ${projects.length} found (${projectNames})`);
  }

  if (questions.length > 0) {
    lines.push(`\n${questions.length} question(s) to clarify:`);
    for (const q of questions) {
      lines.push(`  • ${q.question}`);
    }
  }

  return lines.join("\n");
}
