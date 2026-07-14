ALTER TABLE "DeploymentEnvValue" ADD COLUMN "component" TEXT NOT NULL DEFAULT '';

DROP INDEX "DeploymentEnvValue_profileId_key_key";
DROP INDEX "DeploymentEnvValue_profileId_idx";

CREATE UNIQUE INDEX "DeploymentEnvValue_profileId_component_key_key"
ON "DeploymentEnvValue"("profileId", "component", "key");

CREATE INDEX "DeploymentEnvValue_profileId_component_idx"
ON "DeploymentEnvValue"("profileId", "component");
