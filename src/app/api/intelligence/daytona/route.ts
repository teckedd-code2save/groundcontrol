import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import {
  reproduceInDaytona,
  compareToBlueprint,
  type BlueprintId,
  type TopologySignals,
} from "@/lib/intelligence";

function errorResponse(err: unknown, status = 500) {
  const message = err instanceof Error ? err.message : "Server error";
  const code = message === "Unauthorized" ? 401 : status;
  return NextResponse.json({ error: message }, { status: code });
}

/** POST: Daytona (or local sanitized) reproduction + optional blueprint compare. */
export async function POST(req: NextRequest) {
  try {
    requireAuth(req);
    const body = (await req.json()) as {
      commitSha?: string;
      artifactDigest?: string;
      composeSnippet?: string;
      proxySnippet?: string;
      envKeys?: string[];
      journeyUrl?: string;
      blueprintId?: BlueprintId;
      topologySignals?: TopologySignals;
    };

    // Never accept secret values — envKeys names only
    if (body.envKeys?.some((k) => k.includes("="))) {
      return NextResponse.json(
        { error: "envKeys must be names only, not KEY=value" },
        { status: 400 }
      );
    }

    const reproduction = await reproduceInDaytona({
      commitSha: body.commitSha,
      artifactDigest: body.artifactDigest,
      composeSnippet: body.composeSnippet,
      proxySnippet: body.proxySnippet,
      envKeys: body.envKeys,
      journeyUrl: body.journeyUrl,
    });

    const blueprint = body.blueprintId
      ? compareToBlueprint(body.blueprintId, body.topologySignals || {})
      : undefined;

    return NextResponse.json({
      reproduction,
      blueprint,
      maturity: reproduction.provider === "daytona" ? "early_access" : "local_sanitized",
      note: "Daytona never receives production secrets. Network denied by default.",
    });
  } catch (err) {
    return errorResponse(err);
  }
}
