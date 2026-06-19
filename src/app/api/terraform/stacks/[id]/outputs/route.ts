import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getTerraformOutputs } from "@/lib/terraform/runner";
import { handleApiError } from "@/lib/errors";
import type { TerraformStack } from "@/lib/terraform/types";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    requireAuth(req);

    const { id } = await params;
    const stackId = parseInt(id, 10);
    if (!Number.isFinite(stackId)) {
      return NextResponse.json({ error: "Invalid stack id" }, { status: 400 });
    }

    const stack = (await prisma.terraformStack.findUnique({
      where: { id: stackId },
    })) as TerraformStack | null;
    if (!stack) {
      return NextResponse.json({ error: "Stack not found" }, { status: 404 });
    }

    const outputs = await getTerraformOutputs(stack);
    return NextResponse.json(outputs);
  } catch (err: unknown) {
    return handleApiError(err);
  }
}
