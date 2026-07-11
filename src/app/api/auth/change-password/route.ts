import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import bcrypt from "bcryptjs";
import { requireAuth, validatePassword, setAuthCookie } from "@/lib/auth";
import { createAuditLog } from "@/lib/audit";

export async function POST(req: NextRequest) {
  try {
    const user = requireAuth(req);
    const { currentPassword, newPassword, newUsername } = await req.json();

    if (!currentPassword || !newPassword) {
      return NextResponse.json({ error: "Current and new password required" }, { status: 400 });
    }

    const passwordCheck = validatePassword(newPassword);
    if (!passwordCheck.valid) {
      return NextResponse.json({ error: passwordCheck.message }, { status: 400 });
    }

    const dbUser = await prisma.user.findUnique({ where: { id: user.id } });
    if (!dbUser) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    const valid = await bcrypt.compare(currentPassword, dbUser.password);
    if (!valid) {
      return NextResponse.json({ error: "Current password is incorrect" }, { status: 401 });
    }

    const updates: {
      password: string;
      forcePasswordChange: boolean;
      username?: string;
    } = {
      password: await bcrypt.hash(newPassword, 12),
      forcePasswordChange: false,
    };

    const cleanUsername =
      typeof newUsername === "string" ? newUsername.trim() : "";
    if (cleanUsername && cleanUsername !== dbUser.username) {
      if (cleanUsername.length < 2) {
        return NextResponse.json(
          { error: "Email / username must be at least 2 characters" },
          { status: 400 }
        );
      }
      const taken = await prisma.user.findUnique({ where: { username: cleanUsername } });
      if (taken && taken.id !== dbUser.id) {
        return NextResponse.json(
          { error: "That email / username is already in use" },
          { status: 409 }
        );
      }
      updates.username = cleanUsername;
    }

    const updated = await prisma.user.update({
      where: { id: user.id },
      data: updates,
    });

    await createAuditLog(user.id, "password_change", req, {
      usernameUpdated: Boolean(updates.username),
    });

    const response = NextResponse.json({
      success: true,
      username: updated.username,
    });
    return setAuthCookie(response, {
      id: updated.id,
      username: updated.username,
      role: updated.role,
    });
  } catch (err) {
    if (err instanceof Error && err.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
