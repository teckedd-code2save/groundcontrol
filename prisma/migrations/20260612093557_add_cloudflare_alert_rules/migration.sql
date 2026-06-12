-- CreateTable
CREATE TABLE "CloudflareAccount" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL DEFAULT 'Cloudflare',
    "apiToken" TEXT NOT NULL,
    "accountId" TEXT,
    "email" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "CloudflareTunnel" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "tunnelId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "tunnelSecret" TEXT,
    "connectorId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'inactive',
    "domains" TEXT NOT NULL DEFAULT '',
    "configJson" TEXT NOT NULL DEFAULT '',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "cloudflareAccountId" INTEGER NOT NULL,
    CONSTRAINT "CloudflareTunnel_cloudflareAccountId_fkey" FOREIGN KEY ("cloudflareAccountId") REFERENCES "CloudflareAccount" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AlertRule" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "metric" TEXT NOT NULL,
    "operator" TEXT NOT NULL,
    "threshold" REAL NOT NULL,
    "durationSec" INTEGER NOT NULL DEFAULT 60,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "severity" TEXT NOT NULL DEFAULT 'warning',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "AlertSetting" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "retentionDays" INTEGER NOT NULL DEFAULT 30,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "CloudflareTunnel_tunnelId_key" ON "CloudflareTunnel"("tunnelId");
