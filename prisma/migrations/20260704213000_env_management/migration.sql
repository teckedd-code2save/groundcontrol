ALTER TABLE "Deployment" ADD COLUMN "envProfileId" INTEGER;
ALTER TABLE "Deployment" ADD COLUMN "envProviderType" TEXT;
ALTER TABLE "Deployment" ADD COLUMN "envHash" TEXT;
ALTER TABLE "Deployment" ADD COLUMN "envStatus" TEXT;

CREATE TABLE "EnvProviderAccount" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'local',
    "configJson" TEXT NOT NULL DEFAULT '',
    "credentials" TEXT NOT NULL DEFAULT '',
    "isActive" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

CREATE TABLE "DeploymentEnvProfile" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "projectId" INTEGER NOT NULL,
    "deploymentId" INTEGER,
    "providerType" TEXT NOT NULL DEFAULT 'local',
    "providerAccountId" INTEGER,
    "environment" TEXT NOT NULL DEFAULT 'prod',
    "secretPath" TEXT NOT NULL DEFAULT '/',
    "projectRef" TEXT NOT NULL DEFAULT '',
    "schemaJson" TEXT NOT NULL DEFAULT '[]',
    "status" TEXT NOT NULL DEFAULT 'unknown',
    "lastHash" TEXT,
    "lastSyncedAt" DATETIME,
    "lastError" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "DeploymentEnvProfile_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "DeploymentEnvProfile_deploymentId_fkey" FOREIGN KEY ("deploymentId") REFERENCES "Deployment" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "DeploymentEnvProfile_providerAccountId_fkey" FOREIGN KEY ("providerAccountId") REFERENCES "EnvProviderAccount" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE TABLE "DeploymentEnvValue" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "profileId" INTEGER NOT NULL,
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL DEFAULT '',
    "required" BOOLEAN NOT NULL DEFAULT false,
    "source" TEXT NOT NULL DEFAULT 'local',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "DeploymentEnvValue_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "DeploymentEnvProfile" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "EnvProviderAccount_provider_isActive_idx" ON "EnvProviderAccount"("provider", "isActive");
CREATE INDEX "DeploymentEnvProfile_projectId_providerType_idx" ON "DeploymentEnvProfile"("projectId", "providerType");
CREATE INDEX "DeploymentEnvProfile_deploymentId_idx" ON "DeploymentEnvProfile"("deploymentId");
CREATE INDEX "DeploymentEnvProfile_providerAccountId_idx" ON "DeploymentEnvProfile"("providerAccountId");
CREATE UNIQUE INDEX "DeploymentEnvValue_profileId_key_key" ON "DeploymentEnvValue"("profileId", "key");
CREATE INDEX "DeploymentEnvValue_profileId_idx" ON "DeploymentEnvValue"("profileId");
