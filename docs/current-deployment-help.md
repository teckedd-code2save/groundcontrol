# Deploy an application with GroundControl

GroundControl can launch an application or connect one that is already running. Start with the deployment method your application already uses: keep a working Compose stack, use a published image, or build from a Dockerfile. You do not need to reorganize an existing application to register it as a project.

This guide covers the released Projects and Templates workflows as of 12 November 2026. It distinguishes the desktop Docker workspace from a managed Linux server. Source registration, deployment creation, and agent permission are separate steps.

## Choose a deployment path

| What you have | Managed Linux server | This computer: desktop Docker workspace |
|---|---|---|
| An application already running | Connect the discovered deployment without restarting it. | Connect a discovered Docker deployment without restarting it. |
| A repository-owned Compose stack | Use **VPS Caddy Existing Compose**. Keep its services, builds, commands, and volumes. | Connect an already-running stack. The new-deployment form does not launch Compose stacks. |
| A ready-to-run image | Choose an image-compatible template and provide the image and application settings. | Launch one image with its default command and a private localhost port. |
| A Dockerfile-backed repository | Use **VPS Caddy Source Build**, or Existing Compose for custom build contexts and multiple services. | Not available in the released local launch form. Build/publish the image separately, or use a Linux server. |
| Static HTML or a generated static site | Use **VPS Caddy Static Site**. Caddy serves the published directory; Docker is not required. | Use a prebuilt web-server image, or connect an existing container. No dedicated static-site launch form. |
| Workers, databases, queues, persistent storage | Include them in the repository-owned Compose stack, or connect an existing deployment. | Existing containers can be connected. The local launch form has no custom environment, volume, or command fields. |

The Existing Compose template currently requires a public service, a published host port, and a domain. It supports workers **within that routed stack**, not a new standalone headless-worker launch. Do not add an unnecessary public endpoint merely to fit the template; connect an existing headless workload instead.

Other target adapters and specialized templates exist. Their requirements differ. This guide focuses on the paths above, not on promising that every template works on every host. Use the options actually offered by your installed version.

## Before you deploy

### Select the right host

In **Settings → Connections**, select the computer or server that should run the application. Confirm its name again in **Add deployment**. A folder on your laptop is not automatically available on a remote server. In a server template, **Path on VPS** means a directory on that selected server.

If GroundControl is not installed, follow [Start from your computer](./start-from-your-computer.md). Desktop mode requires running Docker with Linux containers. The supported server distribution uses AMD64 Linux. GroundControl's own management port should remain private; publishing an application's route does not require exposing the control plane.

### Prepare the workload

Have these details ready before pressing Deploy:

| Detail | What to establish |
|---|---|
| Source | Repository and ref, accessible host folder, or an image tag/digest. Private repositories and registries need access from the deployment execution path. |
| Runtime | Startup command, container port, required companion services, and CPU architecture. The app must listen on an interface reachable outside its container, usually `0.0.0.0`. |
| Configuration | Required environment **key names**, which component consumes each key, and where values will be entered securely. |
| State | Database connection, named volumes or other persistent storage, backup location, and restore procedure. Container files alone are not durable storage. |
| Networking | For routed server templates: domain, DNS destination, free host port, and reverse proxy. The container port and the host port are different settings. |
| Verification | A meaningful health path, expected response, and one real user-facing check. |
| Recovery | Previous image/ref, configuration backup, and any database migration or rollback constraints. |

Docker workloads need Docker Engine and Compose on the server. Git sources need Git. Caddy templates need Caddy and a usable HTTPS/DNS route. Static-site build commands also need their build tools on the server, such as Node/npm; selecting a template does not install every application-specific tool.

If a dependency is missing, identify it on the **target host**, then use an applicable GroundControl bootstrap action or an approved host installation procedure. Verify the installed tool before retrying. Do not install packages inside the GroundControl container when the application needs them on the server. An assistant can help diagnose and prepare this step; missing dependencies should produce a useful next action, not a dead end.

## Create a project, then its deployment

1. Open **Projects → Add project**. Choose a folder, import a GitHub repository, or start without source.
2. Review the name, purpose, and source. Adding the project does not clone code, build an image, or start an application.
3. Open the project and choose **Add deployment**.
4. Choose **Connect an existing deployment** to associate a discovered app with this project. Select its environment. Connecting does not restart the app or move it to another host.
5. Otherwise choose **Launch a new deployment**, name the environment, and follow one of the examples below.

Use a new instance name for a new deployment. Update an existing instance from its deployment page rather than creating a second instance with the same name. See [Projects and deployments](./projects-and-deployments.md) for discovery and source-folder behavior.

