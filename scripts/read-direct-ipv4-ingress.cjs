const { isIP } = require('node:net');

// Host-admin companion only. Reads stage/evidence; never issues claims or writes DB state.
async function read(prisma, mode, enabled, now = Date.now()) {
  if (!enabled || !['staged', 'adopted'].includes(mode)) throw Error('Access unavailable');
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
    return [id, stage.ip, stage.routeKey, Math.floor(stage.expiresAt / 1000)];
  });
}
module.exports = { read };
if (require.main === module) {
  const { PrismaClient } = require('@prisma/client');
  const prisma = new PrismaClient();
  read(prisma, process.argv[2], process.env.GC_EXPERIMENTAL_DIRECT_IPV4 === '1')
    .then(fields => process.stdout.write(fields.join(' ') + '\n'))
    .catch(() => { console.error('No matching GroundControl IPv4 rehearsal state.'); process.exitCode = 1; })
    .finally(() => prisma.$disconnect());
}
