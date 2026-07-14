# GroundControl Loop

> Status: implemented product-direction foundation with a production workspace driven by enrolled services, recorded changes and live public-path probes. Deterministic fixtures remain test-only evaluation assets; guarded autopilot is not generally enabled.

## Product hierarchy

GroundControl is the product. Loop is its intelligence and recovery engine. A Loop Run is one evidence chain from a meaningful operational change or detected failure through customer-facing verification.

Loop is not a separate deployment platform, testing framework, monitoring product, or unrestricted production agent.

## Product statement

GroundControl continuously understands applications running on operator-owned infrastructure. When code, containers, reverse proxies, networks, environment configuration, certificates, or host state change, Loop determines the affected services, exercises the relevant customer journeys, investigates regressions, and selects the least disruptive route back to verified health.

> GroundControl understands what is running on your VPS, tests what a meaningful change can affect, and safely guides or performs recovery when the customer experience breaks.

The first supported environment is a lean team running Docker Compose behind Caddy or Nginx on one to five VPS hosts.

## Core cycle

~~~text
meaningful host or release change
    ↓
update live service graph and change ledger
    ↓
calculate affected services and journeys
    ↓
wait for stabilization
    ↓
exercise targeted internal and external probes
    ├─ healthy → record verified state
    └─ unhealthy
         ↓
       collect evidence and diagnose
         ↓
       select least disruptive recovery
         ├─ guide a human
         ├─ request approval
         └─ execute inside explicit policy
         ↓
       verify from outside the host
         ├─ failed → roll back and continue investigation
         └─ healthy → record confirmed operational memory
~~~

Loop can also begin from an alert, scheduled verification, manual investigation, or CI artifact. Host-change intelligence is the primary MVP trigger.

## Principles

- **Customer outcome over process health.** A green container is not proof that a public application works.
- **Relationships over isolated signals.** Domain, DNS, TLS, proxy, network, container, process, dependency and customer journey form one service graph.
- **Changes explain incidents.** Compare current state with the last verified healthy state.
- **Evidence before mutation.** Findings cite supporting and contradictory evidence, confidence and uncertainty.
- **Least disruptive recovery.** Restore or patch the smallest reversible surface before rebuilding topology.
- **Deterministic safety.** Policy and verification—not model confidence—authorize execution and decide success.
- **Infrastructure ownership.** Existing VPS hosts, GitHub Actions and registries remain in place.
- **Safe abstention.** Unknown, destructive and stateful failures stop automation and produce a guided plan.
- **No arbitrary production shell.** Gemini receives scoped functions; production mutations use allowlisted GroundControl actions.
- **Honest product state.** Seeded experiences are visibly marked as demos until real adapters pass evaluation.

## Live service graph

The service graph is GroundControl's operational model:

~~~text
repository / commit / artifact
            ↓
deployment event
            ↓
VPS host → Docker project → service → container → process
                                ↓
domain → DNS → TLS → Caddy/Nginx route → Docker network → internal port
                                ↓
database / Redis / queue / external dependency
                                ↓
customer journey and verification history
~~~

Initial nodes include Host, DockerProject, Service, Container, Process, Domain, Certificate, Proxy, ProxyRoute, Network, Port, Volume, Artifact, RepositoryRevision, Dependency and Journey.

Initial relationships include RUNS_ON, DEPLOYS, ROUTES_TO, RESOLVES_TO, TERMINATES_TLS_FOR, LISTENS_ON, PUBLISHES, JOINS_NETWORK, DEPENDS_ON, VERIFIED_BY and CHANGED_BY.

Every node and relationship records its source, observation time, confidence and last verified healthy value.

## Change ledger

Loop consumes normalized operational events rather than raw logs alone.

Initial event sources:

- Docker events and periodic reconciliation
- Compose file fingerprint and parsed topology changes
- Container image and immutable digest changes
- Caddy or Nginx configuration revision
- Environment schema fingerprint, never secret values
- Domain, DNS and TLS observations
- GroundControl service actions and terminal audit records
- GitHub deployment or workflow metadata
- External endpoint checks
- Host resource and filesystem thresholds

