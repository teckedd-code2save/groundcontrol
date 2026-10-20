# Share GroundControl

## The promise

**Put your agents to work on infrastructure you own.**

GroundControl connects ChatGPT and compatible MCP agents to your applications. Agents can inspect workloads, request supported deployments, and return to recorded results. You define their access through OAuth while GroundControl holds infrastructure credentials.

## One public starting point

Share **https://trygroundcontrol.serendepify.com/docs/getting-started**. Visitors choose local Docker or their own Linux server and receive a personal setup link. Do not share your private GroundControl URL or anyone’s one-time claim link.

Source: https://github.com/teckedd-code2save/groundcontrol

Product story: https://trygroundcontrol.serendepify.com/articles/agentic-deployment-with-oauth-and-mcp

Projects guide: https://trygroundcontrol.serendepify.com/docs/projects

## Reusable announcement

GroundControl gives your AI agents a working connection to applications on infrastructure you own.

Run it locally with Docker or install it on a Linux server from your computer. Open the setup link, pick a project folder or GitHub repository, and connect an existing deployment or launch a new instance. Then give ChatGPT or another compatible MCP agent access to the workloads you choose.

Explore the product and get started: https://trygroundcontrol.serendepify.com/docs/getting-started

## A short demonstration

1. Run the two download/start commands and choose a destination.
2. Show the ownership screen without recording the claim token or password.
3. Add a project using the folder picker or a public GitHub repository.
4. Connect a disposable existing deployment, or launch a simple local image.
5. On a reachable HTTPS server instance, authorize an MCP client and ask it to inspect the deployment.
6. Show the returned runtime evidence and operation history. Keep dates visible on prerecorded examples.

## Claims to keep precise

- Windows setup uses WSL; there is no native PowerShell launcher.
- Local mode manages Docker workloads. It does not manage native Mac or Windows services and does not publish a public MCP endpoint.
- The published image currently targets AMD64. Apple Silicon uses Docker emulation; native ARM server installation is not supported.
- Registering source code does not build or launch it. Local launches accept one ready-to-use image and its default command. Linux-server templates handle source builds and configured stacks.
- The September RentAWeekend example was triggered by GitHub; ChatGPT subsequently read health and the recorded operation. It does not prove that ChatGPT initiated that deployment, or that the images came from the recorded source SHA.
- Autopilot recovery remains product direction. Do not promise unattended recovery.

## Release gate before announcing

Merge the distribution update, wait for server and desktop acceptance and `latest` promotion, then publish the matching public docs. Retain the workflow links and the release revision. A passing synthetic migration test establishes compatibility of the fixture, not the health of any existing production installation.

Sharing this file does not send or publish a social post. Use the announcement when you choose a channel and audience.
