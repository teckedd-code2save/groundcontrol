import { promises as fs } from "fs";
import path from "path";
import type { PrismaClient } from "@prisma/client";
import { prisma as defaultPrisma } from "@/lib/prisma";

export interface GuideStep {
  id: string;
  title: string;
  content: string; // markdown
  checkCommand?: string;
  expectedOutput?: string;
  aiHint?: string;
  nextStepId?: string;
  action?: {
    tool: string;
    action: string;
    confirm?: boolean;
    label?: string;
  };
}

export interface GuideDefinition {
  slug: string;
  title: string;
  description: string;
  category: "integration" | "incident" | "concept" | "checklist";
  sourceRef: string;
  steps: GuideStep[];
  isPublished?: boolean;
}

const CONTENT_DIR = path.join(process.cwd(), "src", "lib", "guides", "content");

export async function loadGuideDefinitions(): Promise<GuideDefinition[]> {
  const files = await fs.readdir(CONTENT_DIR).catch(() => [] as string[]);
  const jsonFiles = files.filter((f) => f.endsWith(".json"));

  const definitions: GuideDefinition[] = [];
  for (const file of jsonFiles) {
    const raw = await fs.readFile(path.join(CONTENT_DIR, file), "utf-8");
    try {
      const parsed = JSON.parse(raw) as GuideDefinition;
      definitions.push(parsed);
    } catch (err) {
      console.error(`[guides] failed to parse ${file}:`, err);
    }
  }

  return definitions.sort((a, b) => a.title.localeCompare(b.title));
}

export async function upsertGuidesFromDisk(
  db: PrismaClient = defaultPrisma
): Promise<{ created: number; updated: number }> {
  const definitions = await loadGuideDefinitions();
  let created = 0;
  let updated = 0;

  for (const def of definitions) {
    const exists = await db.guide.findUnique({ where: { slug: def.slug } });
    const data = {
      title: def.title,
      description: def.description,
      category: def.category,
      sourceRef: def.sourceRef,
      stepsJson: JSON.stringify(def.steps),
      isPublished: def.isPublished ?? true,
    };

    if (exists) {
      await db.guide.update({ where: { slug: def.slug }, data });
      updated++;
    } else {
      await db.guide.create({ data: { slug: def.slug, ...data } });
      created++;
    }
  }

  return { created, updated };
}

export async function getGuideBySlug(slug: string, db: PrismaClient = defaultPrisma) {
  return db.guide.findUnique({ where: { slug } });
}

export async function listPublishedGuides(db: PrismaClient = defaultPrisma) {
  return db.guide.findMany({
    where: { isPublished: true },
    orderBy: [{ category: "asc" }, { title: "asc" }],
  });
}

export function parseGuideSteps(guide: { stepsJson: string }): GuideStep[] {
  try {
    return JSON.parse(guide.stepsJson) as GuideStep[];
  } catch {
    return [];
  }
}
