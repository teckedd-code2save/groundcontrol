-- CreateTable
CREATE TABLE "HealthCheckConfig" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "intervalSec" INTEGER NOT NULL DEFAULT 60,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "severity" TEXT NOT NULL DEFAULT 'error',
    "lastRunAt" DATETIME,
    "lastStatus" TEXT,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "HealthCheckResult" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "containerName" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "detail" TEXT NOT NULL DEFAULT '',
    "checkedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE INDEX "HealthCheckResult_containerName_checkedAt_idx" ON "HealthCheckResult"("containerName", "checkedAt");

-- CreateIndex
CREATE INDEX "HealthCheckResult_checkedAt_idx" ON "HealthCheckResult"("checkedAt");
