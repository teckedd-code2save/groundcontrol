# Deployment automation and Daytona

> Status: merge-triggered deployment automation is live for explicitly enrolled deployments. The RentAWeekend path has one verified production proof. Daytona reproduction is early access and remains bounded to eligible code, configuration, and deployment-behaviour investigations.

This runbook records how GroundControl now participates in delivery without replacing GitHub Actions, the image registry, Docker Compose, or operator-owned infrastructure.

## The two deployment paths

### 1. GroundControl's own release path

GroundControl continues to ship through the repository-owned GitHub Actions workflow:

1. A reviewed change merges to `main`.
2. GitHub Actions builds the image away from the production VPS.
3. The workflow pushes revision-addressable and `latest` tags to GHCR.
4. The deploy job connects to the VPS, synchronizes the repository-owned Compose definition, pulls the image, applies Prisma migrations, and recreates the workload.
5. Container health, a local API probe, the public HTTPS endpoint, and MCP discovery are verified.
6. A failed verification fails the deployment and preserves logs for diagnosis.

This remains the correct path for releasing GroundControl itself.

### 2. A managed application's merge-to-deploy path

For an enrolled application such as RentAWeekend, GroundControl can turn an accepted GitHub push into a bounded deployment operation:

1. The deployment is explicitly linked to a repository, allowed branch, deployed revision, Compose identity, environment bundle, and public verification URL.
2. GitHub sends a signed push event after a merge.
3. GroundControl validates the webhook signature, repository, branch, deployment identity, and autonomy policy.
4. An allowed event creates the durable `deployment.source.deploy` operation.
5. The existing delivery mechanism builds or resolves the exact revision without competing with the running workload for production resources.
6. GroundControl reconciles the synchronized environment and repository-owned Compose topology.
7. The workload is recreated through the typed deployment action.
8. GroundControl waits for declared service health and verifies the public customer endpoint.
9. The operation records revision, stage evidence, attempts, result, and any blocker.

Autopilot is deployment-scoped. Enabling it for one repository and branch does not authorize other workloads, arbitrary shell commands, stateful changes, or destructive actions.

## Responsibility boundaries

| Component | Responsibility |
|---|---|
| GitHub | Authoritative repository, merge event, commit identity, and review history |
| GitHub Actions | Existing CI/build path and GroundControl's own production release |
| GHCR | Built image storage and revision-addressable artifacts |
| GroundControl | Policy checks, durable operation state, deployment orchestration, evidence, health checks, public verification, and safe abstention |
| Production VPS | Runs the deployed Compose workload; it is not the default image builder |
| Daytona | Ephemeral reproduction and candidate validation for eligible failures; never the production runtime |

## Daytona's role

Daytona is an isolated workbench inside a Loop investigation, not a second production deployment platform.

Use it when live evidence points to a repository, configuration, Compose, or deployment-behaviour defect that benefits from reproduction. The intended contract is:

1. Check out the exact deployed revision.
2. Construct a sanitized sandbox without production secrets or customer data.
3. Reproduce the focused failure.
4. Apply the smallest candidate change.
5. Rerun the reproduction and independent regression checks.
6. Capture a reviewable diff and evidence.
7. Destroy the sandbox.
8. After operator approval, open a normal pull request.
9. Let the existing delivery path deploy the merged revision.
10. Let GroundControl verify the customer outcome externally.

A Daytona setup or network failure is evidence about the sandbox, not proof that application code is broken. If required dependency mirrors are unreachable, record the blocker and use an already-approved build path rather than weakening production safety.

## Verified RentAWeekend proof

The first bounded production proof used an empty commit so the event and deployment machinery could be verified without changing application behaviour.

| Evidence | Recorded value |
|---|---|
| Feature revision deployed to GroundControl | `7f016f863a3e30212cc120d1c22ea5c2038b35bc` |
| RentAWeekend proof revision | `468acf8d69821cf2c83af1629ee853325354a306` |
| Durable operation | `cmubbc14l0002tjpa0r56r1sm` |
| Trigger | Signed GitHub push on the explicitly allowed repository and `main` branch |
| Operation result | Success, one attempt, no recorded error |
| Runtime verification | Web, API, PostgreSQL, and Redis healthy |
| Public verification | HTTP 200, approximately 99 ms during the proof |

This proves the event-to-operation-to-verification chain for the enrolled deployment. It does not imply that guarded autopilot is generally enabled for every deployment.

## Production safety rules

- Never make the production VPS the default build machine.
- Treat host CPU, memory, disk, and concurrent operation limits as deployment preconditions.
- Build exact revisions in CI or another approved isolated builder.
- Use repository-owned Compose and preserve service identity.
- Never place production secrets or customer data in Daytona.
- Never execute model-authored shell directly on a managed host.
- Keep mutations typed, allowlisted, audited, bounded, and idempotent.
- Require container/service health and public-path verification.
- Keep rollback information attached to the operation.
- Stop with an evidence-backed blocker when identity, policy, resources, or verification are uncertain.
- Serialize deployment work per workload so retries cannot create competing releases.

## Incident lesson: VPS timeouts

The GroundControl and RentAWeekend timeouts occurred while a heavy build competed with live workloads on the same VPS for CPU and memory. The deployed images were not swapped by an unknown actor, and the evidence did not indicate service hijacking.

The durable correction is architectural: keep builds off the production host, admit deployments only when resource and identity checks pass, and verify the public customer path after recreation.

## Enablement checklist

Before enabling merge-triggered deployment for another application:

- [ ] Repository and default branch are explicit.
- [ ] The currently deployed revision is recorded.
- [ ] Repository-owned Compose file and public entrypoint are known.
- [ ] Environment reconciliation is configured without exposing values.
- [ ] Webhook signature verification is active.
- [ ] The deployment-specific autopilot policy allows `deployment.source.deploy`.
- [ ] CI or another isolated builder can produce the exact revision.
- [ ] Health checks cover every declared service.
- [ ] A meaningful public verification URL is configured.
- [ ] Rollback artifact or previous known-good revision is available.
- [ ] A harmless proof change succeeds before normal changes rely on the path.
- [ ] Durable operation evidence is retained and reviewable.

## Remaining hardening work

- Prefer immutable image digests throughout deployment and rollback.
- Complete clean-host distribution acceptance.
- Add explicit production-host resource admission and clearer UI progress.
- Complete Daytona network/setup acceptance for the supported repository classes.
- Exercise and document an end-to-end failed-verification rollback.
- Expand guarded autopilot only after deterministic evaluation on each deployment class.

## Operator summary

After a code merge, GitHub remains the source of truth and the existing builder produces the artifact. GroundControl decides whether the event is authorized for this deployment, runs a durable typed operation, verifies service and customer health, and records evidence. Daytona enters only when a failure needs isolated reproduction and exits before production deployment.
