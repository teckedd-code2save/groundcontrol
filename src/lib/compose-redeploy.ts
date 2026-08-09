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

function inferLegacyVerifyFailure(lines: string[]) {
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index].trim();
    const blankRunning = line.match(/^\[verify\]\s+([A-Za-z0-9_.-]+):\s+running\s*$/i);
    if (!blankRunning) continue;
    const service = blankRunning[1];
    const servicePattern = service.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const expected = [...lines.slice(0, index)].reverse().find((candidate) =>
      new RegExp(`^\\[verify\\]\\s+${servicePattern}:\\s+expected\\s+`, "i").test(candidate.trim())
    );
    return expected
      ? `[failure] phase=verify service=${service} error=no running image was observed after Compose recreation; ${expected.replace(/^\[verify\]\s+/i, "")}`
      : `[failure] phase=verify service=${service} error=no running image was observed after Compose recreation`;
  }
  return null;
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
  const containerLogFailure = [...lines].reverse().find((line) =>
    /^\[container-log\]\s+/i.test(line.trim())
    && /\b(error|fatal|exception|failed|unhealthy|refused|denied|timeout|not found|missing|invalid)\b/i.test(line)
  );
  const containerFailure = [...lines].reverse().find((line) =>
    /^\[failure\]\s+/i.test(line.trim())
  );
  const legacyVerifyFailure = inferLegacyVerifyFailure(lines);
  const diagnosticFailure = [...lines].reverse().find((line) =>
    !/^\[(prepare|deploy|verify)\]/i.test(line.trim())
    && /\b(error|fatal|exception|failed|unhealthy|refused|denied|timeout)\b/i.test(line)
  );
  const error = containerLogFailure?.trim()
    || containerFailure?.trim()
    || legacyVerifyFailure
    || diagnosticFailure?.trim()
    || phaseFailure?.trim()
    || "Compose stopped before GroundControl captured a service or container error. The run evidence is incomplete and no automatic repair should be proposed from this result alone.";

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
    const runningPs = buildManagedComposeInvocation(composeCommand, `ps -q ${shQuote(service)}`, composeFile);
    const allPs = buildManagedComposeInvocation(composeCommand, `ps -q --all ${shQuote(service)}`, composeFile);
    return [
      `gc_service=${shQuote(service)}`,
      `gc_expected=${shQuote(expected)}`,
      `gc_container_id=$( ${runningPs} | head -n 1)`,
      `gc_observed_state=running`,
      `if [ -z "$gc_container_id" ]; then`,
      `  gc_container_id=$( ${allPs} | head -n 1)`,
      `  gc_observed_state=$(docker inspect --format '{{.State.Status}}' "$gc_container_id" 2>/dev/null || true)`,
      `fi`,
      `if [ -z "$gc_container_id" ]; then`,
      `  gc_all_ready=0`,
      `else`,
      `  gc_actual=$(docker inspect --format '{{.Config.Image}}' "$gc_container_id" 2>/dev/null || true)`,
      `  gc_exit_code=$(docker inspect --format '{{.State.ExitCode}}' "$gc_container_id" 2>/dev/null || true)`,
      `  gc_image_ok=0`,
      `  if [ "$gc_actual" = "$gc_expected" ] || [ "$gc_actual" = "docker.io/library/$gc_expected" ]; then gc_image_ok=1; fi`,
      `  if [ "$gc_image_ok" -ne 1 ]; then gc_all_ready=0; fi`,
      `  if [ "$gc_observed_state" != "running" ] && { [ "$gc_observed_state" != "exited" ] || [ "$gc_exit_code" != "0" ]; }; then gc_all_ready=0; fi`,
      `fi`,
    ];
  });
  const evidence = entries.flatMap(([service, expected]) => {
    const runningPs = buildManagedComposeInvocation(composeCommand, `ps -q ${shQuote(service)}`, composeFile);
    const allPs = buildManagedComposeInvocation(composeCommand, `ps -q --all ${shQuote(service)}`, composeFile);
    return [
      `gc_service=${shQuote(service)}`,
      `gc_expected=${shQuote(expected)}`,
      `gc_container_id=$( ${runningPs} | head -n 1)`,
      `gc_observed_state=running`,
      `if [ -z "$gc_container_id" ]; then`,
      `  gc_container_id=$( ${allPs} | head -n 1)`,
      `  gc_observed_state=$(docker inspect --format '{{.State.Status}}' "$gc_container_id" 2>/dev/null || true)`,
      `fi`,
      `gc_actual=$(docker inspect --format '{{.Config.Image}}' "$gc_container_id" 2>/dev/null || true)`,
      `gc_exit_code=$(docker inspect --format '{{.State.ExitCode}}' "$gc_container_id" 2>/dev/null || true)`,
      `printf '%s\\n' ${shQuote(`[verify] ${service}: expected ${expected}`)}`,
      `if [ -z "$gc_container_id" ]; then`,
      `  printf '%s\\n' ${shQuote(`[verify] ${service}: observed no container`)}`,
      `  printf '%s\\n' ${shQuote(`[failure] phase=verify service=${service} error=no container exists for service`)}`,
      `elif [ "$gc_observed_state" = "exited" ] && [ "$gc_exit_code" = "0" ]; then`,
      `  printf '%s\\n' "[verify] ${service}: completed one-shot $gc_actual (exit 0)"`,
      `elif [ "$gc_observed_state" = "running" ]; then`,
      `  printf '%s\\n' "[verify] ${service}: running $gc_actual"`,
      `else`,
      `  printf '%s\\n' "[verify] ${service}: state $gc_observed_state image $gc_actual exit $gc_exit_code"`,
      `fi`,
      `if [ -n "$gc_container_id" ] && [ "$gc_actual" != "$gc_expected" ] && [ "$gc_actual" != "docker.io/library/$gc_expected" ]; then`,
      `  printf '%s\\n' "[failure] phase=verify service=${service} error=image mismatch expected=$gc_expected actual=$gc_actual state=$gc_observed_state exit=$gc_exit_code"`,
      `fi`,
      `if [ -n "$gc_container_id" ] && [ "$gc_observed_state" != "running" ] && { [ "$gc_observed_state" != "exited" ] || [ "$gc_exit_code" != "0" ]; }; then`,
      `  printf '%s\\n' "[failure] phase=verify service=${service} error=container not running state=$gc_observed_state exit=$gc_exit_code image=$gc_actual"`,
      `fi`,
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
    `if [ "$gc_all_ready" -ne 1 ]; then printf '%s\\n' '[verify] Runtime verification found service image or container-state mismatch' >&2; exit 42; fi`,
  ].join("\n");
}

export function normalizePublicEndpointUrl(value?: unknown): string | null {
  const text = String(value || "").trim();
  if (!text) return null;
  if (/^[A-Za-z][A-Za-z0-9+.-]*:\/\//.test(text) && !/^https?:\/\//i.test(text)) return null;
  const candidate = /^https?:\/\//i.test(text) ? text : `https://${text}`;
  try {
    const url = new URL(candidate);
    if (!["http:", "https:"].includes(url.protocol)) return null;
    if (url.username || url.password) return null;
    return url.toString();
  } catch {
    return null;
  }
}

export function buildPublicEndpointVerificationCommand(publicUrl?: string | null): string {
  const url = normalizePublicEndpointUrl(publicUrl);
  if (!url) return `printf '%s\\n' '[public] No public endpoint configured; skipped'`;
  return [
    `gc_public_url=${shQuote(url)}`,
    `printf '%s\\n' "[public] Checking $gc_public_url"`,
    `gc_public_status=$(curl -k -sS -o /dev/null --max-time 15 -w '%{http_code}' "$gc_public_url" 2>/tmp/gc-public-probe.err || true)`,
    `gc_public_error=$(cat /tmp/gc-public-probe.err 2>/dev/null || true)`,
    `rm -f /tmp/gc-public-probe.err 2>/dev/null || true`,
    `if [ -n "$gc_public_status" ] && [ "$gc_public_status" -ge 200 ] && [ "$gc_public_status" -lt 400 ]; then`,
    `  printf '%s\\n' "[public] $gc_public_url returned HTTP $gc_public_status"`,
    `  printf '%s\\n' '[public] Public endpoint verified'`,
    `else`,
    `  if [ -z "$gc_public_status" ] || [ "$gc_public_status" = "000" ]; then`,
    `    printf '%s\\n' "[public] $gc_public_url did not return an HTTP response"`,
    `    printf '%s\\n' "[failure] phase=public url=$gc_public_url error=$gc_public_error"`,
    `  else`,
    `    printf '%s\\n' "[public] $gc_public_url returned HTTP $gc_public_status"`,
    `    printf '%s\\n' "[failure] phase=public url=$gc_public_url status=$gc_public_status error=public endpoint returned unhealthy status"`,
    `  fi`,
    `  printf '%s\\n' '[public] Public endpoint verification failed' >&2`,
    `  exit 43`,
    `fi`,
  ].join("\n");
}

export function buildDetachedComposeRedeployCommand({
  projectPath,
  composeCommand,
  composeFile,
  deployArgs,
  expectedImages,
  publicUrl,
}: {
  projectPath: string;
  composeCommand: string;
  composeFile: string;
  deployArgs: string;
  expectedImages: Record<string, string>;
  publicUrl?: string | null;
}): string {
  const deploy = buildManagedComposeInvocation(composeCommand, deployArgs, composeFile);
  const verify = buildRuntimeImageVerificationCommand(composeCommand, composeFile, expectedImages);
  const verifyPublic = buildPublicEndpointVerificationCommand(publicUrl);
  const composeState = buildManagedComposeInvocation(composeCommand, "ps --all", composeFile);
  const composeContainers = buildManagedComposeInvocation(composeCommand, "ps -q --all", composeFile);

  return [
    `cd ${shQuote(projectPath)}`,
    `printf '%s\\n' ${shQuote(`[deploy] Compose source ${composeFile}`)}`,
    `printf '%s\\n' '[deploy] Starting Docker Compose recreation'`,
    `if ${deploy}; then`,
    `  printf '%s\\n' '[deploy] Docker Compose recreation completed'`,
    `  printf '%s\\n' '[verify] Checking each Compose service against the effective image and runtime state'`,
    `  if (`,
    ...verify.split("\n").map((line) => `    ${line}`),
    `  ); then`,
    `    printf '%s\\n' '[verify] Service images and runtime states match the effective Compose configuration'`,
    `    if (`,
    ...verifyPublic.split("\n").map((line) => `      ${line}`),
    `    ); then`,
    `      gc_status=0`,
    `    else`,
    `      gc_status=$?`,
    `    fi`,
    `  else`,
    `    gc_status=$?`,
    `    printf '%s\\n' "[verify] Runtime image verification failed (exit $gc_status)" >&2`,
    `  fi`,
    `else`,
    `  gc_status=$?`,
    `  printf '%s\\n' "[deploy] Docker Compose failed to recreate the deployment (exit $gc_status)" >&2`,
    `  printf '%s\\n' '[evidence] Compose state after failure'`,
    `  ${composeState} 2>&1 || true`,
    `  gc_container_ids=$( ${composeContainers} 2>/dev/null || true )`,
    `  if [ -z "$gc_container_ids" ]; then`,
    `    printf '%s\\n' '[failure] Compose created no containers; inspect the service definition, image, build context, and dependency graph.'`,
    `  else`,
    `    for gc_container_id in $gc_container_ids; do`,
    `      gc_container_name=$(docker inspect --format '{{.Name}}' "$gc_container_id" 2>/dev/null | sed 's#^/##')`,
    `      docker inspect --format ${shQuote("[failure] container={{.Name}} status={{.State.Status}} health={{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}} exit={{.State.ExitCode}} error={{.State.Error}}")} "$gc_container_id" 2>/dev/null || true`,
    `      docker logs --tail 60 "$gc_container_id" 2>&1 | tail -n 60 | while IFS= read -r gc_line; do`,
    `        printf '%s\\n' "[container-log] container=$gc_container_name $gc_line"`,
    `      done`,
    `    done`,
    `  fi`,
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
