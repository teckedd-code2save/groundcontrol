export type TerraformProvider = "hetzner" | "aws" | "gcp" | "azure";
export type StateBackend = "local" | "s3" | "gcs";

export interface TerraformStack {
  id: number;
  name: string;
  /** hetzner | aws | gcp | azure */
  provider: string;
  workspace: string;
  hcl: string;
  /** encrypted JSON terraform.tfvars */
  varsJson: string;
  /** local | s3 | gcs */
  stateBackend: string;
  statePath?: string | null;
  lastPlan?: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export type StackVars = Record<string, unknown>;

export interface TerraformOutput {
  value: unknown;
  type?: string;
  sensitive?: boolean;
}

export interface InitResult {
  success: boolean;
  stdout: string;
  stderr: string;
  statePath?: string;
}

export interface PlanResult {
  success: boolean;
  stdout: string;
  stderr: string;
  planPath?: string;
}

export interface ApplyResult {
  success: boolean;
  stdout: string;
  stderr: string;
  outputs: Record<string, TerraformOutput>;
  statePath?: string;
}

export interface DestroyResult {
  success: boolean;
  stdout: string;
  stderr: string;
}
