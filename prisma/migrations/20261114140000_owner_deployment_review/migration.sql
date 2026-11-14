CREATE TABLE "AgentDeploymentReview" (
"id" TEXT NOT NULL PRIMARY KEY, "proposalId" TEXT NOT NULL, "userId" INTEGER NOT NULL, "reviewJson" TEXT NOT NULL, "reviewHash" TEXT NOT NULL, "expiresAt" DATETIME NOT NULL, "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "AgentDeploymentReview_proposalId_userId_idx" ON "AgentDeploymentReview"("proposalId", "userId");
CREATE TABLE "AgentDeploymentRecipe" (
"id" TEXT NOT NULL PRIMARY KEY, "proposalId" TEXT NOT NULL, "reviewId" TEXT NOT NULL, "deploymentId" INTEGER NOT NULL, "vpsConfigId" INTEGER NOT NULL, "deploymentPath" TEXT NOT NULL, "userId" INTEGER NOT NULL, "recipeJson" TEXT NOT NULL, "recipeHash" TEXT NOT NULL, "status" TEXT NOT NULL DEFAULT 'pending', "launchOperationId" TEXT, "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" DATETIME NOT NULL
);
CREATE UNIQUE INDEX "AgentDeploymentRecipe_proposalId_key" ON "AgentDeploymentRecipe"("proposalId");
CREATE UNIQUE INDEX "AgentDeploymentRecipe_reviewId_key" ON "AgentDeploymentRecipe"("reviewId");
CREATE UNIQUE INDEX "AgentDeploymentRecipe_deploymentId_key" ON "AgentDeploymentRecipe"("deploymentId");
CREATE UNIQUE INDEX "AgentDeploymentRecipe_launchOperationId_key" ON "AgentDeploymentRecipe"("launchOperationId");
CREATE UNIQUE INDEX "AgentDeploymentRecipe_vpsConfigId_deploymentPath_key" ON "AgentDeploymentRecipe"("vpsConfigId", "deploymentPath");
