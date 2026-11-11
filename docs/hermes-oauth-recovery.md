# Native Hermes OAuth recovery

GroundControl's `/mcp` keeps action discovery public and requires a valid, resource-scoped OAuth token for every tool invocation. Discovery alone does not prove that a client is authenticated.

## Fixed failure

A native Hermes session can lose its connection when its refresh token is rejected (`invalid_grant`). Previously the following unauthenticated tool invocation returned HTTP 200 with an MCP `isError` result. Hermes' OAuth HTTP client only initiates authorization on HTTP 401, so it could report a missing Bearer token without starting fresh consent.

Tool authentication failures now return the `OAuthBearerError` HTTP status: 401 for missing/invalid tokens and 403 for insufficient scope. The response still contains the `WWW-Authenticate` header, MCP error content, and `_meta["mcp/www_authenticate"]` required by tool-level clients. Public initialize/discovery/tools-list behavior is unchanged. Workload resolution, scopes, write approvals and durable operations are unchanged.

This follows the [MCP authorization status requirements](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization) while preserving the [OpenAI tool-level authentication challenge](https://developers.openai.com/plugins/build/auth).

## Verification

- Route tests cover legacy and current protocol authentication challenges, exact-scope denial, no execution before authentication, fresh authenticated retry, and ordinary tool failures.
- All 594 GroundControl tests pass. Production build and focused ESLint pass.
- `scripts/check-hermes-oauth-transport.py` exercises the installed native Hermes OAuth provider against an in-memory HTTP transport. It reproduces the old HTTP 200 failure and verifies HTTP 401 recovery, including rejected refresh, fresh consent, S256 PKCE, token exchange and exactly one authorized retry. Its four tests do not contact production, use real credentials, read user token storage or open a browser.

Run the native-client compatibility test with the existing Hermes Python environment:

```sh
~/.hermes/hermes-agent/venv/bin/python scripts/check-hermes-oauth-transport.py
```

These tests are not evidence of a live deployment or a completed live reauthentication. After installing the fix, restore native OAuth consent with the same intended workload/scopes, reload the client connection and require a fresh successful `deployment.list`, `deployment.inspect` and `deployment.health`. Do not substitute old health values. If a write was already accepted before a disconnect, resume its operation ID; never replay it blindly.

## Upgrade boundary

No schema or migration changes are required by this fix. Upgrade only GroundControl's web container using the reviewed pinned image, preserve its existing SQLite/Compose/environment state, take a consistent backup while quiesced, and verify health after startup. The upgrade supervisor must run independently of GroundControl's terminal helper. Do not use the legacy reset/migrate/prune workflow as a shortcut. Roll back the prior image/configuration and database snapshot on startup or verification failure.
