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

  await prisma.githubRepositoryDeployment.deleteMany({
    where: {
      source: "repository_url",
      repository: { installationId },
    },
  });

  let linked = 0;
  for (const deployment of deployments) {
    const identity = normalizeGithubRepositoryUrl(deployment.legacyProject?.repoUrl);
    const repository = repositoryByName.get(identity);
    if (!repository) continue;
    await prisma.githubRepositoryDeployment.upsert({
      where: {
        githubRepositoryId_enrolledDeploymentId: {
          githubRepositoryId: repository.id,
          enrolledDeploymentId: deployment.id,
        },
      },
      create: {
        githubRepositoryId: repository.id,
        enrolledDeploymentId: deployment.id,
        source: "repository_url",
      },
      update: { source: "repository_url" },
    });
    linked += 1;
  }
  return linked;
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
  const { token, expiresAt } = await createGithubInstallationToken({
    appId: installation.connection.appId,
    privateKey,
    installationId,
  });
  const repositories = await listGithubInstallationRepositories(token);
  await persistRepositories(installationId, repositories);
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
  return {
    status: installations.some((installation) => !installation.suspended) ? "connected" as const : "app_ready" as const,
    app: {
      id: connection.appId,
      slug: connection.slug,
      name: connection.name,
      ownerLogin: connection.ownerLogin,
      permissions: JSON.parse(connection.permissionsJson || "{}"),
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
    },
    installations,
  };
}
