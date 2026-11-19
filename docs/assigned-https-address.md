# Use an assigned HTTPS address

This first version supports Linux-server installations through onboarding. Desktop adoption is not enabled. No owned domain or Serendepify relay is needed. Use **your own ngrok account** and its assigned static `NAME.ngrok-free.dev` or `NAME.ngrok-free.app` address. The address survives agent restarts; availability still depends on your computer/server, Docker, the connector and provider limits. This is public, account-protected GroundControl, not private networking or a hosted GC account.

## Prepare the external connector

1. Claim GroundControl and retain your working local/SSH or existing HTTPS access.
2. Follow the [official ngrok CLI setup](https://ngrok.com/docs/gateway/endpoints/agent-cli-quickstart) using your own account. Enter the provider credential only in ngrok's own configuration, never in GC or chat. GC does not install ngrok, store its token, pay for it, or manage its service.
3. On the machine hosting GC run `docker port groundcontrol-web 3000/tcp`. Use the reported **loopback** address and port. If it reports `127.0.0.1:3003`, the forwarding command is `ngrok http http://127.0.0.1:3003`. Do not assume port 3003, use a remote client's localhost, expose the management port globally, or expose ngrok's inspection UI.
4. For restarts, configure an endpoint with that explicit upstream using [ngrok v3 configuration](https://ngrok.com/docs/gateway/agent/config/v3) and the [official service guide](https://ngrok.com/docs/gateway/agent/service). Use the account's assigned domain. A foreground process is not reboot persistence; verify the service after restart yourself.
5. In GC onboarding choose **Use an assigned HTTPS address**, paste only that HTTPS origin and choose **Verify & use assigned address**.

GC accepts only a single assigned hostname label on the two suffixes above, without credentials, ports, paths, queries or fragments. It checks matching claimed instance identity, exact-origin OAuth metadata and MCP discovery without following redirects before changing saved access. Failed verification or a concurrent access change leaves the previous selection unchanged. This is not an authenticated Hermes test.

## Access transitions

Adoption leaves existing routes running to preserve recovery. Existing bookmarks and Hermes connections do not automatically migrate. Set Hermes to the new `/mcp` URL, complete fresh OAuth consent, then verify an actual authorized deployment list and health call. Keep the former route until that works; retire it deliberately afterwards.

GC never removes an externally administered connector. When moving to Caddy/Cloudflare or another address, stop the old ngrok service yourself. GC remembers the external route even after changing methods. **Keep it private** requires your explicit confirmation that you stopped it; this is an operator attestation, not independent evidence of provider shutdown. Inspect old routes yourself. Stop and acknowledge the previous external connector before adopting a different assigned address.

Installer reruns preserve a verified saved assigned address instead of creating a new temporary bridge.

## Provider limits and security

[Assigned domains](https://ngrok.com/docs/gateway/domains) remain stable, but a free plan is not an uptime promise. [Free-plan limits](https://ngrok.com/docs/pricing-limits/free-plan-limits) include browser HTML warnings and quotas (currently 1 GB outbound data and 20,000 HTTP requests monthly). Limits can change. Long-lived HTTP connections have a five-minute idle timeout; test client reconnect behavior. See [HTTP endpoints](https://ngrok.com/docs/gateway/endpoints/http).

ngrok terminates TLS at its edge. Keep Traffic Inspector **Full Capture off** for GC login/OAuth traffic, and keep its local inspection UI private. Review [ngrok security](https://ngrok.com/security) and [traffic inspection](https://ngrok.com/docs/obs/traffic-inspection/http-requests). GC does not bypass the free browser warning or promise compatibility with every client.

## Acceptance still required

Before relying on this address: restart the connector and host, verify the URL remains stable, complete browser login and fresh native Hermes OAuth, read only the selected workload, test token refresh/reconnect and idle timeout, and confirm old routes are retired when intended. No live provider, host-reboot or Hermes acceptance is implied by unit tests.
