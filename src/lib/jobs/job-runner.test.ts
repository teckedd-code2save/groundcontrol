// @vitest-environment node
import { PrismaClient } from '@prisma/client';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ db: undefined as PrismaClient | undefined }));
vi.mock('@/lib/prisma', () => ({ get prisma() { return state.db!; } }));
import { appendJobOutput, createJob, getJob, runJob } from './job-runner';
const directory = mkdtempSync(join(tmpdir(), 'gc-jobs-'));
beforeAll(async () => {
  state.db = new PrismaClient({ datasources: { db: { url: `file:${join(directory, 'test.db')}` } } });
  await state.db.$executeRawUnsafe(`CREATE TABLE "Job" ("id" INTEGER PRIMARY KEY AUTOINCREMENT, "type" TEXT NOT NULL, "status" TEXT NOT NULL DEFAULT 'pending', "payload" TEXT NOT NULL, "output" TEXT NOT NULL DEFAULT '', "result" TEXT, "error" TEXT, "startedAt" DATETIME, "finishedAt" DATETIME, "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" DATETIME NOT NULL)`);
});
beforeEach(async () => { await state.db!.job.deleteMany(); });
afterAll(async () => { await state.db?.$disconnect(); rmSync(directory, { recursive: true, force: true }); });
it('preserves every concurrent log chunk in SQLite', async () => {
  const job = await createJob('build', {});
  const chunks = Array.from({ length: 50 }, (_, i) => `chunk-${i}\n`);
  await Promise.all(chunks.map((chunk) => appendJobOutput(job.id, chunk)));
  expect((await getJob(job.id))!.output.split('\n').filter(Boolean).sort()).toEqual(chunks.map((s) => s.trim()).sort());
});
it('claims a pending job once and flushes ordered logs before marking success', async () => {
  const job = await createJob('build', {});
  const runner = vi.fn(async (log: (chunk: string) => void) => { for (let i = 0; i < 30; i++) log(`${i},`); return { built: true }; });
  const results = await Promise.allSettled([runJob(job.id, runner), runJob(job.id, runner)]);
  expect(runner).toHaveBeenCalledTimes(1);
  expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
  expect(await getJob(job.id)).toMatchObject({ status: 'success', output: Array.from({ length: 30 }, (_, i) => `${i},`).join('') });
});
it('persists logs and the error before marking failure', async () => {
  const job = await createJob('build', {});
  await expect(runJob(job.id, async (log) => { log('started\n'); throw new Error('build failed'); })).rejects.toThrow('build failed');
  expect(await getJob(job.id)).toMatchObject({ status: 'failed', output: 'started\n[error] build failed\n', error: 'build failed' });
});
