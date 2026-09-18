import { decryptMaybe } from "@/lib/crypto";
import { prisma } from "@/lib/prisma";
import {
  createGithubInstallationToken,
  listGithubInstallationRepositories,
  normalizeGithubRepositoryUrl,
  type GithubRepositoryPayload,
} from "@/lib/github-app";

type InstallationPayload = {
  id: number;
  repository_selection?: string;
  suspended_at?: string | null;
  account?: { login?: string; type?: string };
};

export async function upsertGithubInstallation(connectionId: number, installation: InstallationPayload) {
  return prisma.githubInstallation.upsert({
    where: { id: String(installation.id) },
    create: {
      id: String(installation.id),
      connectionId,
      accountLogin: installation.account?.login || "unknown",
      accountType: installation.account?.type || "User",
      repositorySelection: installation.repository_selection || "selected",
      suspendedAt: installation.suspended_at ? new Date(installation.suspended_at) : null,
    },
    update: {
      connectionId,
      accountLogin: installation.account?.login || "unknown",
      accountType: installation.account?.type || "User",
      repositorySelection: installation.repository_selection || "selected",
      suspendedAt: installation.suspended_at ? new Date(installation.suspended_at) : null,
    },
  });
}

async function persistRepositories(installationId: string, repositories: GithubRepositoryPayload[]) {
  const ids = repositories.map((repository) => String(repository.id));
  await prisma.$transaction(async (tx) => {
    await tx.githubRepository.deleteMany({
      where: {
        installationId,
        ...(ids.length > 0 ? { id: { notIn: ids } } : {}),
      },
    });
    for (const repository of repositories) {
      await tx.githubRepository.upsert({
        where: { id: String(repository.id) },
        create: {
          id: String(repository.id),
          installationId,
          owner: repository.owner.login,
          name: repository.name,
          fullName: repository.full_name,
          htmlUrl: repository.html_url,
          defaultBranch: repository.default_branch || "main",
          isPrivate: repository.private,
          isArchived: repository.archived,
          permissionsJson: JSON.stringify(repository.permissions || {}),
        },
        update: {
          installationId,
          owner: repository.owner.login,
          name: repository.name,
          fullName: repository.full_name,
          htmlUrl: repository.html_url,
          defaultBranch: repository.default_branch || "main",
          isPrivate: repository.private,
          isArchived: repository.archived,
          permissionsJson: JSON.stringify(repository.permissions || {}),
          lastSyncedAt: new Date(),
        },
      });
    }
    await tx.githubInstallation.update({
      where: { id: installationId },
      data: { lastSyncedAt: new Date() },
    });
  });
}

export async function reconcileGithubRepositoryDeploymentLinks(installationId: string) {
  const [repositories, deployments] = await Promise.all([
    prisma.githubRepository.findMany({ where: { installationId } }),
    prisma.enrolledDeployment.findMany({ include: { legacyProject: true } }),
  ]);
  const repositoryByName = new Map(repositories.map((repository) => [repository.fullName.toLowerCase(), repository]));
  const explicitLinks = await prisma.githubRepositoryDeployment.findMany({
    where: { source: "explicit" },
    select: { enrolledDeploymentId: true },
  });
  const explicitlyLinkedDeployments = new Set(explicitLinks.map((link) => link.enrolledDeploymentId));

  await prisma.githubRepositoryDeployment.deleteMany({
    where: {
      source: "repository_url",
      repository: { installationId },
    },
  });

  let linked = 0;
  for (const deployment of deployments) {
    if (explicitlyLinkedDeployments.has(deployment.id)) continue;
    const identity = normalizeGithubRepositoryUrl(deployment.legacyProject?.repoUrl);
    const repository = repositoryByName.get(identity);
    if (!repository) continue;
    await prisma.githubRepositoryDeployment.create({
      data: {
        githubRepositoryId: repository.id,
        enrolledDeploymentId: deployment.id,
        source: "repository_url",
      },
    }).catch(async () => {
      // A concurrent sync may have linked the same repository/deployment pair.
      // Never convert an explicit link back to inferred identity.
      const existing = await prisma.githubRepositoryDeployment.findUnique({
        where: {
          githubRepositoryId_enrolledDeploymentId: {
            githubRepositoryId: repository.id,
            enrolledDeploymentId: deployment.id,
          },
        },
      });
      if (!existing || existing.source === "explicit") return;
      await prisma.githubRepositoryDeployment.update({
        where: {
          githubRepositoryId_enrolledDeploymentId: {
            githubRepositoryId: repository.id,
            enrolledDeploymentId: deployment.id,
          },
        },
        data: { source: "repository_url" },
      });
    });
    linked += 1;
  }
  return linked;
}

