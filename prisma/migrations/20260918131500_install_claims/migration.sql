-- CreateTable
CREATE TABLE "InstallClaim" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "instanceId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "expiresAt" DATETIME NOT NULL,
    "claimedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX "InstallClaim_tokenHash_key" ON "InstallClaim"("tokenHash");
CREATE INDEX "InstallClaim_status_expiresAt_idx" ON "InstallClaim"("status", "expiresAt");
CREATE INDEX "InstallClaim_instanceId_createdAt_idx" ON "InstallClaim"("instanceId", "createdAt");
