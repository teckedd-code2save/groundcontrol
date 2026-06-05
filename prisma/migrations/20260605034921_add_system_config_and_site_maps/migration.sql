-- CreateTable
CREATE TABLE "SiteContainerMap" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "siteDomain" TEXT NOT NULL,
    "containerName" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "SystemConfig" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "projectRoot" TEXT NOT NULL DEFAULT '/opt',
    "caddySitesDir" TEXT NOT NULL DEFAULT '/etc/caddy/sites',
    "caddyFile" TEXT NOT NULL DEFAULT '/etc/caddy/Caddyfile',
    "nginxSitesDir" TEXT NOT NULL DEFAULT '/etc/nginx/sites-available',
    "nginxLogPath" TEXT NOT NULL DEFAULT '/var/log/nginx/error.log',
    "staticRoot" TEXT NOT NULL DEFAULT '/var/www',
    "sshDefaultCwd" TEXT NOT NULL DEFAULT '/root',
    "certDomain" TEXT NOT NULL DEFAULT '',
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "SiteContainerMap_siteDomain_containerName_key" ON "SiteContainerMap"("siteDomain", "containerName");