export async function linkGithubRepositoryToDeployment(input: {
  repositoryId: string;
  deploymentId: number;
}) {
  const [repository, deployment] = await Promise.all([
    prisma.githubRepository.findUnique({
      where: { id: input.repositoryId },
      include: { installation: true },
    }),
    prisma.enrolledDeployment.findUnique({
      where: { id: input.deploymentId },
      include: { legacyProject: true },
    }),
  ]);
  if (!repository) throw new Error("GitHub repository is not available to this GroundControl installation.");
  if (repository.installation.suspendedAt) throw new Error("The GitHub App installation for this repository is suspended.");
  if (!deployment) throw new Error("Deployment not found.");

  const canonicalUrl = `https://github.com/${repository.fullName}`;
  let metadata: Record<string, unknown> = {};
  try { metadata = JSON.parse(deployment.metadataJson || "{}"); } catch {}
  metadata.manualRepoUrl = canonicalUrl;
  metadata.repositoryIdentitySource = "github_app_explicit";
  metadata.identityUpdatedAt = new Date().toISOString();

  await prisma.$transaction(async (tx) => {
    await tx.githubRepositoryDeployment.deleteMany({
      where: { enrolledDeploymentId: deployment.id },
    });
    await tx.githubRepositoryDeployment.create({
      data: {
        githubRepositoryId: repository.id,
        enrolledDeploymentId: deployment.id,
        source: "explicit",
      },
    });
    if (deployment.legacyProjectId) {
      await tx.project.update({
        where: { id: deployment.legacyProjectId },
        data: { repoUrl: canonicalUrl },
      });
    }
    await tx.enrolledDeployment.update({
      where: { id: deployment.id },
      data: { metadataJson: JSON.stringify(metadata) },
    });
  });

  return {
    repository: {
      id: repository.id,
      fullName: repository.fullName,
      htmlUrl: repository.htmlUrl,
      defaultBranch: repository.defaultBranch,
      private: repository.isPrivate,
      installationId: repository.installationId,
    },
    deployment: {
      id: deployment.id,
      slug: deployment.slug,
      name: deployment.name,
    },
    source: "explicit" as const,
  };
}

export async function useInferredGithubRepositoryIdentity(deploymentId: number) {
  const deployment = await prisma.enrolledDeployment.findUnique({ where: { id: deploymentId } });
  if (!deployment) throw new Error("Deployment not found.");
  await prisma.githubRepositoryDeployment.deleteMany({
    where: { enrolledDeploymentId: deploymentId, source: "explicit" },
  });
  const installations = await prisma.githubInstallation.findMany({ select: { id: true } });
  let linked = 0;
  for (const installation of installations) {
    linked += await reconcileGithubRepositoryDeploymentLinks(installation.id);
  }
  return { deploymentId, inferredLinks: linked };
}

export async function syncGithubInstallation(installationId: string) {
  const installation = await prisma.githubInstallation.findUnique({
    where: { id: installationId },
    include: { connection: true },
  });
  if (!installation) throw new Error("GitHub installation is not registered in GroundControl");
  if (installation.suspendedAt) throw new Error("GitHub installation is suspended");

  const privateKey = decryptMaybe(installation.connection.privateKeyEncrypted);
  if (!privateKey) throw new Error("GitHub App private key is unavailable");
  const { token, expiresAt, permissions } = await createGithubInstallationToken({
    appId: installation.connection.appId,
    privateKey,
    installationId,
  });
  const repositories = await listGithubInstallationRepositories(token);
  await Promise.all([
    persistRepositories(installationId, repositories),
    prisma.githubAppConnection.update({
      where: { id: installation.connectionId },
      data: { permissionsJson: JSON.stringify(permissions) },
    }),
  ]);
  const linkedDeployments = await reconcileGithubRepositoryDeploymentLinks(installationId);
  return { repositoryCount: repositories.length, linkedDeployments, tokenExpiresAt: expiresAt };
}

export async function githubAppPublicState() {
  const [connection, lastWebhook] = await Promise.all([
    prisma.githubAppConnection.findFirst({
      orderBy: { updatedAt: "desc" },
      include: {
        installations: {
          orderBy: { accountLogin: "asc" },
          include: {
            repositories: {
              orderBy: { fullName: "asc" },
              include: {
                deployments: {
                  include: { deployment: { select: { id: true, name: true, slug: true } } },
                },
              },
            },
          },
        },
      },
    }),
    prisma.githubWebhookDelivery.findFirst({
      where: { status: "processed" },
      orderBy: { processedAt: "desc" },
      select: { event: true, processedAt: true },
    }),
  ]);
  if (!connection) {
    return {
      status: "not_configured" as const,
      publicUrl: process.env.GC_PUBLIC_URL || "",
      requirements: {
        publicHttps: false,
        appCreated: false,
        installationConnected: false,
        webhookReachable: false,
        sourceRepairWrite: false,
      },
      installations: [],
    };
  }
  const installations = connection.installations.map((installation) => ({
    id: installation.id,
    accountLogin: installation.accountLogin,
    accountType: installation.accountType,
    repositorySelection: installation.repositorySelection,
    suspended: Boolean(installation.suspendedAt),
    lastSyncedAt: installation.lastSyncedAt,
    repositories: installation.repositories.map((repository) => ({
      id: repository.id,
      owner: repository.owner,
      name: repository.name,
      fullName: repository.fullName,
      htmlUrl: repository.htmlUrl,
      defaultBranch: repository.defaultBranch,
      private: repository.isPrivate,
      archived: repository.isArchived,
      deployments: repository.deployments.map((link) => link.deployment),
    })),
  }));
  const publicHttps = connection.publicUrl.startsWith("https://");
  const appPermissions = JSON.parse(connection.permissionsJson || "{}") as Record<string, string>;
  return {
    status: installations.some((installation) => !installation.suspended) ? "connected" as const : "app_ready" as const,
    app: {
      id: connection.appId,
      slug: connection.slug,
      name: connection.name,
      ownerLogin: connection.ownerLogin,
      permissions: appPermissions,
      events: JSON.parse(connection.eventsJson || "[]"),
      updatedAt: connection.updatedAt,
    },
    publicUrl: connection.publicUrl,
    webhookUrl: `${connection.publicUrl}/api/github/webhooks`,
    lastWebhook,
    requirements: {
      publicHttps,
      appCreated: true,
      installationConnected: installations.length > 0,
      webhookReachable: publicHttps && Boolean(lastWebhook),
      sourceRepairWrite:
        appPermissions.contents === "write" &&
        appPermissions.pull_requests === "write",
    },
    installations,
  };
}
