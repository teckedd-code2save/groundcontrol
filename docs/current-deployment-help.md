# Current deployment help for connected agents

The MCP endpoint provides these instructions during `initialize` and `server/discover`. Tool discovery and OAuth scopes remain unchanged. This guidance-only change neither adds deployment permissions nor requires unreleased local runtime functionality.

Current main supports Linux-server templates for repository-owned Compose, ready images, Dockerfile source builds and static sites. Existing Compose launch selects a public service/port/domain, so workers are part of that routed stack rather than a standalone headless template launch. Already-running workloads can be connected. Local desktop launch currently starts a ready image using its default command and a private localhost port. Repository registration does not itself clone, build or launch.

An agent should help prepare a successful deployment: inspect available source and current capabilities, identify required services, ports, environment key names, storage, database connectivity, routing, migrations, verification and recovery. Explain missing dependencies and offer installation/configuration assistance within the operator's authorization. Use Manage Envs where supported and do not solicit secret values in chat. Prepare the missing recipe rather than treating an unavailable direct MCP creation tool as a dead end. New workloads use Projects → Add deployment and the suitable template; MCP mutation tools remain scoped to approved existing deployments.

## Small release path

This patch changes only MCP guidance, tests and this document. Deploy the reviewed server revision through the established release process, then verify `initialize` and `server/discover` return the new text and reconnect/refresh the plugin if its discovery cache remains stale. No database migration, new OAuth grant, runtime dependency or local-parity release is needed for this guidance. The repository's image-build workflow is not itself proof that the operator VPS has upgraded; verify the serving endpoint before calling the change live.
