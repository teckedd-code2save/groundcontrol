import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { encryptIfNeeded } from "@/lib/crypto";
import type { TerraformProvider, StateBackend } from "@/lib/terraform/types";

function getErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function isUnauthorized(err: unknown): boolean {
  return err instanceof Error && err.message === "Unauthorized";
}

const VALID_PROVIDERS: TerraformProvider[] = ["hetzner", "aws", "gcp", "azure"];
const VALID_BACKENDS: StateBackend[] = ["local", "s3", "gcs"];

function isValidProvider(value: string): value is TerraformProvider {
  return VALID_PROVIDERS.includes(value as TerraformProvider);
}

function isValidBackend(value: string): value is StateBackend {
  return VALID_BACKENDS.includes(value as StateBackend);
}

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

    const stack = await prisma.terraformStack.findUnique({
      where: { id: stackId },
    });

    if (!stack) {
      return NextResponse.json({ error: "Stack not found" }, { status: 404 });
    }

    return NextResponse.json(stack);
  } catch (err: unknown) {
    if (isUnauthorized(err)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.json({ error: getErrorMessage(err) }, { status: 500 });
  }
}

export async function PATCH(
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

    const body = await req.json();
    const data: Record<string, unknown> = {};

    if (body.name !== undefined) data.name = String(body.name);
    if (body.provider !== undefined) {
      if (!isValidProvider(body.provider)) {
        return NextResponse.json(
          { error: "provider must be one of: hetzner, aws, gcp, azure" },
          { status: 400 }
        );
      }
      data.provider = body.provider;
    }
    if (body.workspace !== undefined) {
      data.workspace =
        typeof body.workspace === "string" && body.workspace.length > 0
          ? body.workspace
          : "default";
    }
    if (body.hcl !== undefined) data.hcl = String(body.hcl);
    if (body.varsJson !== undefined) {
      data.varsJson =
        typeof body.varsJson === "string"
          ? encryptIfNeeded(body.varsJson) ?? ""
          : "";
    }
    if (body.stateBackend !== undefined) {
      if (!isValidBackend(body.stateBackend)) {
        return NextResponse.json(
          { error: "stateBackend must be one of: local, s3, gcs" },
          { status: 400 }
        );
      }
      data.stateBackend = body.stateBackend;
    }
    if (body.statePath !== undefined) {
      data.statePath = body.statePath === null ? null : String(body.statePath);
    }
    if (body.lastPlan !== undefined) {
      data.lastPlan = body.lastPlan === null ? null : String(body.lastPlan);
    }

    const stack = await prisma.terraformStack.update({
      where: { id: stackId },
      data,
    });

    return NextResponse.json(stack);
  } catch (err: unknown) {
    if (isUnauthorized(err)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.json({ error: getErrorMessage(err) }, { status: 500 });
  }
}

export async function DELETE(
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

    await prisma.terraformStack.delete({ where: { id: stackId } });
    return NextResponse.json({ ok: true });
  } catch (err: unknown) {
    if (isUnauthorized(err)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.json({ error: getErrorMessage(err) }, { status: 500 });
  }
}
