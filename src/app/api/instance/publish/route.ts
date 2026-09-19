import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { HttpError, handleApiError } from "@/lib/errors";
import { createAuditLog } from "@/lib/audit";
import {
  instancePublishStatus,
  keepInstancePrivate,
  publishQuickTunnel,
  publishWithCaddy,
  publishWithCloudflare,
  verifyGroundControlInstance,
} from "@/lib/instance-publish";

async function requireAdmin(req: NextRequest) {
  const user = requireAuth(req);
  if (user.role !== "admin") throw new HttpError("Admin access required", 403);
  return user;
}

export async function GET(req: NextRequest) {
  try {
    await requireAdmin(req);
    return NextResponse.json(await instancePublishStatus(), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await requireAdmin(req);
    const body = await req.json() as {
      action?: string;
      hostname?: string;
      apiToken?: string;
      accountId?: string;
    };

    if (body.action === "private") {
      const result = await keepInstancePrivate();
      const verification = await verifyGroundControlInstance(null);
      await createAuditLog(user.id, "instance_access_disable", req, {
        mode: "private",
        verificationOk: verification.ok,
      });
      return NextResponse.json({ result, verification });
    }

    if (body.action === "quick_tunnel") {
      const result = await publishQuickTunnel();
      const verification = await verifyGroundControlInstance(result.publicUrl);
      await createAuditLog(user.id, "instance_access_publish", req, {
        mode: result.mode,
        publicUrl: result.publicUrl,
        verificationOk: verification.ok,
      });
      return NextResponse.json({ result, verification });
    }

    if (body.action === "caddy") {
      if (!body.hostname) {
        return NextResponse.json({ error: "hostname is required" }, { status: 400 });
      }
      try {
        const result = await publishWithCaddy({ hostname: body.hostname });
        const verification = await verifyGroundControlInstance(result.publicUrl);
        await createAuditLog(user.id, "instance_access_publish", req, {
          mode: result.mode,
          publicUrl: result.publicUrl,
          verificationOk: verification.ok,
        });
        return NextResponse.json({ result, verification });
      } catch (error) {
        const typed = error as Error & {
          code?: string;
          requiredRecord?: Record<string, string>;
        };
        if (typed.code === "DNS_REQUIRED") {
          return NextResponse.json({
            error: typed.message,
            code: typed.code,
            requiredRecord: typed.requiredRecord,
          }, { status: 409 });
        }
        throw error;
      }
    }

    if (body.action === "cloudflare") {
      if (!body.hostname) {
        return NextResponse.json({ error: "hostname is required" }, { status: 400 });
      }
      const result = await publishWithCloudflare({
        hostname: body.hostname,
        apiToken: body.apiToken,
        accountId: body.accountId,
      });
      const verification = await verifyGroundControlInstance(result.publicUrl);
      await createAuditLog(user.id, "instance_access_publish", req, {
        mode: result.mode,
        publicUrl: result.publicUrl,
        verificationOk: verification.ok,
      });
      return NextResponse.json({ result, verification });
    }

    if (body.action === "verify") {
      const verification = await verifyGroundControlInstance();
      await createAuditLog(user.id, "instance_access_verify", req, {
        publicUrl: verification.publicUrl,
        verificationOk: verification.ok,
      });
      return NextResponse.json({ verification });
    }

    return NextResponse.json({
      error: "action must be private, quick_tunnel, caddy, cloudflare, or verify",
    }, { status: 400 });
  } catch (error) {
    return handleApiError(error);
  }
}
