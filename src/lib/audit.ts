import { prisma } from "@/lib/prisma";
import type { NextRequest } from "next/server";

export type AuditAction =
  | "login"
  | "logout"
  | "password_change"
  | "login_failed"
  | "ai_tool_execute"
  | "ai_tool_confirm"
  | "ai_thread_create"
  | "ai_thread_delete";

export interface AuditContext {
  ip: string;
  userAgent: string;
}

interface AuditOptions {
  userId: number;
  action: AuditAction;
  metadata?: Record<string, unknown>;
  context?: AuditContext;
}

export function getClientInfo(req: NextRequest): AuditContext {
  const forwarded = req.headers.get("x-forwarded-for");
  return {
    ip: forwarded?.split(",")[0]?.trim() || "unknown",
    userAgent: req.headers.get("user-agent") || "unknown",
  };
}

/** Append an entry to the audit log. */
export async function auditLog(opts: AuditOptions) {
  return prisma.auditLog.create({
    data: {
      userId: opts.userId,
      action: opts.action,
      ip: opts.context?.ip || "unknown",
      userAgent: opts.context?.userAgent || "unknown",
      metadata: JSON.stringify(opts.metadata ?? {}),
    },
  });
}

/** Legacy convenience helper used by auth routes. */
export async function createAuditLog(
  userId: number,
  action: AuditAction,
  req?: NextRequest,
  metadata?: Record<string, unknown>
) {
  return auditLog({
    userId,
    action,
    context: req ? getClientInfo(req) : undefined,
    metadata,
  });
}

/** Convenience helper for AI tool execution audit entries. */
export async function auditAiToolExecution(
  userId: number,
  opts: {
    threadId?: number;
    messageId?: number;
    toolCallId?: number;
    name: string;
    args: Record<string, unknown>;
    output?: string;
    readOnly: boolean;
    confirmed: boolean;
    req?: NextRequest;
    context?: AuditContext;
  }
) {
  const context = opts.context ?? (opts.req ? getClientInfo(opts.req) : undefined);
  return auditLog({
    userId,
    action: opts.confirmed ? "ai_tool_confirm" : "ai_tool_execute",
    context,
    metadata: {
      threadId: opts.threadId,
      messageId: opts.messageId,
      toolCallId: opts.toolCallId,
      name: opts.name,
      args: opts.args,
      output: opts.output,
      readOnly: opts.readOnly,
      confirmed: opts.confirmed,
    },
  });
}
