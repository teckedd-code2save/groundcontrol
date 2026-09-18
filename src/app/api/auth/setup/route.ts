import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import bcrypt from "bcryptjs";
import { validatePassword, setAuthCookie } from "@/lib/auth";
import { installClaimStatus } from "@/lib/install-claim";

export async function GET() {
  try {
    const status = await installClaimStatus();
    return NextResponse.json({
      setupRequired: status.setupRequired,
      claimRequired: status.claimRequired,
      claimed: status.claimed,
      instanceId: status.instanceId,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const status = await installClaimStatus();
    if (status.claimed) {
      return NextResponse.json({ error: "Setup has already been completed." }, { status: 403 });
    }
    if (status.claimRequired) {
      return NextResponse.json({
        error: "This installation requires its one-time human claim before an administrator can be created.",
        claimRequired: true,
      }, { status: 409 });
    }

    const { username, password } = await req.json();
    if (!username || !password) {
      return NextResponse.json({ error: "Username and password required" }, { status: 400 });
    }

    const cleanUsername = String(username).trim();
    if (cleanUsername.length < 2) {
      return NextResponse.json({ error: "Username must be at least 2 characters" }, { status: 400 });
    }

    const passwordCheck = validatePassword(password);
    if (!passwordCheck.valid) {
      return NextResponse.json({ error: passwordCheck.message }, { status: 400 });
    }

    const hash = await bcrypt.hash(password, 12);
    const user = await prisma.user.create({
      data: {
        username: cleanUsername,
        password: hash,
        role: "admin",
        forcePasswordChange: false,
      },
    });

    const response = NextResponse.json({
      id: user.id,
      username: user.username,
      role: user.role,
      forcePasswordChange: user.forcePasswordChange,
    });

    return setAuthCookie(response, { id: user.id, username: user.username, role: user.role }, req);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
