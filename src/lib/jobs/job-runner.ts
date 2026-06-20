/**
 * Lightweight SQLite-backed job queue.
 *
 * Jobs are persisted in Prisma so logs survive page refreshes and the UI can
 * poll for real-time output. For now jobs run synchronously in the request
 * worker; a background worker process can be added later without changing the
 * public interface.
 */

import { prisma } from "@/lib/prisma";

export type JobType = "deploy" | "build" | "rollback" | "terraform_apply";
export type JobStatus = "pending" | "running" | "success" | "failed" | "cancelled";

export interface JobPayload {
  projectId?: number;
  targetId?: number;
  deploymentId?: number;
  stackId?: number;
  branch?: string;
  generatePreviewUrl?: boolean;
  subdomain?: string;
  zoneId?: string;
  proxied?: boolean;
  configOverrides?: Record<string, unknown>;
  idempotencyKey?: string;
  [key: string]: unknown;
}

export async function createJob(type: JobType, payload: JobPayload) {
  return prisma.job.create({
    data: {
      type,
      status: "pending",
      payload: JSON.stringify(payload),
      output: "",
    },
  });
}

export async function getJob(id: number) {
  return prisma.job.findUnique({ where: { id } });
}

export async function appendJobOutput(id: number, chunk: string) {
  if (!chunk) return;
  const job = await prisma.job.findUnique({ where: { id }, select: { output: true } });
  if (!job) return;
  await prisma.job.update({
    where: { id },
    data: {
      output: (job.output || "") + chunk,
    },
  });
}

export async function setJobRunning(id: number) {
  return prisma.job.update({
    where: { id },
    data: {
      status: "running",
      startedAt: new Date(),
    },
  });
}

export async function setJobSuccess(id: number, result?: Record<string, unknown>) {
  return prisma.job.update({
    where: { id },
    data: {
      status: "success",
      result: result ? JSON.stringify(result) : null,
      finishedAt: new Date(),
    },
  });
}

export async function setJobFailed(id: number, error: string) {
  return prisma.job.update({
    where: { id },
    data: {
      status: "failed",
      error,
      finishedAt: new Date(),
    },
  });
}

export async function appendAndUpdateJob(
  id: number,
  chunk: string,
  status?: JobStatus
) {
  const job = await prisma.job.findUnique({ where: { id }, select: { output: true } });
  const data: Record<string, unknown> = {};
  if (chunk) data.output = (job?.output || "") + chunk;
  if (status) data.status = status;
  if (status === "running" && !data.startedAt) data.startedAt = new Date();
  if ((status === "success" || status === "failed" || status === "cancelled") && !data.finishedAt) {
    data.finishedAt = new Date();
  }
  return prisma.job.update({ where: { id }, data });
}

/**
 * Wrap a runner function with job lifecycle management.
 * The runner receives a logger that appends to the job output.
 */
export async function runJob<T>(
  jobId: number,
  runner: (log: (chunk: string) => void) => Promise<T>
): Promise<T> {
  await setJobRunning(jobId);
  const log = (chunk: string) => {
    // Fire-and-forget; failures are logged but don't crash the runner.
    appendJobOutput(jobId, chunk).catch((err) => {
      console.error(`[job-runner] failed to append output for job ${jobId}`, err);
    });
  };

  try {
    const result = await runner(log);
    await setJobSuccess(jobId, result as Record<string, unknown>);
    return result;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log(`[error] ${message}\n`);
    await setJobFailed(jobId, message);
    throw err;
  }
}

export function parseJobPayload<T = JobPayload>(job: { payload: string }): T {
  try {
    return JSON.parse(job.payload) as T;
  } catch {
    return {} as T;
  }
}
