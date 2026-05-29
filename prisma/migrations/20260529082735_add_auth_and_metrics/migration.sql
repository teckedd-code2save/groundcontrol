-- CreateTable
CREATE TABLE "User" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "username" TEXT NOT NULL,
    "password" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'admin',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "MetricSnapshot" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "cpuLoad1" REAL NOT NULL,
    "cpuLoad5" REAL NOT NULL,
    "cpuLoad15" REAL NOT NULL,
    "memUsed" REAL NOT NULL,
    "memTotal" REAL NOT NULL,
    "memPercent" REAL NOT NULL,
    "diskUsed" REAL NOT NULL,
    "diskTotal" REAL NOT NULL,
    "diskPercent" REAL NOT NULL,
    "containerCount" INTEGER NOT NULL,
    "runningContainers" INTEGER NOT NULL,
    "unhealthyContainers" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");
