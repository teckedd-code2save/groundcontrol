# GroundControl Rehearsal

> Status: proposed capability. The Serendepify website contains an interactive product preview; this document is the implementation and evaluation contract. Nothing described here should be presented as production-ready until the acceptance criteria pass.

## Product statement

GroundControl Rehearsal turns a production incident into a safe, reproducible investigation. It packages selected operational context, creates an isolated Daytona sandbox, gives Gemini a narrow set of investigation tools, and returns an evidence card plus an optional signed handoff to Convoy for human-controlled delivery.

The core promise is not “AI fixes production.” It is:

> Reproduce the failure away from production, test the diagnosis, and show the operator the evidence before any consequential action.

## Goals

- Launch a rehearsal from an alert, failed deployment, service, or manually supplied incident description.
- Build a minimal incident bundle without copying secrets or unrestricted production data.
- Require reproduction before claiming a root cause.
- Run all model-authored commands and patches inside an isolated sandbox.
- Preserve a complete, readable evidence trail: inputs, hypotheses, tool calls, results, tests, confidence, and remaining risk.
- Produce a signed evidence handoff for Convoy. Convoy owns PR creation, review steering, approval, merge, promotion, and subsequent production steps.
- Make provider boundaries replaceable. Gemini and Daytona are the first adapters, not hard-coded assumptions throughout the application.

## Non-goals for the first release

- No model access to a production shell, production credentials, or the GroundControl host namespace.
- No merge, promotion, deploy, restart, rollback, or configuration change inside Rehearsal. Those delivery transitions belong to Convoy and remain approval-gated.
- No “root cause” result when the failure cannot be reproduced or the evidence is inconclusive.
- No arbitrary internet access from the sandbox.
- No multi-agent swarm. One orchestrated investigation is enough to test the product thesis.

## Boundary with Convoy

GroundControl Rehearsal and Convoy are complementary, but they do not share ownership of the same state machine.

- **Rehearsal owns investigation:** production context, sanitization, isolated reproduction, evidence, a tested candidate change, and explicit uncertainty.
- **Convoy owns delivery:** the coding agent opens the PR; review feedback steers an improvement loop; approval permits merge; promotion then advances through canary, observation, and subsequent production stages.
- **GroundControl observes the handoff:** it can display Convoy status and evidence links, but it cannot silently approve or skip Convoy gates.

Convoy currently performs its coding loop through Claude because that is how the hackathon implementation was built. The delivery protocol should remain model-adaptable: open PR → review steering → approval → merge → promote → canary/observe → production or rollback.

## Operator flow

1. The operator chooses **Reproduce safely** on an alert, deployment, or service.
2. GroundControl previews exactly which logs, metadata, repository reference, and environment keys will enter the bundle.
3. The operator removes fields or confirms the bundle.
4. GroundControl creates the run and streams stage updates.
5. Daytona creates a disposable sandbox from the selected repository ref and approved environment schema.
6. The orchestrator installs dependencies and runs a deterministic reproduction recipe. If the failure does not reproduce, the run stops as `inconclusive`.
7. Gemini inspects the repository with scoped tools, records hypotheses, and must reject or verify each hypothesis with tool output.
8. If a candidate patch is warranted, it is applied only inside the sandbox and the relevant test suite plus reproduction recipe are rerun.
9. GroundControl renders an evidence card. The operator may export the report or hand the verified candidate to Convoy.
10. Convoy opens the PR through its active coding agent (Claude today). Review feedback steers an improved revision; explicit approval permits merge and promotion, followed by guarded canary, observation, and production steps.
11. The sandbox expires automatically. Production remains untouched by Rehearsal throughout.

## System boundary

```text
GroundControl UI
    │  authenticated, confirmed incident bundle
    ▼
Rehearsal API ──► Orchestrator ──► Daytona adapter ──► isolated workspace
                         │                 ▲
                         ▼                 │ scoped tool results only
                    Gemini adapter ────────┘
                         │
                         ▼
                 Evidence store / audit log
                         │
                         ▼ human approval only
                 Signed Convoy handoff
```

The orchestrator owns state transitions and policy. Providers never update run state directly. API routes authenticate, validate, call the orchestrator, and return serialized results; they do not contain provider logic.

## Proposed code map

```text
src/
  app/
    rehearsal/page.tsx
    api/rehearsal/runs/route.ts
    api/rehearsal/runs/[id]/route.ts
    api/rehearsal/runs/[id]/cancel/route.ts
    api/rehearsal/runs/[id]/events/route.ts
    api/rehearsal/runs/[id]/handoff/route.ts
  components/rehearsal/
    RehearsalLauncher.tsx
    RehearsalTimeline.tsx
    EvidenceCard.tsx
    IncidentBundleReview.tsx
  lib/rehearsal/
    types.ts
    policy.ts
    sanitizer.ts
    incident-bundle.ts
    state-machine.ts
    orchestrator.ts
    evidence.ts
    providers/daytona.ts
    providers/gemini.ts
    providers/convoy.ts
    tools/read-file.ts
    tools/search-repo.ts
    tools/run-command.ts
    tools/apply-patch.ts
    tools/run-tests.ts
```

