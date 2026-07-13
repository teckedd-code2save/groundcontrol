CREATE TABLE "ProjectGroup" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

CREATE UNIQUE INDEX "ProjectGroup_slug_key" ON "ProjectGroup"("slug");

ALTER TABLE "Project" ADD COLUMN "projectGroupId" INTEGER REFERENCES "ProjectGroup"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "Project_projectGroupId_idx" ON "Project"("projectGroupId");
