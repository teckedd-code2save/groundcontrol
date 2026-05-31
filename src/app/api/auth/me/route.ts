import { NextRequest, NextResponse } from "next/server";
import jwt from "jsonwebtoken";

function getJwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error("JWT_SECRET environment variable is required");
  }
  return secret;
}

export async function GET(req: NextRequest) {
  try {
    const token = req.cookies.get("gc_token")?.value;
    if (!token) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const payload = jwt.verify(token, getJwtSecret()) as any;
    return NextResponse.json({ id: payload.id, username: payload.username, role: payload.role });
  } catch {
    return NextResponse.json({ error: "Invalid token" }, { status: 401 });
  }
}
