import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import {
  getLoopEngine,
  setLoopEngine,
  registerJourney,
  createHttpJourney,
  type CustomerJourney,
} from "@/lib/intelligence";

function errorResponse(err: unknown, status = 500) {
  const message = err instanceof Error ? err.message : "Server error";
  const code = message === "Unauthorized" ? 401 : status;
  return NextResponse.json({ error: message }, { status: code });
}

export async function GET(req: NextRequest) {
  try {
    requireAuth(req);
    return NextResponse.json({ journeys: getLoopEngine().journeys });
  } catch (err) {
    return errorResponse(err);
  }
}

/** Create an operator-confirmed HTTP journey. */
export async function POST(req: NextRequest) {
  try {
    requireAuth(req);
    const body = (await req.json()) as Partial<CustomerJourney> & {
      publicUrl?: string;
      expectStatus?: number;
    };

    if (!body.id || !body.name) {
      return NextResponse.json({ error: "id and name required" }, { status: 400 });
    }
    if (!body.publicUrl && !body.steps?.length) {
      return NextResponse.json(
        { error: "publicUrl or steps required" },
        { status: 400 }
      );
    }

    const journey =
      body.steps && body.steps.length > 0
        ? ({
            id: body.id,
            name: body.name,
            serviceIds: body.serviceIds || [],
            criticality: body.criticality || "critical",
            triggers: body.triggers || ["proxy.changed", "service.changed"],
            steps: body.steps,
            confirmed: body.confirmed !== false,
            publicUrl: body.publicUrl,
          } satisfies CustomerJourney)
        : createHttpJourney({
            id: body.id,
            name: body.name,
            serviceIds: body.serviceIds || [],
            publicUrl: body.publicUrl!,
            expectStatus: body.expectStatus,
            triggers: body.triggers,
            confirmed: body.confirmed !== false,
            criticality: body.criticality,
          });

    const state = registerJourney(getLoopEngine(), journey);
    setLoopEngine(state);
    return NextResponse.json({ journey }, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
