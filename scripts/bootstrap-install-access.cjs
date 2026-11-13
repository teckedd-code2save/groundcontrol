#!/usr/bin/env node
// Host-admin only: invoked via docker exec by the canonical installer, never an HTTP API.
const NAME = 'groundcontrol-quick-tunnel';
const URL_KEY = 'groundcontrol_public_url';
const MODE_KEY = 'groundcontrol_publish_mode';
// Only these locally authored diagnostics may reach stderr. Never print provider bodies/errors.
class AccessVerificationError extends Error {
  constructor(reason) {
    super(`Public HTTPS could not be verified (${reason}). Existing access was not changed; connector retained. Rerun to recover or use --private.`);
    this.reason = reason;
  }
}
function networkReason(error) {
  const code = error?.cause?.code || error?.code;
  if (['ENOTFOUND', 'EAI_AGAIN'].includes(code)) return 'DNS lookup failed';
  if (['TimeoutError', 'AbortError'].includes(error?.name) || ['ETIMEDOUT', 'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_HEADERS_TIMEOUT', 'UND_ERR_BODY_TIMEOUT'].includes(code)) return 'request timed out';
  if (typeof code === 'string' && /CERT|TLS|SSL/.test(code)) return 'TLS verification failed';
  return 'network connection failed';
}
function safeDiagnostic(error) {
  return error instanceof AccessVerificationError ? error.message : 'Temporary/public HTTPS setup failed. Existing access was not rotated. Inspect the connector or rerun installer with --private.';
}
async function verifyAccess({ resolveUrl, instanceId, fetchUrl = fetch, sleep = ms => new Promise(r => setTimeout(r, ms)), now = Date.now }) {
  const deadline = now() + 120000;
  let reason = 'connector URL not available';
  // Attempt cap also bounds tests/nonstandard clocks; wall-clock deadline includes fetch and sleep.
  for (let attempt = 0; attempt < 60 && now() < deadline; attempt++) {
    const url = resolveUrl(Math.max(1, Math.min(5000, deadline - now())));
    if (url) {
      try {
        const parsed = new URL(url);
        if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.origin !== url) throw new Error();
      } catch { throw new AccessVerificationError('invalid HTTPS origin'); }
      if (now() >= deadline) break;
      try {
        const response = await fetchUrl(`${url}/api/auth/claim`, { redirect: 'manual', cache: 'no-store', signal: AbortSignal.timeout(Math.max(1, Math.min(8000, deadline - now()))) });
        if (!response.ok) {
          reason = Number.isInteger(response.status) && response.status >= 100 && response.status <= 599 ? `HTTP ${response.status}` : 'HTTP response rejected';
          await response.body?.cancel();
        } else {
          let body;
          try { body = await response.json(); } catch (error) {
            if (error?.name === 'TimeoutError' || error?.name === 'AbortError') throw error;
            reason = 'invalid identity response';
          }
          if (!body) reason = 'invalid identity response';
          if (body) {
            if (body.instanceId !== instanceId) throw new AccessVerificationError('instance identity mismatch');
            return url;
          }
        }
      } catch (error) {
        if (error instanceof AccessVerificationError) throw error;
        reason = networkReason(error);
      }
    }
    const remaining = deadline - now();
    if (remaining > 0 && attempt < 59) await sleep(Math.min(2000, remaining));
  }
  throw new AccessVerificationError(reason);
}
async function bootstrap({ prisma, docker, privateOnly = false, fetchUrl = fetch, sleep = (ms) => new Promise(r => setTimeout(r, ms)), now = Date.now }) {
  const get = async key => (await prisma.appConfig.findUnique({ where: { key } }))?.value || '';
  const id = await get('groundcontrol_instance_id');
  if (!id) throw new Error('Instance identity missing. Run the claim initializer first.');
  const oldUrl = await get(URL_KEY);
  const oldMode = await get(MODE_KEY);
  if (privateOnly || oldMode === 'private') {
    if (privateOnly && !oldMode && !oldUrl) await prisma.appConfig.upsert({ where: { key: MODE_KEY }, create: { key: MODE_KEY, value: 'private' }, update: {} });
    return { publicUrl: '', accessMode: 'private', accessStatus: 'private', accessChanged: privateOnly && !oldMode && !oldUrl };
  }
  if (oldUrl) {
    await verifyAccess({ resolveUrl: () => oldUrl, instanceId: id, fetchUrl, sleep, now });
    return { publicUrl: oldUrl, accessMode: oldMode === 'quick_tunnel' ? 'quick_tunnel' : 'permanent', accessStatus: 'ready', accessChanged: false };
  }
  if (oldMode && oldMode !== 'quick_tunnel') throw new Error('Existing publishing configuration needs inspection; no temporary access was created.');
  const names = docker(['ps', '-a', '--format', '{{.Names}}']).trim().split('\n');
  if (!names.includes(NAME)) {
    const networks = JSON.parse(docker(['inspect', 'groundcontrol-web', '--format', '{{json .NetworkSettings.Networks}}']));
    const network = Object.keys(networks).find(n => n !== 'host' && n !== 'none');
    if (!network) throw new Error('GroundControl Docker network unavailable.');
    docker(['run', '-d', '--name', NAME, '--restart', 'no', '--network', network,
      'cloudflare/cloudflared:latest', 'tunnel', '--no-autoupdate', '--url', 'http://groundcontrol-web:3000']);
  }
  // Never remove/restart an existing connector. Recover its URL on interrupted installs.
  const publicUrl = await verifyAccess({
    resolveUrl: (timeout) => {
      const logs = docker(['logs', '--tail', '100', NAME], { timeout });
      return logs.match(/https:\/\/[A-Za-z0-9-]+\.trycloudflare\.com/g)?.at(-1) || '';
    },
    instanceId: id, fetchUrl, sleep, now,
  });
  await prisma.$transaction(async tx => {
    const currentUrl = (await tx.appConfig.findUnique({ where: { key: URL_KEY } }))?.value || '';
    const currentMode = (await tx.appConfig.findUnique({ where: { key: MODE_KEY } }))?.value || '';
    if (currentUrl !== oldUrl || currentMode !== oldMode) throw new Error('Publishing settings changed during bootstrap. Existing settings preserved; inspect access before retrying.');
    for (const [key, value] of [[URL_KEY, publicUrl], [MODE_KEY, 'quick_tunnel']]) {
      await tx.appConfig.upsert({ where: { key }, create: { key, value }, update: { value } });
    }
  });
  return { publicUrl, accessMode: 'quick_tunnel', accessStatus: 'ready', accessChanged: true };
}
module.exports = { bootstrap, verifyAccess, safeDiagnostic };
if (require.main === module) {
  const { PrismaClient } = require('@prisma/client');
  const prisma = new PrismaClient();
  const docker = (args, options = {}) => {
    // cloudflared writes its assigned URL to stderr; capture both, never relay logs.
    const { spawnSync } = require('node:child_process');
    const result = spawnSync('docker', args, { encoding: 'utf8', timeout: options.timeout || 120000, maxBuffer: 1024 * 1024 });
    if (result.error || result.status !== 0) throw new Error(`Docker ${args[0]} failed; inspect the host and retry.`);
    return `${result.stdout || ''}${result.stderr || ''}`;
  };
  bootstrap({ prisma, docker, privateOnly: process.argv.includes('--private') }).then(result => process.stdout.write(JSON.stringify(result) + '\n'))
    .catch(error => { console.error(safeDiagnostic(error)); process.exitCode = 1; })
    .finally(() => prisma.$disconnect());
}
