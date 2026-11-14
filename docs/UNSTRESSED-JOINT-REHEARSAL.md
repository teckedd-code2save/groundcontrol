# Unstressed: joint rehearsal and recording handoff

This is a run sheet, not a claim that a deployment has happened. Finish candidate
checks first. Installation and rehearsal happen with the owner present and visible.

## Preserve

Keep existing Unstressed production, its domain, credentials and data untouched.
Keep GroundControl setup, its access connector, accounts and SSH. A later fresh
slate applies only to the identified disposable Unstressed test deployment/data.

## Before touching the VM

- Record exact GC image digest and plugin commit. Confirm feature is off by default.
- Review backup/upgrade steps and confirm the selected VM is the test target.
- Choose a new app subdomain and isolated Compose/data identity. Confirm the exact
  repository revision and deployment file. Never use production `/opt/unstressed`
  paths, production external networks or fixed container identity.
- Gather configuration key names. The owner enters new/test-authorized values in
  the masked GC form; do not copy production secrets without separate permission.
- Confirm runtime dependencies and Docker Compose 2.30+ for raw scoped env files.
- Inspect Caddy setup, DNS and network prerequisites. Any installation, DNS record
  write, Azure rule or host-firewall change is a separate visible approved step.

## Together: installation and rehearsal

1. Install the tested GC candidate while preserving its database and claim state.
   Enable the experimental feature only for this agreed test instance.
2. Install the pinned plugin candidate, not an assumed catalog update. Connect
   through native Hermes MCP/OAuth. Verify actual approval controls, not just YAML.
3. Show GC. Have Hermes submit the exact repository/SHA/Compose proposal.
4. Open owner review. Save candidate-only service configuration, select the host,
   health service/loopback port and limits. Review fetched Compose and missing inputs.
5. Enroll the pending workload. Prepare the new domain: add the shown A/TXT records
   with the DNS provider, then recheck. Do not alter production records.
6. Reconnect native OAuth, selecting only the new deployment. Inspect its recipe
   hash, approve first launch once and follow the durable operation ID.
7. Verify app loopback health, publish the reviewed app route through existing Caddy,
   then open the HTTPS link independently in the browser. Exercise the actual user
   journey. Health alone does not prove Qloo/model/OAuth/email integrations work.
8. Rehearse code-only source deployment using a disposable non-feature change and
   exact commit SHA. Preserve Compose, configuration, volume and domain bindings.
   An uncertain outcome is inspected, never blindly retried.

## Fresh slate for recording

Inventory the exact test deployment, Compose project, named volumes, domain route,
configuration and pending operations. Confirm the specific reset immediately before
acting; do not infer that the whole VM, GC or SSH may be reset. Preserve needed
recovery copies or explicitly confirm irreversible removal of disposable data.

## Continuous recording

Start with GC already accessible. Show repository → masked configuration → domain
preparation → first launch → browser result. Then choose and implement the owner's
one or two focused Unstressed features, test them, deploy the exact new SHA through
Hermes/GC and verify the real outcome. Do not prebuild those features or substitute
rehearsal logs. Record clear terminal/tool activity; hide tokens, claim links, secret
values and private keys. Finish with evidence and submission preparation.
