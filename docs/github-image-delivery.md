# GitHub image delivery

Import the connected repository in **Projects**, then choose **Add deployment → Launch a new deployment** on a Linux server and select the repository Compose template. Review the host, environment, configuration, storage and routing. The first launch prepares the deployment and queues image delivery; it does not build or start application containers inside the launch request.

Every custom service must have both a `build` recipe (context and Dockerfile in the repository) and a publishable `image: ghcr.io/OWNER/NAME`. Dependencies such as PostgreSQL or Redis can use upstream images without a build recipe. GroundControl builds custom services, verifies their registry digests, then releases those digests through the same durable worker used by MCP.

Choose the executor:

- **GroundControl** builds and publishes the exact commit using the existing BuildKit executor. The saved package credential needs `read:packages` and `write:packages`. Optional image tests remain explicit; a completed build does not imply tests ran.
- **GitHub Actions** requires the exact workflow name. The workflow must succeed for that repository, branch and commit, from a push or manual dispatch. Publish every custom image with the full commit SHA as its tag and `org.opencontainers.image.revision` set to the same full SHA. GroundControl verifies the workflow, image revision and digest, then releases without rebuilding. Put required tests in that workflow; its success is the recorded evidence. Actions can publish using its repository `GITHUB_TOKEN` with `packages: write`; GC's private pull credential needs `read:packages` and access to the packages.

Connect the GitHub App for repository access and use **Settings → Connectors → Private GHCR pulls → Update & verify** for package access. For Actions delivery the App needs Actions read permission and the Workflow run event subscription. For GroundControl builds it needs the Push event subscription. Package credentials are separate from the repository connection. Keep credentials out of repository files and chat.

When automatic deployment is enabled, a push to the chosen branch queues a GroundControl build, or a successful matching Actions completion queues image verification. Older branch revisions and failed workflows cannot release. The progress view follows the build and release operations; inspect deployment health and test the app after release. Uncertain operations require inspection and are not automatically replayed.

An MCP agent uses `deployment.build_publish` with `releaseAfterBuild: true`; add `verifyPublished: true` and `actionsWorkflowName` for Actions-built images. `operation.get` on the build returns the child `releaseOperationId`. The first target must be prepared by its owner through the UI and explicitly included in the external agent's grant; connecting GitHub does not grant arbitrary host deployment access. The UI's internal workflow grant is limited to that one deployment and does not enlarge external agent grants.

A local preview is separate from published GHCR artifacts. Use the application's documented development server or local Compose flow for fast testing before publishing. Upstream dependency images are pulled normally; GC does not rebuild them.
