-- AlterTable
ALTER TABLE "Deployment" ADD COLUMN "changedFields" TEXT;
ALTER TABLE "Deployment" ADD COLUMN "imageDigest" TEXT;
ALTER TABLE "Deployment" ADD COLUMN "previousImageDigest" TEXT;
