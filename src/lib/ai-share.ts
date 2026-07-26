import { createHash, randomBytes } from "node:crypto";
import { HttpError, redactSensitive } from "@/lib/errors";
import { getAiThread } from "@/lib/ai-memory";
import { prisma } from "@/lib/prisma";
import { redactComposeSecrets } from "@/lib/managed-deployments";

const SHARE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export interface SharedChatSnapshot {
  title: string;
  createdAt: string;
  messages: Array<{ role: "user" | "assistant"; content: string; createdAt: string }>;
}

function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function redactChatText(value: string) {
  return redactComposeSecrets(redactSensitive(value));
}

export async function createAiThreadShare(threadId: number, userId: number) {
  const thread = await getAiThread(threadId, userId);
  if (!thread) throw new HttpError("Thread not found", 404);
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SHARE_TTL_MS);
  const snapshot: SharedChatSnapshot = {
    title: thread.title,
    createdAt: new Date().toISOString(),
    messages: thread.messages
      .filter((message) => message.role === "user" || message.role === "assistant")
      .map((message) => ({
        role: message.role as "user" | "assistant",
        content: redactChatText(message.content),
        createdAt: message.createdAt.toISOString(),
      })),
  };
  await prisma.aiThreadShare.deleteMany({
    where: {
      OR: [
        { expiresAt: { lt: new Date() } },
        { revokedAt: { not: null }, createdAt: { lt: new Date(Date.now() - SHARE_TTL_MS) } },
      ],
    },
  });
  await prisma.aiThreadShare.create({
    data: {
      threadId,
      tokenHash: hashToken(token),
      snapshotJson: JSON.stringify(snapshot),
      expiresAt,
    },
  });
  return { token, expiresAt };
}

export async function revokeAiThreadShares(threadId: number, userId: number) {
  const thread = await prisma.aiThread.findFirst({ where: { id: threadId, userId }, select: { id: true } });
  if (!thread) throw new HttpError("Thread not found", 404);
  return prisma.aiThreadShare.updateMany({
    where: { threadId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

export async function resolveAiThreadShare(token: string): Promise<SharedChatSnapshot | null> {
  if (!/^[A-Za-z0-9_-]{32,128}$/.test(token)) return null;
  const share = await prisma.aiThreadShare.findUnique({ where: { tokenHash: hashToken(token) } });
  if (!share || share.revokedAt || share.expiresAt.getTime() <= Date.now()) return null;
  try {
    return JSON.parse(share.snapshotJson) as SharedChatSnapshot;
  } catch {
    return null;
  }
}

export async function exportAiThread(threadId: number, userId: number, format: "markdown" | "json") {
  const thread = await getAiThread(threadId, userId);
  if (!thread) throw new HttpError("Thread not found", 404);
  const messages = thread.messages.map((message) => ({
    role: message.role,
    content: redactChatText(message.content),
    createdAt: message.createdAt.toISOString(),
    tools: message.toolCalls.map((tool) => ({
      name: tool.name,
      status: tool.status,
      readOnly: tool.readOnly,
      output: redactChatText(tool.output || ""),
    })),
  }));
  if (format === "json") {
    return JSON.stringify({
      title: thread.title,
      exportedAt: new Date().toISOString(),
      messages,
    }, null, 2);
  }

  const sections = messages.flatMap((message) => {
    const role = message.role === "user" ? "Operator" : message.role === "assistant" ? "GroundControl" : message.role;
    const toolLines = message.tools.flatMap((tool) => [
      "",
      `<details><summary>${tool.status === "error" ? "Failed" : "Tool"}: ${tool.name}</summary>`,
      "",
      "```text",
      tool.output || "(no output)",
      "```",
      "</details>",
    ]);
    return [`## ${role}`, "", message.content, ...toolLines, ""];
  });
  return [`# ${thread.title}`, "", `Exported ${new Date().toISOString()}`, "", ...sections].join("\n");
}
