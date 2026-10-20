ALTER TABLE "ProjectGroup" ADD COLUMN "repositoryUrl" TEXT;
ALTER TABLE "EnrolledDeployment" ADD COLUMN "environmentName" TEXT NOT NULL DEFAULT 'Unspecified';
DROP INDEX "EnrolledDeployment_vpsConfigId_sourcePath_key";
CREATE INDEX "EnrolledDeployment_vpsConfigId_sourcePath_idx" ON "EnrolledDeployment"("vpsConfigId", "sourcePath");
CREATE TABLE "ProjectSource" (
  "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  "projectGroupId" INTEGER NOT NULL,
  "vpsConfigId" INTEGER NOT NULL,
  "path" TEXT NOT NULL,
  "metadataJson" TEXT NOT NULL DEFAULT '{}',
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "ProjectSource_projectGroupId_fkey" FOREIGN KEY ("projectGroupId") REFERENCES "ProjectGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ProjectSource_vpsConfigId_fkey" FOREIGN KEY ("vpsConfigId") REFERENCES "VpsConfig"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "ProjectSource_vpsConfigId_path_key" ON "ProjectSource"("vpsConfigId", "path");
CREATE INDEX "ProjectSource_projectGroupId_idx" ON "ProjectSource"("projectGroupId");
-- Preserve earlier folder registrations and their IDs/history, but present their
-- sources in Projects rather than count them as running instances.
INSERT OR IGNORE INTO "ProjectSource" ("projectGroupId", "vpsConfigId", "path", "metadataJson", "createdAt", "updatedAt")
SELECT "projectGroupId", "vpsConfigId", "sourcePath", "metadataJson", "createdAt", "updatedAt"
FROM "EnrolledDeployment" WHERE "kind" = 'source' AND "projectGroupId" IS NOT NULL AND "vpsConfigId" IS NOT NULL AND "sourcePath" IS NOT NULL;
