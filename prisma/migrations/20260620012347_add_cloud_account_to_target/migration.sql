-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_DeploymentTarget" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "vpsConfigId" INTEGER,
    "cloudProviderAccountId" INTEGER,
    "configJson" TEXT NOT NULL DEFAULT '',
    "isActive" BOOLEAN NOT NULL DEFAULT false,
    "dnsRecordId" TEXT,
    "dnsRecordName" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "DeploymentTarget_vpsConfigId_fkey" FOREIGN KEY ("vpsConfigId") REFERENCES "VpsConfig" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "DeploymentTarget_cloudProviderAccountId_fkey" FOREIGN KEY ("cloudProviderAccountId") REFERENCES "CloudProviderAccount" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_DeploymentTarget" ("configJson", "createdAt", "dnsRecordId", "dnsRecordName", "id", "isActive", "name", "type", "updatedAt", "vpsConfigId") SELECT "configJson", "createdAt", "dnsRecordId", "dnsRecordName", "id", "isActive", "name", "type", "updatedAt", "vpsConfigId" FROM "DeploymentTarget";
DROP TABLE "DeploymentTarget";
ALTER TABLE "new_DeploymentTarget" RENAME TO "DeploymentTarget";
CREATE INDEX "DeploymentTarget_type_isActive_idx" ON "DeploymentTarget"("type", "isActive");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
