import type { Project, Deployment } from "@prisma/client";
import type { VpsConnection } from "@/lib/vps";

export interface DeployContext {
  vps: VpsConnection | null;
  project?: Project;
  env: Record<string, string>;
  secrets: Record<string, string>;
  branch?: string;
  log(chunk: string): void;
  abortSignal?: AbortSignal;
}

export interface DeployBuildResult {
  imageTag?: string;
  outputDir?: string;
}

export interface DeployResult {
  publicUrl?: string;
  previewUrl?: string;
}

export interface DeployTarget {
  type: string;

  /** One-time setup for the target (e.g. clone repo, prepare directories). */
  prepare(ctx: DeployContext): Promise<void>;

  /** Build the project and return build metadata. */
  build(project: Project, ctx: DeployContext): Promise<DeployBuildResult>;

  /** Deploy a specific deployment and return reachable URLs. */
  deploy(
    project: Project,
    deployment: Deployment,
    ctx: DeployContext
  ): Promise<DeployResult>;

  /** Roll back a previously deployed deployment. */
  rollback(deployment: Deployment, ctx: DeployContext): Promise<void>;

  /** Tear down everything for the project on this target. */
  destroy(project: Project, ctx: DeployContext): Promise<void>;
}

export type AnyDeployTarget = DeployTarget;
