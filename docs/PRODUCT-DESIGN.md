# GroundControl Product and Interface Direction

> Status: design contract for the intelligence evolution. This document does not claim that conceptual screens or intelligence capabilities are currently shipped. See [LOOP.md](./LOOP.md) for the implementation and evaluation contract.

## Purpose

GroundControl is not being rebuilt from zero. The current self-hosted VPS cockpit becomes the foundation for a more intelligent product.

This contract defines:

- how existing GroundControl areas evolve
- where Loop appears in the product
- how intelligence changes navigation and information hierarchy
- how the Serendepify visual language translates from the company site into an operations product
- which screens and components should be introduced
- how the transition happens without hiding or breaking existing functionality

## Product experience statement

> GroundControl should feel like a calm operator that understands the whole application path, explains consequential changes, and makes recovery safe.

The product should not feel like:

- a wall of infrastructure metrics
- a collection of unrelated deployment tools
- a chatbot wrapped around shell access
- a marketing site placed inside an admin dashboard
- an autonomous agent whose actions cannot be explained

## Current product remains the foundation

Preserve and strengthen:

- VPS connections and onboarding
- multi-host selection
- Docker, Compose, systemd, Caddy/Nginx, and Kubernetes discovery
- projects, sites, services, containers, and pods
- logs, metrics, alerts, terminal, and service controls
- deployments and deployment targets
- domains, DNS, Cloudflare, and certificates
- authentication and single-tenant operation
- existing host execution and command-safety utilities

Intelligence should consume these capabilities through structured adapters. It should not duplicate them in a separate application.

## Interface evolution

### Today

The current product is organised around infrastructure objects and tools:

~~~text
Dashboard
Projects
Services
Deployments
Infrastructure
Terminal
Alerts
Settings
~~~

### Near-term

Add intelligence to the objects users already understand:

~~~text
Overview
Applications
  ├─ service topology
  ├─ public endpoints
  ├─ journeys
  ├─ changes
  └─ recovery readiness
Deployments
Infrastructure
Intelligence
  ├─ investigations
  ├─ Loop Runs
  └─ change ledger
Terminal
Settings
~~~

This is an evolutionary map, not an immediate rename checklist.

### Later

When the intelligence layer is real and evaluated, the product can consolidate around outcomes:

~~~text
Overview
Applications
Intelligence
Deploy
Infrastructure
Settings
~~~

Raw logs, metrics, containers, terminal, DNS, and service controls remain accessible within the relevant application or infrastructure context.

## Current-to-future mapping

| Current area | Preserve now | Intelligence evolution |
|---|---|---|
| Dashboard | Host, container, metric, and alert visibility | Lead with customer-impacting applications, active investigations, recent changes, recoveries, and capacity risks |
| Projects | Folder and deployment grouping | Become application ownership and repository/deployment context |
| Services | Containers, proxy, tunnels, DNS, and controls | Become the operational application view with topology, endpoints, dependencies, journeys, changes, and actions |
| Topology | Current host/project/service graph | Extend to domain → DNS → TLS → proxy → network → container → process → dependency |
| Deployments | Existing targets, status, logs, and actions | Add immutable artifact identity, affected-service mapping, verification state, and change correlation |
| Alerts | Existing threshold and failure alerts | Become triggers attached to an investigation rather than isolated notifications |
| Metrics | Existing host and container charts | Become evidence, baseline, and verification signals while remaining directly inspectable |
| Terminal | Existing operator access | Remain an advanced audited path; never become the default model execution mechanism |
| Settings | Connections, providers, security, targets, and rules | Add journey credentials, retention, autonomy modes, action permissions, and evidence policy |

## Application as the primary object

Users operate applications, not disconnected containers.

An application should join:

- repository and current commit
- immutable artifact
- deployment history
- Compose project and services
- public domains and endpoints
- reverse-proxy routes
- networks and internal ports
- databases, queues, and external dependencies
- confirmed customer journeys
- recent changes
- alerts and investigations
- recovery readiness and autonomy mode

The current Project or Site model may evolve into Application, but migration should preserve stable identifiers and existing links.

## Core information hierarchy

Every intelligence view should prioritise:

1. Customer impact
2. Current verified state
3. Meaningful recent change
4. Evidence and uncertainty
5. Proposed action and risk
6. Verification and rollback
7. Raw infrastructure detail

Do not lead an incident with CPU and memory unless they explain the impact.

## App shell

### Navigation

Use a restrained left navigation on desktop and a compact drawer on smaller screens.

Recommended groups:

- Operate: Overview, Applications, Intelligence
- Ship: Deployments
- Manage: Infrastructure, Settings
- Advanced: Terminal

Do not add separate top-level links for Investigations, Journeys, Memory, Policies, and Loop Runs. These belong inside Intelligence or the relevant Application.

### Global context bar

