const {test} = require('node:test');
const assert = require('node:assert/strict');
const {spawnSync} = require('node:child_process');
const {mkdtempSync,writeFileSync,readFileSync,existsSync,rmSync} = require('node:fs');
const {tmpdir} = require('node:os');
const {join} = require('node:path');
const {read} = require('./read-direct-ipv4-ingress.cjs');
const h = join(__dirname,'direct-ipv4-ingress');
const shell = [
  'set -euo pipefail',
  'source "$HELPER"',
  'owned_dir="$FIXTURE/owned"; unit_file="$FIXTURE/unit"; slot_lock="$FIXTURE/lock"; cert_owner="$FIXTURE/cert-owner"',
  'cert_path="$FIXTURE/cert"; cert_private="$FIXTURE/cert-private"',
  'id() { printf "0\\n"; }',
  'trusted_caddy() { [ "$NO_HOST_CADDY" = no ] || return 1; printf "%s\\n" "${1:-$HOST_CADDY}"; }',
  'managed_caddy="$FIXTURE/gc-caddy";',
  'prepare_managed_caddy() { printf "prepared\\n" >> "$FIXTURE/caddy-ops"; [ "$FAIL_CADDY" = no ] || return 1; printf "%s\\n" "$managed_caddy"; }',
  'verified_managed_caddy() { [ "$FAIL_CADDY" = no ] || return 1; printf "%s\\n" "$managed_caddy"; }',
  'stat() { command stat -c "$2" "$3" | sed -E "s/^[0-9]+:[0-9]+:/0:0:/"; }',
  'app_state() { if [ "$1" = trial ]; then IFS= read -r receipt; [ "$receipt" = "$VALID_PROBE" ] || return 1; fi; if [ "$1" = staged ] || [ "$1" = trial ]; then printf "gc_fixture 8.8.4.4 %064d %s\\n" 1 "$(( $(date +%s) + 360 ))"; elif [ "$ADOPTED" = yes ]; then printf "gc_fixture 8.8.4.4\\n"; else return 1; fi; }',
  'docker() { if [ "$1" = inspect ]; then printf "%s\\n" "$RUNNING_REVISION"; return; fi; printf "%s\\n" "$PORT_MAPPING"; }',
  'ss() { if [ "$PORT_BUSY" = yes ]; then printf "occupied\\n"; fi; }',
  'systemctl() {',
  '  printf "%s\\n" "$1 ${2:-}" >> "$FIXTURE/ops"',
  '  case "$1:${2:-}" in',
  '    show:--property=LoadState) printf "not-found\\n";;',
  '    show:--property=DropInPaths) if [ "$DROPIN" = yes ]; then printf "foreign override\\n"; fi ;;',
  '    show:--property=FragmentPath) printf "%s\\n" "$unit_file";;',
  '    start:*|restart:*) if [ "$FAIL_START" = yes ]; then return 1; fi; : > "$FIXTURE/active";;',
  '    stop:*|disable:*) rm -f "$FIXTURE/active";;',
  '    is-active:*) [ -f "$FIXTURE/active" ];;',
  '  esac',
  '}',
  'if [ -n "$LEASE" ]; then main "$ACTION" "$REVISION" "$LEASE"; else main "$ACTION" "$REVISION"; fi'
].join('\n');

function fixture(fn){
  const dir=mkdtempSync(join(tmpdir(),'gc-ingress-test-'));
  const f={
    run(action, overrides={}){
      return spawnSync('bash',['-c',shell],{encoding:'utf8',input:(overrides.PROBE || '')+'\n',env:{...process.env,HELPER:h,FIXTURE:dir,
        LEASE:'',NO_HOST_CADDY:'no',FAIL_CADDY:'no',HOST_CADDY:'/usr/bin/caddy',VALID_PROBE:'c'.repeat(64),
        ACTION:action,REVISION:'a'.repeat(40),RUNNING_REVISION:'a'.repeat(40), ADOPTED:'no',PORT_BUSY:'no',FAIL_START:'no',DROPIN:'no',PORT_MAPPING:'127.0.0.1:3003',...overrides}});
    },
    put(p,t){writeFileSync(join(dir,p),t)},
    present(p){return existsSync(join(dir,p))},
    text(p){return readFileSync(join(dir,p),'utf8')}
  };
  try {fn(f)} finally {rmSync(dir,{force:true,recursive:true})}
}