~~~ts
type OperationalEvent = {
  id: string;
  hostId: string;
  serviceIds: string[];
  kind:
    | 'artifact_changed'
    | 'container_replaced'
    | 'compose_changed'
    | 'proxy_changed'
    | 'environment_schema_changed'
    | 'network_changed'
    | 'certificate_changed'
    | 'resource_threshold_crossed'
    | 'external_probe_failed'
    | 'manual_action';
  observedAt: string;
  source: 'agent' | 'github' | 'probe' | 'groundcontrol';
  beforeRef?: string;
  afterRef?: string;
  evidenceArtifactIds: string[];
};
~~~

Events are debounced into a change set. Loop waits for configurable stabilization before running affected journeys. A rapid container rollout must not create duplicate runs.

## Targeted synthetic journeys

A journey represents a stable customer or operational outcome. It may be operator-authored, imported from existing tests, proposed by Gemini and accepted, or inferred for one investigation and clearly marked as inferred.

Gemini may select and explain journeys. Stored execution remains deterministic and inspectable.

~~~yaml
journeys:
  - id: checkout-completes
    criticality: critical
    triggers:
      - payments-api.changed
      - checkout-ui.changed
      - proxy.changed
      - certificate.changed
    steps:
      - open: https://example.com/checkout
      - authenticate: synthetic-buyer
      - submit: provider-test-payment
      - expect:
          page: order-confirmation
          api_status: 200
          latency_under_ms: 1200
    cleanup:
      - remove_synthetic_order
~~~

### Journey safety

- Use dedicated synthetic accounts and isolated tenants.
- Use provider test modes for payments and notifications.
- Never submit real transactions or customer data.
- Require cleanup and idempotency for mutating journeys.
- Rate-limit external probes.
- Mark journeys that cannot safely run against production.
- Redact secrets, tokens, headers and personal data from evidence.

## Trigger and blast-radius rules

The service graph determines which journeys run.

| Change | Initial checks |
|---|---|
| Container image or artifact | Service health, public endpoint and confirmed service journeys |
| Compose topology | Ports, networks, dependencies, startup and public journeys |
| Caddy/Nginx config | Syntax, domains, TLS, redirects, upstreams and affected journeys |
| Environment schema | Startup and dependent integrations; never reveal values |
| Certificate or DNS | Resolution, chain, expiry, redirects and public endpoints |
| Host firewall or network | Internal and external reachability |
| Database migration | Compatibility, read/write journey and rollback readiness |
| Resource threshold | Latency, process stability and capacity risk |

A change set with no mapped journey runs a minimal service verification and asks the operator to confirm missing coverage.

## Reverse-proxy intelligence

Caddy and Nginx are the first deep infrastructure adapters.

The adapter must:

1. Parse configuration into a normalized route model.
2. Map domains and paths to upstream services and ports.
3. Validate syntax with the native validator.
4. Test name resolution and connectivity from the proxy network.
5. Compare the proposed state with the last verified healthy revision.
6. Identify affected domains and journeys.
7. Prepare an exact diff and rollback revision.
8. Prefer reload over restart when supported.
9. Verify all affected public routes after mutation.
10. Restore the previous revision if verification fails.

A text diff alone is insufficient. Loop reasons over parsed route semantics and preserves unrecognized directives.

## Structured investigation

Gemini receives sanitized evidence and scoped functions such as inspect_change_set, inspect_service_graph, compare_last_healthy_state, inspect_container, inspect_proxy_route, validate_proxy_candidate, inspect_dns, inspect_certificate, run_internal_probe, run_external_probe, run_confirmed_journey, read_sanitized_logs, inspect_resource_pressure, create_daytona_reproduction, record_hypothesis and resolve_hypothesis.

~~~ts
type Investigation = {
  symptom: string;
  customerImpact: string;
  hypotheses: Array<{
    statement: string;
    supportingEvidenceIds: string[];
    contradictingEvidenceIds: string[];
    confidence: number;
    status: 'open' | 'confirmed' | 'rejected';
  }>;
  confirmedCause?: string;
  uncertainty: string[];
  recommendedAction?: ActionPlan;
};
~~~

Application code validates the schema. A valid schema is not evidence that its claims are correct.

## Recovery ladder

Loop attempts the least disruptive eligible action:

1. Refresh evidence and wait for stabilization.
2. Restore a last-known-healthy proxy or application configuration.
3. Restart one stateless unhealthy component.
4. Apply a validated configuration correction.
5. Redeploy the previous healthy immutable artifact.
6. Prepare a Compose or infrastructure patch.
7. Reproduce an application defect and prepare a code repair PR.
8. Propose migration to an approved resilient blueprint.
9. Stop automation and guide the operator.

