// src/lib/probe-containers.ts
//
// Discover every running Docker container on the target VPS.
// Returns container name, image, ports, compose project label,
// and any Convoy deployment labels (plan-id, repo).

import { execOnTarget } from "./host-exec";

export interface DiscoveredContainer {
  name: string;
  image: string;
  ports: string[];
  state: string;
  status: string;
  composeProject?: string;
  composeService?: string;
  composeWorkingDir?: string;
  /** Convoy plan ID if this container was deployed by Convoy. */
  convoyPlanId?: string;
  /** Convoy repo if this was deployed by Convoy. */
  convoyRepo?: string;
}

export async function probeContainers(): Promise<DiscoveredContainer[]> {
  const result = await execOnTarget(
    `docker ps --format '{{json .}}' 2>/dev/null || echo ""`
  );

  if (!result.stdout.trim()) return [];

  try {
    const containers: DiscoveredContainer[] = [];
    for (const line of result.stdout.trim().split("\n")) {
      if (!line.trim()) continue;
      const raw = JSON.parse(line);
      
      const labels = parseDockerLabels(raw.Labels || "");
      const ports = raw.Ports 
        ? raw.Ports.split(", ")
            .filter(Boolean)
            .map((p: string) => p.replace(/^[0-9.]+:/, "").replace(/->.*$/, ""))
        : [];

      containers.push({
        name: raw.Names || "",
        image: raw.Image || "",
        ports,
        state: raw.State || "unknown",
        status: raw.Status || "",
        composeProject: labels["com.docker.compose.project"],
        composeService: labels["com.docker.compose.service"],
        composeWorkingDir: labels["com.docker.compose.project.working_dir"],
        convoyPlanId: labels["com.convoy.plan-id"],
        convoyRepo: labels["com.convoy.repo"],
      });
    }
    return containers;
  } catch {
    return [];
  }
}

function parseDockerLabels(raw: string): Record<string, string> {
  const labels: Record<string, string> = {};
  for (const part of raw.split(",")) {
    const eq = part.indexOf("=");
    if (eq > 0) labels[part.slice(0, eq).trim()] = part.slice(eq + 1).trim();
  }
  return labels;
}
