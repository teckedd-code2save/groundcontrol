-- CreateTable
CREATE TABLE "AiThreadShare" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "threadId" INTEGER NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "snapshotJson" TEXT NOT NULL,
    "expiresAt" DATETIME NOT NULL,
    "revokedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AiThreadShare_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "AiThread" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "AiThreadShare_tokenHash_key" ON "AiThreadShare"("tokenHash");

-- CreateIndex
CREATE INDEX "AiThreadShare_threadId_createdAt_idx" ON "AiThreadShare"("threadId", "createdAt");

-- CreateIndex
CREATE INDEX "AiThreadShare_expiresAt_revokedAt_idx" ON "AiThreadShare"("expiresAt", "revokedAt");
