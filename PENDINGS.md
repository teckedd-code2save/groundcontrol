# PENDINGS — Known Sharp Edges

Things that can bite you when working with or deploying GroundControl.

---

## Next.js 16 Breaking Changes

This repo uses a version of Next.js with breaking changes — APIs, conventions, and file structure may all differ from LLM training data. Read `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices; the agent entry in `AGENTS.md` flags this for a reason.

## Remote Execution

- **Always** use `execOnVps()` and `shQuote()` from `src/lib/vps.ts` for every command run on a managed host.
- Prefer POSIX sh / BusyBox syntax; avoid bashisms. Alpine and minimal VPS images may not have bash.
- Never string-interpolate user input into shell commands, even with `shQuote`.

## VPS Auto-Detection

- `src/lib/server-probe.ts` runs POSIX sh commands only. Test new probes against Alpine, Debian, and Ubuntu before committing.
- Auto-detection failures silently degrade the onboarding experience. Always validate with `execOnVps`.

## Cloudflare Tokens

- Account tokens are encrypted at rest via `encryptCloudflareToken` / `decryptCloudflareToken`.
- Only the active account (`isActive=true`) is used for operations. Switching accounts requires the new one to be tested first.
- Token encryption keys are server-side; lost keys mean lost Cloudflare access.

## Alert Evaluation

- `/api/alert-rules/evaluate` runs every 60s via `AlertScheduler` in `layout.tsx`.
- Evaluation must be idempotent and fully deduplicated. The 60s cadence means misconfigured rules can cause rapid alert spam.
- Rule changes take effect on the next evaluation cycle, not immediately.

## Terminal Helpers

- Shown chips adapt to the active VPS via `/api/server-capabilities`.
- Do not show `systemctl` on OpenRC/Alpine hosts, `caddy` if not installed, or Docker commands if using Podman.
- Terminal AI mode (`/ai <intent>`) generates POSIX sh commands for approval. It must never execute without explicit user confirmation.

## Terraform Control Plane

- Infrastructure stacks are managed in Settings → Infrastructure.
- `plan` is safe; `apply` and `destroy` run on the active VPS and can delete infrastructure permanently.
- Stack outputs can feed into the deploy pipeline — ensure `destroy` doesn't break active deployments.

## Cloud Account Encryption

- GCP/AWS/Azure credentials are encrypted at rest in the database.
- Decryption failures during deployment are silent — the deploy step will fail with a generic error.
- Credential rotation requires re-encrypting via the Settings → Cloud Accounts UI.

## Next.js App Router Import Paths

- This repo uses the Next.js App Router. All page/route files must be in `src/app/` with `page.tsx` convention.
- API routes go in `src/app/api/`. Do not use the Pages Router (`src/pages/`).
- Layout nesting and parallel routes are used — understand the route group hierarchy before adding new paths.

## Deployment Targets

- Pluggable adapters (`compose`, `static`, `k3s`, `cloudrun`, `terraform`) each have different failure modes.
- `compose` assumes Docker Compose v2+ on the VPS. `static` expects Caddy or Nginx already configured.
- Target selection lives in the Projects panel; target configuration lives in Settings → Deploy Targets. They can be out of sync if a target was deleted but a project still references it.
