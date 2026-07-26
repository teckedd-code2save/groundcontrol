import { prisma } from "@/lib/prisma";
import { redactSensitive } from "@/lib/errors";

export type AiRole = "system" | "user" | "assistant" | "tool";

export interface WireMessage {
  role: AiRole | string;
  content: string;
}

export interface ToolCallRecord {
  name: string;
  args: Record<string, unknown>;
  output?: string;
  status: "pending" | "running" | "done" | "error" | "confirmed";
  readOnly: boolean;
  confirmedAt?: Date | null;
}

export interface UsageRecord {
  provider: string;
  model: string;
  inputTokens?: number | null;
  outputTokens?: number | null;
  totalTokens?: number | null;
  costUsd?: number | null;
}

const TOOL_ERROR_PREFIX = /^(?:ERROR:|Refused:|\[exit\s+(?!0\b)\d+\])/i;

/** Convert tool text into a truthful UI/model status. */
export function classifyToolOutput(output: string): "done" | "error" {
  const value = String(output || "").trim();
  if (!value || TOOL_ERROR_PREFIX.test(value)) return "error";
  try {
    const parsed = JSON.parse(value) as Record<string, unknown>;
    if (
      parsed.status === "failed" ||
      parsed.status === "error" ||
      parsed.candidateValidated === false
    ) {
      return "error";
    }
  } catch {
    // Most host tools return plain text.
  }
  return "done";
}

function safeJson(value: string, fallback: unknown) {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return fallback;
  }
}

/**
 * Persisted tool evidence is part of the investigation state. Without it, a
 * later turn can silently replace a confirmed fact with a new guess.
 */
export async function buildAiEvidenceLedger(threadId: number, take = 24): Promise<string> {
  const calls = await prisma.aiToolCall.findMany({
    where: { message: { threadId } },
    orderBy: { createdAt: "desc" },
    take,
    include: { message: { select: { sortOrder: true } } },
  });
  if (!calls.length) return "";

  const rows = calls.reverse().map((call) => {
    const args = redactSensitive(JSON.stringify(safeJson(call.args, {}))).slice(0, 700);
    const output = redactSensitive(call.output || "(no output)").slice(0, 1_600);
    const effectiveStatus = call.output ? classifyToolOutput(call.output) : call.status;
    return [
      `- turn=${call.message.sortOrder} tool=${call.name} status=${effectiveStatus}`,
      `  args=${args}`,
      `  result=${output.replace(/\n/g, "\n  ")}`,
    ].join("\n");
  });

  return [
    "PERSISTED INVESTIGATION EVIDENCE (oldest to newest; tool status is authoritative):",
    ...rows,
  ].join("\n").slice(0, 16_000);
}

/** Create a new thread for a user, optionally seeded with a title. */
export async function createAiThread(userId: number, title = "New chat") {
  return prisma.aiThread.create({
    data: { userId, title: title.slice(0, 120) },
  });
}

/** Update a thread's title and updatedAt timestamp. */
export async function updateAiThread(threadId: number, userId: number, title: string) {
  return prisma.aiThread.update({
    where: { id: threadId, userId },
    data: { title: title.slice(0, 120), updatedAt: new Date() },
  });
}

/** List a user's threads, newest first. */
export async function listAiThreads(userId: number, take = 50) {
  return prisma.aiThread.findMany({
    where: { userId },
    orderBy: { updatedAt: "desc" },
    take,
    include: {
      _count: { select: { messages: true } },
    },
  });
}

/** Get a single thread including all messages and tool calls. */
export async function getAiThread(threadId: number, userId: number) {
  return prisma.aiThread.findFirst({
    where: { id: threadId, userId },
    include: {
      messages: {
        orderBy: { sortOrder: "asc" },
        include: { toolCalls: { orderBy: { createdAt: "asc" } } },
      },
    },
  });
}

/** Delete a thread and all its messages (cascades). */
export async function deleteAiThread(threadId: number, userId: number) {
  return prisma.aiThread.deleteMany({
    where: { id: threadId, userId },
  });
}

/** Append a message to a thread. Returns the created message plus an assigned sortOrder. */
export async function appendAiMessage(
  threadId: number,
  role: AiRole,
  content: string,
  metadata: Record<string, unknown> = {}
) {
  const last = await prisma.aiMessage.findFirst({
    where: { threadId },
    orderBy: { sortOrder: "desc" },
    select: { sortOrder: true },
  });
  return prisma.aiMessage.create({
    data: {
      threadId,
      role,
      content,
      sortOrder: (last?.sortOrder ?? -1) + 1,
      metadata: JSON.stringify(metadata),
    },
  });
}

/** Record a tool call against a message. */
export async function recordAiToolCall(
  messageId: number,
  record: ToolCallRecord
) {
  return prisma.aiToolCall.create({
    data: {
      messageId,
      name: record.name,
      args: JSON.stringify(record.args),
      output: record.output,
      status: record.status,
      readOnly: record.readOnly,
      confirmedAt: record.confirmedAt,
    },
  });
}

/** Update an existing tool call's status and output. */
export async function updateAiToolCall(
  toolCallId: number,
  patch: Partial<Pick<ToolCallRecord, "status" | "output" | "confirmedAt">>
) {
  return prisma.aiToolCall.update({
    where: { id: toolCallId },
    data: {
      ...patch,
      confirmedAt: patch.confirmedAt,
    },
  });
}

/** Record token usage for a turn. */
export async function recordAiUsage(
  usage: UsageRecord & { threadId?: number; messageId?: number }
) {
  return prisma.aiUsage.create({
    data: {
      threadId: usage.threadId,
      messageId: usage.messageId,
      provider: usage.provider,
      model: usage.model,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      totalTokens: usage.totalTokens,
      costUsd: usage.costUsd,
    },
  });
}

/** Convert persisted messages into the wire format used by the AI providers. */
export function toWireHistory(messages: { role: string; content: string }[]): WireMessage[] {
  return messages.map((m) => ({
    role: m.role,
    content: m.content,
  }));
}

/**
 * Generate a concise title from the first user message.
 * Used so the thread list is meaningful instead of "New chat" everywhere.
 */
export function titleFromMessage(text: string): string {
  const cleaned = text.trim().replace(/\s+/g, " ");
  if (cleaned.length <= 40) return cleaned || "New chat";
  return cleaned.slice(0, 37) + "…";
}
