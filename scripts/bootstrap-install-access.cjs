#!/usr/bin/env node
// Host-admin only: invoked via docker exec by the canonical installer, never an HTTP API.
const NAME = 'groundcontrol-quick-tunnel';
const URL_KEY = 'groundcontrol_public_url';
const MODE_KEY = 'groundcontrol_publish_mode';
async function bootstrap({ prisma, docker, privateOnly = false, fetchUrl = fetch, sleep = (ms) => new Promise(r => setTimeout(r, ms)) }) {
  const get = async key => (await prisma.appConfig.findUnique({ where: { key } }))?.value || '';
  const id = await get('groundcontrol_instance_id');
  if (!id) throw new Error('Instance identity missing. Run the claim initializer first.');
  const oldUrl = await get(URL_KEY);
  const oldMode = await get(MODE_KEY);
  if (privateOnly || oldMode === 'private') {
    if (privateOnly && !oldMode && !oldUrl) await prisma.appConfig.upsert({ where: { key: MODE_KEY }, create: { key: MODE_KEY, value: 'private' }, update: {} });
    return { publicUrl: '', accessMode: 'private', accessStatus: 'private', accessChanged: privateOnly && !oldMode && !oldUrl };
  }
  async function verify(url) {
    try {
      const parsed = new URL(url);
      if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.origin !== url) return false;
    } catch { return false; }
    try {
      const response = await fetchUrl(`${url}/api/auth/claim`, { redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(8000) });
      return response.ok && (await response.json()).instanceId === id;
    } catch { return false; }
  }
  if (oldUrl) {
    if (!await verify(oldUrl)) throw new Error('Saved public access could not be verified. It was not changed. Inspect it or rerun with --private.');
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
  let publicUrl = '';
  for (let attempt = 0; attempt < 30; attempt++) {
    const logs = docker(['logs', '--tail', '100', NAME]);
    publicUrl = logs.match(/https:\/\/[A-Za-z0-9-]+\.trycloudflare\.com/g)?.at(-1) || '';
    if (publicUrl && await verify(publicUrl)) break;
    publicUrl = '';
    await sleep(2000);
  }
  if (!publicUrl) throw new Error('Temporary HTTPS could not be verified. Connector retained for inspection; rerun to recover or use --private.');
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
module.exports = { bootstrap };
if (require.main === module) {
  const { PrismaClient } = require('@prisma/client');
  const prisma = new PrismaClient();
  const docker = args => {
    // cloudflared writes its assigned URL to stderr; capture both, never relay logs.
    const { spawnSync } = require('node:child_process');
    const result = spawnSync('docker', args, { encoding: 'utf8', timeout: 120000, maxBuffer: 1024 * 1024 });
    if (result.error || result.status !== 0) throw new Error(`Docker ${args[0]} failed; inspect the host and retry.`);
    return `${result.stdout || ''}${result.stderr || ''}`;
  };
  bootstrap({ prisma, docker, privateOnly: process.argv.includes('--private') }).then(result => process.stdout.write(JSON.stringify(result) + '\n'))
    .catch(() => { console.error('Temporary/public HTTPS could not be verified. Existing access was not rotated. Inspect the connector or rerun installer with --private for private access.'); process.exitCode = 1; })
    .finally(() => prisma.$disconnect());
}