Keep persistent context for:

- active host or fleet
- active environment
- connection state
- command/search access
- current user

When an investigation is active, expose its state without replacing the page title.

### Command surface

A command palette may navigate, filter, open an application, start a read-only investigation, or reach an existing action. It must not bypass confirmation or policy.

## Screen contracts

### 1. Overview

Purpose: answer what needs attention across the fleet.

Lead with:

- applications with customer impact
- active investigations
- changes awaiting verification
- recent recoveries
- capacity or certificate risks
- host connectivity

Secondary content:

- host utilisation
- container counts
- deployment activity
- alert volume

Avoid a grid where every card has equal visual weight.

### 2. Applications list

Each row or compact card should show:

- application identity
- public endpoint
- host/environment
- deployed artifact
- verified health
- last meaningful change
- active journey or investigation
- autonomy mode

Support fast filtering by degraded, changed, unverified, recovering, host, environment, or owner.

### 3. Application detail

Use a stable header with:

- application name and environment
- public health
- deployed version
- last verified time
- autonomy mode
- primary operator action

Recommended internal views:

- Summary
- Topology
- Journeys
- Changes
- Operations
- Settings

Summary should connect customer health, topology, current artifact, dependencies, recent changes, and open investigation.

### 4. Intelligence workspace

Purpose: one home for Loop activity without creating another product.

Views:

- Active investigations
- Loop Runs
- Change ledger
- Operational memory
- Policy status

An empty state should help the operator confirm one application and one public journey, not advertise abstract AI.

### 5. Investigation

The investigation is the flagship intelligence surface.

~~~text
Trigger and customer impact
        ↓
Relevant change set
        ↓
Affected service path
        ↓
Evidence timeline
        ↓
Hypotheses and uncertainty
        ↓
Recovery plan and risk
        ↓
Approval or guidance
        ↓
External verification or rollback
~~~

Required regions:

- incident state and customer impact
- service relationship graph
- chronological evidence stream
- meaningful change comparison
- hypotheses with supporting and contradicting evidence
- remaining uncertainty
- proposed action
- risk and approval state
- verification journeys
- rollback readiness
- audit trail

Conversation may appear as a supporting inspector. It must not replace structured evidence.

### 6. Service relationship graph

The graph should:

- centre the affected customer path
- support domain-to-process tracing
- show healthy, degraded, changed, unknown, and selected states with labels and colour
- reveal evidence and recent changes on selection
- collapse unrelated infrastructure
- remain usable as a list/tree on small screens
- avoid decorative force-directed motion

A useful path:

~~~text
checkout.example.com
  → DNS
  → TLS
  → Caddy route
  → Docker network
  → payments-api:3000
  → PostgreSQL
~~~

### 7. Change ledger

Join:

- Git commit
- workflow
- artifact
- deployment
- Compose change
- proxy change
- environment schema change
- container replacement
- manual GroundControl action
- health and journey result

Allow comparison with the last verified healthy state.

### 8. Customer journeys

Each journey should show:

- outcome-oriented name
- criticality
- trigger relationships
- environment eligibility
- synthetic identity and cleanup policy
- last result and duration
- evidence
- ownership and confirmation status

Generated journeys remain proposed until confirmed.

### 9. Recovery plan

Show:

- plain-language diagnosis
- smallest proposed change
- semantic and text diff
- supporting evidence
- remaining uncertainty
- preconditions
- risk
- policy decision
- verification plan
- rollback
- execution budget

The approval control must state exactly what will change.

### 10. Autonomy settings

Per application:

- Monitor
- Guide
- Approve
- Autopilot
- Locked

Show actions inside:

- allowed
- approval required
- prohibited

Do not use a single global “AI control” switch.

## Visual direction

The company site established the shared Serendepify character:

- editorial typography
- warm neutral surfaces
- deep graphite operational panels
- lime and coral/orange signal colours
- fine borders
- generous spacing
- compact monospace evidence
- motion that explains a process

GroundControl should translate that language into a denser operations variant.

### Product versus marketing

| Company site | GroundControl |
|---|---|
| Large narrative headlines | Large type only for application, incident, or decision orientation |
| Spacious editorial sections | Compact work surfaces with clear grouping |
| Demonstrative product panels | Real structured data and actions |
| Cyclic explanatory animation | Event, investigation, journey, and recovery transitions |
| Expressive layout changes | Stable shell and predictable navigation |

## Design tokens

Use semantic tokens rather than hard-coded colours inside components.

~~~css
:root {
  --gc-canvas: #f1f0e8;
  --gc-surface: #f8f7f1;
  --gc-surface-muted: #e8e7dc;
  --gc-ink: #171812;
  --gc-text-muted: #6e7067;
  --gc-border: rgba(23, 24, 18, 0.14);

  --gc-dark: #12140f;
  --gc-dark-surface: #191c16;
  --gc-dark-border: rgba(255, 255, 255, 0.12);

  --gc-verified: #c8ff3d;
  --gc-critical: #ff6846;
  --gc-warning: #d6a62e;
  --gc-info: #7e91ff;
  --gc-unknown: #8b8e84;
}
~~~

