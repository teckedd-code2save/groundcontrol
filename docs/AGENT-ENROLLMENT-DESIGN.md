# Agent-assisted first deployment: proposed boundary

Status: experimental local implementation, disabled by default. Not live-rehearsed or a catalog release.

## Why the current tool cannot do this

`deployment.source.deploy` resolves an existing `EnrolledDeployment` through the
OAuth grant's approved IDs, then queues a durable operation. The runtime contract
rejects `kind=source`: imported source alone is not a host/runtime recipe. Reusing
`deployment:redeploy` to create and auto-grant a new deployment would expand the
resource boundary without the operator's consent.

The existing Hermes v0.2.0 catalog can demonstrate a new version or first source
execution against an operator-prepared deployment, but must disclose preparation.
It cannot honestly demonstrate autonomous blank-repository enrollment.

## Recommended first extension

Use a staged proposal and explicit operator acceptance, not arbitrary creation:

1. Agent submits a bounded deployment proposal (public repository identity and
   immutable revision, intended runtime, required configuration key names, workload
   name and requested server). This stage does not fetch source, execute build
   commands, write secrets, open ports, allocate cloud resources or grant access.
2. GC creates a short-lived, requester-bound proposal record with a content hash
   and presents it in the authenticated owner UI. The proposal scope must be
   separately advertised and consented; current read/redeploy scopes are not enough.
3. Owner selects an existing authorized server, reviews recipe privileges and
   build source, configures secrets through the normal UI, and accepts that exact
   proposal. Never accept arbitrary host paths, privilege, host-network, socket
   mounts or command strings invisibly. Source code/builds are untrusted execution.
4. Acceptance creates the enrollment atomically, with a durable outcome and unique
   idempotency identity; collisions and changed revisions require review. It does
   not silently edit all existing OAuth grants.
5. Owner explicitly grants the new resource to the requesting agent. The agent
   reconnects if needed, obtains fresh list/inspect capability evidence, and uses
   the existing durable deploy operation after action-specific approval.

A future pre-authorized project/server envelope may remove repetitive approval,
but needs limits on resources, sources, recipes, ports, mounts and spending. It is
not equivalent to permission to redeploy an existing application.

## Acceptance tests required before exposure

- Existing tokens cannot propose/create with old scopes or target unapproved hosts.
- Proposal ownership, expiry, replay, tampering, concurrent acceptance and revocation.
- No provider secrets, source credentials, env values or private host inventory leaks.
- New enrollment is not accessible until exact resource grant approval.
- Failed DB/host setup yields a truthful recoverable state, no duplicate creation.
- Cancellation before execution makes no host mutation.
- Deployment mutation still uses durable operation/idempotency; disconnect and
  uncertain operation cannot replay as a new first deployment.
- A real Hermes session shows the proposal, owner handoff, refreshed grant, first
  approved deployment, operation evidence and externally verified application.

## Recording acceptance target

The target is a genuine repository-to-first-deployment flow. Do not substitute a
silently pre-enrolled workload. An existing-workload release can be a separate
smoke test, explicitly labelled as such, but is not acceptance of this feature.

The rehearsal must show a fresh proposal, owner review of pinned source and
configuration, creation of a pending enrollment, explicit resource consent,
Hermes execution approval, a durable first-deploy operation, and an externally
verified working application. Preserve the terminal and tool evidence; redact
claim URLs, credentials, private keys and secret values.

## Implementation stages and current gaps

The proposal prototype and consent bootstrap are deliberately feature-gated off
by default. A proposal approval records review only; it must not suggest that a
service was launched. Do not expose the prototype as a complete enrollment flow.

The local implementation now includes:

- Authenticated owner review of the actual pinned Compose configuration, not just
  a repository name. Source/build execution remains untrusted even when YAML
  passes static checks.
- Exclusive generated deployment-directory reservation, transactional enrollment
  identity and a dedicated immutable source recipe, not a fabricated GitHub App link. The existing import creates only a project;
  template persistence does not create the GitHub deployment link.
- A distinct typed durable first-deploy runner using the existing operation worker.
  The current template HTTP route runs synchronously and saves enrollment after
  host mutation; calling that route is not a safe durable-operation substitute.
- SHA-pinned public-repository checkout, occupied-path refusal, phase evidence,
  truthful failed/uncertain states, and no blind replay after interruption.
- Explicit application access plan without implicit DNS/firewall changes; trusted
  HTTPS verification must not disable certificate checking.

The first-launch runner, owner UI, acceptance transaction and durable dispatch are
implemented locally and tested. Public repositories, candidate-only encrypted runtime configuration and owned
loopback applications are supported. A separate owner-approved app-domain publisher
uses existing Caddy without changing DNS or firewall rules. Existing source.deploy
can update a full SHA when reviewed Compose/configuration/host/volume/domain policy
remains unchanged. Other deployment-policy changes still require owner review.

Passing tests are not evidence of live first-deploy support. Only an end-to-end
rehearsal closes that claim; enabling this feature is an operator decision.

## Prototype validation limitations

Unit tests and disposable SQLite integration tests cover authorization, immutable
content, acceptance, consent rotation and single-launch claims. A real-host and
native-Hermes rehearsal is still required before exposure. Add proposal rate limits
and expiry retention cleanup before enabling on a shared instance. The proposal
URL allowlist checks syntax only; it does not prove the repository exists or is
public, and deliberately does not fetch repository contents.