Every API route must call `requireAuth(req)`. Do not use `execOnVps()` for model-authored commands: those commands belong exclusively in the Daytona adapter. Existing managed-host operations must continue to use `execOnVps()` and `shQuote()` as required by the repository conventions.

## Run lifecycle

Use an explicit state machine. Persist every transition with a timestamp and structured reason.

```text
queued
  → bundling
  → awaiting_bundle_approval
  → sandboxing
  → reproducing
      ↘ inconclusive
  → investigating
  → patching (optional)
  → verifying
  → evidence_ready
      → handoff_ready (human action)
      → complete

Convoy (outside the Rehearsal state machine):
  pr_opened → review_steering ↺ → approved → merged → promoted → canary → observed → production

Any active state → failed | cancelled | expired
```

Invalid transitions must throw before a provider call. Retrying a stage must be idempotent by `(runId, stage, attempt)` and must not create a second sandbox or Convoy handoff.

## Data model

Names are suggestions; keep provider-specific payloads in JSON fields so the core model stays portable.

### `RehearsalRun`

- `id`, `status`, `sourceType`, `sourceId`, `projectId`, `repositoryUrl`, `repositoryRef`
- `operatorId`, `createdAt`, `updatedAt`, `expiresAt`
- `sandboxProvider`, `sandboxId`, `modelProvider`, `modelName`
- `reproductionStatus`, `confidence`, `summary`, `remainingRisk`
- `errorCode`, `errorMessage`

### `RehearsalEvent`

- `id`, `runId`, `sequence`, `stage`, `kind`, `message`, `payload`, `createdAt`
- Append-only. Redact payloads before persistence.

### `RehearsalArtifact`

- `id`, `runId`, `kind`, `label`, `contentType`, `storageRef`, `sha256`, `createdAt`
- Kinds: `incident_bundle`, `reproduction_log`, `tool_result`, `candidate_diff`, `test_report`, `evidence_report`.

Never persist provider API keys, repository tokens, raw environment values, or unrestricted logs in these models.

## Incident bundle contract

The bundle is versioned and reviewable before upload:

```ts
type IncidentBundleV1 = {
  version: 1;
  runId: string;
  source: { type: 'alert' | 'deployment' | 'service' | 'manual'; id?: string };
  service: { name: string; runtime?: string; topology: SafeTopologyNode[] };
  repository: { url: string; ref: string; commitSha?: string };
  observations: Array<{ timestamp: string; kind: string; message: string }>;
  logs: Array<{ source: string; lines: string[]; truncated: boolean }>;
  environmentSchema: Array<{ key: string; required: boolean; classification: string }>;
  reproduction: { command?: string; expectedFailure: string; successSignal: string };
  redactions: Array<{ field: string; reason: string }>;
};
```

Default limits: 500 log lines per source, 256 KB total bundle size, five-minute observation window, and no environment values. The UI must show truncation and redaction counts.

## Sanitization policy

Sanitization runs before persistence and again before sending data to providers.

- Replace values matching token, password, private-key, connection-string, cookie, JWT, bearer-token, and cloud-key patterns.
- Treat any key containing `SECRET`, `TOKEN`, `PASSWORD`, `PRIVATE`, `COOKIE`, `KEY`, or `CREDENTIAL` as sensitive by default.
- Remove home-directory paths, IPs, and account identifiers unless the operator explicitly includes a field and the policy permits it.
- Keep environment variable names only. A sandbox may receive test fixture values entered for that run; it never inherits production values.
- Hash repository URLs in analytics and never send incident contents to telemetry.
- Record what was removed, not the removed value.

The sanitizer must fail closed. If serialization or classification fails, do not create the sandbox.

## Daytona provider contract

The Daytona adapter is the only module allowed to call the Daytona API.

```ts
interface SandboxProvider {
  create(input: SandboxCreateInput): Promise<{ sandboxId: string }>;
  restoreDependencies(sandboxId: string): Promise<CommandResult>;
  readFile(sandboxId: string, path: string): Promise<string>;
  search(sandboxId: string, query: string, paths?: string[]): Promise<SearchResult[]>;
  exec(sandboxId: string, command: ApprovedCommand): Promise<CommandResult>;
  applyPatch(sandboxId: string, patch: string): Promise<PatchResult>;
  snapshot(sandboxId: string, label: string): Promise<{ snapshotId: string }>;
  destroy(sandboxId: string): Promise<void>;
}
```

