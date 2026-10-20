import { redactSensitive } from "./errors";

export type BuildOutput = { phase: string; code: number; stdout: string; stderr: string };

/** Keep complete evidence; only the human summary is shortened. */
export function buildOutput(phase: string, result: Omit<BuildOutput, "phase">): BuildOutput {
  const redact = (text: string) => redactSensitive(text)
    .replace(/\bBearer\s+[A-Za-z0-9._~+\/-]+=*/gi, "Bearer [REDACTED]")
    .replace(/\b(?:gh[pousr]_[A-Za-z0-9]+|github_pat_[A-Za-z0-9_]+)\b/g, "[REDACTED]")
    .replace(/(https?:\/\/)[^\s/@]+:[^\s/@]+@/gi, "$1[REDACTED]@");
  return { phase, code: result.code, stdout: redact(result.stdout), stderr: redact(result.stderr) };
}

export function buildFailureSummary(output: BuildOutput): string {
  const tail = (output.stderr.trim() || output.stdout.trim()).slice(-1500);
  return `${output.phase} failed (exit ${output.code})${tail ? `: ${tail}` : ""}`;
}
