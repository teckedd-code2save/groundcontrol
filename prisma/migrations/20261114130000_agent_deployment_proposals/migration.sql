ALTER TABLE "OAuthGrant" ADD COLUMN "consentRevision" INTEGER NOT NULL DEFAULT 0;
CREATE TABLE "AgentDeploymentProposal" (
 "id" TEXT NOT NULL PRIMARY KEY,
 "grantId" INTEGER NOT NULL,
 "userId" INTEGER NOT NULL,
 "idempotencyKey" TEXT NOT NULL,
 "inputJson" TEXT NOT NULL,
 "contentHash" TEXT NOT NULL,
 "grantHash" TEXT NOT NULL,
 "status" TEXT NOT NULL DEFAULT 'pending',
 "expiresAt" DATETIME NOT NULL,
 "reviewedAt" DATETIME,
 "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "updatedAt" DATETIME NOT NULL,
 CONSTRAINT "AgentDeploymentProposal_grantId_fkey" FOREIGN KEY ("grantId") REFERENCES "OAuthGrant" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "AgentDeploymentProposal_grantId_idempotencyKey_key" ON "AgentDeploymentProposal"("grantId", "idempotencyKey");
CREATE INDEX "AgentDeploymentProposal_userId_status_createdAt_idx" ON "AgentDeploymentProposal"("userId", "status", "createdAt");
