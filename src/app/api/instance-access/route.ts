import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { createAuditLog } from "@/lib/audit";
import {
  getInstanceAccessState,
  keepInstancePrivate,
  publishCloudflareDomain,
  publishTemporaryHttps,
  verifyPublishedInstance,
} from "@/lib/instance-access";

export async function GET(req: NextRequest) {
  try {
    requireAuth(req);
    const state = await getInstanceAccessState();
    return NextResponse.json(state, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not read instance access";
    return NextResponse.json({ error: message }, { status: message === "Unauthorized" ? 401 : 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = requireAuth(req);
    if (user.role !== "admin") {
      return NextResponse.json({ error: "Administrator access required" }, { status: 403 });
    }

    const body = await req.json().catch(() => ({})) as {
      action?: string;
      domain?: string;
    };
    const action = String(body.action || "").trim();

    if (action === "temporary_https") {
      const state = await publishTemporaryHttps();
      await createAuditLog(user.id, "instance_access_publish", req, {
        mode: state.mode,
        publicUrl: state.publicUrl,
        temporary: state.temporary,
      });
      return NextResponse.json(state);
    }

    if (action === "cloudflare_domain") {
      const state = await publishCloudflareDomain(String(body.domain || ""));
      await createAuditLog(user.id, "instance_access_publish", req, {
        mode: state.mode,
        domain: state.domain,
        publicUrl: state.publicUrl,
        tunnelId: state.tunnelId,
      });
      return NextResponse.json(state);
    }

    if (action === "verify") {
      const state = await verifyPublishedInstance();
      await createAuditLog(user.id, "instance_access_verify", req, {
        mode: state.mode,
        publicUrl: state.publicUrl,
        verifiedAt: state.verifiedAt,
        checks: state.checks?.map((check) => ({ id: check.id, ok: check.ok })),
      });
      return NextResponse.json(state);
    }

    if (action === "private") {
      const state = await keepInstancePrivate();
      await createAuditLog(user.id, "instance_access_disable", req, { mode: "private" });
      return NextResponse.json(state);
    }

    return NextResponse.json({
      error: "Use temporary_https, cloudflare_domain, verify, or private.",
    }, { status: 400 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not update instance access";
    return NextResponse.json({ error: message }, { status: message === "Unauthorized" ? 401 : 500 });
  }
}
