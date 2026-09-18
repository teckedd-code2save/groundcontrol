-- CreateTable
CREATE TABLE "OAuthClient" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "clientId" TEXT NOT NULL,
    "clientName" TEXT NOT NULL,
    "redirectUris" TEXT NOT NULL DEFAULT '[]',
    "source" TEXT NOT NULL DEFAULT 'dynamic',
    "tokenEndpointAuthMethod" TEXT NOT NULL DEFAULT 'none',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

CREATE UNIQUE INDEX "OAuthClient_clientId_key" ON "OAuthClient"("clientId");
CREATE INDEX "OAuthClient_source_createdAt_idx" ON "OAuthClient"("source", "createdAt");

-- CreateTable
CREATE TABLE "OAuthGrant" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "userId" INTEGER NOT NULL,
    "clientDbId" INTEGER NOT NULL,
    "scope" TEXT NOT NULL,
    "resources" TEXT NOT NULL DEFAULT '[]',
    "revokedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "OAuthGrant_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "OAuthGrant_clientDbId_fkey" FOREIGN KEY ("clientDbId") REFERENCES "OAuthClient" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "OAuthGrant_userId_clientDbId_key" ON "OAuthGrant"("userId", "clientDbId");
CREATE INDEX "OAuthGrant_clientDbId_revokedAt_idx" ON "OAuthGrant"("clientDbId", "revokedAt");

-- CreateTable
CREATE TABLE "OAuthAuthorizationCode" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "grantId" INTEGER NOT NULL,
    "codeHash" TEXT NOT NULL,
    "redirectUri" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "codeChallenge" TEXT NOT NULL,
    "codeChallengeMethod" TEXT NOT NULL DEFAULT 'S256',
    "expiresAt" DATETIME NOT NULL,
    "usedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "OAuthAuthorizationCode_grantId_fkey" FOREIGN KEY ("grantId") REFERENCES "OAuthGrant" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "OAuthAuthorizationCode_codeHash_key" ON "OAuthAuthorizationCode"("codeHash");
CREATE INDEX "OAuthAuthorizationCode_grantId_expiresAt_idx" ON "OAuthAuthorizationCode"("grantId", "expiresAt");

-- CreateTable
CREATE TABLE "OAuthToken" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "grantId" INTEGER NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "familyId" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "expiresAt" DATETIME NOT NULL,
    "revokedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "OAuthToken_grantId_fkey" FOREIGN KEY ("grantId") REFERENCES "OAuthGrant" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "OAuthToken_tokenHash_key" ON "OAuthToken"("tokenHash");
CREATE INDEX "OAuthToken_grantId_kind_revokedAt_idx" ON "OAuthToken"("grantId", "kind", "revokedAt");
CREATE INDEX "OAuthToken_familyId_kind_idx" ON "OAuthToken"("familyId", "kind");

-- CreateTable
CREATE TABLE "AgentOperation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "grantId" INTEGER NOT NULL,
    "deploymentId" INTEGER NOT NULL,
    "type" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "idempotencyKey" TEXT NOT NULL,
    "inputJson" TEXT NOT NULL DEFAULT '{}',
    "resultJson" TEXT,
    "evidenceJson" TEXT,
    "error" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "leaseUntil" DATETIME,
    "startedAt" DATETIME,
    "finishedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "AgentOperation_grantId_fkey" FOREIGN KEY ("grantId") REFERENCES "OAuthGrant" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "AgentOperation_deploymentId_fkey" FOREIGN KEY ("deploymentId") REFERENCES "EnrolledDeployment" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "AgentOperation_grantId_idempotencyKey_key" ON "AgentOperation"("grantId", "idempotencyKey");
CREATE INDEX "AgentOperation_status_createdAt_idx" ON "AgentOperation"("status", "createdAt");
CREATE INDEX "AgentOperation_deploymentId_createdAt_idx" ON "AgentOperation"("deploymentId", "createdAt");
