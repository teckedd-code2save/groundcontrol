import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";

export type AuditAction = "login" | "logout" | "password_change" | "login_failed" | "account_created";

export function getClientInfo(req: NextRequest) {
  const forwarded = req.headers.get("x-forwarded-for");
  const ip = forwarded?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "unknown";
  const userAgent = req.headers.get("user-agent") || "";
  return { ip, userAgent };
}

export async function createAuditLog(
  userId: number | null,
  action: AuditAction,
  req: NextRequest,
  metadata?: Record<string, unknown>
) {
  if (!userId) return;
  const { ip, userAgent } = getClientInfo(req);
  try {
    await prisma.auditLog.create({
      data: {
        userId,
        action,
        ip,
        userAgent,
        metadata: metadata ? JSON.stringify(metadata) : "",
      },
    });
  } catch {
    // Audit logging must never break the request.
  }
}