Every action plan contains preconditions, affected graph nodes, supporting evidence, risk classification, exact proposed diff or command intent, expected result, verification journeys, rollback action, approval requirement and execution budget.

## Resilient deployment blueprints

Blueprints describe approved characteristics, not blind replacements.

Initial blueprints:

- single web application behind Caddy
- frontend plus API
- API plus PostgreSQL and Redis
- worker and queue
- replicated stateless application
- stateful application with backup preconditions

Blueprint checks may recommend explicit internal ports, private application networks, health checks, restart policies, resource limits, log rotation, named volumes, graceful shutdown, dependency readiness, immutable image digests, previous-artifact retention, proxy timeouts and backup hooks.

Loop presents the semantic difference between current topology and blueprint. Operators may accept individual improvements. Automatic blueprint migration is outside the MVP.

## Autonomy policy

Each service selects a mode:

- monitor: observe changes and run journeys
- guide: diagnose and prepare recovery steps
- approve: execute one reversible plan after approval
- autopilot: execute only allowlisted low-risk actions
- locked: never mutate

~~~yaml
autopilot:
  allowed:
    - restore_proxy_revision
    - reload_validated_proxy
    - restart_stateless_service
    - redeploy_previous_healthy_artifact
  approval_required:
    - change_environment_schema
    - modify_compose_topology
    - change_firewall
    - apply_code_patch
    - restart_database
  prohibited:
    - delete_persistent_volume
    - destructive_database_operation
    - expose_secret
    - execute_model_authored_shell
~~~

Policies are enforced outside Gemini. Model confidence cannot widen permissions.

## Daytona's role

Daytona is used when a failure can be reproduced through repository code, container topology, configuration or deployment behaviour. It is not an exact production clone and is not required for every recovery.

The Daytona adapter may open the exact commit, use the exact artifact digest, construct a sanitized topology, validate a Compose or proxy candidate, reproduce a journey, fork repair attempts, run tests, prepare a minimal patch, enforce budgets and clean up safely.

Network access is denied by default and allowlisted per dependency. Daytona never receives production secret values.

## Guided recovery

When policy blocks automation or evidence is incomplete, Loop produces an interactive plan containing a plain-language problem, evidence and uncertainty, proposed repair, reason automation paused, reviewable diff, ordered steps, preflight, verification, rollback and stop conditions.

GroundControl may execute each approved step and attach its result. The operator should not need to translate generic advice into commands.

## State machine

~~~text
observed
  → correlating
  → stabilized
  → exercising
      ├─ passed → verified_healthy
      └─ failed → investigating
                    ├─ inconclusive → guided
                    └─ cause_confirmed → planning
                                          ├─ policy_blocked → guided
                                          └─ authorized → applying
                                                           → verifying
                                                               ├─ failed → rolling_back → investigating
                                                               └─ passed → recovered → remembered
~~~

A process restart must resume without duplicating journeys, mutations, rollbacks, PRs or memory records.

## Proposed code map

~~~text
src/lib/intelligence/
  events.ts
  change-set.ts
  service-graph.ts
  graph-reconciler.ts
  last-healthy.ts
  blast-radius.ts
  journey-selector.ts
  investigation.ts
  operational-memory.ts

src/lib/loop/
  types.ts
  state-machine.ts
  orchestrator.ts
  policy.ts
  recovery-ladder.ts
  verifier.ts
  sanitizer.ts
  providers/gemini.ts
  providers/daytona.ts
  adapters/docker.ts
  adapters/compose.ts
  adapters/caddy.ts
  adapters/nginx.ts
  adapters/github.ts
  actions/restart-stateless.ts
  actions/restore-proxy.ts
  actions/redeploy-artifact.ts

src/app/api/intelligence/...
src/app/intelligence/...
src/components/intelligence/...
~~~

Existing host actions continue through execOnVps() and shQuote(). Model-authored content never passes directly to execOnVps().

## Proposed API

