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
    const jobId = Number(id);
    if (!Number.isSafeInteger(jobId) || jobId <= 0) {
      return new Response("Invalid job id", { status: 400 });
    }

    const cursor = req.headers.get("last-event-id");
    let lastOutputLength = 0;
    if (cursor) {
      const match = /^(\d+):(\d+)$/.exec(cursor);
      if (!match || Number(match[1]) !== jobId || !Number.isSafeInteger(Number(match[2]))) {
        return new Response("Invalid job stream cursor", { status: 400 });
      }
      lastOutputLength = Number(match[2]);
    }
    const encoder = new TextEncoder();
    let stopped = req.signal.aborted;
    let cancelled = false;
    const abort = () => { stopped = true; };
    req.signal.addEventListener("abort", abort);

    const stream = new ReadableStream({
      async start(controller) {
        const send = (event: string, data: unknown, cursorId?: string) => {
          if (!stopped) controller.enqueue(encoder.encode(
            `${cursorId ? `id: ${cursorId}\n` : ""}event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
          ));
        };
        try {
          send("connected", {});
          while (!stopped) {
            const job = await prisma.job.findUnique({
              where: { id: jobId },
              select: { output: true, status: true, error: true, result: true },
            });
            if (stopped) break;
            if (!job) { send("error", { error: "Job not found" }); break; }
            const currentOutput = job.output || "";
            if (lastOutputLength > currentOutput.length) {
              lastOutputLength = 0;
              send("reset", {}, `${jobId}:0`);
            }
            if (currentOutput.length > lastOutputLength) {
              const delta = currentOutput.slice(lastOutputLength);
              lastOutputLength = currentOutput.length;
              send("log", { delta, status: job.status, error: job.error }, `${jobId}:${lastOutputLength}`);
            }
            if (TERMINAL_STATUSES.has(job.status)) {
              send("done", { status: job.status, error: job.error, result: job.result }, `${jobId}:${lastOutputLength}`);
              break;
            }
            await new Promise((resolve) => setTimeout(resolve, 1000));
          }
        } catch (err) {
          console.error("[job-stream]", err);
          send("error", { error: "Unable to read job output" });
        } finally {
          req.signal.removeEventListener("abort", abort);
          if (!cancelled) controller.close();
        }
      },
      cancel() { cancelled = true; stopped = true; },
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
