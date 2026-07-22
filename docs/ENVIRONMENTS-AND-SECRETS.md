# Deployment environments and secrets

GroundControl treats a project as an optional group of deployments. Environment
configuration belongs to the deployment workload, never to the project group.

## Product model

- A deployment has named environments such as Production and Staging.
- An environment selects exactly one primary secret provider.
- A component receives only keys explicitly assigned to that component.
- Environment names are operator-facing; immutable profile IDs and normalized
  slugs are used internally.
- Releases record the environment profile and fingerprint they consumed.

There is no implicit shared-variable scope. GroundControl does not inspect
`.env` files or running containers to guess secret ownership. Operators add
values directly or explicitly import an environment file into a selected
component.

## Providers

### GroundControl Vault

The built-in provider is intended for self-hosted static secrets and ordinary
configuration. Values are AES-256-GCM encrypted at rest, write-only in the
deployment interface, component scoped, and versioned on replacement or
deletion.

GroundControl Vault is not intended to reproduce dynamic credentials, PKI,
complex organization IAM, or cross-platform secret synchronization.

### Infisical

Infisical is a first-class external provider. A connected machine identity can
list the projects it is allowed to access. Each GroundControl environment maps
to an Infisical project, provider environment slug, and secret path. Secret
values remain owned by Infisical; GroundControl resolves them only for an
authorized runtime operation.

One provider remains authoritative for an environment. GroundControl does not
dual-write secrets between the built-in vault and Infisical.

## Runtime handling

Saving changes updates the authoritative provider but does not mutate running
containers. The environment marked for deployment is configuration, not a
separate release step. Every full or component deployment resolves that
environment, validates the relevant component keys, prepares ephemeral runtime
delivery, validates the effective Compose model, pulls the artifact, recreates
the requested scope, and verifies the result. Operators never materialize or
deploy an environment separately.

Provider readiness and runtime readiness are separate states. A vault may own
valid encrypted values while a host restart has cleared their ephemeral runtime
files. GroundControl evaluates both states inside the deployment transaction,
repairs ephemeral delivery automatically when possible, and reports one
actionable deployment failure when it cannot proceed safely.

The deployment interface is write-only. An administrator may deliberately pull
one component into an environment-named file for local use; every export is
audited and returned with no-store response headers.

The current compatibility injector writes component env files beneath the
host's `/run/groundcontrol/environments` memory-backed runtime area and points a
GroundControl-owned Compose override at those files. It removes older
GroundControl component files and plaintext backups from deployment directories
during materialization. A companion manifest records the expected runtime files;
Compose lifecycle operations refuse to use the managed override unless every
file is present. Materialization removes the old override first and publishes
the replacement last, preventing a partially written bundle from being used.
Materialization, Compose validation, image pulls, recreation, verification,
and detached progress logs all use the same host execution plane. A
containerized GroundControl therefore cannot report host runtime files as
ready and then ask an inner-container Compose process to consume them.
Existing deployment-wide values retain their top-level
`.env` compatibility path so an upgrade does not break a running workload, but
new values can only be created inside a component scope.

Environment-variable injection remains observable to a privileged Docker
operator. Native file-secret delivery through `/run/secrets` is the next mode
for applications that support `*_FILE` or configurable credential paths.

## Capability state

### Live

- Named environments per deployed workload.
- Default environment selection.
- Component-scoped requirements and values.
- GroundControl Vault and Infisical provider selection per environment.
- Existing Infisical project discovery.
- Write-only managed secret inputs.
- Version history for GroundControl Vault values and deletion markers.
- Explicit add and environment-file import flows.
- Audited, administrator-only environment file export.
- Visible UTF-8 `.env.txt` exports that open directly in standard desktop text editors.
- No automatic secret discovery from host files or containers.
- Runtime-area Compose compatibility injection.
- Automatic deployment-time runtime delivery with actionable preparation failures.
- Missing-key validation mapped to components and fields.

### Next hardening

- Per-component Infisical folder and machine-identity bindings.
- Native file-secret injection and application capability detection.
- Step-up authentication and audit records for security-sensitive actions.
- Master-key health, recovery export, rotation, and systemd/TPM credential
  support.
- Provider webhooks and controlled secret-rotation runs.
- Encrypted last-known-good runtime cache with expiry policy.

### Product direction

- Dynamic-secret leases through capable external providers.
- Workload identity for cloud services instead of long-lived cloud keys.
- Policy-controlled rotation with targeted redeploy, customer-journey
  verification, and evidence-backed completion.
