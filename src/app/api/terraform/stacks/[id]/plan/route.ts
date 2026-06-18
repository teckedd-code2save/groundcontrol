import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { runTerraformPlan } from "@/lib/terraform/runner";
import type { TerraformStack } from "@/lib/terraform/types";

function getErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function isUnauthorized(err: unknown): boolean {
  return err instanceof Error && err.message === "Unauthorized";
}

export async function POST(
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

    const result = await runTerraformPlan(stack);

    await prisma.terraformStack.update({
      where: { id: stackId },
      data: { lastPlan: result.stdout },
    });

    return NextResponse.json(result);
  } catch (err: unknown) {
    if (isUnauthorized(err)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.json({ error: getErrorMessage(err) }, { status: 500 });
  }
}
