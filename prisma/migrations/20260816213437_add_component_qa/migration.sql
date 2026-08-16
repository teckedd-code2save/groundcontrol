-- CreateTable
CREATE TABLE "ComponentQACheck" (
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
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ComponentQACheck_deploymentId_fkey" FOREIGN KEY ("deploymentId") REFERENCES "EnrolledDeployment" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ComponentQARun" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "deploymentId" INTEGER NOT NULL,
    "component" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'running',
    "output" TEXT,
    "error" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ComponentQARun_deploymentId_fkey" FOREIGN KEY ("deploymentId") REFERENCES "EnrolledDeployment" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "ComponentQACheck_deploymentId_component_idx" ON "ComponentQACheck"("deploymentId", "component");

-- CreateIndex
CREATE INDEX "ComponentQARun_deploymentId_createdAt_idx" ON "ComponentQARun"("deploymentId", "createdAt");
