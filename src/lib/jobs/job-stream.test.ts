// @vitest-environment node
import { expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
vi.mock('@/lib/auth', () => ({ requireAuth: () => ({ id: 1 }) }));
vi.mock('@/lib/prisma', () => ({ prisma: { job: { findUnique: async () => ({ output: 'first\nsecond\n', status: 'success', error: null, result: '{}' }) } } }));
import { GET } from '@/app/api/jobs/[id]/stream/route';
const request = (cursor?: string) => new NextRequest('http://localhost/api/jobs/1/stream', { headers: cursor ? { 'Last-Event-ID': cursor } : {} });
it('reconnects after the last delivered offset without duplicating logs', async () => {
  const result = await GET(request('1:6'), { params: Promise.resolve({ id: '1' }) });
  const body = await result.text();
  expect(body).toContain('id: 1:13');
  expect(body).toContain('second\\n');
  expect(body).not.toContain('first');
  expect(body).toContain('event: done');
});
it('rejects cursors from another job', async () => {
  expect((await GET(request('2:6'), { params: Promise.resolve({ id: '1' }) })).status).toBe(400);
});
it('resets a cursor beyond the available output', async () => {
  const body = await (await GET(request('1:100'), { params: Promise.resolve({ id: '1' }) })).text();
  expect(body).toContain('event: reset');
  expect(body).toContain('first\\nsecond\\n');
});