test('owned slot stages only TCP HTTPS, no public HTTP/admin, no URL before adoption and identical retry',()=>fixture(f=>{
  const first=f.run('stage');
  assert.equal(first.status,0,first.stderr);
  assert.doesNotMatch(first.stdout,/https:\/\//);
  assert.match(first.stdout,/TCP 443 only/);
  const config=f.text('owned/Caddyfile');
  assert.match(f.text('unit'),/RuntimeMaxSec=\d+s/);
  assert.match(config,/respond 404/);
  assert.match(config,/not header Authorization/);
  assert.match(config,/header_up -X-GroundControl-IP-Phase/);
  assert.match(config,/admin off/);
  assert.match(config,/default_sni 8\.8\.4\.4/);
  assert.match(config,/auto_https disable_redirects/);
  assert.match(config,/protocols h1 h2/);
  assert.match(config,/disable_http_challenge/);
  assert.match(config,/reverse_proxy 127\.0\.0\.1:3003/);
  assert.doesNotMatch(config,/http:\/\//);
  assert.match(f.text('unit'),/StateDirectory=groundcontrol-direct-ipv4/);
  assert.match(f.text('unit'),/DynamicUser=yes/);
  assert.match(f.run('stage').stdout,/already staged/);
  let denied=f.run('enable');
  assert.notEqual(denied.status,0);assert.doesNotMatch(denied.stdout,/https:\/\//);
  assert.doesNotMatch(f.text('ops'),/^enable /m);
  const enabled=f.run('enable',{ADOPTED:'yes'});
  assert.equal(enabled.status,0,enabled.stderr);assert.match(enabled.stdout,/https:\/\/8\.8\.4\.4/);
  assert.doesNotMatch(f.text('unit'),/RuntimeMaxSec/);
  assert.doesNotMatch(f.text('owned/Caddyfile'),/respond 404/);
  const removed=f.run('remove');
  assert.equal(removed.status,0,removed.stderr);assert.equal(f.present('unit'),false);
  assert.equal(f.present('cert-owner'),true);
}));
test('occupied ports, ambiguous GC origin, and overrides refuse with no slot files',()=>{
  for(const e of [{RUNNING_REVISION:'b'.repeat(40)},{PORT_BUSY:'yes'},{PORT_MAPPING:'0.0.0.0:3003'},{DROPIN:'yes'}])fixture(f=>{
    const r=f.run('stage',e);
    assert.notEqual(r.status,0);assert.equal(f.present('unit'),false);
    assert.equal(f.present('owned'),false);
  });
});
test('foreign TLS data or systemd unit never gets replaced, start failure rolls back owned files only',()=>{
  fixture(f=>{f.put('unit','foreign');const r=f.run('stage');assert.notEqual(r.status,0);assert.equal(f.text('unit'),'foreign')});
  fixture(f=>{f.put('cert','foreign');const r=f.run('stage');assert.notEqual(r.status,0);assert.equal(f.text('cert'),'foreign')});
  fixture(f=>{const r=f.run('stage',{FAIL_START:'yes'});assert.notEqual(r.status,0);assert.equal(f.present('owned'),false);assert.equal(f.present('unit'),false);assert.match(f.text('ops'),/stop /)});
});
test('managed Caddy stage refuses to expose secret data or proceed from stale/ambiguous auth state',async()=>{
  const n=Date.now(), routeKey='b'.repeat(64), id='gc_fixture', ip='8.8.4.4';
  const stage={ip,instanceId:id,adminId:2,routeKey,challenge:'private',signingKey:'secret',expiresAt:n+10000,priorMode:'private',priorUrl:''};
  const vals={'groundcontrol_instance_id':id,groundcontrol_publish_mode:'private',groundcontrol_direct_ipv4_stage:JSON.stringify(stage)};
  const tx={user:{count:async()=>1,findUnique:async()=>({role:'admin'})},installClaim:{count:async()=>0},appConfig:{findUnique:async({where})=>({value:vals[where.key]})}};
  const db={$transaction:f=>f(tx)};
  assert.deepEqual(await read(db,'staged',true,n),[id,ip,routeKey,Math.floor(stage.expiresAt/1000)]);
  await assert.rejects(read(db,'staged',false,n));
  await assert.rejects(read(db,'staged',true,n+10001));
  vals.groundcontrol_public_url='https://foreign.example';
  await assert.rejects(read(db,'staged',true,n));
  vals.groundcontrol_public_url='https://'+ip;vals.groundcontrol_publish_mode='direct_ipv4';
  await assert.rejects(read(db,'adopted',true,n));
  vals.groundcontrol_direct_ipv4_evidence=JSON.stringify({publicUrl:'https://'+ip,checkedAt:new Date(n).toISOString()});
  assert.deepEqual(await read(db,'adopted',true,n),[id,ip]);
});


test('guided slot permits only the same leased and signed off-host trial, still timed and not boot-enabled',()=>fixture(f=>{
  const lease='d'.repeat(32);
  assert.equal(f.run('stage',{LEASE:lease}).status,0);
  assert.notEqual(f.run('abort',{LEASE:'e'.repeat(32)}).status,0);
  assert.notEqual(f.run('trial',{LEASE:lease,PROBE:'e'.repeat(64)}).status,0);
  assert.notEqual(f.run('enable',{LEASE:lease,ADOPTED:'yes'}).status,0);
  const trial=f.run('trial',{LEASE:lease,PROBE:'c'.repeat(64)});
  assert.equal(trial.status,0,trial.stderr);
  assert.match(f.text('unit'),/RuntimeMaxSec=\d+s/);
  assert.match(f.text('unit'),/Restart=no/);
  assert.match(f.text('owned/Caddyfile'),/header_up X-GroundControl-IP-Phase trial/);
  assert.doesNotMatch(f.text('owned/Caddyfile'),/respond 404/);
  assert.doesNotMatch(f.text('ops'),/^enable /m);
  assert.notEqual(f.run('enable',{LEASE:lease}).status,0);
  assert.equal(f.run('abort',{LEASE:lease}).status,0);
  assert.equal(f.present('unit'),false);
}));


test('approved guided stage can provision its own connector and use it during trial',()=>fixture(f=>{
  const approved={LEASE:'b'.repeat(32),NO_HOST_CADDY:'yes'};
  const first=f.run('stage',approved);
  assert.equal(first.status,0,first.stderr);
  assert.match(f.text('unit'),/ExecStart=.*\/gc-caddy run/);
  assert.equal(f.text('caddy-ops'),'prepared\n');
  const trial=f.run('trial',{...approved,PROBE:'c'.repeat(64)});
  assert.equal(trial.status,0,trial.stderr);
  assert.match(f.text('unit'),/ExecStart=.*\/gc-caddy run/);
  assert.equal(f.text('caddy-ops'),'prepared\n');
}));

test('guided provisioning refuses occupied port before download and does not stage if preparation fails',()=>{
  fixture(f=>{
    const r=f.run('stage',{LEASE:'b'.repeat(32),NO_HOST_CADDY:'yes',PORT_BUSY:'yes'});
    assert.notEqual(r.status,0);
    assert.match(r.stderr,/TCP 443 already has a listener/);
    assert.equal(f.present('caddy-ops'),false);
    assert.equal(f.present('unit'),false);
  });
  fixture(f=>{
    const r=f.run('stage',{LEASE:'b'.repeat(32),NO_HOST_CADDY:'yes',FAIL_CADDY:'yes'});
    assert.notEqual(r.status,0);
    assert.match(r.stderr,/Keep using the earlier setup link/);
    assert.equal(f.present('unit'),false);
    assert.equal(f.present('cert-owner'),false);
  });
  fixture(f=>{
    const r=f.run('stage',{NO_HOST_CADDY:'yes'});
    assert.notEqual(r.status,0);
    assert.equal(f.present('caddy-ops'),false);
  });
});

test('managed connector verifies archive and binary, reuses only exact files, and never overwrites a foreign path',()=>{
  const d=mkdtempSync(join(tmpdir(),'gc-caddy-test-'));
  try {
    const r=spawnSync('bash',['-c',String.raw`
      set -euo pipefail
      source "$HELPER"
      managed_caddy="$FIXTURE/managed"
      managed_caddy_parent() { return 0; }
      stat() { printf '0:0:755:1\n'; }
      printf 'fixture executable\n' > "$FIXTURE/caddy"
      tar -czf "$FIXTURE/release" -C "$FIXTURE" caddy
      archive_sha="$(content_digest "$FIXTURE/release")"
      expected_binary="$(content_digest "$FIXTURE/caddy")"
      caddy_release() {
        release_arch=amd64
        release_sha="$archive_sha"
        binary_sha="$expected_binary"
      }
      curl() {
        for arg; do last="$arg"; done
        [ "$last" = 'https://github.com/caddyserver/caddy/releases/download/v2.11.9/caddy_2.11.9_linux_amd64.tar.gz' ] || return 1
        while [ "$1" != --output ]; do shift; done
        cp -- "$FIXTURE/release" "$2"
        printf 'download\n' >> "$FIXTURE/attempts"
      }
      real_archive="$archive_sha"; archive_sha="$(printf %064d 0)"
      if prepare_managed_caddy; then exit 90; fi
      [ ! -e "$managed_caddy" ]
      archive_sha="$real_archive"; real_binary="$expected_binary"; expected_binary="$(printf %064d 0)"
      if prepare_managed_caddy; then exit 91; fi
      [ ! -e "$managed_caddy" ]
      expected_binary="$real_binary"
      [ "$(prepare_managed_caddy)" = "$managed_caddy" ]
      cmp "$managed_caddy" "$FIXTURE/caddy"
      [ "$(prepare_managed_caddy)" = "$managed_caddy" ]
      [ "$(wc -l < "$FIXTURE/attempts")" -eq 3 ]
      printf 'foreign' > "$managed_caddy"
      if prepare_managed_caddy; then exit 92; fi
      [ "$(cat "$managed_caddy")" = foreign ]
      rm "$managed_caddy"
      ln -s "$FIXTURE/caddy" "$managed_caddy"
      if prepare_managed_caddy; then exit 93; fi
      [ -L "$managed_caddy" ]
      [ "$(wc -l < "$FIXTURE/attempts")" -eq 3 ]
      ! compgen -G "$FIXTURE/.gc-caddy.*"
    `],{encoding:'utf8', env:{...process.env,FIXTURE:d,HELPER:h}});
    assert.equal(r.status,0,r.stderr);
  } finally {rmSync(d,{force:true,recursive:true})}
});


test('host connector promotion keeps the staged executable even if the preferred PATH order changes',()=>fixture(f=>{
  const approved={LEASE:'b'.repeat(32)};
  assert.equal(f.run('stage',approved).status,0);
  assert.match(f.text('unit'),/ExecStart=\/usr\/bin\/caddy run/);
  const trial=f.run('trial',{...approved,HOST_CADDY:'/usr/local/bin/caddy',PROBE:'c'.repeat(64)});
  assert.equal(trial.status,0,trial.stderr);
  assert.match(f.text('unit'),/ExecStart=\/usr\/bin\/caddy run/);
}));