Required controls:

- Pinned base image and repository commit.
- CPU, memory, disk, process-count, and wall-clock limits.
- Network disabled by default; allow only explicitly required package and repository hosts during setup.
- Commands executed as an unprivileged user with a fixed workspace root.
- Path traversal protection for all filesystem tools.
- Cleanup in a `finally` path plus an expiry sweeper for orphaned sandboxes.

## Gemini provider contract

Gemini receives the approved bundle, stage-specific instructions, and only these tools:

- `search_repo(query, paths?)`
- `read_file(path, startLine?, endLine?)`
- `run_command(commandId, args)` from a policy-approved command registry
- `apply_patch(unifiedDiff)` inside the workspace
- `run_tests(testPlanId)` from a repository-derived test plan
- `record_hypothesis(statement, evidenceNeeded)`
- `resolve_hypothesis(hypothesisId, verdict, evidenceArtifactIds)`

The model may not submit raw shell text for direct execution. `commandId` maps to an allowlisted command template and validated argument schema. A run stops after the configured tool-call, token, or time budget.

The final model response must validate against a schema containing:

- `reproduction`: `verified | not_reproduced | changed_failure`
- `hypotheses[]` with verdict and evidence artifact IDs
- `rootCause`: nullable statement
- `candidateChange`: nullable summary and diff artifact ID
- `verification[]` with command, exit code, and artifact ID
- `confidence`: `low | medium | high`
- `remainingRisk[]`
- `abstentionReason`: required when no root cause is claimed

Confidence is presentation metadata, not evidence. GroundControl computes whether the evidence gate passed.

## Evidence gate

An evidence card may say **root cause verified** only when all of the following hold:

1. The original failure reproduced from the approved recipe.
2. At least one diagnosis has a linked observation or tool result.
3. A candidate change causes the reproduction recipe to pass or materially changes the measured failure as predicted.
4. The configured regression tests pass.
5. No policy violation, timeout, or missing artifact occurred.

Otherwise the result is `inconclusive`, `candidate_only`, or `failed`. The interface must never convert uncertainty into a success state.

## API surface

### `POST /api/rehearsal/runs`

Creates a run in `queued`. Accepts a source reference, repository ref, selected log sources, and reproduction recipe. Returns the run and a bundle preview. It does not start provider work until bundle approval.

### `POST /api/rehearsal/runs/:id/approve-bundle`

Records the exact bundle hash and operator approval, then schedules sandbox creation. Reject if the preview changed after approval.

### `GET /api/rehearsal/runs/:id`

Returns the sanitized run, stage progress, evidence summary, and artifact metadata.

### `GET /api/rehearsal/runs/:id/events`

SSE stream backed by persisted events. Reconnection uses `Last-Event-ID`; the database remains the source of truth.

### `POST /api/rehearsal/runs/:id/cancel`

Idempotently cancels active work and requests sandbox cleanup.

### `POST /api/rehearsal/runs/:id/handoff`

Requires `evidence_ready`, operator confirmation, a candidate diff, verification artifacts, and a configured Convoy connection. Creates an idempotent signed handoff; Convoy then owns PR creation and the review/approval lifecycle. GroundControl records Convoy's run URL and read-only status updates but cannot approve, merge, promote, or deploy on Convoy's behalf.

## Feature flags and configuration

```dotenv
REHEARSAL_ENABLED=false
REHEARSAL_MAX_RUNTIME_SECONDS=900
REHEARSAL_MAX_TOOL_CALLS=24
REHEARSAL_MAX_BUNDLE_BYTES=262144
DAYTONA_API_KEY=
DAYTONA_API_URL=
GEMINI_API_KEY=
GEMINI_MODEL=
```

When disabled or incompletely configured, launch controls are hidden and Settings shows a setup checklist. Provider secrets use the repository's encrypted-at-rest configuration path; do not expose them to the browser.

## Build milestones

### M0 — Fake vertical slice

- Add `/rehearsal` with seeded runs and the four-stage timeline.
- Reuse the evidence language from the website preview, but label all seeded content as demo data.
- Add feature flag and Settings readiness panel.

### M1 — Bundle and policy

- Implement versioned bundle builder, sanitizer, review UI, state machine, and append-only events.
- Launch from one alert type and one failed deployment type.
- No external providers yet; use deterministic fixture adapters.

### M2 — Real sandbox reproduction

- Implement Daytona adapter, repository checkout, dependency restoration, command registry, budgets, expiry, and cleanup.
- Support a repository-provided `.groundcontrol/rehearsal.yml` recipe.
- Stop at a reproduction report; no Gemini patching yet.

### M3 — Evidence-guided investigation

- Implement Gemini adapter, structured hypotheses, scoped tools, evidence gate, candidate patch, and verification.
- Add explicit abstention and budget-exhausted states.

