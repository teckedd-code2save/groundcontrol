# Bring an existing deployment into GroundControl

Already running your app? Connect it to GroundControl so you can see its services, inspect its state, and give an agent scoped access. You do not need to redeploy it, change its Compose file, or import its source first.

**Enrollment records an existing deployment. It does not restart containers, move the application, or enable automatic deployments.**

## Connect it in the UI

1. **Select the host.** In **Settings → Connections**, select the computer or server where the app runs. Make sure GroundControl can connect to it and inspect Docker. Local desktop connections discover Docker workloads, not native Mac/Windows services.
2. **Open a project.** Go to **Projects** and choose the app's project. If it has none, choose **Add project** and start without source. A repository or source folder can be attached later.
3. **Choose Add deployment → Connect an existing deployment.** GroundControl lists discoveries from the active host and tracked deployments that can be associated with the project.
4. **Select the app and its environment.** Pick the Compose stack or standalone container, then set an environment such as `Production`, `Staging`, or `Local`. Compose services are grouped by their running instance; select the stack rather than treating every worker or database as a separate app. For an already-tracked deployment, check its displayed host and current project: connecting it here changes its project association, not its running location.
5. **Click Connect deployment.** Open the resulting deployment and confirm the host, service/container identity, environment, and runtime state match the application you intended to enroll.

For example, if `shop` already runs as a Compose stack on your VPS, select that VPS, open a `Shop` project, connect the discovered `shop` stack, and choose `Production`. Its web, worker, and database services stay in place. A headless worker or private stack does not need a new public domain merely to be connected.

## If the app is missing

- **Wrong host:** switch Connections and reopen the dialog. If the connection changed while it was open, close it and refresh Projects.
- **Docker cannot be inspected:** check that Docker is running and the selected host connection has the required access. Ask for help identifying the missing dependency or permission before changing the host.
- **Already tracked:** look among tracked deployments, including those associated with another project, rather than creating a duplicate.
- **Previously dismissed:** use **Restore hidden** on the discovery surface, then look again. Dismissal hides a suggestion; it does not stop the app.
- **Only source code exists:** a registered folder or GitHub repository is not a running deployment. Use [Projects and deployments](./projects-and-deployments.md) for launching a new instance. Do not choose Launch just to make an existing app appear.

## Let an agent help

You can ask:

> Help me connect my existing `shop` deployment on the production VPS to GroundControl. Keep it running as-is. Help identify the right stack and any missing access, then verify the enrolled deployment. Do not redeploy it or enable automation.

The current MCP tools operate on **already-enrolled, explicitly authorized deployments**. They do not expose a general discovery scan or enrollment action. An agent should guide the steps above, or use separately authorized UI access, rather than invent an enrollment tool or treat an empty MCP list as proof that nothing is running.

After enrollment, approve access to the intended deployment through GroundControl's agent authorization flow. The agent can use `deployment.list` and `deployment.inspect` to verify visibility, identity, and available capabilities. Begin with the read access you need; enrollment alone does not grant restart, redeploy, or other mutation permissions. Do not share SSH keys or secret values in chat.

**Done means:** the correct deployment is listed under the right project and host, its runtime identity matches, and any agent you chose to authorize can see it. Updates, secrets, and automatic delivery are separate next steps.

For those next steps, see [agent access](./agent-native-access.md), [configuration and secrets](./ENVIRONMENTS-AND-SECRETS.md), and [deployment automation](./DEPLOYMENT-AUTOMATION-AND-DAYTONA.md).
