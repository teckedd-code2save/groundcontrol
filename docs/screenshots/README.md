# Screenshots

## Verified live evidence

The [BNL case-study screenshots](bnl-2026-09-28/README.md) document actual GroundControl terminal verification and the resulting public playground. Each capture has a caption, scope and checksum. Keep live evidence separate from explicitly labelled product demonstrations.

Drop PNGs here and they'll render in the main [README](../../README.md). Capture at a consistent width (≈1440px, retina/2x if you can) on a dark background for a clean, cohesive look.

Suggested shots (file names the README expects):

| File | What to capture |
|------|-----------------|
| `topology.png` | The live topology graph with several nodes — Internet → Host → Caddy → Sites → Containers. The signature shot. |
| `dashboard.png` | The dashboard with the narrative health overview, stat cards, and a metrics chart. |
| `containers.png` | The container list with status badges and the action menu (start/stop/logs) open. |
| `ai-assistant.png` | The AI chat widget mid-conversation, ideally answering an ops question with a streamed reply. |
| `terminal.png` | The browser terminal with a live command result. |
| `alerts.png` | The alerts/incidents view showing a few severity levels. |
| `proxy.png` | The proxy view showing a parsed Caddy/Nginx site mapped to a container. |

Tips:
- For evidence, capture actual runtime state, including empty states. Use [demo data](../demo-data.md) only for an explicitly labelled demonstration; never present seeded values as a measured live outcome.
- Hide or blur any real hostnames, IPs, or domains.
- Keep the same browser zoom and window size across shots for visual consistency.
- A short looping GIF of the topology graph or a deploy is a great hero asset for social posts.