## Example 1: run a ready image locally

This is a small smoke test of the released local launch path. It requires no repository, domain, or secret values.

1. Select your desktop Docker connection.
2. Create a project named `Web demo`, then choose **Add deployment → Launch a new deployment**.
3. Enter:

   | Field | Value |
   |---|---|
   | Environment | `Local` |
   | Deployment name | `Web demo local` |
   | Docker image | `nginx:alpine` |
   | App port inside the container | `80` |

4. Choose **Review deployment**, confirm the target, then **Launch deployment**.
5. Open the returned local address. Expect the Nginx welcome page. Docker chooses the host port; use the displayed address rather than assuming port 80 on your computer.

The address is private to that computer. The image's default command is used. This example deliberately needs no extra environment values or persistent storage. For your own image, choose a versioned tag or digest and verify its architecture and startup requirements. Registering a Dockerfile folder does not make this form build it.

## Example 2: deploy a repository-owned Compose application

Use **VPS Caddy Existing Compose** when the repository already describes the application. This preserves custom Dockerfiles, worker commands, databases, and volumes instead of replacing the stack with a generic service.

For a minimal route test, a repository can contain this `docker-compose.yml`:

```yaml
services:
  web:
    image: nginx:alpine
    ports:
      - "127.0.0.1:18080:80"
    restart: unless-stopped
```

This example serves Nginx's default page. Replace it with your application's existing recipe for a real deployment; do not discard its stateful services or volume declarations.

1. Select the Linux server and choose **Add deployment → Launch a new deployment → Choose a template**.
2. Select **VPS Caddy Existing Compose**.
3. In **Source**, provide the repository and ref. Use **Verify source**, then **Check & continue**. For a host folder, use the offered local-source option and check the server path instead.
4. Configure the deployment using values that match the Compose file:

   | Input | Example |
   |---|---|
   | Repository Compose file | `docker-compose.yml` |
   | Public Compose service | `web` |
   | Published host port | `18080` |
   | Public domain | A hostname you own, such as `demo.example.com` |
   | Public verification path | `/` for this demo; your app's health path in production |

5. Supply required discovered configuration through the deployment interface. If GroundControl should create DNS, select the connected Cloudflare account/zone and review that choice. Otherwise arrange the correct DNS record yourself.
6. Choose **Preview**. Check the selected Compose file, service, loopback port, domain, and persistence before **Deploy**.
7. Read the deployment result and open its HTTPS URL. Confirm both the service graph and the public route, not just that a container exists.

Traffic follows this path:

```text
https://demo.example.com → host Caddy → 127.0.0.1:18080 → web:80
```

Do not select an internal database port as the public port. For an API plus workers, route the API or gateway and keep workers internal. One-shot migration services and long-running services have different success conditions; inspect the deployment evidence when either fails.

## Example 3: build a Dockerfile-backed app on a server

Choose **VPS Caddy Source Build** for a single application whose source root contains its Dockerfile. For nested Dockerfiles, non-default contexts, or several services, express the build in your repository's Compose file and use the previous path.

A small static web app can demonstrate the Dockerfile path with these two files:

```dockerfile
# Dockerfile
FROM nginx:alpine
COPY index.html /usr/share/nginx/html/index.html
```

```html
<!-- index.html -->
<!doctype html>
<title>GroundControl deployment check</title>
<h1>Application is serving</h1>
```

1. Put the files in the selected repository's root and choose **VPS Caddy Source Build**.
2. Select the repository/ref or an accessible server source folder. Verify the source.
3. Set **Application container port** to `80`, **Host loopback port** to an unused port such as `13050`, **Health path** to `/`, and a domain you own.
4. Review the generated configuration and image build in **Preview**, then deploy.
5. Confirm the container health check and the HTTPS page both pass.

For a real app, its Dockerfile must install dependencies, build the application where necessary, and define a working default command. This template's generated health check invokes `wget` inside the app container; include it or use a repository-owned Compose health check appropriate to your image. Review template defaults rather than treating sample database URLs or generated application secrets as your app's complete configuration. This template does not provision a database merely because `DATABASE_URL` is present, and its generated app service does not add persistent volumes.

## Example 4: publish a static site

Select **VPS Caddy Static Site**, verify the repository/ref or server folder, and configure a domain and the directory to publish.

- Plain HTML: leave **Optional build command** empty; set **Directory to publish** to `.` if `index.html` is in the source root.
- A site that actually builds with `npm ci && npm run build`: use that command only after checking its package scripts and server toolchain; set the output directory to the generated folder, for example `dist`.

