# GroundControl launch interface

The launch interface presents GroundControl as a self-hosted operational control plane, not a generic server dashboard or an AI concept demo.

## Hierarchy

1. Customer impact and current operational state
2. The next safe action or decision
3. Evidence, changes, and verification
4. Workload and runtime state
5. Raw host telemetry and advanced controls

The dashboard therefore leads with one operational state surface. Metrics support that state instead of competing with it as equal cards.

## Navigation

- **Observe:** Overview, Intelligence, Alerts
- **Operate:** Projects, Deployments, Runtime
- **Build:** Templates
- **Tools:** Assistant, Terminal
- **System:** Settings

Capabilities remain available, but are grouped by operator intent. Intelligence is evidence-led; the assistant remains a supporting tool.

## Visual rules

- Graphite surfaces and warm neutral text keep the product calm under pressure.
- Signal blue means the primary safe action or active selection.
- Green is reserved for verified health and successful outcomes.
- Amber and red are reserved for consequential attention.
- Editorial type is used for orientation; monospace is limited to identifiers, timestamps, metrics, and machine state.
- Borders and surface contrast establish hierarchy before shadows.
- Motion is short, functional, and disabled when reduced motion is requested.
- Dense data remains available without exposing implementation metadata in summary views.

## Product truth

The interface must distinguish live host evidence from model analysis. Recovery always follows policy, typed actions, approval requirements, verification, rollback, and audit. Visual confidence must never imply that a conceptual or unverified capability is already operating in production.

## Existing product architecture

The design system sits beneath the current product model. It must not reinterpret these established decisions:

- Host scans discover deployment candidates but never enrol them automatically.
- A project is an organizational group of deployments. It does not own runtime, source, paths, configuration, or environment.
- A deployment is the primary management workspace for identity, source, endpoint, named environments, components, and releases.
- Secrets are write-only values owned by a named runtime environment and explicit deployment or component scope. GroundControl Vault and Infisical are provider choices; `.env` and runtime inspection are migration inputs, not sources of truth.
- Connectors are explicit capabilities with setup and readiness state.
- Intelligence reports evidence, readiness, policy, and verification honestly. It does not imply autonomous recovery when required adapters or credentials are absent.

## Component architecture

Shared components live in `src/components/ui`. Domain components keep their current behavior and compose these primitives.

- `Button` owns action hierarchy, size, focus, disabled, and destructive states.
- `Surface` and `SurfaceHeader` own primary grouping geometry.
- `Notice` owns feedback and consequence messaging across neutral, informational, successful, warning, and dangerous states.
- `StatusBadge` owns compact machine or workflow status. It is not decorative metadata.
- `ModalSurface` owns dialog structure, focus containment, focus restoration, viewport fit, escape and backdrop behavior.
- `ContextActionMenu` owns secondary actions that should not compete with a page's primary action.

Pages and domain components should not create new button, notice, badge, dialog, or panel styling from raw utility strings when an existing primitive represents the state. Monospace is reserved for machine-readable values; file paths and provenance stay in detail views instead of summary rows.

## Migration rule

Migrate one complete workflow at a time and preserve its API and domain behavior. Broad selectors and `!important` overrides are not a substitute for component adoption because they can change mature screens without reviewing their states.