- POST /api/intelligence/events — ingest idempotent events
- GET /api/intelligence/graph — sanitized service graph
- GET /api/intelligence/changes — change ledger
- POST /api/loop/runs — create a manual or external Loop Run
- GET /api/loop/runs/:id — state and evidence summary
- GET /api/loop/runs/:id/events — resumable SSE stream
- POST /api/loop/runs/:id/approve — approve current action plan
- POST /api/loop/runs/:id/reject — block execution and retain guidance
- POST /api/loop/runs/:id/cancel — cancel and clean up
- POST /api/loop/runs/:id/rollback — request eligible rollback
- POST /api/journeys — create an operator-confirmed journey
- POST /api/journeys/:id/run — run manually

Every route calls requireAuth(req) except narrowly scoped agent and CI ingestion endpoints. Tokens are project-scoped, rate-limited and audited.

## MVP: unreachable Docker Compose application

The first release supports one incident family:

> A Docker Compose web application behind Caddy or Nginx becomes unreachable or returns 502/503 after a meaningful change.

### Inputs

- Docker events and reconciled container state
- Compose topology and fingerprint
- proxy route model and configuration revision
- domain, DNS and TLS observations
- internal and external HTTP probes
- recent GroundControl and deployment events
- selected sanitized logs
- one operator-confirmed customer journey

### Outcomes

- locate failure at domain, TLS, proxy, network, container or process layer
- compare with last verified healthy state
- cite evidence and uncertainty
- prepare the smallest reversible repair
- restore a known-good proxy revision or artifact after approval
- verify the public journey
- roll back on failed verification
- create a guided plan when automation is unsafe

### Deterministic fixtures

- container running but proxy targets the wrong port
- host/container networking mismatch
- broken Compose port mapping
- unhealthy or crash-looping application
- invalid Caddy/Nginx configuration
- certificate or DNS mismatch
- missing environment variable name
- disk pressure caused by disposable logs
- stale container after a failed deployment
- ambiguous external dependency failure requiring abstention

## Evaluation

Measure root-cause accuracy, journey-selection precision and recall, change-to-verification time, alert-to-diagnosis time, verified recovery rate, rollback correctness, safe abstention, destructive actions, unsupported claims and duplicate side effects after restart.

Every fixture defines acceptable diagnosis concepts, required evidence, forbidden claims, eligible actions, expected verification and rollback.

## Milestones

### M0 — Seeded vertical slice

- interactive change → test → investigate → recover → verify UI
- deterministic service graph and fixture events
- fake Gemini, agent, journey and action adapters
- fixture data visibly labelled as demo data

### M1 — Read-only intelligence

- Docker and Compose discovery
- Caddy adapter
- domain-to-container service graph
- change ledger and last-known-healthy snapshots
- internal and external probes
- no mutations

### M2 — Targeted journeys and investigation

- operator-confirmed HTTP and browser journey
- event debouncing and blast-radius selection
- structured Gemini investigation
- evidence, contradiction and uncertainty UI
- deterministic fixture evaluation

### M3 — Approved recovery

- proxy revision retention
- native configuration validation
- reversible action plans
- approval, execution, public verification and rollback
- process-restart idempotency

### M4 — Reproduction and repair

- Daytona reproduction for eligible failures
- Compose and proxy candidate validation
- optional application repair PR
- resilient blueprint comparison
- operational memory retrieval

### M5 — Guarded autopilot

- per-service autonomy policy
- allowlisted low-risk actions
- action budgets and stop conditions
- policy audit and evaluation dashboard

## Release acceptance criteria

- Public product state is represented honestly.
- No production secrets or customer data enter prompts or Daytona.
- No model-authored shell command executes on a managed host.
- Every diagnosis cites evidence and exposes uncertainty.
- Every mutation is allowlisted, audited and bounded.
- Every executed action has verification and rollback.
- Customer-facing verification decides recovery.
- Failed verification triggers rollback or safe escalation.
- Stateful and destructive actions cannot run in autopilot.
- Process restart cannot duplicate tests, actions, rollbacks, PRs or memory.
- Complete, failed, cancelled and expired runs clean up resources.
- npm test, npm run lint and npm run build pass before enabling real adapters.

## First build boundary

> A Docker or proxy change occurs → GroundControl maps the affected public service → one confirmed journey runs → an evidence-backed diagnosis identifies the fault → a guided reversible repair is prepared.

Automatic mutation follows only after read-only diagnosis is reliable on deterministic fixtures and real opt-in hosts.
