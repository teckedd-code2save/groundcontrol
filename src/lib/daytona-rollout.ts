import { stringify } from "yaml";
import { assertComposeServiceName, MANAGED_IMAGE_OVERRIDE_FILE } from "./compose-management";
import { shQuote } from "./vps";
import { buildDeploymentVerificationCommand, type DeploymentVerificationCheck } from "./compose-redeploy";

export function releaseImageOverride(images: Record<string, string>): string {
  return stringify({ services: Object.fromEntries(Object.entries(images).map(([name, image]) => [assertComposeServiceName(name), { image }])) });
}

const ENVIRONMENT_PATHS = [".env", ".groundcontrol/env", ".groundcontrol/compose.env.override.yml", ".groundcontrol/compose.env.files"];
export function snapshotReleaseEnvironment(directory: string): string {
  return `set -eu\numask 077\n: > ${shQuote(`${directory}/environment.list`)}\n${ENVIRONMENT_PATHS.map(file => `if [ -e ${shQuote(file)} ]; then printf '%s\\n' ${shQuote(file)} >> ${shQuote(`${directory}/environment.list`)}; fi`).join("\n")}\ntar -cf ${shQuote(`${directory}/environment.tar`)} -T ${shQuote(`${directory}/environment.list`)}`;
}
export function restoreReleaseEnvironment(directory: string): string {
  // Only known generated overlay files that were absent before this run may be removed.
  return `if [ -f ${shQuote(`${directory}/environment.tar`)} ]; then\n${ENVIRONMENT_PATHS.filter(file => file !== ".groundcontrol/env").map(file => `  if ! grep -Fxq ${shQuote(file)} ${shQuote(`${directory}/environment.list`)}; then rm -f ${shQuote(file)}; fi`).join("\n")}\n  tar -xf ${shQuote(`${directory}/environment.tar`)}\nfi`;
}

/** Verify actual image IDs, health checks and explicitly identified one-shot services. */
export function verifyReleaseCommand(compose: string, images: Record<string, string>, oneShot: string[] = []): string {
  return Object.entries(images).map(([service, image]) => {
    assertComposeServiceName(service);
    return `gc_ready=0
gc_attempt=0
gc_expected=$(docker image inspect --format '{{.Id}}' ${shQuote(image)}) || exit 42
while [ "$gc_attempt" -lt 90 ]; do
  gc_ids=$(${compose} ps -q --all ${shQuote(service)}) || exit 42
  gc_ready=1
  [ -n "$gc_ids" ] || gc_ready=0
  for gc_id in $gc_ids; do
    gc_actual=$(docker inspect --format '{{.Image}}' "$gc_id") || exit 42
    gc_state=$(docker inspect --format '{{.State.Status}}' "$gc_id") || exit 42
    gc_health=$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$gc_id") || exit 42
    gc_exit=$(docker inspect --format '{{.State.ExitCode}}' "$gc_id") || exit 42
    [ "$gc_actual" = "$gc_expected" ] || gc_ready=0
    if [ "$gc_state" = running ]; then
      case "$gc_health" in healthy|none) ;; *) gc_ready=0;; esac
      ${oneShot.includes(service) ? "gc_ready=0" : ":"}
    elif ${oneShot.includes(service) ? '[ "$gc_state" = exited ] && [ "$gc_exit" = 0 ]' : "false"}; then :
    else gc_ready=0; fi
  done
  [ "$gc_ready" = 1 ] && break
  gc_attempt=$((gc_attempt+1))
  sleep 2
done
printf '%s\\n' "[verify] ${service} ready=$gc_ready image=$gc_expected"
[ "$gc_ready" = 1 ] || exit 42`;
  }).join("\n");
}

/** All files live in a private release directory and are prepared before this detached mutation. */
export function buildGuardedRollout(input: {
  projectPath: string; directory: string; composeCommand: string; lockDirectory: string;
  images: Record<string, string>; previousImages: Record<string, string>;
  oneShot: string[]; previousOneShot: string[]; services: string[];
  checks: DeploymentVerificationCheck[]; previousCommit: string;
}): string {
  const dir = shQuote(input.directory);
  const prefix = `${input.composeCommand} --project-directory ${shQuote(input.projectPath)}`;
  const next = `${prefix} -f ${shQuote(`${input.directory}/next.yml`)}`;
  const old = `${prefix} -f ${shQuote(`${input.directory}/previous.yml`)} -f ${shQuote(`${input.directory}/previous-images.yml`)}`;
  const selected = input.services.map(assertComposeServiceName).map(shQuote).join(" ");
  const publicCheck = buildDeploymentVerificationCommand(input.checks).replace("curl -k -sS", "curl -sS");
  return `set -eu
umask 077
cd ${shQuote(input.projectPath)}
export DOCKER_CONFIG="$HOME/.groundcontrol/docker"
gc_changed=0
gc_finish() {
  gc_status=$?
  trap - EXIT HUP INT TERM
  set +e
  if [ "$gc_status" -ne 0 ]; then
    printf '%s\\n' '[failure] New release failed; restoring previous source and images'
    if [ -f ${dir}/override-existed ]; then cp ${dir}/previous-override.yml ${shQuote(MANAGED_IMAGE_OVERRIDE_FILE)}; else rm -f ${shQuote(MANAGED_IMAGE_OVERRIDE_FILE)}; fi
    git reset --hard ${shQuote(input.previousCommit)} >/dev/null 2>&1 || printf '%s\\n' '[failure] Previous source checkout could not be restored'
    ${restoreReleaseEnvironment(input.directory)}
    if [ "$gc_changed" = 1 ]; then
      if (set -e
        ${old} up -d --no-build --pull never --no-deps --force-recreate ${selected} || exit 41
        ${verifyReleaseCommand(old, input.previousImages, input.previousOneShot)}
        ${publicCheck}
      ); then printf '%s\\n' '[rollback] Previous images and health verified';
      else printf '%s\\n' '[failure] Rollback verification failed; inspect this deployment'; fi
    fi
    printf '%s\\n' '__GC_REDEPLOY_STATUS__=failed:1'
  else
    printf '%s\\n' '__GC_REDEPLOY_STATUS__=success'
  fi
  rmdir ${shQuote(input.lockDirectory)} 2>/dev/null || true
  exit "$gc_status"
}
trap gc_finish EXIT
trap 'exit 1' HUP INT TERM
${Object.entries(input.images).map(([service, image]) => `printf '%s\\n' ${shQuote(`[pull] ${service} ${image}`)}\ndocker pull ${shQuote(image)}`).join("\n")}
${Object.entries(input.previousImages).map(([service, image]) => `docker image tag ${shQuote(image)} ${shQuote(`groundcontrol-rollback/${service.toLowerCase()}:${input.directory.split("/").pop()}`)}`).join("\n")}
cp ${dir}/next-override.yml ${shQuote(`${MANAGED_IMAGE_OVERRIDE_FILE}.tmp`)}
mv ${shQuote(`${MANAGED_IMAGE_OVERRIDE_FILE}.tmp`)} ${shQuote(MANAGED_IMAGE_OVERRIDE_FILE)}
gc_changed=1
${next} up -d --no-build --pull never --no-deps --force-recreate ${selected}
(set -e
${verifyReleaseCommand(next, input.images, input.oneShot)}
${publicCheck}
)
printf '%s\\n' '[deploy] Immutable release verified'
`;
}
