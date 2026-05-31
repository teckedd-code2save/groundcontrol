import { NextRequest } from "next/server";
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