Preview, deploy, then check the HTTPS page and its CSS/JavaScript assets. The output directory must contain the generated static files. A server-rendered application needing a Node process is not a static site; use an image, Dockerfile, or Compose deployment instead.

## Configuration, updates, and recovery

For workloads that expose **Manage Envs**, select the deployment environment and component, then enter or explicitly import values through the supported provider. GroundControl Vault and Infisical are supported there. Saving values does not update a running container: the next deployment resolves and delivers that configuration. Do not assume a project's display environment label creates a secret profile or makes a local image launch consume it.

Keep secret values out of chat, source control, screenshots, and example commands. An assistant can work with names such as `DATABASE_URL` and check whether required keys are configured without receiving their values. See [Environments and secrets](./ENVIRONMENTS-AND-SECRETS.md) for provider and runtime-delivery details.

Before updating an existing deployment:

1. Inspect its actual deployment method and supported actions.
2. Identify the intended source ref or image, required configuration changes, and migrations.
3. Preserve recoverable application data and the previous release before making changes.
4. Update from the deployment's supported workflow, then inspect progress and verify the application.

A successful image build in GitHub Actions does not prove a server deployed it. Automatic delivery requires the deployment-specific integration and policy to be configured. Follow [Deployment automation](./DEPLOYMENT-AUTOMATION-AND-DAYTONA.md); do not enable unrelated deployments as a workaround.

Rolling back an image does not necessarily roll back its database schema. An interrupted or uncertain operation needs inspection before retrying; launching a duplicate operation can make recovery harder.

## Troubleshooting

| Symptom | Check and next action |
|---|---|
| A project exists but nothing is running | Source registration is non-executing. Open **Add deployment** to connect or launch an instance. |
| The source folder cannot be found | Confirm the source host, not just the path. For desktop scans, check Docker file sharing. A server cannot read a laptop-only folder. |
| Private source/image access fails | Check repository installation access or registry credentials for the actual execution path. Do not paste access tokens into chat. |
| Docker, Compose, Git, or the proxy is missing | Identify the selected host and required tool; install through an authorized host procedure, verify it, then retry. |
| A build fails | Read the build evidence. Check Dockerfile/context, package lockfiles, required build tools, architecture, memory, and disk space. |
| The container runs but the page does not open | Check app bind address, container port versus host port, proxy upstream, DNS, TLS, and health path. Container health and public-route health are separate. |
| A required configuration key is missing | Configure it on the correct component/environment through the supported interface; redeploy to apply it. |
| The app loses data after recreation | Check persistent storage and backups. Recreating a container does not preserve data written only to its writable layer. |
| An operation appears stuck or its response was lost | Inspect the existing deployment and operation first. Do not submit a new mutation merely because the client timed out. |
| The desired launch option is absent locally | Use a ready image or connect an existing container; use a server for the documented source/Compose paths. Unreleased local parity work is not an available feature. |

When asking for help, share the deployment name, target host, method, attempted step, error, and relevant redacted evidence. Include the expected result and the last known working version.

## Working with a connected agent

A useful request describes the desired outcome and the source, for example:

> Help deploy my existing Compose application to staging. Keep its API, worker, database, and volumes. Inspect what is missing, prepare the deployment inputs, and show me the verification and recovery plan before changing the server. Ask for secret values only through the supported configuration interface.

The agent should:

1. Discover the installed server's tools and instructions. Use `deployment.list` and `deployment.inspect` for workloads the operator has granted access to.
2. Distinguish supported capabilities from authorized actions. A connected agent does not automatically gain access to every deployment.
3. Inspect available source through an authorized source tool or supplied files. Deployment visibility alone does not grant arbitrary filesystem access.
4. Explain the fitting deployment path, missing dependencies and information, and help prepare the recipe. If the current MCP surface cannot create the workload, guide the operator through **Projects → Add deployment** rather than inventing a creation tool.
5. For an existing workload, use its advertised read, health, configuration-check, and mutation capabilities. `deployment.config.check` checks specified key metadata, not secret values. `deployment.logs` provides release execution evidence; use the deployment/runtime interface for container logs when no runtime-log tool is advertised.
6. After an authorized mutation, retain its durable operation handle and use `operation.get` to follow it. Inspect an `uncertain` result before another attempt.
7. Report what changed, the verification evidence, and anything still unresolved. A queued operation or passing build is not a verified deployment.

MCP instructions are returned by `initialize` and `server/discover`; `tools/list` describes the tool surface. Guidance does not expand OAuth scopes or add deployment permissions. See [Agent-native access](./agent-native-access.md) for the access contract.
