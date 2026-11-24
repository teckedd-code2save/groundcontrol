# GroundControl

GroundControl is a self-hosted control plane for deploying and operating applications on infrastructure you own. Use the dashboard to manage projects, Docker workloads, logs, terminals and host state, or grant compatible MCP agents access to specific deployments.

[Install](#install) · [First deployment](#first-deployment) · [Connect an agent](#connect-an-agent) · [Contribute](#local-development)

## Install

Run this in Terminal on macOS or Linux, or in WSL on Windows:

```bash
curl -fsSL https://raw.githubusercontent.com/teckedd-code2save/groundcontrol/main/scripts/start -o groundcontrol-start
bash groundcontrol-start
```

Choose where to run GroundControl:

| Location | Requirements and scope |
| --- | --- |
| **This computer** | Docker Desktop/Engine running Linux containers. Manages a local Docker workspace, not native Mac/Windows services. Apple Silicon uses AMD64 emulation. |
| **Remote Linux server** | An AMD64 server reachable over SSH, with root or passwordless sudo. Setup installs Docker if needed. ARM servers are not currently supported. |

Open the browser link printed by setup and choose your administrator credentials. A fresh installation uses a single-use claim link; there is no default password. Keep that link out of screenshots, recordings and shared logs. Rerun the launcher to reconnect to an existing installation.

Local mode stays private to your computer. Fresh remote setup uses **temporary public HTTPS** by default; configure a permanent domain for ongoing use. For SSH-only access, use `bash groundcontrol-start --remote YOUR_SSH_ALIAS --private` and keep that terminal open. The management port remains bound to loopback.

[Complete setup guide](docs/start-from-your-computer.md) covers SSH keys, permanent addresses, private access and recovery. Already on the server? Use the [canonical on-host installer](docs/agent-assisted-installation.md#canonical-command).

## First deployment

1. Finish the onboarding scan and confirm the selected connection. On a Linux server, use **Services → Install** for any missing workload tools: Git for repository sources, a proxy for routed templates, and build tools where required. A working GroundControl login does not mean those tools are ready.
2. Open **Projects → Add project**. Choose a folder, import from GitHub, or start without source code. Creating a project does not build or run an application.
3. Open the project and choose **Add deployment → Launch a new deployment**. Choose its environment, then follow the path for its host:

   | Host | Launch path |
   | --- | --- |
   | **This computer** | Name the instance and supply a ready-to-use Docker image and its app port. Choose **Review deployment**, then **Launch deployment**. The app gets a private localhost address. |
   | **Linux server** | Continue through the template workflow. Review the source/image, required configuration, services, storage and routing before deploying. See [available templates](docs/TEMPLATES.md#implemented). |

4. For a GitHub repository with a Compose file, choose **GroundControl** to build and publish its images, or **GitHub Actions** to use a named successful build workflow. Review automatic deployment for the selected branch. See the [GitHub image delivery contract](docs/github-image-delivery.md) for required Dockerfiles, GHCR images and credentials.
5. Check the deployment's status and logs, then test the application at its reported address. A running container alone does not prove the app works.

Local launches currently support one image with its default command and no extra environment configuration. Source builds, multiple services and custom configuration use Linux-server templates.

**Already running an app?** Choose **Add deployment → Connect an existing deployment** instead. Select the discovered app and its environment; enrollment leaves its containers and files in place. Follow the [existing-deployment walkthrough](docs/projects-and-deployments.md#connect-an-existing-deployment).

## Connect an agent

After enrolling a deployment, add `https://YOUR_GROUNDCONTROL_DOMAIN/mcp` to a compatible remote MCP client and complete OAuth consent. Use a stable HTTPS address that the client can reach. Choose the deployments and permissions to grant; enrollment alone does not authorize an agent.

Agents can inspect state, logs and health, then use the operations supported by each deployment. New deployment creation still goes through **Projects → Add deployment**. See [agent access and runtime capabilities](docs/agent-native-access.md).

## Operating GroundControl

GroundControl can execute commands with the privileges of its host connection. Treat dashboard and terminal access as privileged server access. Keep the management port private, use HTTPS for public access, and preserve database backups together with their matching encryption-key configuration. See [SECURITY.md](SECURITY.md) for reporting vulnerabilities and the threat model.

<a id="-roadmap"></a>

Loop is GroundControl's intelligence and recovery workspace. Its current scope and limitations are documented in [docs/LOOP.md](docs/LOOP.md); guarded autopilot is not generally enabled.

| Guide | Use it for |
| --- | --- |
| [Projects and deployments](docs/projects-and-deployments.md) | Sources, environments, existing apps and new instances |
| [Setup and recovery](docs/start-from-your-computer.md) | Reconnecting, permanent HTTPS and platform limits |
| [Installer lifecycle](docs/agent-assisted-installation.md) | Claims, upgrade previews, backups and uninstall |
| [Architecture](docs/ARCHITECTURE.md) | Host execution, storage and implementation details |
| [Known limitations](docs/PENDINGS.md) | Remaining work and sharp edges |

## Local development

Use Node.js **22.13 or newer within 22.x** and npm. A VPS is not needed for local development or fixture tests.

```bash
git clone https://github.com/teckedd-code2save/groundcontrol.git
cd groundcontrol
npm ci
cp .env.example .env
# Set separate JWT_SECRET and GROUNDCONTROL_SECRET values (openssl rand -hex 32).
# Keep DATABASE_URL="file:./dev.db" for the local SQLite database.
npx prisma migrate deploy
npx prisma generate
HOSTNAME=127.0.0.1 npm run dev
```

Open **http://localhost:3000/setup** to create the first local admin. This source-checkout flow is separate from installer claiming. `npm run db:seed` optionally loads learning guides; demo records require `GC_SEED_DEMO=1`. It does not create the schema or a shared default account.

Run `npm test` and `npm run build`; review the [CI workflows](.github/workflows) for the complete checks. [CONTRIBUTING.md](CONTRIBUTING.md) covers conventions and pull requests. For a bug report, include the commit/image version, reproduction steps and redacted logs; report vulnerabilities privately via [SECURITY.md](SECURITY.md).

[MIT License](LICENSE)
