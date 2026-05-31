import { prisma } from "./prisma";

export async function createAlert({
  title,
  message,
  severity = "info",
  source = "system",
}: {
  title: string;
  message: string;
  severity?: "info" | "warning" | "error" | "critical";
  source?: string;
}) {
  // Deduplicate: don't create the exact same alert within 1 hour
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
  const existing = await prisma.alert.findFirst({
    where: {
      title,
      message,
      severity,
      source,
      createdAt: { gte: oneHourAgo },
    },
  });

  if (!existing) {
    await prisma.alert.create({
      data: { title, message, severity, source },
    });
  }
}
