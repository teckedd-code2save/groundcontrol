import { createComposeTarget } from "./compose";
import { createStaticTarget } from "./static";
import { createK3sTarget } from "./kubernetes";
import { createCloudRunTarget } from "./cloudrun";
import type { DeployTarget } from "./types";
import type { Project, DeploymentTarget } from "@prisma/client";

export type DeployTargetFactory = (
  project: Project,
  target: DeploymentTarget
) => DeployTarget;

export const deployTargets: Record<string, DeployTargetFactory> = {
  compose: createComposeTarget,
  static: createStaticTarget,
  k3s: createK3sTarget,
  cloudrun: createCloudRunTarget,
};

export function normalizeTargetType(type: string): string {
  if (type === "docker-compose") return "compose";
  return type;
}

export function createAdapter(
  project: Project,
  target: DeploymentTarget
): DeployTarget {
  const type = normalizeTargetType(target.type);
  const factory = deployTargets[type];
  if (!factory) {
    throw new Error(`Unknown deployment target type: ${target.type}`);
  }
  return factory(project, target);
}
