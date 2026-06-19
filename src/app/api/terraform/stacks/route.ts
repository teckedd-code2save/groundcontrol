import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { encryptIfNeeded } from "@/lib/crypto";
import { handleApiError } from "@/lib/errors";
import type { TerraformProvider, StateBackend } from "@/lib/terraform/types";

const VALID_PROVIDERS: TerraformProvider[] = ["hetzner", "aws", "gcp", "azure"];
const VALID_BACKENDS: StateBackend[] = ["local", "s3", "gcs"];

function isValidProvider(value: string): value is TerraformProvider {
  return VALID_PROVIDERS.includes(value as TerraformProvider);
}

function isValidBackend(value: string): value is StateBackend {
  return VALID_BACKENDS.includes(value as StateBackend);
}

export async function GET(req: NextRequest) {
  try {
    requireAuth(req);

    const stacks = await prisma.terraformStack.findMany({
      orderBy: { updatedAt: "desc" },
    });

    return NextResponse.json(stacks);
  } catch (err: unknown) {
    return handleApiError(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    requireAuth(req);

    const body = await req.json();

    if (!body.name || typeof body.name !== "string") {
      return NextResponse.json({ error: "name is required" }, { status: 400 });
    }
    if (!body.provider || !isValidProvider(body.provider)) {
      return NextResponse.json(
        { error: "provider must be one of: hetzner, aws, gcp, azure" },
        { status: 400 }
      );
    }

    const workspace =
      typeof body.workspace === "string" && body.workspace.length > 0
        ? body.workspace
        : "default";
    const stateBackend =
      typeof body.stateBackend === "string" && isValidBackend(body.stateBackend)
        ? body.stateBackend
        : "local";
    const statePath =
      body.statePath === null || body.statePath === undefined
        ? null
        : String(body.statePath);
    const hcl =
      typeof body.hcl === "string" ? body.hcl : `# Terraform stack for ${body.provider}\n`;
    const varsJson =
      typeof body.varsJson === "string" ? encryptIfNeeded(body.varsJson) ?? "" : "";

    const stack = await prisma.terraformStack.create({
      data: {
        name: body.name,
        provider: body.provider,
        workspace,
        hcl,
        varsJson,
        stateBackend,
        statePath,
      },
    });

    return NextResponse.json(stack, { status: 201 });
  } catch (err: unknown) {
    return handleApiError(err);
  }
}
