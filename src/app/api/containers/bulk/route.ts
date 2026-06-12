import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { controlContainerWithState, type ContainerAction } from "@/lib/container-control";

const VALID_ACTIONS: ContainerAction[] = ["start", "stop", "restart", "remove"];

interface BulkResult {
  success: boolean;
  action: ContainerAction;
  name: string;
  output: string;
  error: string;
  container: { name: string; id: string; state: string; status: string; removed: boolean } | null;
}

function errorResponse(err: unknown, status = 500) {
  const message = err instanceof Error ? err.message : "Server error";
  return NextResponse.json({ error: message }, { status });
}

export async function POST(req: NextRequest) {
  try {
    await requireAuth(req);
    const body = (await req.json()) as Record<string, unknown>;
    const action = body.action as ContainerAction;
    const names = body.names;

    if (!Array.isArray(names) || names.length === 0) {
      return NextResponse.json({ error: "names array required" }, { status: 400 });
    }
    if (!VALID_ACTIONS.includes(action)) {
      return NextResponse.json(
        { error: `Invalid action "${action}". Expected one of: ${VALID_ACTIONS.join(", ")}` },
        { status: 400 }
      );
    }

    const results: BulkResult[] = [];
    for (const name of names) {
      if (typeof name !== "string" || !name.trim()) continue;
      try {
        const result = await controlContainerWithState(action, name.trim());
        results.push(result);
      } catch (err: unknown) {
        results.push({
          success: false,
          action,
          name: String(name),
          output: "",
          error: err instanceof Error ? err.message : String(err),
          container: null,
        });
      }
    }

    const success = results.length > 0 && results.every((r) => r.success);
    const processed = results.length;

    return NextResponse.json({ success, action, processed, results });
  } catch (err: unknown) {
    return errorResponse(err);
  }
}
