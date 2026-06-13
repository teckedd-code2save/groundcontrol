import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import bcrypt from "bcryptjs";
import { setAuthCookie } from "@/lib/auth";

// Simple in-memory rate limiter: ip -> { attempts, resetAt }
const loginAttempts = new Map<string, { attempts: number; resetAt: number }>();
const MAX_ATTEMPTS = 5;
const WINDOW_MS = 15 * 60 * 1000; // 15 minutes

function getClientIp(req: NextRequest): string {
  const forwarded = req.headers.get("x-forwarded-for");
  return forwarded?.split(",")[0]?.trim() || "unknown";
}

function isRateLimited(ip: string): boolean {
  const now = Date.now();
  const record = loginAttempts.get(ip);
  if (!record) {
    loginAttempts.set(ip, { attempts: 1, resetAt: now + WINDOW_MS });
    return false;
  }
  if (now > record.resetAt) {
    loginAttempts.set(ip, { attempts: 1, resetAt: now + WINDOW_MS });
    return false;
  }
  record.attempts++;
  return record.attempts > MAX_ATTEMPTS;
}

export async function POST(req: NextRequest) {
  try {
    const ip = getClientIp(req);
    if (isRateLimited(ip)) {
      return NextResponse.json({ error: "Too many login attempts. Try again in 15 minutes." }, { status: 429 });
    }

    const { username, password } = await req.json();
    if (!username || !password) {
      return NextResponse.json({ error: "Username and password required" }, { status: 400 });
    }

    const user = await prisma.user.findUnique({ where: { username } });
    if (!user) {
      return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });
    }

    const valid = await bcrypt.compare(password, user.password);
    if (!valid) {
      return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });
    }

    // Reset attempts on successful login
    loginAttempts.delete(ip);

    const response = NextResponse.json({
      success: true,
      username: user.username,
      forcePasswordChange: user.forcePasswordChange,
    });
    return setAuthCookie(response, { id: user.id, username: user.username, role: user.role });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
