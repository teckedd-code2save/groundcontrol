-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_ComponentQACheck" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "deploymentId" INTEGER NOT NULL,
    "component" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "method" TEXT NOT NULL DEFAULT 'GET',
    "path" TEXT NOT NULL,
    "headers" TEXT NOT NULL DEFAULT '{}',
    "body" TEXT,
    "expectedStatus" INTEGER,
    "expectedBodyContains" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "source" TEXT NOT NULL DEFAULT 'manual',
    "status" TEXT NOT NULL DEFAULT 'active',
    "evidenceRef" TEXT,
    "revisionSha" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ComponentQACheck_deploymentId_fkey" FOREIGN KEY ("deploymentId") REFERENCES "EnrolledDeployment" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_ComponentQACheck" ("body", "component", "createdAt", "deploymentId", "enabled", "expectedBodyContains", "expectedStatus", "headers", "id", "method", "name", "path", "updatedAt") SELECT "body", "component", "createdAt", "deploymentId", "enabled", "expectedBodyContains", "expectedStatus", "headers", "id", "method", "name", "path", "updatedAt" FROM "ComponentQACheck";
DROP TABLE "ComponentQACheck";
ALTER TABLE "new_ComponentQACheck" RENAME TO "ComponentQACheck";
CREATE INDEX "ComponentQACheck_deploymentId_component_status_idx" ON "ComponentQACheck"("deploymentId", "component", "status");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
