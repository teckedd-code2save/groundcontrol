const { test } = require('node:test');
const assert = require('node:assert/strict');
const { verifyAccess, bootstrap, safeDiagnostic } = require('./bootstrap-install-access.cjs');
const url = 'https://sample.trycloudflare.com';
function fixture() {
  let elapsed = 0;
  let calls = 0;
  const deps = {
    resolveUrl: () => url, instanceId: 'gc_local',
    now: () => elapsed, sleep: async ms => { elapsed += ms; },
    fetchUrl: async () => { calls++; return { ok: true, json: async () => ({ instanceId: 'gc_local' }) }; },
  };
  return { deps, advance: ms => { elapsed += ms; }, elapsed: () => elapsed, calls: () => calls };
}
test('waits for connector URL and transient DNS propagation', async () => {
  const f = fixture(); let probes = 0;
  f.deps.resolveUrl = () => ++probes < 3 ? '' : url;
  const success = f.deps.fetchUrl;
  f.deps.fetchUrl = async () => { if (probes < 5) throw { cause: { code: 'EAI_AGAIN' } }; return success(); };
  assert.equal(await verifyAccess(f.deps), url); assert.equal(f.elapsed(), 8000);
});
test('budget includes fetch duration and ends at 120 seconds', async () => {
  const f = fixture(); let attempts = 0;
  f.deps.fetchUrl = async ({}, options) => {
    assert.ok(options.signal); attempts++; f.advance(8000); throw { name: 'TimeoutError' };
  };
  await assert.rejects(verifyAccess(f.deps), /request timed out/);
  assert.equal(f.elapsed(), 120000); assert.equal(attempts, 12);
});
for (const [error, label] of [
  [{ cause: { code: 'ENOTFOUND' } }, 'DNS lookup failed'],
  [{ cause: { code: 'CERT_HAS_EXPIRED' } }, 'TLS verification failed'],
  [{ name: 'TimeoutError' }, 'request timed out'],
  [new Error('private-token-secret'), 'network connection failed'],
]) test(`safe diagnostic: ${label}`, async () => {
  const f = fixture(); f.deps.fetchUrl = async () => { throw error; };
  await assert.rejects(verifyAccess(f.deps), e => {
    assert.match(safeDiagnostic(e), new RegExp(label)); assert.doesNotMatch(safeDiagnostic(e), /private-token-secret/); return true;
  });
});
test('reports HTTP status without reading response content and retries', async () => {
  const f = fixture(); let canceled = 0;
  f.deps.fetchUrl = async () => ({ ok: false, status: 530, body: { cancel: async () => { canceled++; } }, json: () => { throw new Error('must not read'); } });
  await assert.rejects(verifyAccess(f.deps), /HTTP 530/); assert.equal(canceled, 60);
});
test('identity mismatch fails immediately and never includes identity/body values', async () => {
  const f = fixture(); f.deps.fetchUrl = async () => ({ ok: true, json: async () => ({ instanceId: 'gc_foreign_secret' }) });
  await assert.rejects(verifyAccess(f.deps), e => { assert.match(e.message, /identity mismatch/); assert.doesNotMatch(e.message, /foreign_secret/); return true; });
  assert.equal(f.elapsed(), 0);
});
test('existing saved URL receives retries without Docker or config changes', async () => {
  const f = fixture(); let attempts = 0;
  const success = f.deps.fetchUrl;
  f.deps.fetchUrl = async () => { if (++attempts < 4) throw { cause: { code: 'ENOTFOUND' } }; return success(); };
  const config = { groundcontrol_instance_id: 'gc_local', groundcontrol_public_url: url, groundcontrol_publish_mode: 'quick_tunnel' };
  const prisma = { appConfig: { findUnique: async ({ where }) => ({ value: config[where.key] }) } };
  const result = await bootstrap({ ...f.deps, prisma, docker: () => assert.fail('must preserve existing connector') });
  assert.equal(result.publicUrl, url); assert.equal(result.accessChanged, false); assert.equal(attempts, 4);
});
test('unknown setup errors remain sanitized', () => {
  assert.doesNotMatch(safeDiagnostic(new Error('private-token-secret')), /private-token-secret/);
});

for (const body of [null, false]) test(`invalid successful JSON ${body} has accurate diagnostic`, async () => {
  const f = fixture(); f.deps.fetchUrl = async () => ({ ok: true, json: async () => body });
  await assert.rejects(verifyAccess(f.deps), /invalid identity response/);
});
test('connector lookup receives only remaining deadline budget', async () => {
  const f = fixture(); const budgets = [];
  f.deps.resolveUrl = budget => { budgets.push(budget); f.advance(budget); return ''; };
  await assert.rejects(verifyAccess(f.deps), /connector URL not available/);
  assert.equal(f.elapsed(), 120000); assert.equal(budgets.at(-1), 1000);
});
