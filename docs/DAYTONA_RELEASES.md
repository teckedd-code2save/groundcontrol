# Daytona releases

Status: implemented on the #107 branch; **not activated in production**. The real RentAWeekend web image builds in Daytona. Publishing is blocked by the saved GHCR credential's scopes, so registry pull and live rollout acceptance remain outstanding.

GroundControl owns release policy, deployment, verification and rollback. Daytona supplies a disposable build machine. A deployment configured for Daytona never falls back to compiling on the production VPS.

## Configuration

In a managed deployment's Source settings, select **Daytona** as the release builder and set a GHCR image prefix, for example `ghcr.io/teckedd-code2save/rentaweekend-daytona`. Save the configuration. Keep **Autopilot after merge** off until the acceptance checklist below passes.

The saved GitHub container registry credential must be a personal access token (classic) with `write:packages` and permission to the target packages. Pull verification alone does not establish publish permission. The release preflight checks scopes before creating a sandbox. Configure credentials through the existing authenticated Settings form; never put them in source, build arguments, or chat.

The policy is stored at `metadata.sourceRepair.releaseBuild`:

```json
{
  "provider": "daytona",
  "imagePrefix": "ghcr.io/owner/application",
  "builderImage": "docker:28.3.3-dind",
  "timeoutSeconds": 900
}
```

Existing deployments default to `host`. Repair/reproduction Daytona settings remain separate from the release builder. Changing release policy and initiating source releases require administrator access.

## Release contract

1. Resolve the explicitly linked GitHub repository and exact commit. Webhook releases use the queued commit even if the branch moves. The worker forwards that commit to the source-deploy route.
2. Read that commit's repository Compose file and identify buildable services. Reject unsupported options, interpolated build paths and paths outside the repository.
3. Fetch a bounded clean source archive using a repository-scoped, contents-read GitHub installation token. Transfer source only; production environment files and the GitHub credential never go to the builder.
4. Create a private, disposable Docker builder: 2 vCPU, 4 GiB RAM, 10 GiB disk, a maximum 15-minute execution budget and an independent sandbox TTL. Run the repository Dockerfiles with revision/source OCI labels. Registry credentials arrive after every build completes, outside all build contexts.
5. Push commit-tagged images, resolve their immutable registry digests and delete the sandbox. Cleanup failure blocks production replacement. Evidence is bounded and credential-redacted.
6. Hold a deployment lock. Preserve previous effective Compose, exact running image IDs, source revision, image override and environment files in a private `.groundcontrol/releases/<release-id>` directory. These files can contain production configuration and must remain private.
7. Sync the exact built commit, reconcile the managed environment, and stage the release configuration. Pull only the newly built digests. Preserve rollback image tags; do not prune them during deployment.
8. Recreate only built/selected services with `--no-build --pull never --no-deps`. Verify actual image IDs, Docker health, declared one-shot completion and public HTTPS checks. A failed replacement restores source, environment and the previous image override, recreates the previous images, and verifies recovery. Recovery does not turn the failed release into a success.
9. Reconcile release-specific logs into the durable release and agent-operation records. Update the recorded deployed commit only after successful verification. An uncertain worker interruption is never automatically replayed; an abandoned host lock requires inspection before retrying.

## Supported scope and limits

- Existing, single-container Compose services built from repository Dockerfiles on linux/amd64; unrelated running services are not recreated.
- Literal local build contexts, Dockerfile paths and optional build targets. Build arguments, build secrets, SSH forwarding, remote/additional contexts, `include` and `extends` fail closed.
- The host source directory must be the repository root. A monorepo may select a nested Compose file; a separate nonempty `sourceRoot` is rejected.
- New services, replicas and dependency provisioning need a separate rollout. Image rollback does **not** reverse database migrations. Database recovery remains an application-specific precondition.
- GroundControl self-upgrades must follow the canonical installer's quiesced SQLite backup and restore workflow; this generic workload path is not a substitute for that gate.
- Failed or interrupted runs retain release evidence and the private rollback bundle. Sandbox TTL is a fallback, not a claim of confirmed cleanup.
- GroundControl's current Alpine-based Dockerfile still needs package-mirror network access that failed in the tested Daytona account. RentAWeekend's successful frontend build does not establish that GroundControl itself can build there.

## Evidence, 2026-09-23

- Live Daytona API and create/execute/delete lifecycle passed. Docker 28.3.3 starts successfully inside a disposable sandbox and pulls base images.
- RentAWeekend `9ce754ce4726ca31b65dadbd6a4e378117d301ad` failed a clean web build: npm's install did not complete and TypeScript was absent. The frontend lockfile referenced `registry.npmmirror.com` for 119 packages.
- RentAWeekend PR #220 changes those tarball URLs to the official npm registry, preserving versions and integrity hashes, and checks that build dependencies were installed.
- Exact PR head `d70ce9869317b5ebd550d1b45da03c8ddc852b06` successfully built the web image in Daytona sandbox `0abbf699-6ff8-4bbd-b89f-6ea516315cec`. GHCR then rejected the push: `permission_denied: The token provided does not match expected scopes.` The sandbox was deleted successfully. No new registry digest or production release is claimed.
- GroundControl production build, TypeScript and targeted lint pass. Tests cover exact revision selection, path rejection, credential separation/redaction, cleanup failures, writer-scope preflight, failed pulls, wrong/unhealthy replacement, failed public checks, verified image rollback and rollback failure.
- Paystack: both `PAYSTACK_SECRET_KEY` and `PAYSTACK_PUBLIC_KEY` are missing from the loaded RentAWeekend API configuration and both persisted production environment files. No payment was attempted.

## Acceptance still required

1. Save a GHCR credential that can publish the target images, then repeat `scripts/daytona-release-acceptance.ts` with the deployment, exact commit, image prefix and selected services supplied through its `GC_ACCEPTANCE_*` variables. It builds/publishes only and never replaces production containers.
2. Verify private registry pull by digest on the VPS and retain the artifact manifest.
3. Deploy a controlled application release through GroundControl; confirm the exact running images and public checks.
4. Exercise failed-verification rollback on a disposable workload and confirm sandbox cleanup on success/failure.
5. Only then activate Daytona for the deployment and enable merge automation. RentAWeekend's existing API and UI remain in place until these checks succeed.
