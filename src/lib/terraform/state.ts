import { encrypt, decrypt } from "@/lib/crypto";
import { execOnVps, shQuote, type VpsConnection } from "@/lib/vps";
import type { TerraformStack, StackVars } from "./types";

function getStackWorkspaceDir(stack: TerraformStack): string {
  return `/tmp/gc-terraform-${stack.id}/${stack.workspace}`;
}

function hclString(value: string): string {
  const escaped = value
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r")
    .replace(/\${/g, () => "$${")
    .replace(/%{/g, () => "%%{");
  return `"${escaped}"`;
}

export interface StateBackendPrep {
  backendHcl?: string;
  backendArgs: string[];
  env: Record<string, string>;
  statePath: string;
}

export function encryptTfvars(vars: StackVars): string {
  return encrypt(JSON.stringify(vars));
}

export function decryptTfvars(encrypted: string): StackVars {
  const raw = decrypt(encrypted);
  if (!raw) return {};
  try {
    return JSON.parse(raw) as StackVars;
  } catch {
    return {};
  }
}

export function prepareStateBackend(
  stack: TerraformStack,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _vps?: VpsConnection | null
): StateBackendPrep {
  const vars = decryptTfvars(stack.varsJson);
  const workDir = getStackWorkspaceDir(stack);
  const baseName = `${stack.name || "stack"}-${stack.id}`;

  if (stack.stateBackend === "s3") {
    const bucket = String(vars.stateBucket ?? vars.bucket ?? "");
    const key = String(
      vars.stateKey ?? `gc-terraform/${baseName}/${stack.workspace}/terraform.tfstate`
    );
    const region = String(vars.region ?? vars.aws_region ?? "us-east-1");

    const backendHcl = `terraform {
  backend "s3" {
    bucket  = ${hclString(bucket)}
    key     = ${hclString(key)}
    region  = ${hclString(region)}
    encrypt = true
  }
}
`;
    const env: Record<string, string> = {};
    if (vars.aws_access_key_id) env.AWS_ACCESS_KEY_ID = String(vars.aws_access_key_id);
    if (vars.aws_secret_access_key) env.AWS_SECRET_ACCESS_KEY = String(vars.aws_secret_access_key);
    if (vars.aws_session_token) env.AWS_SESSION_TOKEN = String(vars.aws_session_token);
    env.AWS_DEFAULT_REGION = region;
    return {
      backendHcl,
      backendArgs: [],
      env,
      statePath: `s3://${bucket}/${key}`,
    };
  }

  if (stack.stateBackend === "gcs") {
    const bucket = String(vars.stateBucket ?? vars.bucket ?? "");
    const prefix = String(
      vars.statePrefix ?? `gc-terraform/${baseName}/${stack.workspace}`
    );

    const backendHcl = `terraform {
  backend "gcs" {
    bucket = ${hclString(bucket)}
    prefix = ${hclString(prefix)}
  }
}
`;
    const env: Record<string, string> = {};
    if (vars.gcp_credentials ?? vars.google_credentials) {
      env.GOOGLE_CREDENTIALS = String(vars.gcp_credentials ?? vars.google_credentials);
    }
    if (vars.project_id ?? vars.gcp_project_id) {
      env.GOOGLE_PROJECT = String(vars.project_id ?? vars.gcp_project_id);
    }
    return {
      backendHcl,
      backendArgs: [],
      env,
      statePath: `gs://${bucket}/${prefix}/terraform.tfstate`,
    };
  }

  // local backend (default)
  return {
    backendArgs: [],
    env: {},
    statePath: stack.statePath ?? `${workDir}/terraform.tfstate`,
  };
}

export async function readLocalState(
  stack: TerraformStack,
  vps?: VpsConnection | null
): Promise<string | null> {
  if (stack.stateBackend !== "local") return null;
  const workDir = getStackWorkspaceDir(stack);
  const statePath = stack.statePath ?? `${workDir}/terraform.tfstate`;
  const result = await execOnVps(`cat ${shQuote(statePath)} 2>/dev/null || true`, vps);
  if (result.code !== 0) return null;
  const trimmed = result.stdout.trim();
  return trimmed || null;
}

export function encryptState(stateJson: string): string {
  return encrypt(stateJson);
}

export function decryptState(encrypted: string): string {
  return decrypt(encrypted);
}

export async function backupLocalState(
  stack: TerraformStack,
  vps?: VpsConnection | null
): Promise<string | null> {
  const state = await readLocalState(stack, vps);
  if (!state) return null;
  return encryptState(state);
}
