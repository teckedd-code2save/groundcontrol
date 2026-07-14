CREATE TABLE "EnrolledDeployment" (
  "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  "name" TEXT NOT NULL,
  "slug" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "managementMode" TEXT NOT NULL DEFAULT 'track',
  "sourcePath" TEXT,
  "composePath" TEXT,
  "containerName" TEXT,
  "systemdUnit" TEXT,
  "status" TEXT NOT NULL DEFAULT 'unknown',
  "metadataJson" TEXT NOT NULL DEFAULT '{}',
  "lastSeenAt" DATETIME,
  "projectGroupId" INTEGER,
  "vpsConfigId" INTEGER,
  "legacyProjectId" INTEGER,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "EnrolledDeployment_projectGroupId_fkey" FOREIGN KEY ("projectGroupId") REFERENCES "ProjectGroup" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "EnrolledDeployment_vpsConfigId_fkey" FOREIGN KEY ("vpsConfigId") REFERENCES "VpsConfig" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "EnrolledDeployment_legacyProjectId_fkey" FOREIGN KEY ("legacyProjectId") REFERENCES "Project" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "EnrolledDeployment_slug_key" ON "EnrolledDeployment"("slug");
CREATE UNIQUE INDEX "EnrolledDeployment_legacyProjectId_key" ON "EnrolledDeployment"("legacyProjectId");
CREATE UNIQUE INDEX "EnrolledDeployment_vpsConfigId_sourcePath_key" ON "EnrolledDeployment"("vpsConfigId", "sourcePath");
CREATE UNIQUE INDEX "EnrolledDeployment_vpsConfigId_containerName_key" ON "EnrolledDeployment"("vpsConfigId", "containerName");
CREATE INDEX "EnrolledDeployment_projectGroupId_updatedAt_idx" ON "EnrolledDeployment"("projectGroupId", "updatedAt");
CREATE INDEX "EnrolledDeployment_vpsConfigId_status_idx" ON "EnrolledDeployment"("vpsConfigId", "status");
