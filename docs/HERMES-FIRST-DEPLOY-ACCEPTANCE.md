# Hermes repository-to-live acceptance

Status: release gate, not a record of tests passed.

## A useful real service

Use a small public **release evidence board**: a web app listing releases, health
checks and human-readable change summaries for a project. Start with one usable
screen and a health endpoint; Hermes adds a meaningful feature after first launch.
Use synthetic example release data, never customer records or secrets. The app
must be independent of GroundControl so opening it proves an application was
actually deployed rather than showing the GC dashboard.

The recorded task is: “Take this repository, propose its deployment on this
server, tell me what information is missing, and get it working through
GroundControl. Then add a filter for failed checks and release that improvement.”
Do not prepare a hidden enrollment to make this appear supported. Pin the exact
repository revision shown in each approval. Keep rehearsal and recorded service
identities separate so the recording exercises first enrollment again.

## Gate 1: access and native Hermes

- Install the exact tested Hermes and plugin revisions; record both.
- Verify trusted HTTPS and actual MCP transport, not only a successful dashboard
  login. Do not infer streaming support from a Quick Tunnel login URL.
- Connect through native MCP/OAuth; consent initially to proposal-only access.
- Prove zero existing deployments is supported without selecting unrelated apps.
- Disable no approval safeguards for convenience. Reject one harmless proposal or
  mutation at Hermes approval and prove no corresponding server action happened.
- An “Approve Once” permits that exact action; a retained broad grant or YOLO mode
  invalidates this approval test.

## Gate 2: proposal and owner review

- Hermes submits repo identity, immutable SHA and Compose path, not shell commands
  or secret values. Duplicate idempotency key returns the same proposal.
- Owner sees actual pinned workload configuration, privileges, server, expected
  application access and required configuration before accepting.
- Missing dependencies and inputs produce precise, actionable next steps before
  host mutation. Installation/firewall/DNS changes require their own authorization.
- No automatic default selection of other deployments or grant expansion.
- Rejected, expired, tampered, cross-client and revoked proposals cannot execute.

## Gate 3: first launch

- Acceptance reserves an exclusive directory and pending enrollment; source link
  and immutable recipe persist. Never delete an occupied directory to recover.
- Owner explicitly grants this new deployment and Hermes obtains fresh consent.
- Hermes requests first launch; durable operation ID is visible immediately.
- The server checks authorization again, fetches the pinned source and records
  execution phases. Credentials stay in the established encrypted store.
- Prove app readiness with its own health response and a real browser interaction.
  A running container or reachable GC alone is not success evidence.
- Capture operation result, deployed revision and deployment ID. Verify HTTPS
  without skipping certificate checks if public HTTPS is the selected access mode.

## Gate 4: evolution and failure behavior

- Hermes makes and tests the failed-check filter in the actual repository.
- Show changed revision and tests; approve release through GC, not a hidden SSH
  command. Confirm browser behavior and revision after release.
- Reusing an operation key must not start another deployment.
- Interrupt a disposable rehearsal operation safely; unknown results must be
  marked uncertain and inspected rather than blindly retried.
- Revoke access and demonstrate the next operation cannot run.

## Recording evidence

Keep readable terminal, Hermes tool calls, owner approvals, GC operation evidence
and the working app visible. Explain tradeoffs aloud. Hide tokens, claim URLs,
private SSH keys, passwords and provider credentials. Do not replace failed output
with reconstructed logs. Capture bugs as bugs and retest the corrected build.

The final report must distinguish **unit-tested**, **integration-tested** and
**live-rehearsed**, and include any manual setup. No promise of “no issues” follows
from a green unit suite.
