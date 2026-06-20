import { NextRequest } from "next/server";
import { requireAuth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { handleApiError } from "@/lib/errors";

export const dynamic = "force-dynamic";

const TERMINAL_STATUSES = new Set(["success", "failed", "cancelled"]);

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireAuth(req);
    const { id } = await params;
    const jobId = parseInt(id, 10);
    if (!Number.isFinite(jobId)) {
      return new Response("Invalid job id", { status: 400 });
    }

    const encoder = new TextEncoder();
    let lastOutputLength = 0;
    let closed = false;

    req.signal.addEventListener("abort", () => {
      closed = true;
    });

    const stream = new ReadableStream({
      async start(controller) {
        controller.enqueue(encoder.encode("event: connected\ndata: {}\n\n"));

        while (!closed) {
          try {
            const job = await prisma.job.findUnique({
              where: { id: jobId },
              select: { output: true, status: true, error: true, result: true },
            });
            if (!job) {
              controller.enqueue(encoder.encode("event: error\ndata: {\"error\":\"Job not found\"}\n\n"));
              controller.close();
              return;
            }

            const currentOutput = job.output || "";
            if (currentOutput.length > lastOutputLength) {
              const delta = currentOutput.slice(lastOutputLength);
              lastOutputLength = currentOutput.length;
              const payload = JSON.stringify({ delta, status: job.status, error: job.error });
              controller.enqueue(encoder.encode(`event: log\ndata: ${payload}\n\n`));
            }

            if (TERMINAL_STATUSES.has(job.status)) {
              const payload = JSON.stringify({
                status: job.status,
                error: job.error,
                result: job.result,
              });
              controller.enqueue(encoder.encode(`event: done\ndata: ${payload}\n\n`));
              controller.close();
              return;
            }

            await new Promise((resolve) => setTimeout(resolve, 1000));
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            controller.enqueue(encoder.encode(`event: error\ndata: ${JSON.stringify({ error: message })}\n\n`));
            controller.close();
            return;
          }
        }
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
      },
    });
  } catch (err: unknown) {
    return handleApiError(err);
  }
}
