-- CreateTable
CREATE TABLE "TerraformStack" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "workspace" TEXT NOT NULL DEFAULT 'default',
    "hcl" TEXT NOT NULL,
    "varsJson" TEXT NOT NULL DEFAULT '',
    "stateBackend" TEXT NOT NULL DEFAULT 'local',
    "statePath" TEXT,
    "lastPlan" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE INDEX "TerraformStack_provider_workspace_idx" ON "TerraformStack"("provider", "workspace");
