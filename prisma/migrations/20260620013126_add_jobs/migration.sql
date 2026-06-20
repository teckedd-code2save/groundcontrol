-- CreateTable
CREATE TABLE "Job" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "type" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "payload" TEXT NOT NULL,
    "output" TEXT NOT NULL DEFAULT '',
    "result" TEXT,
    "error" TEXT,
    "startedAt" DATETIME,
    "finishedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Deployment" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "projectId" INTEGER NOT NULL,
    "targetId" INTEGER NOT NULL,
    "jobId" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "branch" TEXT NOT NULL DEFAULT 'main',
    "commitSha" TEXT,
    "imageTag" TEXT,
    "publicUrl" TEXT,
    "previewUrl" TEXT,
    "previewProcessInfo" TEXT,
    "idempotencyKey" TEXT,
    "output" TEXT,
    "error" TEXT,
    "durationMs" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Deployment_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Deployment_targetId_fkey" FOREIGN KEY ("targetId") REFERENCES "DeploymentTarget" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Deployment_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Deployment" ("branch", "commitSha", "createdAt", "durationMs", "error", "id", "idempotencyKey", "imageTag", "output", "previewProcessInfo", "previewUrl", "projectId", "publicUrl", "status", "targetId", "updatedAt") SELECT "branch", "commitSha", "createdAt", "durationMs", "error", "id", "idempotencyKey", "imageTag", "output", "previewProcessInfo", "previewUrl", "projectId", "publicUrl", "status", "targetId", "updatedAt" FROM "Deployment";
DROP TABLE "Deployment";
ALTER TABLE "new_Deployment" RENAME TO "Deployment";
CREATE INDEX "Deployment_projectId_createdAt_idx" ON "Deployment"("projectId", "createdAt");
CREATE INDEX "Deployment_targetId_createdAt_idx" ON "Deployment"("targetId", "createdAt");
CREATE INDEX "Deployment_idempotencyKey_idx" ON "Deployment"("idempotencyKey");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "Job_status_createdAt_idx" ON "Job"("status", "createdAt");

-- CreateIndex
CREATE INDEX "Job_type_status_idx" ON "Job"("type", "status");
