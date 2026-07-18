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
- Lime means verified state or the primary safe action.
- Orange, amber, and red are reserved for consequential attention.
- Editorial type is used for orientation; monospace is limited to identifiers, timestamps, metrics, and machine state.
- Borders and surface contrast establish hierarchy before shadows.
- Motion is short, functional, and disabled when reduced motion is requested.
- Dense data remains available without exposing implementation metadata in summary views.

## Product truth

The interface must distinguish live host evidence from model analysis. Recovery always follows policy, typed actions, approval requirements, verification, rollback, and audit. Visual confidence must never imply that a conceptual or unverified capability is already operating in production.
