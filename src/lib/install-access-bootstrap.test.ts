// @vitest-environment node
import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';
const { bootstrap } = createRequire(import.meta.url)('../../scripts/bootstrap-install-access.cjs');
function fixture(config: Record<string, string> = {}, existing = false) {
  const values: Record<string, string> = { groundcontrol_instance_id: 'gc_test', ...config };
  const appConfig = {
    findUnique: vi.fn(async ({ where }: { where: { key: string } }) => ({ value: values[where.key] })),
    create: vi.fn(async () => ({})), deleteMany: vi.fn(async () => ({})),
    upsert: vi.fn(async ({ create }: { create: { key: string; value: string } }) => { values[create.key] = create.value; }),
  };
  const prisma = { appConfig, $transaction: async (fn: (tx: unknown) => unknown) => fn({ appConfig }) };
  const docker = vi.fn((args: string[]) => {
    if (args[0] === 'ps') return existing ? 'groundcontrol-quick-tunnel' : '';
    if (args[0] === 'inspect') return '{"groundcontrol_default":{}}';
    if (args[0] === 'logs') return 'https://sample-bridge.trycloudflare.com';
    return '';
  });
  const fetchUrl = vi.fn(async () => ({ ok: true, json: async () => ({ instanceId: 'gc_test' }) }));
  return { prisma, docker, fetchUrl, sleep: vi.fn(async () => {}), values };
}
describe('host-only installation access bootstrap', () => {
  it('creates outbound bridge and persists only verified exact-instance HTTPS', async () => {
    const f = fixture();
    expect(await bootstrap(f)).toMatchObject({ publicUrl: 'https://sample-bridge.trycloudflare.com', accessMode: 'quick_tunnel' });
    expect(f.docker).toHaveBeenCalledWith(expect.arrayContaining(['--network', 'groundcontrol_default']));
    expect(f.values.groundcontrol_public_url).toContain('https://');
  });
  it('preserves explicit private mode without Docker or network access', async () => {
    const f = fixture({ groundcontrol_publish_mode: 'private' });
    expect((await bootstrap(f)).accessStatus).toBe('private');
    expect(f.docker).not.toHaveBeenCalled(); expect(f.fetchUrl).not.toHaveBeenCalled();
  });
  it('persists explicit private intent only without existing access', async () => {
    const f = fixture(); await bootstrap({ ...f, privateOnly: true });
    expect(f.values.groundcontrol_publish_mode).toBe('private');
    expect(f.docker).not.toHaveBeenCalled();
    const published = fixture({ groundcontrol_public_url: 'https://gc.example.com', groundcontrol_publish_mode: 'caddy' });
    await bootstrap({ ...published, privateOnly: true });
    expect(published.prisma.appConfig.upsert).not.toHaveBeenCalled();
  });
  it('reuses verified permanent access without creating a connector', async () => {
    const f = fixture({ groundcontrol_publish_mode: 'caddy', groundcontrol_public_url: 'https://gc.example.com' });
    expect((await bootstrap(f)).accessMode).toBe('permanent'); expect(f.docker).not.toHaveBeenCalled();
  });
  it('never rotates an existing quick connector, including recovery before URL save', async () => {
    const f = fixture({}, true); await bootstrap(f);
    expect(f.docker.mock.calls.some(([args]) => ['run', 'rm', 'restart'].includes(args[0]))).toBe(false);
  });
  it('rejects a different public instance without saving or tearing down access', async () => {
    const f = fixture(); f.fetchUrl.mockResolvedValue({ ok: true, json: async () => ({ instanceId: 'wrong' }) });
    await expect(bootstrap(f)).rejects.toThrow('could not be verified');
    expect(f.prisma.appConfig.upsert).not.toHaveBeenCalled();
    expect(f.docker.mock.calls.some(([args]) => args[0] === 'rm')).toBe(false);
  });
  it('retains unverified saved access rather than replacing it', async () => {
    const f = fixture({ groundcontrol_public_url: 'https://old.example.com' });
    f.fetchUrl.mockRejectedValue(new Error('offline'));
    await expect(bootstrap(f)).rejects.toThrow('not changed'); expect(f.docker).not.toHaveBeenCalled();
  });
  it('does not overwrite settings changed by the owner during verification', async () => {
    const f = fixture();
    f.fetchUrl.mockImplementation(async () => {
      f.values.groundcontrol_publish_mode = 'private';
      return { ok: true, json: async () => ({ instanceId: 'gc_test' }) };
    });
    await expect(bootstrap(f)).rejects.toThrow('settings changed');
    expect(f.prisma.appConfig.upsert).not.toHaveBeenCalled();
  });
  it('rejects saved URLs with credentials before sending a request', async () => {
    const f = fixture({ groundcontrol_public_url: 'https://user:secret@gc.example.com' });
    await expect(bootstrap(f)).rejects.toThrow('not changed');
    expect(f.fetchUrl).not.toHaveBeenCalled();
  });

});
