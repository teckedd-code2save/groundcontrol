-- CreateTable
CREATE TABLE "GithubAppConnection" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "appId" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "ownerLogin" TEXT NOT NULL DEFAULT '',
    "clientId" TEXT NOT NULL,
    "clientSecretEncrypted" TEXT NOT NULL,
    "privateKeyEncrypted" TEXT NOT NULL,
    "webhookSecretEncrypted" TEXT NOT NULL,
    "publicUrl" TEXT NOT NULL,
    "permissionsJson" TEXT NOT NULL DEFAULT '{}',
    "eventsJson" TEXT NOT NULL DEFAULT '[]',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

CREATE UNIQUE INDEX "GithubAppConnection_appId_key" ON "GithubAppConnection"("appId");
CREATE UNIQUE INDEX "GithubAppConnection_slug_key" ON "GithubAppConnection"("slug");

-- CreateTable
CREATE TABLE "GithubInstallation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "connectionId" INTEGER NOT NULL,
    "accountLogin" TEXT NOT NULL,
    "accountType" TEXT NOT NULL DEFAULT 'User',
    "repositorySelection" TEXT NOT NULL DEFAULT 'selected',
    "suspendedAt" DATETIME,
    "lastSyncedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "GithubInstallation_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "GithubAppConnection" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "GithubInstallation_connectionId_accountLogin_idx" ON "GithubInstallation"("connectionId", "accountLogin");

-- CreateTable
CREATE TABLE "GithubRepository" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "installationId" TEXT NOT NULL,
    "owner" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "htmlUrl" TEXT NOT NULL,
    "defaultBranch" TEXT NOT NULL DEFAULT 'main',
    "isPrivate" BOOLEAN NOT NULL DEFAULT false,
    "isArchived" BOOLEAN NOT NULL DEFAULT false,
    "permissionsJson" TEXT NOT NULL DEFAULT '{}',
    "lastSyncedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "GithubRepository_installationId_fkey" FOREIGN KEY ("installationId") REFERENCES "GithubInstallation" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "GithubRepository_fullName_key" ON "GithubRepository"("fullName");
CREATE INDEX "GithubRepository_installationId_owner_idx" ON "GithubRepository"("installationId", "owner");

-- CreateTable
CREATE TABLE "GithubRepositoryDeployment" (
    "githubRepositoryId" TEXT NOT NULL,
    "enrolledDeploymentId" INTEGER NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'repository_url',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY ("githubRepositoryId", "enrolledDeploymentId"),
    CONSTRAINT "GithubRepositoryDeployment_githubRepositoryId_fkey" FOREIGN KEY ("githubRepositoryId") REFERENCES "GithubRepository" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "GithubRepositoryDeployment_enrolledDeploymentId_fkey" FOREIGN KEY ("enrolledDeploymentId") REFERENCES "EnrolledDeployment" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "GithubRepositoryDeployment_enrolledDeploymentId_idx" ON "GithubRepositoryDeployment"("enrolledDeploymentId");

-- CreateTable
CREATE TABLE "GithubWebhookDelivery" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "event" TEXT NOT NULL,
    "action" TEXT NOT NULL DEFAULT '',
    "repositoryFullName" TEXT NOT NULL DEFAULT '',
    "installationId" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'received',
    "summaryJson" TEXT NOT NULL DEFAULT '{}',
    "error" TEXT,
    "receivedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" DATETIME
);

CREATE INDEX "GithubWebhookDelivery_event_receivedAt_idx" ON "GithubWebhookDelivery"("event", "receivedAt");
CREATE INDEX "GithubWebhookDelivery_repositoryFullName_receivedAt_idx" ON "GithubWebhookDelivery"("repositoryFullName", "receivedAt");
