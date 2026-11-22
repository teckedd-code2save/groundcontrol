import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { HttpError, handleApiError } from "@/lib/errors";
import { createAuditLog } from "@/lib/audit";
import {
  adoptDirectIpv4, directIpv4Active, directIpv4Enabled, directIpv4Evidence, forgetDirectIpv4, prepareDirectIpv4,
} from "@/lib/direct-ipv4-access";
import { isDesktopMode } from "@/lib/runtime";
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

let changing = false;

export async function GET(req: NextRequest) {
  try {
    await requireAdmin(req);
    return NextResponse.json({
      ...await instancePublishStatus(),
      directIpv4Enabled: directIpv4Enabled(),
      directIpv4Evidence: await directIpv4Evidence(),
    }, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(req: NextRequest) {
  let ownsMutation = false;
  try {
    const user = await requireAdmin(req);
    const body = await req.json() as {
      action?: string;
      hostname?: string;
      apiToken?: string;
      accountId?: string;
      ip?: unknown;
      confirmed?: unknown;
      proof?: unknown;
    };

    if (isDesktopMode() && body.action !== "private" && body.action !== "verify" && body.action !== "forget_direct_ipv4") {
      return NextResponse.json({ error: "This installation uses a local login link. Install on a Linux server to configure public instance access." }, { status: 400 });
    }

    if (body.action !== "verify") {
      if (changing) throw new HttpError("Another access change is in progress.", 409);
      changing = ownsMutation = true;
      if (body.action !== "forget_direct_ipv4" && await directIpv4Active()) {
        throw new HttpError("This operator-managed IPv4 route must be removed by the operator and forgotten here before switching modes.", 409);
      }
    }

    if (body.action === "forget_direct_ipv4") {
      const result = await forgetDirectIpv4(body.confirmed);
      await createAuditLog(user.id, "instance_access_forget", req, {
        mode: "direct_ipv4",
        operatorAttestedRemoval: result.operatorAttestedRemoval,
      });
      return NextResponse.json({ result }, { headers: { "Cache-Control": "no-store" } });
    }

    if (body.action === "prepare_direct_ipv4") {
      const candidate = await prepareDirectIpv4(body.ip, body.confirmed, user.id);
      return NextResponse.json({ candidate }, { headers: { "Cache-Control": "no-store" } });
    }

    if (body.action === "adopt_direct_ipv4") {
      const result = await adoptDirectIpv4(body.proof, body.confirmed, user.id);
      await createAuditLog(user.id, "instance_access_publish", req, {
        mode: result.mode,
        publicUrl: result.publicUrl,
        check: "operator_external_proof",
      });
      return NextResponse.json({ result }, { headers: { "Cache-Control": "no-store" } });
    }

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
        const { verification, ...result } = await publishWithCaddy({ hostname: body.hostname });
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
      const { verification, ...result } = await publishWithCloudflare({
        hostname: body.hostname,
        apiToken: body.apiToken,
        accountId: body.accountId,
      });
      await createAuditLog(user.id, "instance_access_publish", req, {
        mode: result.mode,
        publicUrl: result.publicUrl,
        verificationOk: verification.ok,
      });
      return NextResponse.json({ result, verification });
    }

    if (body.action === "verify") {
      const direct = await directIpv4Active();
      // The local server can lack hairpin NAT. Keep its readiness separate
      // from the operator's earlier external IP/TLS evidence.
      const verification = direct
        ? await verifyGroundControlInstance("", { persist: false })
        : await verifyGroundControlInstance();
      if (direct) verification.checks.publicHttps.detail = "The local readiness check does not recheck external IPv4 reachability.";
      await createAuditLog(user.id, "instance_access_verify", req, {
        publicUrl: verification.publicUrl,
        verificationOk: verification.ok,
      });
      return NextResponse.json({ verification });
    }

    return NextResponse.json({
      error: "Unknown instance access action.",
    }, { status: 400 });
  } catch (error) {
    return handleApiError(error);
  } finally {
    if (ownsMutation) changing = false;
  }
}
