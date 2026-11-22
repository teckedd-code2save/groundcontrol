const { isIP } = require('node:net');
const { createHmac, timingSafeEqual } = require('node:crypto');

// Host-admin companion only. Reads stage/evidence; never issues claims or writes DB state.
async function read(prisma, mode, enabled, now = Date.now(), proof = '') {
  if (!enabled || !['staged', 'challenge', 'adopted', 'trial'].includes(mode)) throw Error('Access unavailable');
  return prisma.$transaction(async tx => {
    const value = async key => (await tx.appConfig.findUnique({where:{key}}))?.value || '';
    const id = await value('groundcontrol_instance_id');
    if (!/^gc_[a-zA-Z0-9-]{1,80}$/.test(id) || !await tx.user.count() ||
        await tx.installClaim.count({where:{status:'active',expiresAt:{gt:new Date(now)}}})) throw Error('Claim required');
    const url = await value('groundcontrol_public_url');
    const access = await value('groundcontrol_publish_mode');
    if (mode === 'adopted') {
      const evidence = JSON.parse(await value('groundcontrol_direct_ipv4_evidence') || 'null');
      const ip = /^https:\/\/([0-9.]+)$/.exec(url)?.[1];
      if (access !== 'direct_ipv4' || !ip || isIP(ip) !== 4 || url !== evidence?.publicUrl || !Number.isFinite(Date.parse(evidence?.checkedAt))) throw Error('Proof required');
      return [id, ip];
    }
    const stage = JSON.parse(await value('groundcontrol_direct_ipv4_stage') || 'null');
    const admin = stage && await tx.user.findUnique({where:{id:stage.adminId},select:{role:true}});
    if (stage?.instanceId !== id || !Number.isSafeInteger(stage?.expiresAt) || stage.expiresAt <= now ||
        stage.expiresAt > now + 30 * 60_000 || admin?.role !== 'admin' ||
        stage.priorUrl !== url || stage.priorMode !== access ||
        !['', 'private', 'quick_tunnel'].includes(access) ||
        (url && !/^https:\/\/[a-z0-9-]+\.trycloudflare\.com$/i.test(url)) ||
        isIP(stage.ip) !== 4 || !/^[a-f0-9]{64}$/.test(stage.routeKey)) throw Error('Live stage required');
    let expected;
    if (mode === 'trial') {
      if (stage.guidedTrial !== true || !/^[a-f0-9]{64}$/.test(proof) || !/^[a-f0-9]{64}$/.test(stage.signingKey)) throw Error('Proof required');
      expected = createHmac('sha256', Buffer.from(stage.signingKey, 'hex'))
        .update(JSON.stringify([stage.ip, stage.instanceId, stage.adminId, stage.challenge, stage.expiresAt])).digest();
      if (!timingSafeEqual(expected, Buffer.from(proof, 'hex'))) throw Error('Proof does not match stage');
    }
    if (mode === 'challenge') {
      if (!/^[a-f0-9]{64}$/.test(stage.challenge)) throw Error('Live challenge required');
      return [id, stage.ip, stage.challenge, Math.floor(stage.expiresAt / 1000)];
    }
    return [id, stage.ip, stage.routeKey, Math.floor(stage.expiresAt / 1000)];
  });
}
module.exports = { read };
if (require.main === module) {
  const { PrismaClient } = require('@prisma/client');
  const prisma = new PrismaClient();
  const mode = process.argv[2];
  // Only the host-admin helper supplies the probe proof as a bounded stdin field.
  let proof = '';
  if (mode === 'trial') {
    const buffer = Buffer.alloc(66);
    const fs = require('node:fs');
    let n = 0;
    while (n < buffer.length) {
      const received = fs.readSync(0, buffer, n, buffer.length - n, null);
      if (!received) break;
      n += received;
      if (buffer.subarray(0, n).includes(10)) break;
    }
    const line = buffer.subarray(0, n).toString();
    proof = /^[a-f0-9]{64}\n$/.test(line) ? line.slice(0, 64) : '';
  }
  read(prisma, mode, (process.env.GC_EXPERIMENTAL_DIRECT_IPV4 === '1' || process.env.GC_INSTALLER_GUIDED_IPV4 === '1'), Date.now(), proof)
    .then(fields => process.stdout.write(fields.join(' ') + '\n'))
    .catch(() => { console.error('No matching GroundControl IPv4 rehearsal state.'); process.exitCode = 1; })
    .finally(() => prisma.$disconnect());
}