These values are starting points. Check contrast before adoption.

## Type system

- Display: application identity, incident orientation, decisive headings.
- Body: explanations, labels, actions, and guidance.
- Mono: identifiers, timestamps, evidence, metrics, diffs, configuration, and machine state.

Keep body copy plain and operational. Prefer “Caddy targets api:8080; the service now listens on 3000” over “AI detected an infrastructure anomaly.”

## Component language

Build reusable components for:

- ApplicationHealth
- ServicePath
- ChangeEvent
- ChangeComparison
- JourneyResult
- EvidenceStream
- HypothesisList
- UncertaintyNotice
- RiskBadge
- AutonomyBadge
- RecoveryPlan
- ApprovalGate
- VerificationResult
- RollbackState
- LastHealthyComparison
- OperationalMemoryMatch

Avoid a universal card component that erases hierarchy.

## Motion

Use motion to explain:

- a host change entering the ledger
- impact propagating through a service path
- a targeted journey running
- evidence arriving
- a hypothesis being confirmed or rejected
- recovery advancing
- verification succeeding
- rollback restoring the last healthy state

Constraints:

- preserve native scrolling
- prefer 180–420ms interface transitions
- run cyclic demonstrations only in preview/demo surfaces
- start expensive motion only in view
- preserve manual interaction
- pause for keyboard interaction where needed
- respect prefers-reduced-motion
- never hide essential state behind animation

## Density modes

Default to comfortable operational density. A future compact mode may support large fleets, but do not compress the first product until hierarchy is proven.

Within a dense surface:

- group evidence tightly
- separate conceptual regions generously
- align timestamps and identifiers
- keep primary action visually distinct
- keep destructive action visually isolated

## Copy rules

Use:

- customer outcome
- concrete system relationship
- evidence
- explicit uncertainty
- exact action
- verification
- rollback

Avoid:

- “magic”
- “self-healing” without policy boundaries
- generic “AI-powered”
- claims of autonomy before evaluation
- new names for every internal capability
- language that suggests GroundControl replaces current test, CI, or hosting tools

## Accessibility

Required:

- keyboard access to navigation, tabs, filters, graphs, dialogs, and approval controls
- visible focus
- state labels in addition to colour
- contrast checks across light and dark surfaces
- reduced-motion behaviour
- list/tree alternative for topology
- no critical evidence hidden behind hover
- readable mobile evidence and action order
- accessible live announcements for meaningful Loop state changes without noisy updates

## Responsive behaviour

On narrow screens preserve:

1. customer impact and current state
2. active action or approval
3. evidence timeline
4. verification and rollback
5. topology summary
6. raw telemetry

Replace large topology canvases with a focused service-path list. Keep destructive controls away from common navigation gestures.

## Implementation approach

### Phase A — visual foundations without navigation disruption

- introduce semantic tokens
- establish typography and spacing
- improve page frames, status, tables, logs, and empty states
- keep current routes and functionality
- create Storybook or a seeded internal component gallery if the repository adopts one

### Phase B — application-centred surfaces

- add stable Application identity
- evolve Services and Topology around application context
- add current artifact, endpoint, change, and verification summaries
- preserve old controls inside Operations

### Phase C — Intelligence workspace

- add read-only investigations, Loop Runs, and change ledger
- add evidence stream and service-path components
- link alerts and deployments to investigations

### Phase D — guided recovery

- add recovery plan, risk, approval, verification, and rollback surfaces
- keep mutation approval-gated

### Phase E — guarded autopilot

- expose evaluated action policies and service autonomy
- keep destructive and stateful operations outside autopilot

## Suggested frontend structure

~~~text
src/
  app/
    applications/
    intelligence/
    investigations/
  components/
    shell/
    applications/
    topology/
    changes/
    journeys/
    intelligence/
    recovery/
  lib/
    design/
      tokens.css
      states.ts
    intelligence/
      types.ts
~~~

Adapt this map to the current repository rather than forcing directory churn before implementation.

## Design acceptance criteria

- Existing VPS management remains reachable.
- Concept and live capability are clearly distinguished.
- GroundControl remains the product; Loop remains its engine.
- The application and customer path are more prominent than isolated host metrics.
- Every intelligence surface can represent evidence and uncertainty.
- Every mutation surface can represent risk, approval, verification, and rollback.
- The visual system feels related to Serendepify without becoming a marketing page.
- Responsive, keyboard, contrast, and reduced-motion behaviour pass review.
- Lint, tests, and production build pass for implementation changes.

