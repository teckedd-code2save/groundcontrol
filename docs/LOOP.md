# GroundControl Loop

> Status: proposed capability. This document is the implementation and evaluation contract. The website experience is a labelled product preview until the acceptance criteria below pass.

## Product statement

GroundControl Loop takes an immutable release artifact from CI to verified production on infrastructure the operator owns. It creates an isolated execution environment in Daytona, uses Gemini to discover and execute the customer journeys affected by the change, repairs reproducible failures through a reviewable pull request, and controls a bounded production canary before promotion.

The product promise is:

> Every release exercises the customer journeys it can affect. A failure enters a repair loop instead of becoming a dead end.

Loop begins where CI ends. It does not replace the developer's IDE, source host, test suite, container registry, or GitHub Actions pipeline.

## Core principles

- **Customer behaviour first.** Functional customer journeys gate performance and production rollout.
- **Failures become work.** A failed test moves the run into reproduce, diagnose, repair, and verify stages.
- **One evidence chain.** Commit SHA, artifact digest, test evidence, fix PR, approval, canary, and production result remain connected.
- **Build once, promote exactly.** Canary and production use the same immutable artifact digest.
- **Real approval.** Gemini may prepare and revise a fix, but it cannot approve or merge its own work.
- **Deterministic safety.** Hard health policies decide promotion and rollback. Model confidence never overrides them.
- **Infrastructure ownership.** Production stays on the operator's VPS or chosen deployment target; no Serendepify SaaS is required.

## Where Loop enters the pipeline

~~~text
Developer IDE
    ↓ push / pull request
GitHub Actions: existing tests and artifact build
    ↓ SHA + immutable artifact digest + service ID
GroundControl Loop
    ↓ isolated Daytona environment
Customer journey validation
    ├─ fail → reproduce → repair → draft PR → review → rebuild ↺
    └─ pass → human release approval
                ↓
          bounded production canary
                ├─ unhealthy → rollback → investigate ↺
                └─ healthy → promote → soak → verified
~~~

The first integration is a small GitHub Action step after the image is published. A GitHub App may later add native PR checks and review steering, but it is not required for the first useful release.

## Loop execution environment

Each Loop Run gets a disposable execution environment for one commit and one artifact digest. Daytona is the first provider.

The Loop environment contains:

- The exact repository commit and release artifact.
- Synthetic users, fixtures, queues, databases, and provider test modes.
- Environment variable names and safe test values, never production secret values.
- The service topology and dependency contracts selected by GroundControl.
- Browser, HTTP, process, filesystem, Git, log, and test tools exposed through a narrow policy.
- A snapshot retained across diagnosis and repair attempts for the duration of the Loop Run.

The Loop environment is not production and must never be described as an exact clone. The production canary is the bounded real-world verification.

## Change-aware customer journeys

Gemini builds an impact graph from:

- Changed files, functions, routes, schemas, and deployment configuration.
- Existing unit, integration, browser, and contract tests.
- OpenAPI, GraphQL, event, database, and environment schemas.
- GroundControl's live service topology and deployment history.
- Previously confirmed customer journeys and prior Loop evidence.

For a payment change, an impact graph might include:

~~~text
Checkout
  → payment authorization
      → success / decline / retry / duplicate request
  → order creation
  → inventory reservation
  → receipt and notification
  → refund or cancellation
~~~

The operator can see why each journey was selected. Gemini may propose a new journey, but the run records whether it was inferred, repository-defined, or previously confirmed.

Use realistic synthetic accounts and payment-provider test mode. Never use real customer data or real transactions inside a Loop environment.

## Test order

### 1. Functional journeys

Validate customer-visible correctness first:

- Expected successful path.
- Relevant negative and retry paths.
- Idempotency and duplicate-event behaviour.
- Cross-service state consistency.
- UI, API, event, and database outcomes.

If a critical functional journey fails, performance work and production rollout stop while the repair loop begins.

### 2. Integration and contract checks

- API and event compatibility.
- Database migration compatibility.
- Dependency timeout and retry behaviour.
- Environment schema compatibility.
- Backward compatibility with the currently deployed version.

### 3. Non-functional checks

Only after functional correctness:

- Latency compared with the current production baseline.
- Throughput and bounded concurrency.
- CPU, memory, disk, and process behaviour.
- Dependency failure and recovery behaviour.
- Startup, readiness, and graceful shutdown.

### 4. Production canary

Deploy the exact artifact digest with limited exposure, observe hard health policies, then promote, pause, or roll back.

## Repair loop

A failed test is classified before code changes begin:

- `product_defect`: behaviour contradicts an established journey or contract.
- `test_defect`: expectation or fixture is incorrect.
- `environment_defect`: Loop environment setup does not represent the required dependency.
- `inconclusive`: evidence is insufficient or reproduction is unstable.

