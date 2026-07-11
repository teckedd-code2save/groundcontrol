import { NextRequest, NextResponse } from "next/server";
import jwt from "jsonwebtoken";

function getJwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error("JWT_SECRET environment variable is required");
  }
  return secret;
}

export function getUserFromToken(req: NextRequest) {
  const token = req.cookies.get("gc_token")?.value;
  if (!token) return null;
  try {
    return jwt.verify(token, getJwtSecret()) as { id: number; username: string; role: string };
  } catch {
    return null;
  }
}

export function requireAuth(req: NextRequest) {
  const user = getUserFromToken(req);
  if (!user) {
    throw new Error("Unauthorized");
  }
  return user;
}

/**
 * Strong password policy:
 * - At least 12 characters
 * - At least one uppercase letter
 * - At least one lowercase letter
 * - At least one digit
 * - At least one special character
 */
export function validatePassword(password: string): { valid: boolean; message?: string } {
  if (!password || password.length < 12) {
    return { valid: false, message: "Password must be at least 12 characters long." };
  }
  if (!/[A-Z]/.test(password)) {
    return { valid: false, message: "Password must contain at least one uppercase letter." };
  }
  if (!/[a-z]/.test(password)) {
    return { valid: false, message: "Password must contain at least one lowercase letter." };
  }
  if (!/[0-9]/.test(password)) {
    return { valid: false, message: "Password must contain at least one digit." };
  }
  if (!/[^A-Za-z0-9]/.test(password)) {
    return { valid: false, message: "Password must contain at least one special character." };
  }
  return { valid: true };
}

/**
 * Whether the session cookie should use the Secure flag.
 *
 * Browsers refuse to store Secure cookies on plain HTTP. Bootstrap and IP:port
 * installs (http://128.x.x.x:3737) must use secure:false or login appears to
 * succeed then immediately bounces back to the marketing/login page.
 *
 * Order: COOKIE_SECURE env override → request scheme → production default.
 */
export function cookieSecureFlag(req?: NextRequest): boolean {
  const override = (process.env.COOKIE_SECURE || "").trim().toLowerCase();
  if (override === "true" || override === "1" || override === "yes") return true;
  if (override === "false" || override === "0" || override === "no") return false;

  if (req) {
    const forwarded = (req.headers.get("x-forwarded-proto") || "").split(",")[0]?.trim().toLowerCase();
    if (forwarded === "https") return true;
    if (forwarded === "http") return false;
    try {
      const proto = req.nextUrl.protocol.replace(":", "").toLowerCase();
      if (proto === "https") return true;
      if (proto === "http") return false;
    } catch {
      // ignore
    }
  }

  // Unknown scheme: keep production cookies Secure (HTTPS reverse-proxy default).
  return process.env.NODE_ENV === "production";
}

export function setAuthCookie(
  response: NextResponse,
  user: { id: number; username: string; role: string },
  req?: NextRequest
) {
  const token = jwt.sign({ id: user.id, username: user.username, role: user.role }, getJwtSecret(), {
    expiresIn: "7d",
  });
  response.cookies.set("gc_token", token, {
    httpOnly: true,
    secure: cookieSecureFlag(req),
    sameSite: "lax",
    maxAge: 60 * 60 * 24 * 7,
    path: "/",
  });
  return response;
}

export function clearAuthCookie(response: NextResponse, req?: NextRequest) {
  response.cookies.set("gc_token", "", {
    httpOnly: true,
    secure: cookieSecureFlag(req),
    sameSite: "lax",
    maxAge: 0,
    path: "/",
  });
  return response;
}
