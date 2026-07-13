---
name: shape-groundcontrol
description: Preserve and apply the GroundControl and Serendepify product direction across implementation, design, copy, planning, and review. Use automatically for any task involving the GroundControl repository, GroundControl, Loop, Autopilot, VPS intelligence, investigations, synthetic journeys, recovery, the Serendepify company site, product navigation, naming, marketing language, frontend components, screenshots, visual redesigns, or operator-facing architecture. Also use when changes to Convoy or Forge affect the Serendepify product hierarchy.
---

# Shape GroundControl

Keep product truth, interface evolution, and visual craft coherent while GroundControl grows from a VPS cockpit into operational intelligence.

## Start from reality

1. Inspect the current repository, especially docs/LOOP.md, README.md, existing navigation, routes, components, design tokens, and current product capabilities.
2. Separate three states explicitly:
   - live: implemented and usable
   - in progress: code exists but is not complete
   - product direction: conceptual or seeded demonstration
3. Never turn a concept surface into a shipping claim.
4. Preserve working VPS functionality unless the task explicitly replaces it.

## Hold the product hierarchy

- GroundControl is the flagship product and self-hosted operational control plane.
- Loop is GroundControl's intelligence and recovery engine, not a competing product.
- A Loop Run is one evidence chain from change or failure through verification.
- Convoy and Forge remain focused independent products; do not force them into GroundControl.
- Existing VPS access, topology, services, deployments, logs, metrics, terminal, proxy controls, and authentication are the foundation—not legacy clutter to discard.

Read references/product-direction.md for positioning, boundaries, maturity language, and the implementation sequence.

## Evolve the interface incrementally

Design intelligence into the current product rather than depicting a ground-up replacement.

- Reuse current entities and actions.
- Add intelligence first as linked context on services, changes, alerts, and deployments.
- Introduce a dedicated Intelligence workspace when investigations and Loop Runs become real.
- Rename or consolidate navigation only when the new structure reduces confusion and no capability becomes harder to find.
- Preserve an advanced path to raw logs, terminal, metrics, and host controls.

Read references/interface-architecture.md before changing navigation, routes, dashboards, service pages, alerts, investigations, journeys, autonomy settings, or product mockups.

## Apply the visual system

Carry the company site's visual confidence into GroundControl without making an operations product feel like a marketing page.

- Use editorial scale for orientation, compact type for operational detail, and monospace for evidence, identifiers, state, and time.
- Use warm neutral surfaces, deep operational panels, precise borders, generous spacing, and one signal colour per meaning.
- Prefer service maps, evidence streams, change comparisons, timelines, journey results, risk indicators, and recovery diffs over generic cards.
- Use motion to explain state change, causality, progress, verification, and recovery.
- Keep scrolling native and interactions responsive.
- Respect reduced motion, keyboard use, contrast, and small screens.
- Avoid decorative AI gradients, floating particles, glass everywhere, excessive rounding, and motion without information.

Read references/visual-system.md before implementing or reviewing UI, CSS, design tokens, motion, diagrams, screenshots, or marketing surfaces.

## Make intelligence legible

Every intelligence surface should answer:

1. What changed or failed?
2. What customer outcome is affected?
3. What evidence supports the conclusion?
4. What remains uncertain?
5. What action is proposed?
6. What is its risk and approval requirement?
7. How will success be verified?
8. What is the rollback?

Do not present a chat box as the primary intelligence experience. Conversation may help investigation, but evidence and action state remain structured.

## Protect the autonomy ladder

Keep the modes distinct:

- Monitor: observe and verify.
- Guide: diagnose and prepare exact steps.
- Approve: execute a reversible plan after approval.
- Autopilot: execute only evaluated, allowlisted, low-risk actions.
- Locked: never mutate.

Do not imply that model confidence grants permission. Policy, action typing, verification, rollback, and audit remain deterministic.

## Review checklist

Before completing work:

- Confirm product hierarchy and feature maturity are honest.
- Confirm the change builds on current GroundControl.
- Confirm customer outcome is more prominent than raw infrastructure state.
- Confirm evidence, uncertainty, action, verification, and rollback are representable.
- Confirm names do not create unnecessary products or sub-brands.
- Confirm visual work follows the operations variant of the Serendepify system.
- Confirm responsive, keyboard, contrast, and reduced-motion behaviour.
- Run repository-relevant lint, tests, and production build.
- Update product-direction documents when a design decision becomes durable.
