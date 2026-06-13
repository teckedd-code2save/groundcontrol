import { NextRequest, NextResponse } from "next/server";
import { getUserFromToken } from "@/lib/auth";
import { createAuditLog } from "@/lib/audit";

export async function POST(req: NextRequest) {
  const user = getUserFromToken(req);
  if (user) {
    await createAuditLog(user.id, "logout", req, { username: user.username });
  }
  const response = NextResponse.json({ success: true });
  response.cookies.set("gc_token", "", { maxAge: 0, path: "/" });
  return response;
}
