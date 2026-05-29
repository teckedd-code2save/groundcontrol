import { NextRequest } from "next/server";
import jwt from "jsonwebtoken";

const JWT_SECRET = process.env.JWT_SECRET || "groundcontrol-secret-change-me";

export function getUserFromToken(req: NextRequest) {
  const token = req.cookies.get("gc_token")?.value;
  if (!token) return null;
  try {
    return jwt.verify(token, JWT_SECRET) as { id: number; username: string; role: string };
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
