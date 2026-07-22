import { assertComposeServiceName, composeServiceImages } from "./compose-management";
import { buildManagedComposeInvocation, shQuote } from "./vps";

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
    `if ${deploy}; then`,
    `  if (`,
    ...verify.split("\n").map((line) => `    ${line}`),
    `  ); then`,
    `    gc_status=0`,
    `  else`,
    `    gc_status=$?`,
    `  fi`,
    `else`,
    `  gc_status=$?`,
    `fi`,
    `if [ "$gc_status" -eq 0 ]; then`,
    `  docker image prune -f >/dev/null 2>&1 || true`,
    `  printf '%s\\n' '__GC_REDEPLOY_STATUS__=success'`,
    `else`,
    `  printf '%s\\n' "__GC_REDEPLOY_STATUS__=failed:$gc_status"`,
    `  exit "$gc_status"`,
    `fi`,
  ].join("\n");
}
