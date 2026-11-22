# Reserved public IPv4 rehearsal

This is an experimental, operator-managed Access option. It does not install
or update Caddy, change firewall or DNS settings, provision an IP, rotate a
connector, or take over an existing site. It is not a shipping installer path.

1. On a disposable Linux VPS, check the provider's allocation details. Use
   an existing reserved public IPv4, not the machine's outgoing NAT address.
   Confirm inbound TCP 443 can reach the VPS. Do not expose GroundControl's
   internal port. Keep the existing login and recovery link working.
2. In the candidate web container set `GC_EXPERIMENTAL_DIRECT_IPV4=1` using its
   Compose environment. Use the rehearsal-pinned Caddy 2.11.9 on the host with
   persistent service and certificate storage. GroundControl checks the actual
   host version and a single IPv4 loopback upstream. Keep Caddy's admin port private.
3. After claiming GroundControl, choose **Use my server’s reserved IP** in
   Access. Prepare the site block. Review it beside your existing Caddy
   configuration: do not replace unrelated sites or become the first listener
   on an unrelated address. Validate and reload it yourself. It requests a
   Let's Encrypt publicly trusted short-lived IP certificate via TLS-ALPN.
   Caddy may also bind port 80 for redirects; the certificate challenge here
   does not require externally opening that port.
4. From your laptop or another machine off the VPS, run the shown
   `python3 scripts/check-direct-ipv4.py IPv4 INSTANCE_ID` command from this
   snapshot. Enter the short-lived challenge when prompted. Treat the staged
   route key, challenge and proof as private; don't record them. The script
   validates the IP SAN and short lifetime against pinned Let's Encrypt production
   roots, does not follow redirects, and checks
   instance identity, public PKCE metadata, exact issuer/resource, MCP deployment
   discovery and the expected 401 challenge on an anonymous tool call before requesting the one-time proof.
5. Save that proof in Access. GroundControl records the new management URL only
   after checking it against the stage, operator and current access state. The
   separate-machine location is operator-confirmed, not independently
   geolocated. Operator configuration remains outside GroundControl's control.

If verification fails, the saved address and known recovery path stay unchanged.
Remove only your added Caddy site if abandoning the attempt. After adoption,
the prior route remains in place; a quick link is still temporary and SSH
should remain available. This version refuses to replace an existing durable
identity. To roll back, use the previous login or SSH recovery, remove only the
operator-managed IPv4 Caddy site, reload, then select **Forget IPv4 address** in
Access. This restores saved app state, does not remove or probe the site itself,
and does not verify the old route's health. Do not use this on an existing
managed production deployment.

OAuth metadata on this baseline remains origin-derived. Saving an IP does not
transfer or revoke OAuth access on an old origin, or enforce a shared issuer
across domains. Reconnect external clients explicitly with fresh consent.
Public discovery isn't evidence of authorization. Before calling the route
durable, verify provider stop/start as well as reboot, a real scoped Hermes
read, and one actual automatic certificate renewal. None is established merely
by preparing the site or passing the local test suite.


## Start the rehearsal with the normal remote launcher

Use the launcher from the exact candidate commit and its matching published commit image, never `latest`:

```sh
bash start --remote <ssh-host-alias> --installer-ref <full-candidate-commit> \
  --version <candidate-commit-tag> --experimental-direct-ipv4
```

This only enables the experimental Access screen on the candidate image. Claim or sign in over the setup route first; only the later outside proof in Access can save the direct address. No Caddy config, firewall or existing URL is changed by the flag. Add `--private` for SSH-only bootstrap instead of creating a new temporary link. On an existing instance without the exact enabled candidate the launcher stops before claim or changes. For a disposable existing host only, first review the pinned on-host installer's `--preview`, then separately choose its `--upgrade --version <candidate-commit-tag> --experimental-direct-ipv4 <full-candidate-commit>`; continue over the previous route. The host installer verifies the pulled immutable digest and image revision before entering its existing backup/rollback upgrade path. This rehearsal is not an automatic installer-managed HTTPS handoff.


### Owned TCP 443 slot (Linux/systemd, no existing listener)

Sign in with your working recovery link and prepare the reserved IPv4 in Access. With the same launcher and candidate pin arguments, add `--direct-ipv4-ingress stage`. It requires trusted host Caddy 2.11.9, iproute2 and systemd. This action neither installs Caddy nor reconfigures a distro proxy; use the manual snippet or another disposable server if TCP 443 is in use. Never turn off another listener for this test.

The pinned launcher checks the helper checksum, reads only the active administrator stage from the candidate, and starts a dedicated Caddy service on TCP 443 with persistent certificate files. It disables public HTTP/redirects and the admin API, leaves GC bound to loopback and does not touch provider or guest firewall rules. No permanent URL prints at stage. Before adoption it exposes only probe routes and stops when the stage expires. Run the external verifier and save proof over recovery; run the same launcher with `--direct-ipv4-ingress enable` to enable the exact verified owned slot at boot and receive its HTTPS URL. Then test stock-browser sign-in, terminal and Hermes on that URL. Remove and forget this slot over recovery before installer upgrade, uninstall or recreation. If unsuccessful or abandoned, run `--direct-ipv4-ingress remove` (only the owned unit/config is removed; cert storage and recovery stay). After adoption, use Forget IPv4 address over the prior route to restore saved access. The staged unit is not enabled through reboot; explicitly clean up an abandoned running stage.

### Normal interactive setup

The regular README command stays the same. When the installed image advertises support, the launcher offers an optional guided continuation after it shows the recovery link. After approval, with TCP 443 free, it uses a verified host Caddy 2.11.9 or downloads and verifies its own pinned Caddy executable on supported Linux hosts. It does not install a distro package, replace another listener, alter any network policy or change default unattended behavior. TCP 443 must also be reachable for the external proof. Use the browser to claim and prepare **Use my server’s reserved IP**. The same launcher stages the verifier routes, obtains the short-lived challenge over the existing SSH connection and checks the pinned HTTPS path from the computer where setup is running. It uses that initial proof to open a time-limited sign-in test, not a permanent route. After it verifies the actual sign-in page, only the separately signed trial proof is copied back to the browser. After the existing administrator-only save, the launcher promotes the matching owned route and checks the live instance once more before giving you the address.

The invitation times out after 30 seconds, each browser step after five minutes. Decline or stop to keep using recovery. When possible, the launcher removes only the unpromoted slot it created; otherwise the probe listener expires. If the browser saved the candidate but promotion or its final check failed, sign in on the earlier route and inspect the owned slot before removing or forgetting it. Revise app snapshots and connection grants only after the live rehearsal.