Only a reproducible `product_defect` may produce an application fix.

~~~text
journey_failed
  → reproducing
  → diagnosing
  → candidate_ready
  → verifying_candidate
      ├─ failed → diagnosing ↺
      └─ passed → draft_pr_ready
  → review_steering ↺
  → approved
  → merged
  → artifact_rebuilt
  → twin_validation
  → canary
  → observing
      ├─ unhealthy → rolled_back → diagnosing ↺
      └─ healthy → promoted → verified
~~~

Gemini applies the smallest evidence-supported candidate inside Daytona, reruns the failed journey, then runs all related journeys and regression checks. A passing candidate becomes a draft PR containing:

- The customer journey that failed.
- Exact reproduction steps and artifacts.
- Root-cause hypothesis and linked evidence.
- Candidate diff and why it is scoped.
- Tests run before and after the change.
- Remaining uncertainty and rollback considerations.

Review comments steer another revision. Every revision must rerun validation. The coding agent cannot approve or merge the PR. If the iteration, time, or cost budget is exhausted, Loop stops with an evidence package for a human.

For a failed open pull request, the first implementation should create a separate repair branch and draft fix PR targeting the source branch. For a failed canary or post-merge run, it creates a draft fix PR targeting the default branch. Writing directly to a developer's branch may be added only as an explicit opt-in.

## Gemini's role

Use the Google GenAI SDK directly for the first implementation. Do not add an agent framework until the core evaluation loop is proven.

Gemini receives scoped functions such as:

- `inspect_change`
- `inspect_topology`
- `search_repository`
- `read_file`
- `start_service`
- `run_existing_test`
- `run_http_probe`
- `run_browser_journey`
- `inspect_screenshot`
- `read_sanitized_logs`
- `compare_environment_schema`
- `apply_candidate_patch`
- `record_hypothesis`
- `resolve_hypothesis`

GroundControl executes these functions through the Daytona adapter. Gemini never receives a production shell or arbitrary command execution.

All decisions use schema-constrained output. A release decision includes:

~~~ts
type ReleaseDecision = {
  verdict: 'blocked' | 'needs_review' | 'ready_for_canary';
  impactedJourneys: JourneyResult[];
  findings: Finding[];
  expectedSignals: SignalPolicy[];
  canaryPlan: CanaryPlan;
  evidenceArtifactIds: string[];
  remainingUncertainty: string[];
};
~~~

Validate the response in application code. A valid schema is not proof that the values are correct.

## Daytona's role

The Daytona adapter is the only module allowed to call Daytona. It must support:

- Create from a pinned image or snapshot.
- Clone or mount the exact repository commit.
- Filesystem and Git operations.
- Process execution and log streaming.
- Preview URL for browser journeys.
- Snapshot/fork for repair attempts.
- CPU, memory, disk, network, tool-call, and wall-clock budgets.
- Cleanup on success, failure, cancellation, expiry, and process recovery.

Network access is denied by default and allowlisted during dependency setup. Commands run as an unprivileged user inside a fixed workspace root.

## Production decisions

Gemini proposes probes and explains anomalies. GroundControl policy decides:

- Whether all required journeys passed.
- Whether a release requires human approval.
- Canary traffic or instance scope.
- Minimum observation duration.
- Maximum error rate, latency regression, and resource regression.
- Automatic rollback conditions.

The first supported production target should be Docker Compose because it matches GroundControl's current lean-founder wedge. Run the candidate beside the stable version, route only synthetic probes or a configured small traffic share, and retain the stable version for immediate rollback. Add k3s and Cloud Run after the state machine is proven.

## Minimal GitHub Actions integration

~~~yaml
- name: Start GroundControl Loop
  uses: teckedd-code2save/groundcontrol-loop-action@v1
  with:
    endpoint: ${{ secrets.GROUNDCONTROL_URL }}
    token: ${{ secrets.GROUNDCONTROL_LOOP_TOKEN }}
    service: payments-api
    repository: ${{ github.repository }}
    commit-sha: ${{ github.sha }}
    artifact: ghcr.io/acme/payments@sha256:...
~~~

The action sends metadata and waits for the Loop result. It never receives VPS credentials. The token is scoped to one project and can only create/read Loop Runs.

## Proposed API

- `POST /api/loop/runs` — create idempotently from repository, SHA, artifact digest, service, and target.
- `GET /api/loop/runs/:id` — sanitized state and evidence summary.
- `GET /api/loop/runs/:id/events` — resumable SSE event stream.
- `POST /api/loop/runs/:id/cancel` — cancel and clean up.
- `POST /api/loop/runs/:id/approve-canary` — explicit release approval.
- `POST /api/loop/runs/:id/retry` — retry an eligible failed stage.
- `POST /api/loop/runs/:id/draft-fix` — explicitly authorize draft repair PR creation.

