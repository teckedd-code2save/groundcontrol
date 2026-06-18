-- AlterTable
ALTER TABLE "Project" ADD COLUMN "buildCommand" TEXT;
ALTER TABLE "Project" ADD COLUMN "dockerfile" TEXT;
ALTER TABLE "Project" ADD COLUMN "envVars" TEXT;
ALTER TABLE "Project" ADD COLUMN "outputDir" TEXT;

-- CreateTable
CREATE TABLE "DeploymentTarget" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "vpsConfigId" INTEGER,
    "configJson" TEXT NOT NULL DEFAULT '',
    "isActive" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "DeploymentTarget_vpsConfigId_fkey" FOREIGN KEY ("vpsConfigId") REFERENCES "VpsConfig" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Deployment" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "projectId" INTEGER NOT NULL,
    "targetId" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "branch" TEXT NOT NULL DEFAULT 'main',
    "commitSha" TEXT,
    "imageTag" TEXT,
    "publicUrl" TEXT,
    "previewUrl" TEXT,
    "output" TEXT,
    "error" TEXT,
    "durationMs" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Deployment_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Deployment_targetId_fkey" FOREIGN KEY ("targetId") REFERENCES "DeploymentTarget" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "DeploymentTarget_type_isActive_idx" ON "DeploymentTarget"("type", "isActive");

-- CreateIndex
CREATE INDEX "Deployment_projectId_createdAt_idx" ON "Deployment"("projectId", "createdAt");

-- CreateIndex
CREATE INDEX "Deployment_targetId_createdAt_idx" ON "Deployment"("targetId", "createdAt");
