-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_SystemConfig" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "vpsConfigId" INTEGER,
    "projectRoot" TEXT NOT NULL DEFAULT '/opt',
    "caddySitesDir" TEXT NOT NULL DEFAULT '/etc/caddy/sites',
    "caddyFile" TEXT NOT NULL DEFAULT '/etc/caddy/Caddyfile',
    "nginxSitesDir" TEXT NOT NULL DEFAULT '/etc/nginx/sites-available',
    "nginxLogPath" TEXT NOT NULL DEFAULT '/var/log/nginx/error.log',
    "staticRoot" TEXT NOT NULL DEFAULT '/var/www',
    "sshDefaultCwd" TEXT NOT NULL DEFAULT '/root',
    "certDomain" TEXT NOT NULL DEFAULT '',
    "composeCommand" TEXT,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "SystemConfig_vpsConfigId_fkey" FOREIGN KEY ("vpsConfigId") REFERENCES "VpsConfig" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_SystemConfig" ("caddyFile", "caddySitesDir", "certDomain", "composeCommand", "id", "nginxLogPath", "nginxSitesDir", "projectRoot", "sshDefaultCwd", "staticRoot", "updatedAt") SELECT "caddyFile", "caddySitesDir", "certDomain", "composeCommand", "id", "nginxLogPath", "nginxSitesDir", "projectRoot", "sshDefaultCwd", "staticRoot", "updatedAt" FROM "SystemConfig";
DROP TABLE "SystemConfig";
ALTER TABLE "new_SystemConfig" RENAME TO "SystemConfig";
CREATE UNIQUE INDEX "SystemConfig_vpsConfigId_key" ON "SystemConfig"("vpsConfigId");
CREATE TABLE "new_VpsConfig" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL DEFAULT 'primary',
    "host" TEXT NOT NULL,
    "port" INTEGER NOT NULL DEFAULT 22,
    "username" TEXT NOT NULL DEFAULT 'root',
    "privateKey" TEXT,
    "authType" TEXT NOT NULL DEFAULT 'key',
    "password" TEXT,
    "isLocal" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_VpsConfig" ("authType", "createdAt", "host", "id", "isLocal", "name", "password", "port", "privateKey", "updatedAt", "username") SELECT "authType", "createdAt", "host", "id", "isLocal", "name", "password", "port", "privateKey", "updatedAt", "username" FROM "VpsConfig";
DROP TABLE "VpsConfig";
ALTER TABLE "new_VpsConfig" RENAME TO "VpsConfig";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
