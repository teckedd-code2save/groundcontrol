# GroundControl product direction

## Product truth

GroundControl is operational intelligence for applications running on infrastructure the operator owns.

The current self-hosted VPS cockpit is the foundation. It already provides authenticated access to hosts, Docker, Compose, Caddy or Nginx, services, deployments, logs, metrics, alerts, terminal operations, domains, and infrastructure state.

Loop adds a continuous evidence chain:

~~~text
observe → understand → test → diagnose → recover → verify → remember
~~~

## Flagship promise

GroundControl understands what is running on a VPS, tests what a meaningful change can affect, and safely guides or performs recovery when the customer experience breaks.

## First customer

A founder or lean team operating Docker Compose applications behind Caddy or Nginx across one to five VPS hosts without a dedicated SRE team.

## First incident family

A public web application becomes unreachable or returns 502/503 after a Docker, Compose, proxy, environment, DNS, TLS, or deployment change.

## Implementation sequence

1. Read-only Docker, Compose, Caddy, DNS, TLS, and endpoint intelligence.
2. Domain-to-container service graph and change ledger.
3. Last-known-healthy snapshots.
4. One operator-confirmed external journey.
5. Structured evidence-based investigation.
6. Guided reversible repair.
7. Approved action, external verification, and rollback.
8. Daytona reproduction for eligible code or configuration failures.
9. Guarded autopilot after deterministic evaluation.

## Product hierarchy

- GroundControl: flagship product and operational control plane.
- Loop: intelligence and recovery engine inside GroundControl.
- Loop Run: one execution and evidence chain.
- Convoy: independent supervised delivery product.
- Forge: independent developer tool for agent-ready practices.

Gemini, Daytona, journey execution, proxy validation, rollback, and operational memory are implementation capabilities, not new brands.

## Boundaries

GroundControl does not initially become:

- a generic observability replacement
- a new CI provider
- an unrestricted production shell agent
- a broad synthetic-testing platform
- a Kubernetes management suite
- a replacement for GitHub Actions, Coolify, Portainer, or existing test tools

It consumes signals from existing systems while owning live service understanding and verified recovery.

## Maturity language

- Say live only for usable current capability.
- Say early access for working but limited capability.
- Say in progress when real implementation exists but acceptance is incomplete.
- Say product direction or preview for seeded and conceptual experiences.
- Never use a future mockup as evidence of shipped functionality.
