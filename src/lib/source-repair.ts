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
  edits: Array<{ find: string; replace: string }>;
  /** Focused command that must fail at the deployed revision and pass with the candidate. */
  validationCommand: string;
  /** Independent checks that protect unaffected behaviour after the candidate is applied. */
  regressionCommands: string[];
  incidentSummary?: string;
  verificationUrl?: string;
}

export interface OpenSourceRepairInput {
  repairPlanId: string;
  title: string;
}

export interface ReadSourceAtRevisionInput {
  repositoryUrl: string;
  commitSha: string;
  filePath: string;
}

function clipped(value: string | undefined, max: number) {
  return String(value || "").trim().slice(0, max);
}

function validationMatrixLines(serialized: string) {
  try {
    const parsed = JSON.parse(serialized) as { reproduction?: unknown; regression?: unknown };
    const regression = Array.isArray(parsed.regression) ? parsed.regression.map(String) : [];
    return [
      `- Focused reproduction: \`${String(parsed.reproduction || "unknown")}\``,
      ...regression.map((command) => `- Regression check: \`${command}\``),
    ];
  } catch {
    return [`- Daytona validation: \`${serialized}\``];
  }
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

function redactRepositorySource(source: string): string {
  return source
    .replace(/https:\/\/[^@\s/]+@/gi, "https://[redacted]@")
    .replace(
      /^(\s*(?:[A-Za-z0-9_]*(?:PASSWORD|SECRET|TOKEN|PRIVATE_KEY|ACCESS_KEY|API_KEY)[A-Za-z0-9_]*)(?:\s*[:=]\s*))(.+)$/gim,
      (_line, prefix: string, value: string) => (
        /\$\{|\[REDACTED\]|<SET_ME>/i.test(value)
          ? `${prefix}${value}`
          : `${prefix}[REDACTED]`
      )
    )
    .replace(/\b(?:gh[opsu]_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/g, "[REDACTED]");
}

async function repositoryFileAtRevision(input: ReadSourceAtRevisionInput) {
  const repository = await linkedRepository(input.repositoryUrl);
  const filePath = input.filePath.trim();
  const pathError = validateRepairFilePath(filePath);
  if (pathError) throw new Error(pathError);
  const commitSha = input.commitSha.trim();
  if (!/^[a-f0-9]{40,64}$/i.test(commitSha)) {
    throw new Error("An exact deployed commit SHA is required before reading repository source.");
  }
  const access = await installationAccess(repository);
  const sourceFile = await githubInstallationFetch<{
    sha: string;
    content: string;
    encoding: string;
    type: string;
  }>(
    access.token,
    `/repos/${encodedRepositoryPath(repository.fullName)}/contents/${encodedFilePath(filePath)}?ref=${encodeURIComponent(commitSha)}`
  );
  if (sourceFile.type !== "file" || sourceFile.encoding !== "base64") {
    throw new Error("The source target must be a regular repository file.");
  }
  return {
    repository,
    filePath,
    commitSha,
    blobSha: sourceFile.sha,
    source: Buffer.from(sourceFile.content.replace(/\s/g, ""), "base64").toString("utf8"),
  };
}

export async function readSourceAtDeployedRevision(input: ReadSourceAtRevisionInput) {
  const file = await repositoryFileAtRevision(input);
  const content = redactRepositorySource(file.source);
  return {
    repository: file.repository.fullName,
    deployedRevision: file.commitSha,
    filePath: file.filePath,
    blobSha: file.blobSha,
    content: content.length <= 80_000 ? content : `${content.slice(0, 80_000)}\n… source clipped`,
    instruction:
      "Use an exact unique non-redacted excerpt from this revision as the find text. Never edit a [REDACTED] value.",
  };
}

export function applyExactSourceEdits(
  source: string,
  edits: Array<{ find: string; replace: string }>
): string {
  if (!edits.length || edits.length > 8) {
    throw new Error("Provide between one and eight exact source edits.");
  }
  let candidate = source;
  for (const [index, edit] of edits.entries()) {
    if (!edit.find) throw new Error(`Edit ${index + 1} needs non-empty source text.`);
    const first = candidate.indexOf(edit.find);
    const second = first < 0 ? -1 : candidate.indexOf(edit.find, first + edit.find.length);
    if (first < 0) {
      if (edit.replace && candidate.includes(edit.replace)) {
        throw new Error(
          `Edit ${index + 1} is already present at the deployed commit. No source repair is needed for this change; continue the live runtime investigation.`
        );
      }
      throw new Error(`Edit ${index + 1} does not match the file at the deployed commit.`);
    }
    if (second >= 0) {
      throw new Error(`Edit ${index + 1} is ambiguous; include more surrounding source text.`);
    }
    candidate = candidate.slice(0, first) + edit.replace + candidate.slice(first + edit.find.length);
  }
  return candidate;
}

export async function prepareSourceRepairPlan(input: PrepareSourceRepairInput) {
  const file = await repositoryFileAtRevision(input);
  const repository = file.repository;
  const filePath = file.filePath;
  const commitSha = file.commitSha;
  const baseBranch = clipped(input.baseBranch || repository.defaultBranch, 120);
  const replacementContent = applyExactSourceEdits(file.source, input.edits);
  if (Buffer.byteLength(replacementContent, "utf8") > MAX_REPLACEMENT_BYTES) {
    throw new Error("The repaired file must be smaller than 300 KB.");
  }
  const regressionCommands = [...new Set(input.regressionCommands.map((command) => command.trim()))]
    .filter((command) => command && command !== input.validationCommand.trim())
    .slice(0, 2);
  if (regressionCommands.length === 0) {
    throw new Error("Daytona source repair requires at least one independent regression command in addition to the focused reproduction.");
  }

  const result = await reproduceInDaytona({
    repositoryUrl: repository.htmlUrl,
    branch: baseBranch,
    commitSha,
    testCommand: input.validationCommand,
    regressionCommands,
    requireReproduction: true,
    journeyUrl: clipped(input.verificationUrl, 500),
    candidate: {
      filePath,
      replacementContent,
    },
    budgetSeconds: 300,
  });

  if (
    result.provider !== "daytona" ||
    result.status !== "completed" ||
    result.candidateValidated !== true ||
    result.reproductionValidated !== true ||
    result.regressionValidated !== true ||
    result.cleanedUp !== true ||
    !result.proposedPatch ||
    !result.baseFileBlobSha
  ) {
    throw new Error(result.detail || "Daytona did not validate this source candidate.");
  }

  const id = `repair_${randomUUID().replace(/-/g, "")}`;
  const expiresAt = new Date(Date.now() + PLAN_TTL_MS);
  const baseline = result.logs.find((line) => line.startsWith("baseline_exit=")) || "baseline_exit=unknown";
  const candidate = result.logs.find((line) => line.startsWith("candidate_exit=")) || "candidate_exit=unknown";
  const regression = result.validations
    ?.filter((validation) => validation.kind === "regression")
    .map((validation) => `${validation.command}=exit ${validation.candidateExitCode}`)
    .join("; ") || "regression=unknown";
  const validationSummary = `${baseline}; ${candidate}; ${regression}; ${result.detail}`;
  const validationMatrix = JSON.stringify({
    reproduction: input.validationCommand,
    regression: regressionCommands,
  });

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
      replacementContent,
      patch: result.proposedPatch,
      validationCommand: validationMatrix,
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
    validations: result.validations,
    daytona: {
      checkedOutRevision: commitSha,
      reproducedFailure: result.reproducedFailure,
      candidateValidated: result.candidateValidated,
      regressionValidated: result.regressionValidated,
      cleanupComplete: result.cleanedUp,
    },
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
      ...validationMatrixLines(plan.validationCommand),
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
