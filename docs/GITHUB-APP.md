# GroundControl GitHub App

GroundControl uses an operator-owned GitHub App for repository discovery and change evidence. It does not require a personal access token for repository integration.

## Setup

1. Give GroundControl a public HTTPS address. Set `GC_PUBLIC_URL` or enter the address in Settings → Connectors.
2. Select **Create operator-owned GitHub App**. GroundControl sends a least-privilege manifest to GitHub.
3. After GitHub returns to GroundControl, select **Install on repositories** and choose only the repositories GroundControl should observe.
4. GitHub sends a signed installation event. GroundControl verifies it, records the installation, requests a short-lived installation token and synchronizes repository access.

If the GroundControl UI is private, expose `/api/github/webhooks` through a Cloudflare Tunnel. Repository synchronization can be triggered manually, but event-driven Intelligence is not ready until a signed webhook has been received.

## Security boundary

- The App private key, client secret and webhook secret are encrypted using `GROUNDCONTROL_SECRET`.
- Installation access tokens are requested only when needed and are never stored.
- Webhook signatures use `X-Hub-Signature-256` and are compared in constant time.
- GroundControl stores sanitized event metadata, not raw webhook payloads.
- Repository access remains controlled by the GitHub installation. Removing a repository from the installation removes it at the next signed access-change event or manual sync.

## Permissions

The manifest requests read access to metadata, contents and Actions, and write access to checks, commit statuses, pull requests and deployments. These write permissions prepare the approval and recovery path; GroundControl does not mutate a repository merely because the App is installed.

## Relationship to deployments

Repositories are linked automatically to enrolled deployments when their normalized GitHub URL matches the deployment repository identity. Unmatched repositories remain visible as **not linked** instead of being guessed from names.

Legacy GHCR credentials are separate registry credentials. They are not treated as a GitHub repository connection and are not migrated into the App automatically.
