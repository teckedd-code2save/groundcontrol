# Hermes repository-to-live acceptance

Status: release gate, not a record of tests passed.

## Actual rehearsal target: Unstressed

Use the owner's `teckedd-code2save/swipe-to-plan` application, not a synthetic
service. Preserve its existing production deployment, domain, secrets and data.
GroundControl is already set up: show its interface, do not reset GC or SSH.

The existing production `compose.yml` contains production-specific paths and
identity. Prepare an isolated reviewed Compose recipe, dedicated named data
volume, unique Compose project and new subdomain. Do not use the development
PostgreSQL `docker-compose.yml` as if it were the application deployment.
The app serves port 4000 and `/api/health`; verify the exact target revision before
using these facts. Required provider configuration is entered explicitly by the
owner for this candidate. Do not copy production credentials or data.

Rehearse the deployment prerequisites together first. Then inventory and confirm
reset of only the disposable app deployment/data. Keep GC, its access and SSH.
Record the fresh sequence: repository → candidate configuration → domain/DNS
preparation → first launch → publish/verify app HTTPS → implement one or two
selected real features → exact-SHA source deploy → browser verification. Do not
prebuild those features or represent rehearsal output as the recorded run.

Feature selection belongs to the owner and the actual first-customer need. This
checklist does not invent the feature or claim live Qloo/model/OAuth integrations
work before exercising them with authorized candidate configuration.

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

- Hermes makes and tests the selected real Unstressed feature in the actual repository.
- Show changed revision and tests; approve exact-SHA source deploy through GC, not a hidden SSH
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

## Candidate implementation limits to surface before starting

- Runtime values use candidate-only encrypted profiles, immutable version binding,
  private stdin materialization outside the build context, and Compose 2.30+ raw
  service env files. Multiline values/build secrets need another reviewed path.
- Code-only source updates preserve the original Compose bytes, approved config,
  host, volume namespace and public route. Deployment-policy changes need review.
- App domains currently require an existing supported file-managed Caddy layout,
  direct IPv4 DNS, no unverified AAAA path and a TXT ownership challenge. Caddy
  installation and DNS/NSG/firewall changes are separate owner-authorized steps.
- Publisher verifies trusted TLS, route marker and health from the server;
  independent browser/off-host access and user journey are separate evidence.
- Uncertain outcomes are inspected, not blindly replayed. Production data, GC
  management identity and SSH are never part of the disposable app reset.
