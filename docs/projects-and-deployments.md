# Projects and deployments

A project is the home for an app or product: its name, purpose, repository, source folders, and running instances. Projects can exist before anything is deployed.

## Add a project

Choose **Add project**, then **Choose a folder** or **Import from GitHub**. Both paths end with a review of the project name, purpose, and source. You can also start without source code. Creating a project does not start, stop, redeploy, or reassign any existing application.

A source folder points to code on a particular connected computer. Browse by location, folder, and breadcrumb; no path entry is required. The preview detects common JavaScript, Python, .NET, Go, Rust, Java, Ruby, PHP, static-site, Docker, and Compose markers. Folder browsing skips unavailable child entries, including macOS virtual `.Trash` entries. Missing folders, permissions, Docker sharing, and timeouts have separate recovery messages. Registering a source does not execute its code or create a deployment. Open a project and choose **Source → Choose folder** to attach another source; remove its source link to disconnect it without deleting files.

For GitHub, select a repository from your connected GitHub App, browse a public user or organization, or use a repository link. Private repositories require an existing connection with access to that repository. GroundControl verifies access before review and again before saving, then stores the canonical repository URL and default branch. It does not clone the code or launch a deployment. A new template deployment uses the saved default branch; existing deployments keep their own settings.

A deployment is an instance of a project, identified independently of its source directory. It has a name, environment (such as Local, Staging, or Production), host, and deployment method. Multiple Compose instances can use the same source directory; their explicit Compose identities keep their services separate. Compose is a deployment method, not the definition of a project or deployment.

## Add a deployment

Open a project and choose **Add deployment**:

- **Connect an existing deployment**: select a discovered running app on the active host, or move a tracked deployment from another project. Pick its environment. This does not restart or move the app.
- **Launch a new deployment**: on this computer, configure a ready-to-use Docker image and its app port, review, and launch. The deployment receives a private localhost address. On a Linux server, choose an existing template workflow; the project, environment, and selected-host check carry through to deployment persistence. New template launches must use a new instance name; existing instances are updated from their deployment page.

Local image launches currently support a single image with its default command and no extra environment configuration. Source builds, multi-service applications, and custom configuration use Linux-server templates. Native Mac/Windows service management is not supported. Local images are tracked as standalone container instances; template releases use the existing release pipeline.

## Connect an existing deployment

No source import or redeployment is required to enroll an app that already runs:

1. Select its host in **Settings → Connections**. GroundControl must be able to connect and inspect Docker there.
2. Open the app's project, or create one with **Add project** without source.
3. Choose **Add deployment → Connect an existing deployment**. Select the discovered Compose stack or standalone container and set its environment, such as `Production`.
4. Click **Connect deployment**, then verify the displayed host, services, environment, and runtime state. For an already-tracked app, check its current project and host before moving its project association.

Enrollment leaves containers and Compose files in place. It does not enable automatic deployments or grant an agent permission to change the app. Existing private stacks and headless workers do not need a new public domain to be connected.

If the app is missing, check the active connection, Docker access, and whether it is already tracked. For dismissed suggestions, open **Deployments → Suggested from this host/computer → Restore hidden**, then reopen the Connect dialog. If the host changed while the dialog was open, close it and refresh Projects.

An agent can help identify the correct stack and missing access, then guide these steps. Current MCP tools do not perform general discovery or enrollment. After enrollment and explicit [agent authorization](./agent-native-access.md), `deployment.list` and `deployment.inspect` can verify visibility and capabilities. Start with the read access you need; keep secret values out of chat.

## Discovery

Suggestions do not automatically become managed projects or deployments. Compose services are grouped by their running instance. **Dismiss** hides a suggestion without changing its files or containers. **Undo** and **Restore hidden** bring suggestions back. Removing a tracked deployment does not silently re-enrol it during the next scan.

## Compatibility

The internal `ProjectGroup` table now represents user-facing projects. `ProjectSource` stores source folders separately. `EnrolledDeployment` represents instances and includes the environment name; source location is indexed rather than unique. The legacy `Project` and `Deployment` tables continue to hold workload configuration and release history.

Migration `20261003000000_project_sources_and_instances` copies earlier source-only registrations into `ProjectSource`, preserves their existing records and references for compatibility, and excludes those source-only records from active deployment inventory and new agent grants. Old source-only detail links route to the project page. Existing deployment records are preserved.

Migration `20261003140000_project_repository_branch` adds a nullable repository default branch to projects. It does not rewrite deployment configuration or release history. Production upgrades still require a quiesced database/configuration backup and migration rehearsal against a copy of that instance's data. A passing local test is not proof of production health.
