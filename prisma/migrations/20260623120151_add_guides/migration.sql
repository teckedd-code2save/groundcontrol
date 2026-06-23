-- CreateTable
CREATE TABLE "Guide" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "category" TEXT NOT NULL,
    "sourceRef" TEXT NOT NULL DEFAULT '',
    "stepsJson" TEXT NOT NULL,
    "isPublished" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "UserGuideProgress" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "userId" INTEGER NOT NULL,
    "guideId" INTEGER NOT NULL,
    "currentStepId" TEXT NOT NULL DEFAULT '',
    "completedStepIds" TEXT NOT NULL DEFAULT '[]',
    "status" TEXT NOT NULL DEFAULT 'not_started',
    "startedAt" DATETIME,
    "completedAt" DATETIME,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "UserGuideProgress_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "UserGuideProgress_guideId_fkey" FOREIGN KEY ("guideId") REFERENCES "Guide" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "Guide_slug_key" ON "Guide"("slug");

-- CreateIndex
CREATE INDEX "Guide_category_isPublished_idx" ON "Guide"("category", "isPublished");

-- CreateIndex
CREATE INDEX "Guide_slug_isPublished_idx" ON "Guide"("slug", "isPublished");

-- CreateIndex
CREATE INDEX "UserGuideProgress_userId_status_idx" ON "UserGuideProgress"("userId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "UserGuideProgress_userId_guideId_key" ON "UserGuideProgress"("userId", "guideId");
