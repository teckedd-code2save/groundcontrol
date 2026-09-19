import bcrypt from "bcryptjs";
import { NextRequest, NextResponse } from "next/server";
import { setAuthCookie, validatePassword } from "@/lib/auth";
import { createAuditLog } from "@/lib/audit";
import {
  hashInstallClaimToken,
  installClaimStatus,
  validInstallClaimToken,
} from "@/lib/install-claim";
import { prisma } from "@/lib/prisma";

export async function GET() {
  try {
    const status = await installClaimStatus();
    return NextResponse.json(status, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : "Could not read claim status",
    }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as {
      token?: string;
      username?: string;
      password?: string;
    };
    const token = String(body.token || "").trim();
    const username = String(body.username || "").trim();
    const password = String(body.password || "");

    if (!validInstallClaimToken(token)) {
      return NextResponse.json({ error: "The claim code is invalid." }, { status: 400 });
    }
    if (username.length < 2 || username.length > 160) {
      return NextResponse.json({ error: "Username must be between 2 and 160 characters." }, { status: 400 });
    }
    const passwordCheck = validatePassword(password);
    if (!passwordCheck.valid) {
      return NextResponse.json({ error: passwordCheck.message }, { status: 400 });
    }

    const now = new Date();
    const claim = await prisma.installClaim.findUnique({
      where: { tokenHash: hashInstallClaimToken(token) },
    });
    if (!claim || claim.status !== "active" || claim.expiresAt <= now) {
      return NextResponse.json({
        error: "This claim has expired, was revoked, or has already been used. Generate a new claim on the GroundControl host.",
      }, { status: 410 });
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const user = await prisma.$transaction(async (tx) => {
      const existingUsers = await tx.user.count();
      if (existingUsers > 0) {
        throw new Error("CLAIM_ALREADY_COMPLETED");
      }

      const consumed = await tx.installClaim.updateMany({
        where: {
          id: claim.id,
          status: "active",
          claimedAt: null,
          expiresAt: { gt: now },
        },
        data: {
          status: "claimed",
          claimedAt: now,
        },
      });
      if (consumed.count !== 1) throw new Error("CLAIM_NOT_AVAILABLE");

      const created = await tx.user.create({
        data: {
          username,
          password: passwordHash,
          role: "admin",
          forcePasswordChange: false,
        },
      });
      await tx.installClaim.updateMany({
        where: {
          id: { not: claim.id },
          status: "active",
        },
        data: { status: "revoked" },
      });
      return created;
    });

    await createAuditLog(user.id, "install_claim", req, {
      claimId: claim.id,
      instanceId: claim.instanceId,
    });

    const response = NextResponse.json({
      ok: true,
      instanceId: claim.instanceId,
      user: {
        id: user.id,
        username: user.username,
        role: user.role,
      },
      next: "/onboarding?fresh=1",
    });
    return setAuthCookie(response, {
      id: user.id,
      username: user.username,
      role: user.role,
    }, req);
  } catch (error) {
    if (error instanceof Error && error.message === "CLAIM_ALREADY_COMPLETED") {
      return NextResponse.json({ error: "This GroundControl instance has already been claimed." }, { status: 409 });
    }
    if (error instanceof Error && error.message === "CLAIM_NOT_AVAILABLE") {
      return NextResponse.json({ error: "This claim is no longer available." }, { status: 409 });
    }
    if (error instanceof Error && /Unique constraint/.test(error.message)) {
      return NextResponse.json({ error: "That username is already in use." }, { status: 409 });
    }
    return NextResponse.json({
      error: error instanceof Error ? error.message : "Could not claim GroundControl",
    }, { status: 500 });
  }
}
