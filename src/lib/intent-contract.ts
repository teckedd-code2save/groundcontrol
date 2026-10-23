import { parse } from "yaml";
import type { ProjectTopology } from "./topology";

export type IntentRisk = "read" | "mutate" | "high";

export interface GroundControlIntentService {
  name: string;
  image?: string;
  port?: number;
  health?: { path: string };
  dependsOn?: string[];
}

export interface GroundControlIntent {
  version: "v1";
  project: string;
  domains?: string[];
  services: GroundControlIntentService[];
  policy?: {
    restart?: "allow" | "approve" | "deny";
    redeploy?: "allow" | "approve" | "deny";
    dns?: "allow" | "approve" | "deny";
    destructive?: "allow" | "approve" | "deny";
  };
}

export interface DriftEvidence {
  source: "manifest" | "topology" | "proxy";
  detail: string;
}

export interface DriftFinding {
  code: "project_missing" | "service_missing" | "port_mismatch" | "domain_missing";
  service?: string;
  expected: string;
  observed: string;
  risk: IntentRisk;
  evidence: DriftEvidence[];
  proposedAction: string;
  reversible: boolean;
}

function ensureString(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`groundcontrol.yaml: ${field} must be a non-empty string`);
  }
  return value.trim();
}

export function parseGroundControlIntent(input: string): GroundControlIntent {
  const raw = parse(input) as Record<string, unknown> | null;
  if (!raw || typeof raw !== "object") {
    throw new Error("groundcontrol.yaml: expected an object");
  }
  if (raw.version !== "v1") {
    throw new Error("groundcontrol.yaml: version must be v1");
  }
  const project = ensureString(raw.project, "project");
  if (!Array.isArray(raw.services) || raw.services.length === 0) {
    throw new Error("groundcontrol.yaml: services must contain at least one service");
  }

  const names = new Set<string>();
  const services = raw.services.map((value, index) => {
    if (!value || typeof value !== "object") {
      throw new Error(`groundcontrol.yaml: services[${index}] must be an object`);
    }
    const item = value as Record<string, unknown>;
    const name = ensureString(item.name, `services[${index}].name`);
    if (names.has(name)) throw new Error(`groundcontrol.yaml: duplicate service ${name}`);
    names.add(name);

    const service: GroundControlIntentService = { name };
    if (item.image !== undefined) service.image = ensureString(item.image, `services[${index}].image`);
    if (item.port !== undefined) {
      if (!Number.isInteger(item.port) || Number(item.port) <= 0 || Number(item.port) > 65535) {
        throw new Error(`groundcontrol.yaml: services[${index}].port must be a valid TCP port`);
      }
      service.port = Number(item.port);
    }
    if (item.health !== undefined) {
      if (!item.health || typeof item.health !== "object") {
        throw new Error(`groundcontrol.yaml: services[${index}].health must be an object`);
      }
      service.health = {
        path: ensureString((item.health as Record<string, unknown>).path, `services[${index}].health.path`),
      };
    }
    if (item.dependsOn !== undefined) {
      if (!Array.isArray(item.dependsOn) || item.dependsOn.some(v => typeof v !== "string")) {
        throw new Error(`groundcontrol.yaml: services[${index}].dependsOn must be a string array`);
      }
      service.dependsOn = item.dependsOn as string[];
    }
    return service;
  });

  const domains = raw.domains === undefined
    ? undefined
    : Array.isArray(raw.domains) && raw.domains.every(v => typeof v === "string")
      ? raw.domains as string[]
      : (() => { throw new Error("groundcontrol.yaml: domains must be a string array"); })();

  return {
    version: "v1",
    project,
    services,
    ...(domains ? { domains } : {}),
    ...(raw.policy && typeof raw.policy === "object"
      ? { policy: raw.policy as GroundControlIntent["policy"] }
      : {}),
  };
}

function declaredPorts(ports: string[]): number[] {
  return ports
    .flatMap(value => value.split(":"))
    .map(value => Number(value.replace(/\/tcp$|\/udp$/i, "")))
    .filter(value => Number.isInteger(value) && value > 0 && value <= 65535);
}

export function detectIntentDrift(
  intent: GroundControlIntent,
  topology: ProjectTopology,
): DriftFinding[] {
  const findings: DriftFinding[] = [];
  const project = topology.projects.find(
    p => p.slug === intent.project || p.name === intent.project || p.slug.endsWith(`/${intent.project}`),
  );

  if (!project) {
    return [{
      code: "project_missing",
      expected: intent.project,
      observed: "not present in live topology",
      risk: "mutate",
      evidence: [
        { source: "manifest", detail: `project=${intent.project}` },
        { source: "topology", detail: "no matching project node" },
      ],
      proposedAction: "inspect repository/deployment target before creating any runtime resources",
      reversible: true,
    }];
  }

  for (const expected of intent.services) {
    const live = project.services.find(service => service.service === expected.name);
    if (!live) {
      findings.push({
        code: "service_missing",
        service: expected.name,
        expected: "service present",
        observed: "service absent",
        risk: "mutate",
        evidence: [
          { source: "manifest", detail: `service=${expected.name}` },
          { source: "topology", detail: `project=${project.slug} has no matching service` },
        ],
        proposedAction: `prepare a reversible deploy/restart plan for service ${expected.name}`,
        reversible: true,
      });
      continue;
    }

    if (expected.port !== undefined) {
      const livePorts = declaredPorts(live.ports);
      if (!livePorts.includes(expected.port)) {
        findings.push({
          code: "port_mismatch",
          service: expected.name,
          expected: String(expected.port),
          observed: live.ports.length ? live.ports.join(", ") : "no declared port",
          risk: "high",
          evidence: [
            { source: "manifest", detail: `port=${expected.port}` },
            { source: "topology", detail: `ports=${live.ports.join(",") || "none"}` },
          ],
          proposedAction: "reconcile service port and reverse-proxy target, then verify the customer-facing journey",
          reversible: true,
        });
      }
    }
  }

  for (const domain of intent.domains ?? []) {
    const exists = project.sites.some(site => site.domain.toLowerCase() === domain.toLowerCase());
    if (!exists) {
      findings.push({
        code: "domain_missing",
        expected: domain,
        observed: "no matching proxy site",
        risk: "high",
        evidence: [
          { source: "manifest", detail: `domain=${domain}` },
          { source: "proxy", detail: `project=${project.slug} has no matching site` },
        ],
        proposedAction: "prepare DNS/proxy mutation for approval, then verify HTTPS and the declared journey",
        reversible: true,
      });
    }
  }

  return findings;
}
