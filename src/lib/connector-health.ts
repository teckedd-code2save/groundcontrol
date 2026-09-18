import { decryptMaybe } from "@/lib/crypto";
import {
  createGithubInstallationToken,
  githubInstallationFetch,
  normalizeGithubRepositoryUrl,
} from "@/lib/github-app";
import { githubRegistryPublicState, verifyGithubRegistryAccess } from "@/lib/github-registry";
import { prisma } from "@/lib/prisma";
import {
  loadDaytonaRuntimeConfig,
  testDaytonaConnection,
  testDaytonaSandboxLifecycle,
} from "@/lib/intelligence/daytona";

export type ConnectorCapabilityStatus =
  | "healthy"
  | "unverified"
  | "degraded"
  | "missing_scope"
  | "revoked"
  | "unavailable"
  | "not_configured";

export type ConnectorOverallStatus =
  | "healthy"
  | "unverified"
  | "degraded"
  | "not_configured";

export interface ConnectorCapabilityHealth {
  id: string;
  label: string;
  status: ConnectorCapabilityStatus;
  detail: string;
  remediation?: string;
  checkedAt?: string | null;
  metadata?: Record<string, unknown>;
}

export interface ConnectorHealth {
  id: "github" | "daytona";
  name: string;
  status: ConnectorOverallStatus;
  configured: boolean;
  capabilities: ConnectorCapabilityHealth[];
  checkedAt: string;
}

function isRecent(value?: string | Date | null, hours = 24) {
  if (!value) return false;
  const time = value instanceof Date ? value.getTime() : Date.parse(value);
  return Number.isFinite(time) && Date.now() - time <= hours * 60 * 60 * 1000;
}

function overall(capabilities: ConnectorCapabilityHealth[], configured: boolean): ConnectorOverallStatus {
  if (!configured) return "not_configured";
  if (capabilities.some((item) => ["degraded", "missing_scope", "revoked", "unavailable"].includes(item.status))) {
    return "degraded";
  }
  if (capabilities.some((item) => item.status === "unverified" || item.status === "not_configured")) {
    return "unverified";
  }
  return "healthy";
}

function classifyRemoteFailure(message: string): ConnectorCapabilityStatus {
  const normalized = message.toLowerCase();
  if (/suspend|revok|bad credentials|unauthorized|authentication|invalid token/.test(normalized)) return "revoked";
  if (/scope|permission|forbidden/.test(normalized)) return "missing_scope";
  return "unavailable";
}

