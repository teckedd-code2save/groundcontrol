ALTER TABLE "DeploymentEnvProfile" ADD COLUMN "name" TEXT NOT NULL DEFAULT 'Production';
ALTER TABLE "DeploymentEnvProfile" ADD COLUMN "slug" TEXT NOT NULL DEFAULT 'production';
ALTER TABLE "DeploymentEnvProfile" ADD COLUMN "isDefault" BOOLEAN NOT NULL DEFAULT false;

-- Preserve the provider environment slug while giving every existing profile a
-- stable GroundControl environment identity. Older installations normally have
-- one profile per workload; duplicate legacy rows remain addressable instead of
-- causing a destructive migration.
UPDATE "DeploymentEnvProfile"
SET "slug" = CASE
  WHEN "id" = (
    SELECT MIN("candidate"."id")
    FROM "DeploymentEnvProfile" AS "candidate"
    WHERE "candidate"."projectId" = "DeploymentEnvProfile"."projectId"
  ) THEN CASE
    WHEN lower(trim("environment")) IN ('prod', 'production') THEN 'production'
    WHEN lower(trim("environment")) IN ('stage', 'staging') THEN 'staging'
    WHEN lower(trim("environment")) IN ('dev', 'development') THEN 'development'
    ELSE lower(replace(trim("environment"), ' ', '-'))
  END
  ELSE 'legacy-' || "id"
END;

UPDATE "DeploymentEnvProfile"
SET "name" = CASE
  WHEN "slug" = 'production' THEN 'Production'
  WHEN "slug" = 'staging' THEN 'Staging'
  WHEN "slug" = 'development' THEN 'Development'
  ELSE "slug"
END;

UPDATE "DeploymentEnvProfile"
SET "isDefault" = CASE
  WHEN "id" = (
    SELECT MAX("candidate"."id")
    FROM "DeploymentEnvProfile" AS "candidate"
    WHERE "candidate"."projectId" = "DeploymentEnvProfile"."projectId"
  ) THEN true
  ELSE false
END;

CREATE UNIQUE INDEX "DeploymentEnvProfile_projectId_slug_key"
ON "DeploymentEnvProfile"("projectId", "slug");

CREATE INDEX "DeploymentEnvProfile_projectId_isDefault_idx"
ON "DeploymentEnvProfile"("projectId", "isDefault");

ALTER TABLE "DeploymentEnvValue" ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1;

CREATE TABLE "DeploymentEnvValueVersion" (
  "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  "profileId" INTEGER NOT NULL,
  "component" TEXT NOT NULL DEFAULT '',
  "key" TEXT NOT NULL,
  "value" TEXT NOT NULL DEFAULT '',
  "version" INTEGER NOT NULL,
  "state" TEXT NOT NULL DEFAULT 'active',
  "source" TEXT NOT NULL DEFAULT 'local',
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DeploymentEnvValueVersion_profileId_fkey"
    FOREIGN KEY ("profileId") REFERENCES "DeploymentEnvProfile"("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

INSERT INTO "DeploymentEnvValueVersion" ("profileId", "component", "key", "value", "version", "state", "source", "createdAt")
SELECT "profileId", "component", "key", "value", 1, 'active', "source", "createdAt"
FROM "DeploymentEnvValue";

CREATE UNIQUE INDEX "DeploymentEnvValueVersion_profileId_component_key_version_key"
ON "DeploymentEnvValueVersion"("profileId", "component", "key", "version");

CREATE INDEX "DeploymentEnvValueVersion_profileId_component_key_createdAt_idx"
ON "DeploymentEnvValueVersion"("profileId", "component", "key", "createdAt");
