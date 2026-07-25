-- CreateTable
CREATE TABLE "SourceRepairPlan" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "repositoryFullName" TEXT NOT NULL,
    "repositoryUrl" TEXT NOT NULL,
    "baseBranch" TEXT NOT NULL,
    "baseSha" TEXT NOT NULL,
    "baseFileBlobSha" TEXT NOT NULL,
    "filePath" TEXT NOT NULL,
    "replacementContent" TEXT NOT NULL,
    "patch" TEXT NOT NULL,
    "validationCommand" TEXT NOT NULL,
    "validationSummary" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "incidentSummary" TEXT NOT NULL DEFAULT '',
    "verificationUrl" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'prepared',
    "branchName" TEXT,
    "pullRequestNumber" INTEGER,
    "pullRequestUrl" TEXT,
    "expiresAt" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

CREATE INDEX "SourceRepairPlan_status_expiresAt_idx" ON "SourceRepairPlan"("status", "expiresAt");
CREATE INDEX "SourceRepairPlan_repositoryFullName_createdAt_idx" ON "SourceRepairPlan"("repositoryFullName", "createdAt");