### M4 — Human handoff and evaluation

- Add the Convoy handoff adapter, evidence report export, evaluation fixtures, metrics, and operational dashboards.
- Run the release gate below before enabling by default.

## Test plan

Use Vitest for unit and integration tests. Provider adapters must be injectable so the default test suite makes no network calls.

### Unit

- Sanitizer redacts representative secrets, encoded tokens, URLs with credentials, private keys, and sensitive environment keys.
- Sanitizer leaves safe error text intact and never includes the original secret in thrown errors.
- Bundle builder enforces size, line, timestamp, and source limits deterministically.
- State machine accepts every documented transition and rejects every undocumented transition.
- Command registry rejects shell metacharacters, path traversal, unknown IDs, oversized arguments, and commands outside the workspace.
- Evidence gate cannot return verified without reproduction, linked evidence, and passing verification.
- Event serialization is stable, ordered, redacted, and safe for SSE reconnects.

### Integration with fakes

- Happy path: reproduce → investigate → patch → verify → evidence ready.
- Non-reproduction: stops as `inconclusive`; Gemini is never called.
- Bad patch: tests fail; evidence reports remaining risk and no PR action is offered.
- Model abstains: run completes as inconclusive with the abstention reason.
- Timeout/cancel: sandbox destroy is called exactly once.
- Provider retry: idempotency prevents duplicate sandboxes and Convoy handoffs.
- Bundle mutation after approval: orchestration refuses to start.

### Seeded evaluation incidents

Keep small fixture repositories under `test/fixtures/rehearsal/`:

1. HTTP client missing a timeout, causing deterministic latency under a synthetic slow upstream.
2. Environment schema mismatch, producing a startup validation error without including any real secret.
3. Resource cleanup regression, producing a deterministic handle-count increase in a bounded test.
4. Ambiguous failure with two plausible causes and insufficient evidence; the correct outcome is abstention.

Each fixture includes the incident bundle, expected reproduction signal, acceptable diagnosis concepts, disallowed claims, required artifacts, and verification commands.

### Manual end-to-end

1. Enable the feature on a non-production GroundControl instance.
2. Configure dedicated test-only Gemini, Daytona, and GitHub credentials.
3. Select the fixture repository and pin a commit.
4. Inspect the bundle preview; confirm no values appear beside environment keys.
5. Approve the bundle and watch stage events survive a page refresh.
6. Confirm the sandbox has no production credentials and cannot reach non-allowlisted hosts.
7. Confirm the original fixture failure reproduces.
8. Confirm every claim in the evidence card opens a matching artifact.
9. Send the candidate to Convoy; confirm Convoy opens the PR, review feedback can steer an improved revision, and no merge or promotion occurs without explicit approval.
10. Cancel a second run and confirm its sandbox disappears.

## Release acceptance criteria

- 100% of secret-leak regression corpus is redacted in unit and integration tests.
- 0 model-authored commands execute outside the sandbox in code review and tests.
- 0 automatic production mutations exist in the Rehearsal path.
- All state transitions are persisted and recover after process restart.
- All completed claims link to artifacts; unverifiable runs abstain.
- Sandbox cleanup succeeds on complete, cancel, failure, timeout, and process recovery paths.
- At least 80% of deterministic seeded incidents reproduce across ten consecutive runs.
- At least 80% of reproducible, single-cause fixtures reach the expected diagnosis concept; the ambiguous fixture must abstain.
- Convoy handoff is human-triggered, idempotent, and disabled when verification fails; Convoy independently enforces approval before merge and promotion.
- `npm test`, `npm run lint`, and `npm run build` pass before the flag is enabled outside development.

## Product metrics

Collect aggregate counts only; never incident content.

- Bundle approval and cancellation rate.
- Reproduction success rate and median time to reproduce.
- Verified, candidate-only, inconclusive, failed, and abstained outcomes.
- Median tool calls and runtime by stage.
- Candidate patches passing reproduction and regression tests.
- Operator evidence opens, report exports, and Convoy handoff requests.
- Sandbox cleanup failures and orphan age.

## Open decisions

- Should the first release accept only GitHub repositories, or a generic Git URL?
- Where should large artifacts live for self-hosted installs: encrypted database blobs, local object storage, or a configured S3-compatible store?
- Is `.groundcontrol/rehearsal.yml` mandatory for M2, or can GroundControl derive a recipe and require operator confirmation?
- Which Gemini model is the default at release time? Keep this configuration-driven and benchmark it against the seeded evaluation set.
- Should one GroundControl instance allow multiple concurrent rehearsals, or begin with a global concurrency limit of one?

The default for unresolved decisions is the narrower, safer product: GitHub-only, operator-confirmed recipe, one concurrent run, short retention, and no provider network access beyond setup requirements.