Every route calls `requireAuth(req)` except the token-authenticated CI endpoint. CI token authentication must be separate, narrowly scoped, rate-limited, and audited.

## Proposed code map

~~~text
src/lib/loop/
  types.ts
  state-machine.ts
  orchestrator.ts
  policy.ts
  sanitizer.ts
  impact-graph.ts
  journey-planner.ts
  release-decision.ts
  repair-loop.ts
  providers/gemini.ts
  providers/daytona.ts
  providers/github.ts
  targets/compose-canary.ts

src/app/api/loop/runs/...
src/app/loop/page.tsx
src/components/loop/...
~~~

API routes remain thin. Existing managed-host operations continue through `execOnVps()` and `shQuote()`. Model-authored work executes only through the Daytona adapter, never `execOnVps()`.

## Milestones

### M0 — Demonstrable vertical slice

- Seeded Loop UI with payment journey example.
- Deterministic fake Gemini and Daytona adapters.
- Complete state machine including repair and canary outcomes.
- Label all fixture data as demo data.

### M1 — CI to Loop environment

- Loop token, GitHub Action, immutable artifact identity, sanitizer, Daytona adapter.
- Existing repository tests plus one operator-confirmed customer journey.
- Structured Gemini impact graph and release decision.
- No production deployment yet.

### M2 — Functional journeys and draft repairs

- Browser/API journey tools and related-flow selection.
- Failure classification, reproduction, candidate patch, full revalidation.
- Human-triggered draft repair PR and review steering.

### M3 — Compose canary

- Side-by-side stable/candidate deployment.
- Synthetic probes, baseline comparison, observation window, promotion and rollback.
- Exact artifact digest carried across all stages.

### M4 — Learning and additional targets

- Retrieve similar local Loop Runs using Gemini embeddings.
- k3s and Cloud Run canary targets.
- Optional GitHub App for native checks and comments.
- Evaluation dashboard and cost/runtime controls.

## Test plan

Provider adapters are injectable. The default test suite makes no network calls.

### Unit

- State transition matrix, retries, cancellation, expiry, and recovery.
- Artifact digest validation and idempotency.
- Sanitizer corpus for keys, tokens, connection strings, headers, and logs.
- Impact graph selection from changed files and schemas.
- Journey-plan and release-decision schema validation.
- Functional gate ordering before non-functional tests.
- Failure classification and repair budget enforcement.
- Candidate diff scope and forbidden-path policy.
- Canary promotion and rollback policy.

### Integration with fake providers

- Functional pass → non-functional pass → approval → canary → promotion.
- Journey failure → reproduce → candidate → related journeys pass → draft PR ready.
- Review feedback → revised candidate → complete revalidation.
- Flaky reproduction → inconclusive, no application PR.
- Candidate fails regression → return to diagnosis, no PR.
- Canary fails hard threshold → rollback exactly once → investigation evidence retained.
- Restart mid-run → resumes without duplicate sandbox, PR, canary, or promotion.

### Seeded payment fixture

Create a small fixture service with checkout, payment-provider test mode, order creation, inventory, receipt, and refund flows. Seed defects for:

- Duplicate webhook creates a second order.
- Declined payment incorrectly reserves inventory.
- Receipt total differs from the completed order.
- Retry path introduces a bounded latency regression.
- Ambiguous failure where the correct outcome is `inconclusive`.

Each fixture defines required journeys, acceptable diagnosis concepts, forbidden claims, expected artifacts, and verification commands.

## Release acceptance criteria

- No real customer data, transactions, or production secret values enter a Loop environment.
- No model-authored command executes on a managed production host.
- Every blocking claim links to reproducible evidence.
- Functional failures prevent non-functional and canary stages.
- A repair PR is created only for a reproducible product defect and only after explicit authorization.
- Every repair revision reruns the failed journey, related journeys, and regression suite.
- Gemini cannot approve or merge its own PR.
- Canary promotion and rollback depend on deterministic policy, not model confidence.
- Complete, cancel, failure, timeout, and recovery paths clean up the Daytona sandbox.
- Process restart cannot duplicate sandboxes, PRs, deployments, or promotions.
- `npm test`, `npm run lint`, and `npm run build` pass before enabling the feature outside development.

## MVP boundary

The first real release is one path:

> GitHub Actions artifact → one confirmed customer journey in Daytona → structured Gemini decision → evidence report.

Draft repair PRs follow once reproduction is reliable. Compose canary follows once artifact identity and state recovery are reliable. The product may show the complete seeded experience early, but it must label unimplemented stages as preview data.
