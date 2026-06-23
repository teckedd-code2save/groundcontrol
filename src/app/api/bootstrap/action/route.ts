import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { handleApiError } from "@/lib/errors";
import { componentAction, type ComponentAction } from "@/lib/bootstrap";

const VALID_ACTIONS: ComponentAction[] = [
  "install",
  "reinstall",
  "uninstall",
  "start",
  "stop",
  "restart",
  "reload",
  "status",
];

export async function POST(req: NextRequest) {
  try {
    await requireAuth(req);
    const body = (await req.json().catch(() => ({}))) as { tool?: string; action?: string };
    const { tool, action } = body;

    if (!tool || typeof tool !== "string") {
      return NextResponse.json({ error: "tool is required" }, { status: 400 });
    }
    if (!action || !VALID_ACTIONS.includes(action as ComponentAction)) {
      return NextResponse.json({ error: `action must be one of ${VALID_ACTIONS.join(", ")}` }, { status: 400 });
    }

    const result = await componentAction(tool, action as ComponentAction);
    return NextResponse.json(result);
  } catch (err) {
    return handleApiError(err);
  }
}
