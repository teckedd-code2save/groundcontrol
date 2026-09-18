import { readDeploymentOverrides } from "@/lib/deployment-evidence";
import { prisma } from "@/lib/prisma";
import {
  reproduceInDaytona,
  validateDaytonaCommand,
} from "@/lib/intelligence/daytona";

function canonicalRepositoryUrl(fullName: string) {
  return `https://github.com/${fullName}`;
}

function exactRevision(value?: string | null) {
  const revision = String(value || "").trim();
  return /^[a-f0-9]{40,64}$/i.test(revision) ? revision : "";
}

export async function listDaytonaAcceptanceDeployments() {
  const deployments = await prisma.enrolledDeployment.findMany({
    orderBy: [{ name: "asc" }, { id: "asc" }],
    include: {
      githubRepositories: {
        include: {
          repository: {
            select: {
              id: true,
              fullName: true,
              htmlUrl: true,
              defaultBranch: true,
              isPrivate: true,
              installationId: true,
            },
          },
        },
      },
      legacyProject: {
        include: {
          deployments: {
            orderBy: { createdAt: "desc" },
            take: 1,
            select: { commitSha: true, branch: true, createdAt: true },
          },
        },
      },
    },
  });

  return deployments.map((deployment) => {
    const explicit = deployment.githubRepositories.find((link) => link.source === "explicit");
    const link = explicit || deployment.githubRepositories[0] || null;
    const overrides = readDeploymentOverrides(deployment.metadataJson);
    const latestRelease = deployment.legacyProject?.deployments[0] || null;
    const revision = exactRevision(overrides.sourceRepair?.deployedCommit || latestRelease?.commitSha);
    const validationCommand = overrides.sourceRepair?.validationCommand || "";
    const repository = link?.repository || null;
    const blockers = [
      ...(!repository ? ["repository_not_linked"] : []),
      ...(!revision ? ["exact_revision_missing"] : []),
      ...(!validationCommand ? ["validation_command_missing"] : []),
    ];
    return {
      id: deployment.id,
      name: deployment.name,
      slug: deployment.slug,
      repository: repository ? {
        id: repository.id,
        fullName: repository.fullName,
        htmlUrl: repository.htmlUrl,
        private: repository.isPrivate,
        linkSource: link?.source || "unknown",
      } : null,
      branch: overrides.sourceRepair?.defaultBranch || latestRelease?.branch || repository?.defaultBranch || "main",
      revision,
      sourceRoot: overrides.sourceRepair?.sourceRoot || "",
      validationCommand,
      ready: blockers.length === 0,
      blockers,
    };
  });
}

export async function runDaytonaRepositoryAcceptance(input: {
  deploymentId: number;
  validationCommand?: string;
}) {
  const deployments = await listDaytonaAcceptanceDeployments();
  const deployment = deployments.find((item) => item.id === input.deploymentId);
  if (!deployment) throw new Error("Deployment not found.");
  if (!deployment.repository) {
    throw new Error("Link this deployment to an installation-backed GitHub repository first.");
  }
  if (!deployment.revision) {
    throw new Error("Record the exact deployed commit before testing Daytona.");
  }

  const validationCommand = String(input.validationCommand || deployment.validationCommand || "").trim();
  const commandError = validateDaytonaCommand(validationCommand);
  if (commandError) throw new Error(commandError);

  const startedAt = new Date();
  const result = await reproduceInDaytona({
    repositoryUrl: canonicalRepositoryUrl(deployment.repository.fullName),
    branch: deployment.branch,
    commitSha: deployment.revision,
    sourceRoot: deployment.sourceRoot || undefined,
    testCommand: validationCommand,
    budgetSeconds: 180,
  });

  const revisionLog = result.logs.find((line) => line.startsWith("revision=")) || "";
  const provedRevision = revisionLog.slice("revision=".length).trim();
  const exactRevisionProved =
    Boolean(provedRevision) &&
    provedRevision.toLowerCase() === deployment.revision.toLowerCase();

  const capabilityHealthy =
    result.provider === "daytona" &&
    result.status === "completed" &&
    result.cleanedUp === true &&
    exactRevisionProved;

  const checkedAt = new Date().toISOString();
  if (capabilityHealthy) {
    await prisma.$transaction([
      prisma.appConfig.upsert({
        where: { key: "connector_daytona_repositoryVerifiedAt" },
        create: { key: "connector_daytona_repositoryVerifiedAt", value: checkedAt },
        update: { value: checkedAt },
      }),
      prisma.appConfig.upsert({
        where: { key: "connector_daytona_repositoryVerifiedDeployment" },
        create: { key: "connector_daytona_repositoryVerifiedDeployment", value: deployment.slug },
        update: { value: deployment.slug },
      }),
      prisma.appConfig.upsert({
        where: { key: "connector_daytona_repositoryVerifiedRevision" },
        create: { key: "connector_daytona_repositoryVerifiedRevision", value: deployment.revision },
        update: { value: deployment.revision },
      }),
      prisma.appConfig.upsert({
        where: { key: "connector_daytona_repositoryValidationOutcome" },
        create: {
          key: "connector_daytona_repositoryValidationOutcome",
          value: result.reproducedFailure ? "validation_failed_at_exact_revision" : "validation_passed_at_exact_revision",
        },
        update: {
          value: result.reproducedFailure ? "validation_failed_at_exact_revision" : "validation_passed_at_exact_revision",
        },
      }),
    ]);
  }

  return {
    ok: capabilityHealthy,
    deployment: {
      id: deployment.id,
      slug: deployment.slug,
      name: deployment.name,
    },
    repository: deployment.repository,
    branch: deployment.branch,
    revision: deployment.revision,
    validationCommand,
    startedAt,
    checkedAt,
    exactRevisionProved,
    capabilityHealthy,
    validationPassed: !result.reproducedFailure,
    reproduction: {
      id: result.id,
      status: result.status,
      provider: result.provider,
      detail: result.detail,
      reproducedFailure: result.reproducedFailure,
      cleanedUp: result.cleanedUp,
      logs: result.logs,
    },
  };
}
