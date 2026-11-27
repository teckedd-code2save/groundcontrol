import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { launchTemplateDeployment } from "@/lib/template-launch";
import { handleApiError } from "@/lib/errors";

export async function POST(req: NextRequest) {
  try {
    const user = await requireAuth(req);
    if (user instanceof NextResponse) return user;
    return launchTemplateDeployment(user, await req.json());
  } catch (error) { return handleApiError(error); }
}
