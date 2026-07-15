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

There is no implicit shared-variable scope. Existing deployment-wide values are
kept as legacy compatibility data until an operator assigns each key to a
component. GroundControl moves encrypted local values without revealing them.

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
containers. Redeploy resolves the chosen named environment, validates required
component keys, and then injects the selected values.

The current compatibility injector writes component env files beneath the
host's `/run/groundcontrol/environments` memory-backed runtime area and points a
GroundControl-owned Compose override at those files. It removes older
GroundControl component files and plaintext backups from deployment directories
during materialization. Legacy deployment-wide values still use the top-level
`.env` compatibility path during redeploy until the operator assigns them to
components; new component-scoped values do not use that path.

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
- Explicit migration of legacy deployment-wide keys.
- Runtime-area Compose compatibility injection.
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
