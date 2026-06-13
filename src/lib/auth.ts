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

export function setAuthCookie(response: NextResponse, user: { id: number; username: string; role: string }) {
  const token = jwt.sign({ id: user.id, username: user.username, role: user.role }, getJwtSecret(), {
    expiresIn: "7d",
  });
  response.cookies.set("gc_token", token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 60 * 60 * 24 * 7,
    path: "/",
  });
  return response;
}
