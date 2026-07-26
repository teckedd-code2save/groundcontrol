import { randomUUID } from "crypto";
import { decryptMaybe } from "@/lib/crypto";
import {
  createGithubInstallationToken,
  githubInstallationFetch,
  normalizeGithubRepositoryUrl,
} from "@/lib/github-app";
import { reproduceInDaytona, validateRepairFilePath } from "@/lib/intelligence/daytona";
import { prisma } from "@/lib/prisma";

const PLAN_TTL_MS = 2 * 60 * 60 * 1000;
const MAX_REPLACEMENT_BYTES = 300_000;

type LinkedRepository = Awaited<ReturnType<typeof linkedRepository>>;

export interface PrepareSourceRepairInput {
  repositoryUrl: string;
  baseBranch?: string;
  commitSha: string;
  filePath: string;
  replacementContent: string;
  validationCommand: string;
  incidentSummary?: string;
  verificationUrl?: string;
}

export interface OpenSourceRepairInput {
  repairPlanId: string;
  title: string;
}

function clipped(value: string | undefined, max: number) {
  return String(value || "").trim().slice(0, max);
}

function encodedRepositoryPath(fullName: string) {
  return fullName.split("/").map(encodeURIComponent).join("/");
}

function encodedFilePath(filePath: string) {
  return filePath.split("/").map(encodeURIComponent).join("/");
}

async function linkedRepository(repositoryUrl: string) {
  const identity = normalizeGithubRepositoryUrl(repositoryUrl);
  if (!identity) throw new Error("Use a GitHub repository URL linked to this deployment.");
  const repositories = await prisma.githubRepository.findMany({
    include: { installation: { include: { connection: true } } },
  });
  const repository = repositories.find(
    (candidate) => candidate.fullName.toLowerCase() === identity
  );
  if (!repository) {
    throw new Error("This repository is not connected through Settings → GitHub App.");
  }
  if (repository.isArchived) throw new Error("Source repairs cannot target an archived repository.");
  if (repository.installation.suspendedAt) throw new Error("The GitHub App installation is suspended.");
  return repository;
}

async function installationAccess(repository: NonNullable<LinkedRepository>) {
  const privateKey = decryptMaybe(repository.installation.connection.privateKeyEncrypted);
  if (!privateKey) throw new Error("The GitHub App private key is unavailable.");
  return createGithubInstallationToken({
    appId: repository.installation.connection.appId,
    privateKey,
    installationId: repository.installation.id,
  });
}

export async function prepareSourceRepairPlan(input: PrepareSourceRepairInput) {
  const repository = await linkedRepository(input.repositoryUrl);
  const filePath = input.filePath.trim();
  const pathError = validateRepairFilePath(filePath);
  if (pathError) throw new Error(pathError);
  const commitSha = input.commitSha.trim();
  if (!/^[a-f0-9]{40,64}$/i.test(commitSha)) {
    throw new Error("An exact deployed commit SHA is required before preparing a source repair.");
  }
  if (!input.replacementContent || Buffer.byteLength(input.replacementContent, "utf8") > MAX_REPLACEMENT_BYTES) {
    throw new Error("The replacement file must be present and smaller than 300 KB.");
  }

  const baseBranch = clipped(input.baseBranch || repository.defaultBranch, 120);
  const result = await reproduceInDaytona({
    repositoryUrl: repository.htmlUrl,
    branch: baseBranch,
    commitSha,
    testCommand: input.validationCommand,
    journeyUrl: clipped(input.verificationUrl, 500),
    candidate: {
      filePath,
      replacementContent: input.replacementContent,
    },
    budgetSeconds: 300,
  });

  if (
    result.provider !== "daytona" ||
    result.status !== "completed" ||
    result.candidateValidated !== true ||
    !result.proposedPatch ||
    !result.baseFileBlobSha
  ) {
    throw new Error(result.detail || "Daytona did not validate this source candidate.");
  }

  const id = `repair_${randomUUID().replace(/-/g, "")}`;
  const expiresAt = new Date(Date.now() + PLAN_TTL_MS);
  const baseline = result.logs.find((line) => line.startsWith("baseline_exit=")) || "baseline_exit=unknown";
  const candidate = result.logs.find((line) => line.startsWith("candidate_exit=")) || "candidate_exit=unknown";
  const validationSummary = `${baseline}; ${candidate}; ${result.detail}`;

  await prisma.sourceRepairPlan.deleteMany({
    where: { expiresAt: { lt: new Date() }, status: { not: "pr_opened" } },
  });
  await prisma.sourceRepairPlan.create({
    data: {
      id,
      repositoryFullName: repository.fullName,
      repositoryUrl: repository.htmlUrl,
      baseBranch,
      baseSha: commitSha,
      baseFileBlobSha: result.baseFileBlobSha,
      filePath,
      replacementContent: input.replacementContent,
      patch: result.proposedPatch,
      validationCommand: input.validationCommand,
      validationSummary,
      provider: result.provider,
      incidentSummary: clipped(input.incidentSummary, 2_000),
      verificationUrl: clipped(input.verificationUrl, 500),
      expiresAt,
    },
  });

  return {
    repairPlanId: id,
    status: "validated",
    repository: repository.fullName,
    deployedRevision: commitSha,
    filePath,
    validation: validationSummary,
    patch: result.proposedPatch,
    expiresAt: expiresAt.toISOString(),
    nextAction: "Ask for approval to open this as a pull request. Do not write the production file.",
  };
}

