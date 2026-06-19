-- AlterTable
ALTER TABLE "Deployment" ADD COLUMN "previewProcessInfo" TEXT;
ALTER TABLE "Deployment" ADD COLUMN "idempotencyKey" TEXT;

-- AlterTable
ALTER TABLE "DeploymentTarget" ADD COLUMN "dnsRecordId" TEXT;
ALTER TABLE "DeploymentTarget" ADD COLUMN "dnsRecordName" TEXT;

-- CreateIndex
CREATE INDEX "Deployment_idempotencyKey_idx" ON "Deployment"("idempotencyKey");
