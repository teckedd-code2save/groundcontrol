import { assertComposeServiceName, composeServiceImages } from "./compose-management";
import { buildManagedComposeInvocation, shQuote } from "./vps";

export const REDEPLOY_STATUS_PREFIX = "__GC_REDEPLOY_STATUS__=";

export type DetachedRedeployStatus = "running" | "success" | "failed";

export interface DetachedRedeployLog {
  lines: string[];
  status: DetachedRedeployStatus;
  error: string | null;
  exitCode: number | null;
}

/**
 * Interpret a detached Compose log without leaking GroundControl's control
 * marker into operator-visible output or durable release evidence.
 */
export function parseDetachedComposeRedeployLog(output: string): DetachedRedeployLog {
  const rawLines = output
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.trimEnd())
    .filter((line) => Boolean(line.trim()));
  const marker = [...rawLines]
    .reverse()
    .find((line) => line.trimStart().startsWith(REDEPLOY_STATUS_PREFIX))
    ?.trim();
  const lines = rawLines.filter(
    (line) => !line.trimStart().startsWith(REDEPLOY_STATUS_PREFIX)
  );
  const failed = marker?.match(/^__GC_REDEPLOY_STATUS__=failed:(\d+)$/);
  const status: DetachedRedeployStatus = marker === `${REDEPLOY_STATUS_PREFIX}success`
    ? "success"
    : failed
      ? "failed"
      : "running";
  const exitCode = failed ? Number(failed[1]) : null;

  if (status !== "failed") {
    return { lines, status, error: null, exitCode };
  }

  const phaseFailure = [...lines].reverse().find((line) =>
    /^\[(deploy|verify)\]\s+(Docker Compose|Runtime image verification) failed\b/i.test(line.trim())
  );
  const lastEvidence = [...lines].reverse().find((line) =>
    !/^\[(prepare|deploy|verify)\]/i.test(line.trim())
  );
  const error = lastEvidence?.trim()
    || phaseFailure?.trim()
    || `Docker Compose failed with exit code ${exitCode ?? "unknown"}.`;

  return { lines, status, error, exitCode };
}

export function expectedComposeImages(
  effectiveCompose: string,
  selectedServices?: string[]
): Record<string, string> {
  const images = composeServiceImages(effectiveCompose);
  if (!selectedServices?.length) return images;
  const selected = new Set(selectedServices.map(assertComposeServiceName));
  return Object.fromEntries(Object.entries(images).filter(([service]) => selected.has(service)));
}

/**
 * POSIX-sh verification used both synchronously and by detached local redeploys.
 * A pull is not a deployment: every selected service must be recreated from the
 * image resolved by the exact effective Compose model.
 */
export function buildRuntimeImageVerificationCommand(
  composeCommand: string,
  composeFile: string,
  expectedImages: Record<string, string>,
  attempts = 30
): string {
  const entries = Object.entries(expectedImages).map(([service, image]) => [
    assertComposeServiceName(service),
    image.trim(),
  ] as const).filter(([, image]) => Boolean(image));
  if (entries.length === 0) return `printf '%s\\n' '[verify] No registry-backed service image required verification'`;

  const checks = entries.flatMap(([service, expected]) => {
    const ps = buildManagedComposeInvocation(composeCommand, `ps -q ${shQuote(service)}`, composeFile);
    return [
      `gc_container_id=$( ${ps} | head -n 1)`,
      `if [ -z "$gc_container_id" ]; then gc_all_ready=0; else`,
      `  gc_actual=$(docker inspect --format '{{.Config.Image}}' "$gc_container_id" 2>/dev/null || true)`,
      `  gc_expected=${shQuote(expected)}`,
      `  if [ "$gc_actual" != "$gc_expected" ] && [ "$gc_actual" != "docker.io/library/$gc_expected" ]; then gc_all_ready=0; fi`,
      `fi`,
    ];
  });
  const evidence = entries.flatMap(([service, expected]) => {
    const ps = buildManagedComposeInvocation(composeCommand, `ps -q ${shQuote(service)}`, composeFile);
    return [
      `gc_container_id=$( ${ps} | head -n 1)`,
      `gc_actual=$(docker inspect --format '{{.Config.Image}}' "$gc_container_id" 2>/dev/null || true)`,
      `printf '%s\\n' ${shQuote(`[verify] ${service}: expected ${expected}`)} "[verify] ${service}: running $gc_actual"`,
    ];
  });

  return [
    `gc_attempt=0`,
    `gc_all_ready=0`,
    `while [ "$gc_attempt" -lt ${Math.max(1, Math.min(120, attempts))} ]; do`,
    `  gc_all_ready=1`,
    ...checks.map((line) => `  ${line}`),
    `  if [ "$gc_all_ready" -eq 1 ]; then break; fi`,
    `  gc_attempt=$((gc_attempt + 1))`,
    `  sleep 2`,
    `done`,
    ...evidence,
    `if [ "$gc_all_ready" -ne 1 ]; then printf '%s\\n' '[verify] Running image does not match the effective Compose configuration' >&2; exit 42; fi`,
  ].join("\n");
}

export function buildDetachedComposeRedeployCommand({
  projectPath,
  composeCommand,
  composeFile,
  deployArgs,
  expectedImages,
}: {
  projectPath: string;
  composeCommand: string;
  composeFile: string;
  deployArgs: string;
  expectedImages: Record<string, string>;
}): string {
  const deploy = buildManagedComposeInvocation(composeCommand, deployArgs, composeFile);
  const verify = buildRuntimeImageVerificationCommand(composeCommand, composeFile, expectedImages);

  return [
    `cd ${shQuote(projectPath)}`,
    `printf '%s\\n' '[deploy] Starting Docker Compose recreation'`,
    `if ${deploy}; then`,
    `  printf '%s\\n' '[deploy] Docker Compose recreation completed'`,
    `  printf '%s\\n' '[verify] Checking running images against the effective Compose configuration'`,
    `  if (`,
    ...verify.split("\n").map((line) => `    ${line}`),
    `  ); then`,
    `    gc_status=0`,
    `    printf '%s\\n' '[verify] Running images match the effective Compose configuration'`,
    `  else`,
    `    gc_status=$?`,
    `    printf '%s\\n' "[verify] Runtime image verification failed (exit $gc_status)" >&2`,
    `  fi`,
    `else`,
    `  gc_status=$?`,
    `  printf '%s\\n' "[deploy] Docker Compose failed to recreate the deployment (exit $gc_status)" >&2`,
    `fi`,
    `if [ "$gc_status" -eq 0 ]; then`,
    `  docker image prune -f >/dev/null 2>&1 || true`,
    `  printf '%s\\n' '${REDEPLOY_STATUS_PREFIX}success'`,
    `else`,
    `  printf '%s\\n' "${REDEPLOY_STATUS_PREFIX}failed:$gc_status"`,
    `  exit "$gc_status"`,
    `fi`,
  ].join("\n");
}
