import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { handleApiError } from "@/lib/errors";
import { execOnTarget } from "@/lib/host-exec";
import { shQuote } from "@/lib/vps";

function slugify(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "deployment";
}

function humanize(value: string): string {
  return value
    .split(/[-_]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ") || value;
}

export async function POST(req: NextRequest) {
  try {
    requireAuth(req);
    const body = await req.json();
    const path = String(body.path || "").replace(/\/+$/, "");
    if (!path.startsWith("/")) {
      return NextResponse.json({ error: "path must be an absolute path" }, { status: 400 });
    }
    const requestedSlug = slugify(String(body.slug || path.split("/").pop() || "deployment"));
    const name = String(body.name || humanize(requestedSlug));
    const composePath = String(body.composePath || `${path}/docker-compose.yml`);
    const compose = await execOnTarget(`cat ${shQuote(composePath)} 2>/dev/null || true`);
    if (!compose.stdout.trim()) {
      return NextResponse.json({ error: `No compose file found at ${composePath}` }, { status: 400 });
    }
    const project = await prisma.project.upsert({
      where: { slug: requestedSlug },
      create: {
        slug: requestedSlug,
        name,
        path,
        dockerCompose: compose.stdout,
        domain: body.domain || null,
        repoUrl: body.hasGit ? "" : null,
        category: "docker",
        status: "unknown",
      },
      update: {
        name,
        path,
        dockerCompose: compose.stdout,
        domain: body.domain || null,
        category: "docker",
      },
    });
    return NextResponse.json({ project });
  } catch (err) {
    return handleApiError(err);
  }
}
