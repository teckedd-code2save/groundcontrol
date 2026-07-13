# Serendepify and GroundControl visual system

## Shared character

The company site and product should feel related through typography, spacing, colour discipline, borders, and motion. They should not be identical.

- Company site: editorial, spacious, narrative, expressive.
- GroundControl: operational, denser, structured, calm under pressure.

## Colour

Use a restrained system:

- warm paper neutrals for primary light surfaces
- graphite or near-black for operational focus areas
- lime for verified progress, healthy live state, and primary emphasis
- orange/coral for incident, failure, or consequential attention
- muted olive/grey for secondary evidence and labels

Do not use lime and orange as decoration. Couple colour with label, icon, or state text.

## Typography

- Display/editorial sans for major orientation and application identity.
- Highly legible body sans for explanations and actions.
- Monospace for timestamps, identifiers, evidence, configuration, code, metrics, and state-machine output.

Use large type sparingly inside the product. A service or incident title may be editorial; dense operational data should remain compact.

## Layout

- Use clear page frames and strong alignment.
- Prefer one dominant work surface over many equal cards.
- Use generous whitespace between conceptual groups and compact spacing within evidence groups.
- Use 1px borders and surface contrast before shadows.
- Keep corner radius controlled; operational panels should not resemble consumer widgets.
- Let tables, timelines, graphs, diffs, and evidence lists carry information density.

## Components

Preferred:

- service relationship graph
- change timeline
- evidence stream
- hypothesis panel
- customer-journey result
- risk and autonomy badge
- semantic configuration diff
- recovery ladder
- verification pulse
- rollback state
- last-known-healthy comparison

Avoid:

- generic metric-card walls
- decorative AI chat bubbles as the main surface
- unexplained confidence gauges
- floating glass panels
- excessive gradients
- motion attached to every element

## Motion

Use motion to communicate:

- a change propagating through dependencies
- an investigation moving through evidence
- a journey executing
- a recovery advancing
- verification succeeding or rollback restoring state

Guidelines:

- Prefer 180–420ms UI transitions.
- Use longer cyclic demonstrations only on marketing or seeded preview surfaces.
- Start cyclic motion only when visible.
- Preserve manual control.
- Pause for keyboard interaction when appropriate.
- Respect prefers-reduced-motion.
- Never hijack native scrolling.

## Accessibility

- Meet contrast requirements on light and dark surfaces.
- Keep focus visible.
- Make every state understandable without colour.
- Support keyboard navigation for tabs, graphs, dialogs, and recovery decisions.
- Preserve readable line lengths and minimum touch targets.
- Avoid hiding critical evidence behind hover.

## Product previews

Conceptual interfaces may demonstrate the direction, but label them product direction or preview. Reuse real GroundControl entities and plausible evidence. Do not fabricate customer counts, success rates, or shipped integrations.
