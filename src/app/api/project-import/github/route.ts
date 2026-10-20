import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { handleApiError } from "@/lib/errors";
import { inspectGithubProject, importGithubProject } from "@/lib/github-project-import";
export async function GET(req: NextRequest) {
  try { requireAuth(req); return NextResponse.json({ repository: await inspectGithubProject(req.nextUrl.searchParams.get("url")) }); }
  catch (error) { return handleApiError(error); }
}
export async function POST(req: NextRequest) {
  try { requireAuth(req); return NextResponse.json(await importGithubProject(await req.json()), { status: 201 }); }
  catch (error) { return handleApiError(error); }
}