async function githubHealth(refresh: boolean): Promise<ConnectorHealth> {
  const [connection, latestWebhook, latestProcessedWebhook, registryState] = await Promise.all([
    prisma.githubAppConnection.findFirst({
      orderBy: { updatedAt: "desc" },
      include: {
        installations: {
          include: {
            repositories: {
              include: {
                deployments: true,
              },
            },
          },
        },
      },
    }),
    prisma.githubWebhookDelivery.findFirst({
      orderBy: { receivedAt: "desc" },
      select: { status: true, event: true, receivedAt: true, processedAt: true, error: true },
    }),
    prisma.githubWebhookDelivery.findFirst({
      where: { status: "processed" },
      orderBy: { processedAt: "desc" },
      select: { event: true, processedAt: true },
    }),
    githubRegistryPublicState(),
  ]);

  if (!connection) {
    const capabilities: ConnectorCapabilityHealth[] = [
      {
        id: "source.installation",
        label: "GitHub App installation",
        status: "not_configured",
        detail: "No operator-owned GitHub App is configured.",
        remediation: "Create the GitHub App and install it on the repositories GroundControl should manage.",
      },
      {
        id: "source.read",
        label: "Repository read",
        status: "not_configured",
        detail: "Repository access is unavailable until the GitHub App is installed.",
      },
      {
        id: "source.write",
        label: "Repair pull requests",
        status: "not_configured",
        detail: "Source repair permissions are not configured.",
      },
      {
        id: "source.webhook",
        label: "Signed GitHub events",
        status: "not_configured",
        detail: "Webhook verification is not configured.",
      },
      {
        id: "repository.identity",
        label: "Deployment repository identity",
        status: "not_configured",
        detail: "No installation repositories are available for workload linking.",
      },
      {
        id: "registry.pull",
        label: "GHCR package pull",
        status: registryState.configured ? "unverified" : "not_configured",
        detail: registryState.configured
          ? "A package credential exists but is not attached to a GitHub App connection."
          : "Private GHCR access is not configured.",
      },
    ];
    return {
      id: "github",
      name: "GitHub",
      configured: false,
      status: "not_configured",
      capabilities,
      checkedAt: new Date().toISOString(),
    };
  }

  const activeInstallations = connection.installations.filter((installation) => !installation.suspendedAt);
  const allRepositories = activeInstallations.flatMap((installation) => installation.repositories);
  const allLinks = allRepositories.flatMap((repository) => repository.deployments);
  const explicitLinks = allLinks.filter((link) => link.source === "explicit");
  const syncedAt = activeInstallations
    .map((installation) => installation.lastSyncedAt)
    .filter((value): value is Date => Boolean(value))
    .sort((a, b) => b.getTime() - a.getTime())[0] || null;

  const deployments = await prisma.enrolledDeployment.findMany({
    include: { legacyProject: { select: { repoUrl: true } } },
  });
  const linkedDeploymentIds = new Set(allLinks.map((link) => link.enrolledDeploymentId));
  const githubIdentityDeployments = deployments.filter((deployment) =>
    Boolean(normalizeGithubRepositoryUrl(deployment.legacyProject?.repoUrl))
  );
  const unlinkedGithubDeployments = githubIdentityDeployments.filter(
    (deployment) => !linkedDeploymentIds.has(deployment.id)
  );

  let sourceRead: ConnectorCapabilityHealth;
  if (activeInstallations.length === 0) {
    sourceRead = {
      id: "source.read",
      label: "Repository read",
      status: connection.installations.some((installation) => installation.suspendedAt) ? "revoked" : "unverified",
      detail: connection.installations.length
        ? "All GitHub App installations are suspended."
        : "The GitHub App exists but is not installed on an account.",
      remediation: "Install or unsuspend the GitHub App, then verify repository access.",
    };
  } else if (refresh) {
    try {
      const installation = activeInstallations[0];
      const privateKey = decryptMaybe(connection.privateKeyEncrypted);
      if (!privateKey) throw new Error("GitHub App private key is unavailable.");
      const token = await createGithubInstallationToken({
        appId: connection.appId,
        privateKey,
        installationId: installation.id,
      });
      const probe = await githubInstallationFetch<{ repositories?: unknown[] }>(
        token.token,
        "/installation/repositories?per_page=1"
      );
      sourceRead = {
        id: "source.read",
        label: "Repository read",
        status: "healthy",
        detail: `Installation token verified. ${allRepositories.length} repositories are currently visible to GroundControl.`,
        checkedAt: new Date().toISOString(),
        metadata: {
          repositoryCount: allRepositories.length,
          tokenExpiresAt: token.expiresAt,
          probeRepositoryCount: Array.isArray(probe.repositories) ? probe.repositories.length : 0,
        },
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      sourceRead = {
        id: "source.read",
        label: "Repository read",
        status: classifyRemoteFailure(message),
        detail: message,
        remediation: "Reconnect or repair the GitHub App installation, then verify again.",
        checkedAt: new Date().toISOString(),
      };
    }
  } else {
    sourceRead = {
      id: "source.read",
      label: "Repository read",
      status: syncedAt && isRecent(syncedAt) ? "healthy" : "unverified",
      detail: syncedAt
        ? `Last repository sync completed ${syncedAt.toISOString()}.`
        : "Repository access has not completed a successful sync yet.",
      checkedAt: syncedAt?.toISOString() || null,
      remediation: syncedAt ? undefined : "Run Verify capabilities to prove current installation access.",
      metadata: { repositoryCount: allRepositories.length },
    };
  }

  let registry = registryState;
  let registryStatus: ConnectorCapabilityStatus;
  let registryFailureKind: string | undefined;
  if (refresh && registry.configured) {
    const verified = await verifyGithubRegistryAccess();
    registry = verified.state;
    registryFailureKind = verified.failureKind;
  }
  if (!registry.configured) registryStatus = "not_configured";
  else if (registry.status === "error") {
    registryStatus = registryFailureKind === "missing_scope"
      ? "missing_scope"
      : registryFailureKind === "revoked_or_invalid"
        ? "revoked"
        : "degraded";
  } else if (!registry.lastCheckedAt || !isRecent(registry.lastCheckedAt)) {
    registryStatus = "unverified";
  } else {
    registryStatus = "healthy";
  }

  const permissions = (() => {
    try { return JSON.parse(connection.permissionsJson || "{}") as Record<string, string>; }
    catch { return {}; }
  })();
  const sourceWrite = permissions.contents === "write" && permissions.pull_requests === "write";

  const capabilities: ConnectorCapabilityHealth[] = [
    {
      id: "source.installation",
      label: "GitHub App installation",
      status: activeInstallations.length > 0 ? "healthy" : connection.installations.length ? "revoked" : "unverified",
      detail: activeInstallations.length > 0
        ? `${activeInstallations.length} active installation${activeInstallations.length === 1 ? "" : "s"}.`
        : connection.installations.length
          ? "GitHub App installation is suspended."
          : "GitHub App exists but has not been installed on an account.",
      remediation: activeInstallations.length > 0 ? undefined : "Install or unsuspend the GitHub App.",
      metadata: { activeInstallations: activeInstallations.length },
    },
    sourceRead,
    {
      id: "source.write",
      label: "Repair pull requests",
      status: sourceWrite ? "healthy" : "missing_scope",
      detail: sourceWrite
        ? "Contents and pull request write permissions are available."
        : "Validated source repair cannot open a pull request with the current App permissions.",
      remediation: sourceWrite
        ? undefined
        : "Grant Contents: read/write and Pull requests: read/write to the GitHub App, then sync.",
    },
    {
      id: "source.webhook",
      label: "Signed GitHub events",
      status: latestWebhook?.status === "failed"
        ? "degraded"
        : latestProcessedWebhook?.processedAt
          ? "healthy"
          : "unverified",
      detail: latestWebhook?.status === "failed"
        ? `Latest webhook processing failed: ${latestWebhook.error || "unknown error"}`
        : latestProcessedWebhook?.processedAt
          ? `Last verified ${latestProcessedWebhook.event} event: ${latestProcessedWebhook.processedAt.toISOString()}.`
          : "No verified signed webhook delivery has been observed yet.",
      remediation: latestWebhook?.status === "failed"
        ? "Inspect the webhook delivery and resync the installation."
        : latestProcessedWebhook
          ? undefined
          : "Trigger a repository event or redeliver a GitHub webhook, then verify again.",
      checkedAt: latestProcessedWebhook?.processedAt?.toISOString() || latestWebhook?.receivedAt?.toISOString() || null,
    },
    {
      id: "repository.identity",
      label: "Deployment repository identity",
      status: unlinkedGithubDeployments.length > 0
        ? "degraded"
        : allRepositories.length > 0
          ? "healthy"
          : "unverified",
      detail: unlinkedGithubDeployments.length > 0
        ? `${unlinkedGithubDeployments.length} deployment${unlinkedGithubDeployments.length === 1 ? "" : "s"} with GitHub source identity are not linked to an installation repository.`
        : `${allLinks.length} deployment link${allLinks.length === 1 ? "" : "s"} resolved; ${explicitLinks.length} explicit.`,
      remediation: unlinkedGithubDeployments.length > 0
        ? "Choose the exact installation repository from each deployment Source tab."
        : undefined,
      metadata: {
        repositoryCount: allRepositories.length,
        linkedDeployments: linkedDeploymentIds.size,
        explicitLinks: explicitLinks.length,
        inferredLinks: allLinks.length - explicitLinks.length,
        unlinkedGithubDeployments: unlinkedGithubDeployments.map((deployment) => deployment.slug),
      },
    },
    {
      id: "registry.pull",
      label: "GHCR package pull",
      status: registryStatus,
      detail: !registry.configured
        ? "Private GHCR access is optional and not configured."
        : registry.status === "error"
          ? registry.error || "GitHub package access verification failed."
          : registry.verifiedImage
            ? `Verified against ${registry.verifiedImage}.`
            : "Credential authenticated, but no current GHCR deployment exists to prove package read access.",
      remediation: registryStatus === "revoked"
        ? "Reconnect the GitHub package credential."
        : registryStatus === "missing_scope"
          ? "Use a package credential with read:packages access to the package owner."
          : registryStatus === "degraded"
            ? "Verify the package credential and target image access."
            : undefined,
      checkedAt: registry.lastCheckedAt || null,
      metadata: { username: registry.username, verifiedImage: registry.verifiedImage },
    },
  ];

  return {
    id: "github",
    name: "GitHub",
    configured: true,
    status: overall(capabilities, true),
    capabilities,
    checkedAt: new Date().toISOString(),
  };
}

async function daytonaHealth(refresh: boolean, deep: boolean): Promise<ConnectorHealth> {
  const [
    config,
    verifiedAtRow,
    lifecycleRow,
    repositoryVerifiedAtRow,
    repositoryDeploymentRow,
    repositoryRevisionRow,
    repositoryOutcomeRow,
  ] = await Promise.all([
    loadDaytonaRuntimeConfig(),
    prisma.appConfig.findUnique({ where: { key: "connector_daytona_verifiedAt" } }),
    prisma.appConfig.findUnique({ where: { key: "connector_daytona_lifecycleVerifiedAt" } }),
    prisma.appConfig.findUnique({ where: { key: "connector_daytona_repositoryVerifiedAt" } }),
    prisma.appConfig.findUnique({ where: { key: "connector_daytona_repositoryVerifiedDeployment" } }),
    prisma.appConfig.findUnique({ where: { key: "connector_daytona_repositoryVerifiedRevision" } }),
    prisma.appConfig.findUnique({ where: { key: "connector_daytona_repositoryValidationOutcome" } }),
  ]);

  if (!config) {
    const capabilities: ConnectorCapabilityHealth[] = [
      {
        id: "sandbox.api",
        label: "Daytona API",
        status: "not_configured",
        detail: "No Daytona API credential is configured.",
        remediation: "Configure Daytona and verify the connection.",
      },
      {
        id: "sandbox.lifecycle",
        label: "Sandbox lifecycle",
        status: "not_configured",
        detail: "Sandbox create/execute/delete has not been configured.",
      },
      {
        id: "sandbox.repository_clone",
        label: "Exact revision reproduction",
        status: "not_configured",
        detail: "Repository reproduction is unavailable until Daytona is configured.",
      },
    ];
    return {
      id: "daytona",
      name: "Daytona",
      configured: false,
      status: "not_configured",
      capabilities,
      checkedAt: new Date().toISOString(),
    };
  }

  let apiStatus: ConnectorCapabilityStatus =
    verifiedAtRow?.value && isRecent(verifiedAtRow.value) ? "healthy" : "unverified";
  let apiDetail = verifiedAtRow?.value
    ? `Last API verification: ${verifiedAtRow.value}.`
    : "Credential exists but current API access has not been verified.";
  let apiCheckedAt = verifiedAtRow?.value || null;

  let lifecycleStatus: ConnectorCapabilityStatus =
    lifecycleRow?.value && isRecent(lifecycleRow.value) ? "healthy" : "unverified";
  let lifecycleDetail = lifecycleRow?.value
    ? `Sandbox create/execute/delete last verified: ${lifecycleRow.value}.`
    : "Sandbox lifecycle has never completed a GroundControl verification.";
  let lifecycleCheckedAt = lifecycleRow?.value || null;

  if (refresh) {
    try {
      await testDaytonaConnection(config);
      apiStatus = "healthy";
      apiCheckedAt = new Date().toISOString();
      apiDetail = `Daytona API verified using ${config.source} configuration.`;
      await prisma.appConfig.upsert({
        where: { key: "connector_daytona_verifiedAt" },
        create: { key: "connector_daytona_verifiedAt", value: apiCheckedAt },
        update: { value: apiCheckedAt },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      apiStatus = classifyRemoteFailure(message);
      apiDetail = message;
    }

    if (apiStatus === "healthy" && deep) {
      try {
        await testDaytonaSandboxLifecycle(config);
        lifecycleStatus = "healthy";
        lifecycleCheckedAt = new Date().toISOString();
        lifecycleDetail = "Created an ephemeral sandbox, executed a command, and deleted the sandbox successfully.";
        await prisma.appConfig.upsert({
          where: { key: "connector_daytona_lifecycleVerifiedAt" },
          create: { key: "connector_daytona_lifecycleVerifiedAt", value: lifecycleCheckedAt },
          update: { value: lifecycleCheckedAt },
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        lifecycleStatus = classifyRemoteFailure(message);
        lifecycleDetail = message;
      }
    }
  }

  const capabilities: ConnectorCapabilityHealth[] = [
    {
      id: "sandbox.api",
      label: "Daytona API",
      status: apiStatus,
      detail: apiDetail,
      remediation: apiStatus === "healthy" ? undefined : "Reconnect Daytona and verify the API credential.",
      checkedAt: apiCheckedAt,
      metadata: { source: config.source },
    },
    {
      id: "sandbox.lifecycle",
      label: "Sandbox lifecycle",
      status: lifecycleStatus,
      detail: lifecycleDetail,
      remediation: lifecycleStatus === "healthy"
        ? undefined
        : "Run a deep connector verification. GroundControl will create, execute in, and delete an ephemeral sandbox.",
      checkedAt: lifecycleCheckedAt,
    },
    {
      id: "sandbox.repository_clone",
      label: "Exact revision reproduction",
      status: lifecycleStatus !== "healthy"
        ? lifecycleStatus
        : repositoryVerifiedAtRow?.value && isRecent(repositoryVerifiedAtRow.value)
          ? "healthy"
          : "unverified",
      detail: lifecycleStatus !== "healthy"
        ? "Exact-revision reproduction cannot be trusted until sandbox lifecycle is healthy."
        : repositoryVerifiedAtRow?.value && isRecent(repositoryVerifiedAtRow.value)
          ? `Exact repository revision verified for ${repositoryDeploymentRow?.value || "a deployment"} at ${repositoryRevisionRow?.value?.slice(0, 12) || "recorded revision"}; ${repositoryOutcomeRow?.value || "validation executed"}.`
          : "Sandbox lifecycle works, but deployment → exact repository revision validation has not been proven recently.",
      remediation: lifecycleStatus === "healthy" && !(repositoryVerifiedAtRow?.value && isRecent(repositoryVerifiedAtRow.value))
        ? "Run the Daytona acceptance flow against one explicitly linked deployment and exact revision."
        : undefined,
      checkedAt: repositoryVerifiedAtRow?.value || null,
      metadata: repositoryVerifiedAtRow?.value ? {
        deployment: repositoryDeploymentRow?.value || "",
        revision: repositoryRevisionRow?.value || "",
        validationOutcome: repositoryOutcomeRow?.value || "",
      } : undefined,
    },
  ];

  return {
    id: "daytona",
    name: "Daytona",
    configured: true,
    status: overall(capabilities, true),
    capabilities,
    checkedAt: new Date().toISOString(),
  };
}

export async function getConnectorHealth(options: {
  refresh?: boolean;
  deepDaytona?: boolean;
  connector?: "github" | "daytona" | "all";
} = {}) {
  const connector = options.connector || "all";
  const refresh = options.refresh === true;
  const checks = [];
  if (connector === "all" || connector === "github") checks.push(githubHealth(refresh));
  if (connector === "all" || connector === "daytona") checks.push(daytonaHealth(refresh, options.deepDaytona === true));
  return Promise.all(checks);
}
