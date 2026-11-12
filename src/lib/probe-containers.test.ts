// @vitest-environment node
import { expect, it, vi } from 'vitest';
const exec = vi.hoisted(() => vi.fn());
vi.mock('./host-exec', () => ({ execOnTarget: exec }));
import { probeContainers } from './probe-containers';
it('accepts an honestly empty inventory', async () => {
  exec.mockResolvedValue({ code: 0, stdout: '', stderr: '' });
  expect(await probeContainers()).toEqual([]);
});
it('surfaces unavailable Docker rather than a false empty inventory', async () => {
  exec.mockResolvedValue({ code: 1, stdout: '', stderr: 'Cannot connect to the Docker daemon' });
  await expect(probeContainers()).rejects.toMatchObject({ status: 503, message: expect.stringContaining('Docker is not reachable') });
  expect(exec.mock.calls.at(-1)?.[0]).not.toContain('||');
});
it('surfaces malformed discovery output', async () => {
  exec.mockResolvedValue({ code: 0, stdout: '{broken', stderr: '' });
  await expect(probeContainers()).rejects.toThrow('unreadable discovery results');
});