export async function openSourceRepairPullRequest(input: OpenSourceRepairInput) {
  const repairPlanId = input.repairPlanId.trim();
  const plan = await prisma.sourceRepairPlan.findUnique({ where: { id: repairPlanId } });
  if (!plan) throw new Error("The validated repair plan was not found.");
  if (plan.status === "pr_opened" && plan.pullRequestUrl) {
    return {
      status: "already_open",
      pullRequestUrl: plan.pullRequestUrl,
      pullRequestNumber: plan.pullRequestNumber,
      nextAction: "Review and merge the pull request; the normal deployment pipeline remains authoritative.",
    };
  }
  if (plan.status !== "prepared") throw new Error(`This repair plan is ${plan.status} and cannot be opened.`);
  if (plan.expiresAt.getTime() <= Date.now()) {
    await prisma.sourceRepairPlan.update({ where: { id: plan.id }, data: { status: "stale" } });
    throw new Error("This repair plan expired. Re-run the Daytona validation against the current revision.");
  }

  const repository = await linkedRepository(plan.repositoryUrl);
  const access = await installationAccess(repository);
  if (access.permissions.contents !== "write" || access.permissions.pull_requests !== "write") {
    throw new Error(
      "The connected GitHub App needs Contents: read and write plus Pull requests: read and write. Upgrade or recreate it in Settings → GitHub App, then approve this plan again."
    );
  }

  const repositoryPath = encodedRepositoryPath(plan.repositoryFullName);
  const filePath = encodedFilePath(plan.filePath);
  const currentFile = await githubInstallationFetch<{ sha: string }>(
    access.token,
    `/repos/${repositoryPath}/contents/${filePath}?ref=${encodeURIComponent(plan.baseBranch)}`
  );
  if (currentFile.sha !== plan.baseFileBlobSha) {
    await prisma.sourceRepairPlan.update({ where: { id: plan.id }, data: { status: "stale" } });
    throw new Error(
      "The source file changed after the deployed revision. GroundControl will not overwrite newer work; investigate and validate a new repair plan."
    );
  }

  const ref = await githubInstallationFetch<{ object: { sha: string } }>(
    access.token,
    `/repos/${repositoryPath}/git/ref/heads/${encodeURIComponent(plan.baseBranch)}`
  );
  const suffix = plan.id.slice(-8);
  const fileSlug = plan.filePath.split("/").pop()?.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "").toLowerCase() || "source";
  const branchName = `groundcontrol/fix-${fileSlug.slice(0, 36)}-${suffix}`;
  const title = clipped(input.title, 120) || `Fix ${plan.filePath}`;

  await prisma.sourceRepairPlan.update({
    where: { id: plan.id },
    data: { status: "opening_pr", branchName },
  });

  try {
    await githubInstallationFetch(
      access.token,
      `/repos/${repositoryPath}/git/refs`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ref: `refs/heads/${branchName}`, sha: ref.object.sha }),
      }
    );
    await githubInstallationFetch(
      access.token,
      `/repos/${repositoryPath}/contents/${filePath}`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: title,
          content: Buffer.from(plan.replacementContent, "utf8").toString("base64"),
          branch: branchName,
          sha: currentFile.sha,
        }),
      }
    );
    const body = [
      "## Incident",
      plan.incidentSummary || "GroundControl isolated a source-backed production defect.",
      "",
      "## Validated repair",
      `- File: \`${plan.filePath}\``,
      `- Deployed revision: \`${plan.baseSha}\``,
      `- Daytona validation: \`${plan.validationCommand}\``,
      `- Evidence: ${plan.validationSummary}`,
      "",
      "## Delivery",
      "This changes the source of truth only. Production was not edited directly.",
      plan.verificationUrl
        ? `After the normal deployment pipeline completes, GroundControl should verify ${plan.verificationUrl}.`
        : "After the normal deployment pipeline completes, GroundControl should re-run the affected customer check.",
    ].join("\n");
    const pullRequest = await githubInstallationFetch<{
      number: number;
      html_url: string;
    }>(
      access.token,
      `/repos/${repositoryPath}/pulls`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title,
          head: branchName,
          base: plan.baseBranch,
          body,
          draft: false,
        }),
      }
    );
    await prisma.sourceRepairPlan.update({
      where: { id: plan.id },
      data: {
        status: "pr_opened",
        pullRequestNumber: pullRequest.number,
        pullRequestUrl: pullRequest.html_url,
        replacementContent: "",
      },
    });
    return {
      status: "pr_opened",
      pullRequestUrl: pullRequest.html_url,
      pullRequestNumber: pullRequest.number,
      branchName,
      productionMutated: false,
      nextAction: "Review and merge the pull request. Let the existing delivery pipeline deploy it, then verify the public outcome.",
    };
  } catch (error) {
    await prisma.sourceRepairPlan.update({
      where: { id: plan.id },
      data: { status: "failed", branchName },
    });
    throw error;
  }
}
