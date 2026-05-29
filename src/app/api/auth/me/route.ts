import { NextRequest, NextResponse } from "next/server";
import jwt from "jsonwebtoken";

const JWT_SECRET = process.env.JWT_SECRET || "groundcontrol-secret-change-me";

export async function GET(req: NextRequest) {
  try {
    const token = req.cookies.get("gc_token")?.value;
    if (!token) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const payload = jwt.verify(token, JWT_SECRET) as any;
    return NextResponse.json({ id: payload.id, username: payload.username, role: payload.role });
  } catch {
    return NextResponse.json({ error: "Invalid token" }, { status: 401 });
  }
}
