// @vitest-environment node
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mock = vi.hoisted(() => ({ role: 'admin', user: true, targetExists: true, exec: vi.fn() }));
vi.mock('@/lib/auth', () => ({ requireAuth: () => { if (!mock.user) throw new Error('Unauthorized'); return { id: 1 }; } }));
vi.mock('@/lib/prisma', () => ({ prisma: {
  user: { findUnique: async () => ({ role: mock.role }) },
  vpsConfig: { findUnique: async ({ where }: { where: { id: number } }) => mock.targetExists ? { id: where.id, host: 'pinned.example', port: 22, username: 'ops', isLocal: false } : null },
} }));
vi.mock('@/lib/host-exec', () => ({ execOnTargetStrict: mock.exec }));
import { parseTerminalOutput, wrapTerminalCommand } from './terminal-execution';
import { POST } from '@/app/api/terminal/route';
const root = mkdtempSync(join(tmpdir(), 'gc-terminal-'));
mkdirSync(join(root, 'quoted dir'));
afterAll(() => rmSync(root, { recursive: true, force: true }));
beforeEach(() => { mock.role = 'admin'; mock.user = true; mock.targetExists = true; mock.exec.mockReset(); });

describe('terminal shell semantics', () => {
  it('executes the part after cd and returns the actual directory without stripping output', () => {
    const script = wrapTerminalCommand("cd 'quoted dir' && printf 'ran'", root);
    const output = execFileSync('sh', ['-c', script.command], { encoding: 'utf8' });
    expect(parseTerminalOutput(output, script.marker)).toEqual({ stdout: 'ran', cwd: join(root, 'quoted dir') });
  });
  it('preserves command exit status and refuses an invalid starting directory', () => {
    const fail = wrapTerminalCommand('false', root);
    expect(spawnSync('sh', ['-c', fail.command]).status).toBe(1);
    const missing = wrapTerminalCommand("printf 'should-not-run'", join(root, 'missing'));
    const result = spawnSync('sh', ['-c', missing.command], { encoding: 'utf8' });
    expect(result.status).not.toBe(0);
    expect(result.stdout).not.toContain('should-not-run');
    expect(parseTerminalOutput(result.stdout, missing.marker).cwd).toBeUndefined();
  });
  it('does not invent a directory when an explicit exit bypasses the marker', () => {
    const script = wrapTerminalCommand('exit 7', root);
    const result = spawnSync('sh', ['-c', script.command], { encoding: 'utf8' });
    expect(result.status).toBe(7);
    expect(parseTerminalOutput(result.stdout, script.marker).cwd).toBeUndefined();
  });
});
const request = (body: unknown) => new NextRequest('http://localhost/api/terminal', { method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } });
describe('terminal request boundary', () => {
  it('rejects unauthenticated and revoked administrator access before execution', async () => {
    mock.user = false;
    expect((await POST(request({ command: 'pwd', vpsId: 7 }))).status).toBe(401);
    mock.user = true; mock.role = 'viewer';
    expect((await POST(request({ command: 'pwd', vpsId: 7 }))).status).toBe(403);
    expect(mock.exec).not.toHaveBeenCalled();
  });
  it('requires a saved explicit target and fails if it disappeared', async () => {
    expect((await POST(request({ command: 'pwd' }))).status).toBe(400);
    mock.targetExists = false;
    expect((await POST(request({ command: 'pwd', vpsId: 7 }))).status).toBe(409);
    expect(mock.exec).not.toHaveBeenCalled();
  });
  it('pins execution to the requested server and preserves explicit bash commands', async () => {
    mock.exec.mockImplementation(async (command: string) => ({ stdout: execFileSync('sh', ['-c', command], { encoding: 'utf8' }), stderr: '', code: 0 }));
    const response = await POST(request({ command: "cd 'quoted dir' && bash -c 'printf \"%s\" \"${BASH_VERSION:+bash}\"'", cwd: root, vpsId: 7 }));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ stdout: 'bash', cwd: join(root, 'quoted dir'), vpsId: 7 });
    expect(mock.exec.mock.calls[0][1]).toMatchObject({ id: 7, host: 'pinned.example' });
  });
});
