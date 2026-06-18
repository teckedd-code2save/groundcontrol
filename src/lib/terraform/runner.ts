import { execOnVps, shQuote, type VpsConnection } from "@/lib/vps";
import { prepareStateBackend, decryptTfvars } from "./state";
import type {
  TerraformStack,
  InitResult,
  PlanResult,
  ApplyResult,
  DestroyResult,
  TerraformOutput,
} from "./types";

export function getWorkspaceDir(stack: TerraformStack): string {
  return `/tmp/gc-terraform-${stack.id}/${stack.workspace}`;
}

function getMainTfPath(stack: TerraformStack): string {
  return `${getWorkspaceDir(stack)}/main.tf`;
}

function getTfvarsPath(stack: TerraformStack): string {
  return `${getWorkspaceDir(stack)}/terraform.tfvars.json`;
}

async function writeFileOnVps(
  filePath: string,
  content: string,
  vps?: VpsConnection | null
): Promise<void> {
  const encoded = Buffer.from(content, "utf8").toString("base64");
  const lastSlash = filePath.lastIndexOf("/");
  const dir = lastSlash > 0 ? filePath.slice(0, lastSlash) : "/";
  await execOnVps(
    `mkdir -p ${shQuote(dir)} && printf '%s' ${shQuote(encoded)} | (base64 -d 2>/dev/null || base64 -D) > ${shQuote(filePath)}`,
    vps
  );
}

async function writeWorkspaceFiles(
  stack: TerraformStack,
  vps?: VpsConnection | null
): Promise<{ statePath: string }> {
  const backend = prepareStateBackend(stack, vps);
  const hcl = backend.backendHcl
    ? `${backend.backendHcl}\n${stack.hcl}`
    : stack.hcl;

  await writeFileOnVps(getMainTfPath(stack), hcl, vps);

  const vars = decryptTfvars(stack.varsJson);
  await writeFileOnVps(getTfvarsPath(stack), JSON.stringify(vars), vps);

  return { statePath: backend.statePath };
}

function buildEnvPrefix(env: Record<string, string>): string {
  const parts: string[] = [];
  for (const [key, value] of Object.entries(env)) {
    if (value === "") continue;
    parts.push(`export ${key}=${shQuote(value)}`);
  }
  return parts.join("; ");
}

async function runTerraformCommand(
  stack: TerraformStack,
  command: string,
  vps?: VpsConnection | null,
  env: Record<string, string> = {}
): Promise<{ stdout: string; stderr: string; code: number }> {
  const envPrefix = buildEnvPrefix(env);
  const fullCommand = envPrefix ? `${envPrefix}; ${command}` : command;
  return execOnVps(fullCommand, vps, getWorkspaceDir(stack));
}

export async function runTerraformInit(
  stack: TerraformStack,
  vps?: VpsConnection | null
): Promise<InitResult> {
  const { statePath } = await writeWorkspaceFiles(stack, vps);
  const backend = prepareStateBackend(stack, vps);
  const backendArgs = backend.backendArgs.length
    ? " " + backend.backendArgs.map(shQuote).join(" ")
    : "";

  const result = await runTerraformCommand(
    stack,
    `terraform init -input=false -no-color${backendArgs}`,
    vps,
    backend.env
  );

  return {
    success: result.code === 0,
    stdout: result.stdout,
    stderr: result.stderr,
    statePath,
  };
}

export async function runTerraformPlan(
  stack: TerraformStack,
  vps?: VpsConnection | null
): Promise<PlanResult> {
  const init = await runTerraformInit(stack, vps);
  if (!init.success) {
    return {
      success: false,
      stdout: init.stdout,
      stderr: init.stderr,
    };
  }

  const backend = prepareStateBackend(stack, vps);
  const tfvarsPath = getTfvarsPath(stack);
  const planPath = `${getWorkspaceDir(stack)}/plan.out`;
  const result = await runTerraformCommand(
    stack,
    `terraform plan -input=false -no-color -var-file=${shQuote(tfvarsPath)} -out=${shQuote(planPath)}`,
    vps,
    backend.env
  );

  return {
    success: result.code === 0,
    stdout: result.stdout,
    stderr: result.stderr,
    planPath: result.code === 0 ? planPath : undefined,
  };
}

export async function runTerraformApply(
  stack: TerraformStack,
  vps?: VpsConnection | null
): Promise<ApplyResult> {
  const plan = await runTerraformPlan(stack, vps);
  if (!plan.success || !plan.planPath) {
    return {
      success: false,
      outputs: {},
      stdout: plan.stdout,
      stderr: plan.stderr,
    };
  }

  const backend = prepareStateBackend(stack, vps);
  const applyResult = await runTerraformCommand(
    stack,
    `terraform apply -auto-approve -input=false -no-color ${shQuote(plan.planPath)}`,
    vps,
    backend.env
  );

  if (applyResult.code !== 0) {
    return {
      success: false,
      outputs: {},
      stdout: applyResult.stdout,
      stderr: applyResult.stderr,
    };
  }

  const outputs = await getTerraformOutputs(stack, vps);

  return {
    success: true,
    outputs,
    stdout: applyResult.stdout,
    stderr: applyResult.stderr,
    statePath: backend.statePath,
  };
}

export async function runTerraformDestroy(
  stack: TerraformStack,
  vps?: VpsConnection | null
): Promise<DestroyResult> {
  await writeWorkspaceFiles(stack, vps);
  const backend = prepareStateBackend(stack, vps);
  const tfvarsPath = getTfvarsPath(stack);

  const result = await runTerraformCommand(
    stack,
    `terraform destroy -auto-approve -input=false -no-color -var-file=${shQuote(tfvarsPath)}`,
    vps,
    backend.env
  );

  return {
    success: result.code === 0,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

export async function getTerraformOutputs(
  stack: TerraformStack,
  vps?: VpsConnection | null
): Promise<Record<string, TerraformOutput>> {
  const backend = prepareStateBackend(stack, vps);
  const result = await runTerraformCommand(
    stack,
    "terraform output -json -no-color",
    vps,
    backend.env
  );
  return parseTerraformOutputs(result.stdout);
}

export function parseTerraformOutputs(
  stdout: string
): Record<string, TerraformOutput> {
  const trimmed = stdout.trim();
  if (!trimmed) return {};

  try {
    const parsed = JSON.parse(trimmed) as Record<string, unknown>;
    if (!parsed || typeof parsed !== "object") return {};

    const outputs: Record<string, TerraformOutput> = {};
    for (const [key, raw] of Object.entries(parsed)) {
      if (
        raw &&
        typeof raw === "object" &&
        "value" in (raw as Record<string, unknown>)
      ) {
        const obj = raw as Record<string, unknown>;
        outputs[key] = {
          value: obj.value,
          type: typeof obj.type === "string" ? obj.type : undefined,
          sensitive:
            typeof obj.sensitive === "boolean" ? obj.sensitive : false,
        };
      } else {
        outputs[key] = { value: raw };
      }
    }
    return outputs;
  } catch {
    return {};
  }
}
