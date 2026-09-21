# GroundControl launch playbook

## Launch position

**One line:** Give ChatGPT and other approved agents scoped deployment capabilities on infrastructure you own—without sharing SSH keys.

**Proof:** ChatGPT operated an enrolled production deployment through a scoped OAuth grant, a durable GroundControl operation, and customer-facing verification. Separately, the installer passed fresh-host install, claim, verification, upgrade and data-preserving uninstall acceptance.

**Primary audience:** founders and lean engineering teams running Docker Compose behind Caddy or Nginx on one to five VPS hosts.

## Do not lead with

- “AI-powered VPS dashboard”
- the full feature inventory
- Daytona as a separate product
- unrestricted autonomous infrastructure
- replacement claims for GitHub Actions, Portainer or existing CI

Lead with the trust boundary and the verified outcome.

## Proof bundle required before launch

- [x] Public product page
- [x] Public source repository
- [x] One-command private-first installer
- [x] Redacted clean-host acceptance record
- [x] Real ChatGPT grant, health and redeploy captures
- [x] Verified production deployment evidence
- [x] Adoption guide
- [x] Technical article draft
- [ ] 45–75 second launch video using the real sequence
- [ ] One clean social image
- [ ] Public GitHub release/tag
- [ ] Issue and discussion templates for pilot feedback
- [ ] Three external testers who did not build the product

## Product Hunt

### Tagline

**Infrastructure capabilities for AI agents—without sharing SSH keys**

### Short description

GroundControl is a self-hosted control plane that lets ChatGPT and other approved agents inspect deployments, check health and configuration, start durable redeploys, and return verification evidence on infrastructure you own.

### First comment

I built GroundControl after repeatedly facing the same uncomfortable choice: either keep an AI agent away from production, or give it credentials and a terminal.

GroundControl introduces a control plane between the agent and the VPS. The agent receives deployment-scoped, typed capabilities through MCP and OAuth. GroundControl keeps SSH keys and provider credentials, enforces policy, runs durable operations, and verifies the customer-facing result.

For the production proof, ChatGPT operated RentAWeekend through a scoped grant. A signed merge event created a durable deployment operation; web, API, PostgreSQL and Redis finished healthy, and the public endpoint returned HTTP 200.

The installer has also passed a disposable clean-host acceptance covering one-time ownership claim, persistent storage, MCP/OAuth discovery, idempotent rerun, backup-backed upgrade and data-preserving uninstall.

I would especially value feedback from founders and small teams running Docker Compose on VPS infrastructure: what would you need to trust this with one real service?

### Gallery order

1. The promise: agent capabilities without SSH keys
2. OAuth grant with exact deployment and capabilities
3. ChatGPT reading live health
4. Durable operation ID and progress
5. Verified public outcome
6. Private-first installation and one-time claim
7. Architecture/trust-boundary diagram
8. Adoption CTA

## Hacker News

### Title

Show HN: GroundControl – let agents operate your VPS without giving them SSH

### Post

I built GroundControl, a self-hosted control plane for Docker Compose applications behind Caddy/Nginx.

Instead of giving an agent a terminal, GroundControl exposes deployment-scoped capabilities through MCP + OAuth: inspect, health, logs, secret-safe configuration presence checks, durable redeploy, and operation evidence.

The production proof used ChatGPT against one enrolled RentAWeekend deployment. The agent received no SSH key. A signed allowed push became a durable operation; GroundControl completed the deployment and verified web, API, PostgreSQL, Redis and the public endpoint.

The installer is private-first and has a clean-host acceptance covering one-time claim, persistent storage, MCP/OAuth discovery, idempotent rerun, guarded upgrade and data-preserving uninstall.

Source: https://github.com/teckedd-code2save/groundcontrol
Product: https://trygroundcontrol.serendepify.com

I am looking for feedback from people running small VPS fleets: is the typed capability boundary enough for you to let an agent operate one non-critical service?

## Reddit and communities

Use the same evidence, but adapt the question:

- r/selfhosted: focus on single tenancy, private-first installation, data ownership and no shared dashboard.
- r/devops: focus on deterministic policy, durable operations, exact revisions, verification and rollback.
- Docker/Compose communities: focus on preserving repository-owned Compose.
- MCP/agent communities: focus on OAuth grants and constrained tool surfaces.
- Indie Hackers: focus on operating without a dedicated SRE team.

Do not cross-post identical copy on the same day. Participate in the discussion and publish technical details before asking for adoption.

## LinkedIn

### Founder post

I wanted ChatGPT to help operate my applications—but I did not want to give it an SSH key.

So I built GroundControl: a self-hosted control plane that gives approved agents scoped deployment capabilities through MCP and OAuth.

The agent can inspect a selected deployment, check health and configuration, start a durable redeploy, reconnect later, and report verification evidence. GroundControl keeps the credentials and enforces the action boundary.

We have now proven the path on a real RentAWeekend deployment and passed a fresh-host distribution acceptance covering install, one-time claim, persistent storage, upgrade and data-preserving uninstall.

The interesting part is not that an AI ran a command. It is that the model never held production authority.

Try it: https://trygroundcontrol.serendepify.com
Source: https://github.com/teckedd-code2save/groundcontrol

## Launch order

1. Recruit three design partners and watch them install without help.
2. Fix the first-run blockers they expose.
3. Publish the technical article and GitHub release.
4. Publish the launch video and LinkedIn proof.
5. Launch on Product Hunt.
6. Submit Show HN after the technical article is live.
7. Share tailored posts with self-hosted, DevOps and MCP communities.
8. Track installs, claims, first enrolled deployment, first health check, first durable operation and verified recovery.

## Adoption metrics

Track a small funnel:

| Stage | Signal |
|---|---|
| Interest | Product-page visit → source/install click |
| Install | Installer returns `claim_required` |
| Ownership | One-time claim completes |
| Activation | First VPS and deployment are enrolled |
| Agent value | OAuth grant completes and first health check runs |
| Operational value | First durable operation reaches verified success |
| Retention | Operator returns or runs another verified operation within 14 days |

Never collect claim tokens, secret values, raw credentials or customer log contents as launch analytics.

## Stop conditions

Delay broad launch if:

- a fresh install cannot complete without author intervention;
- the latest image and installer checksum disagree;
- one-time claim or private binding regresses;
- upgrades cannot restore a healthy previous state;
- the public site claims features beyond current evidence;
- the first three external pilots cannot reach a verified health check.
