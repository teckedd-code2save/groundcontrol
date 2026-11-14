CREATE TABLE "AgentAppDomainPublication" (
 "id" TEXT NOT NULL PRIMARY KEY,
 "deploymentId" INTEGER NOT NULL,
 "vpsConfigId" INTEGER NOT NULL,
 "userId" INTEGER NOT NULL,
 "hostname" TEXT NOT NULL,
 "idempotencyKey" TEXT NOT NULL,
 "challenge" TEXT NOT NULL,
 "status" TEXT NOT NULL DEFAULT 'reviewed',
 "planJson" TEXT NOT NULL DEFAULT '{}',
 "planHash" TEXT NOT NULL DEFAULT '',
 "resultJson" TEXT,
 "error" TEXT,
 "expiresAt" DATETIME NOT NULL,
 "startedAt" DATETIME,
 "finishedAt" DATETIME,
 "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "updatedAt" DATETIME NOT NULL
);
CREATE UNIQUE INDEX "AgentAppDomainPublication_userId_idempotencyKey_key" ON "AgentAppDomainPublication"("userId", "idempotencyKey");
CREATE UNIQUE INDEX "AgentAppDomainPublication_vpsConfigId_hostname_key" ON "AgentAppDomainPublication"("vpsConfigId", "hostname");
CREATE INDEX "AgentAppDomainPublication_deploymentId_status_idx" ON "AgentAppDomainPublication"("deploymentId", "status");
