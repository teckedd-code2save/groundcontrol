# GroundControl interface architecture

## Evolution rule

Do not replace the current application shell merely because a conceptual marketing mockup looks different. Introduce intelligence through current entities, then evolve navigation when real capability justifies it.

## Likely navigation evolution

| Current area | Near-term evolution | Later intelligence role |
|---|---|---|
| Dashboard | Fleet health and customer-impact summary | Overview of degraded applications, active investigations, recent recoveries, and capacity risks |
| Services | Preserve service controls | Application view containing topology, public endpoints, dependencies, journeys, change history, and recovery readiness |
| Topology | Extend current nodes and relationships | Live domain → proxy → network → container → process → dependency service graph |
| Alerts | Link alerts to service and change context | Investigation inbox with evidence, hypotheses, impact, action plans, and verification |
| Deployments | Preserve deployment history and controls | Unified change timeline across commit, workflow, artifact, deployment, configuration, and health |
| Logs/Metrics | Preserve raw operational access | Evidence sources attached to investigations and baselines |
| Terminal | Preserve advanced operator path | Audited manual action source; never the default AI execution surface |
| Settings | Preserve connections and providers | Add service policies, journey credentials, retention, autonomy, and action permissions |

## New Intelligence workspace

Introduce when real Loop Runs exist. It may include:

- Investigations
- Change ledger
- Customer journeys
- Recovery plans
- Operational memory
- Autonomy policies

Avoid adding all items as top-level navigation. Use one Intelligence entry with internal views.

## Core screens

### Fleet overview

Lead with applications and customer impact. Keep host CPU and memory available but secondary.

### Application view

Show:

- current customer-facing health
- public endpoints
- deployed artifact
- service relationship graph
- dependencies
- confirmed journeys
- recent changes
- incidents and recoveries
- autonomy mode

### Investigation

Show one chronological evidence chain:

- trigger and customer impact
- meaningful changes
- affected relationships
- journey results
- hypotheses with supporting and contradicting evidence
- remaining uncertainty
- proposed action and risk
- approval
- verification and rollback

### Change timeline

Join repository, workflow, artifact, deployment, Compose, proxy, container, host, and verification events.

### Recovery plan

Present:

- the smallest proposed change
- semantic and text diff
- preconditions
- risk
- approval requirement
- expected result
- verification journeys
- exact rollback
- execution evidence

## State presentation

Use explicit state labels. Never communicate production state through colour alone.

Suggested groups:

- healthy / verified
- observing / running
- degraded / failed
- needs review / uncertain
- action prepared / awaiting approval
- recovering / rolling back

## Responsive priority

On narrow screens, preserve in order:

1. customer impact and current state
2. active action or decision
3. evidence timeline
4. verification and rollback
5. topology detail
6. raw telemetry
