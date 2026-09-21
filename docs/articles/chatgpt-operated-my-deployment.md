# I gave ChatGPT infrastructure access without giving it SSH

Most “AI for infrastructure” demos begin by placing a model in front of a terminal.

That is impressive, but it is also the wrong trust boundary for production.

I built GroundControl around a narrower idea: an agent should ask for an operational outcome, while a control plane owns credentials, policy, execution, verification and rollback.

## The test

I connected ChatGPT to a self-hosted GroundControl instance through MCP and OAuth. The grant exposed only selected deployments and a small set of typed capabilities:

- inspect deployment identity;
- read health and logs;
- confirm whether named configuration exists without reading its value;
- start a durable redeploy;
- retrieve operation progress and evidence.

ChatGPT never received the VPS SSH key, provider credentials or unrestricted terminal access.

I then used RentAWeekend as the production proof.

ChatGPT inspected the deployment and checked the live runtime. A signed push to the explicitly allowed repository and `main` branch created a durable `deployment.source.deploy` operation inside GroundControl.

The operation completed in one attempt with no recorded error. Web, API, PostgreSQL and Redis were healthy. The public endpoint returned HTTP 200 at approximately 99 ms during verification.

That result matters more than “the command ran.” A healthy process is not proof that the customer can reach the application.

## Why durable operations matter

A chat request is temporary. Deployment work is not.

GroundControl returns an operation ID, continues independently of the conversation, records each stage, and lets the agent reconnect later. This avoids holding a shell session open and prevents a disconnected chat from making the state of production ambiguous.

The model can explain the result, but it does not decide whether it is permitted to mutate the host. That decision belongs to deterministic policy:

- exact deployment scope;
- typed action;
- allowed repository and branch;
- idempotency;
- execution budget;
- verification;
- rollback or safe abstention.

## The distribution problem

The control plane itself also has to be trustworthy to install.

A fresh-host acceptance run now proves that GroundControl can:

1. install from one command;
2. bind privately to loopback;
3. return a short-lived one-time claim;
4. create the first human administrator;
5. expose MCP and OAuth discovery;
6. preserve its database on a Docker volume;
7. rerun without changing a healthy installation;
8. preview and perform a backup-backed upgrade;
9. preserve the operator session across that upgrade;
10. uninstall without deleting its data.

The acceptance ran against revision `e27dddec3bdf5944de7ca7317b1bbbf32b203953` and passed on a disposable Linux host.

## Where Daytona fits

Daytona is useful when live evidence points to a repository, configuration or Compose defect that needs isolated reproduction. It is not the production runtime and it is not required for every incident.

The intended path is: reproduce the exact deployed revision in an ephemeral sandbox, validate the smallest candidate fix, open a normal pull request after approval, let the existing delivery pipeline deploy it, and let GroundControl verify the public outcome.

## What GroundControl is—and is not

GroundControl is a self-hosted operational control plane for applications running on infrastructure you own. It builds on Docker Compose, Caddy or Nginx, GitHub Actions and registries.

It is not a new CI provider, an unrestricted shell agent, or a replacement for the tools already delivering your software.

The useful product boundary is simple:

> Give agents infrastructure capabilities, not infrastructure credentials.

GroundControl is open source. You can install it privately, connect one deployment, and test the same read → operate → verify loop.

- Product: https://trygroundcontrol.serendepify.com
- Source: https://github.com/teckedd-code2save/groundcontrol
- Adoption guide: https://github.com/teckedd-code2save/groundcontrol/blob/main/docs/ADOPTION.md
