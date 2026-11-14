CREATE TABLE "AgentProposalConfiguration" (
  "proposalId" TEXT NOT NULL PRIMARY KEY,
  "projectId" INTEGER NOT NULL,
  "profileId" INTEGER NOT NULL,
  "userId" INTEGER NOT NULL,
  "revision" INTEGER NOT NULL DEFAULT 0,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL
);
CREATE UNIQUE INDEX "AgentProposalConfiguration_projectId_key" ON "AgentProposalConfiguration"("projectId");
CREATE UNIQUE INDEX "AgentProposalConfiguration_profileId_key" ON "AgentProposalConfiguration"("profileId");
