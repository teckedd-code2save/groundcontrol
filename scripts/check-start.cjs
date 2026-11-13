const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { spawnSync } = require('node:child_process');

const launcher = join(__dirname, 'start');
const mock = `#!/usr/bin/env node
const fs=require('node:fs'),path=require('node:path');
const name=path.basename(process.argv[1]),args=process.argv.slice(2),e=process.env;
fs.appendFileSync(e.GC_TEST_LOG,JSON.stringify({name,args})+'\\n');
const say=x=>process.stdout.write(x+'\\n');
const result=e.GC_TEST_RESULT||JSON.stringify({stage:'claim_required',claimToken:'gc_claim_test_token',hostPort:4731,publicUrl:'https://test-owner.trycloudflare.com',accessMode:'quick_tunnel',accessStatus:'ready'});
if(name==='sleep') process.exit(0);
if(name==='curl') {if(e.GC_TEST_CURL_FAIL)process.exit(7);say('{}');process.exit(0);}
if(name==='ssh') {
 if(args.includes('-M')) process.exit(e.GC_TEST_SSH_FAIL?255:0);
 if(args.includes('-O')) {
   const action=args[args.indexOf('-O')+1];
   if(action==='check') process.exit(1);
   if(action==='forward'&&e.GC_TEST_BUSY&&args.some(x=>x.startsWith('127.0.0.1:3003:')))process.exit(1);
   process.exit(0);
 }
 fs.writeFileSync(e.GC_TEST_REMOTE_SCRIPT,fs.readFileSync(0));
 if(e.GC_TEST_INSTALL_FAIL)process.exit(3);
 say(result);process.exit(0);
}
if(name==='docker') {
 const state=fs.existsSync(e.GC_TEST_STATE)?JSON.parse(fs.readFileSync(e.GC_TEST_STATE)):{};
 const format=args.includes('--format')?args[args.indexOf('--format')+1]:'';
 if(args[0]==='info'){if(e.GC_TEST_DOCKER_DOWN)process.exit(1);say(format?'linux':'Docker ready');process.exit(0);}
 if(args[0]==='context'){say(e.GC_TEST_ENDPOINT||'unix:///var/run/docker.sock');process.exit(0);}
 if(args[0]==='inspect'){
  if(!state.exists)process.exit(1);
  say(format.includes('Health')?'healthy':(e.GC_TEST_FOREIGN?'server':'desktop'));process.exit(0);
 }
 if(args[0]==='image') {say(format.includes('Architecture')?'amd64':e.GC_TEST_OLD_IMAGE?'':'1');process.exit(0);}
 if(args[0]==='volume')process.exit(e.GC_TEST_ORPHAN_DB?0:1);
 if(args[0]==='pull'||args[0]==='start')process.exit(0);
 if(args[0]==='port'){say('127.0.0.1:39123');process.exit(0);}
 if(args[0]==='exec'){say(result);process.exit(0);}
 if(args[0]==='run'){
  if(args.includes('node')){if(e.GC_TEST_EMULATION_FAIL)process.exit(1);say('JWT_SECRET=test-session-key\\nGROUNDCONTROL_SECRET=test-encryption-key');process.exit(0);}
  fs.writeFileSync(e.GC_TEST_STATE,JSON.stringify({exists:true}));say('test-container');process.exit(0);
 }
}
process.stderr.write('Unexpected mock command '+name+' '+args.join(' '));process.exit(99);
`;

function run(args, overrides = {}, existing = false) {
  const dir = mkdtempSync(join(tmpdir(), 'gc-start-test-'));
  const bin = join(dir, 'bin'); mkdirSync(bin);
  for (const name of ['ssh','docker','curl','sleep']) writeFileSync(join(bin,name),mock,{mode:0o755});
  const state=join(dir,'state.json'); if(existing) writeFileSync(state,JSON.stringify({exists:true}));
  const log=join(dir,'commands.jsonl'),remote=join(dir,'remote.sh');
  const data=join(dir,'desktop config');
  try {
    const result=spawnSync('bash',[launcher,...args,'--dir',data],{
      encoding:'utf8',timeout:10000,
      env:{...process.env,DOCKER_HOST:'',PATH:bin+':'+process.env.PATH,GC_TEST_LOG:log,GC_TEST_STATE:state,GC_TEST_REMOTE_SCRIPT:remote,...overrides},
    });
    return {...result,commands:existsSync(log)?readFileSync(log,'utf8').trim().split('\n').filter(Boolean).map(JSON.parse):[],remoteScript:existsSync(remote)?readFileSync(remote,'utf8'):'',envCreated:existsSync(join(data,'.env'))};
  } finally { rmSync(dir,{recursive:true,force:true}); }
}

test('default remote setup hands off verified HTTPS and exits without forwarding',()=>{
  const r=run(['--remote','test-server']);
  assert.equal(r.status,0,r.stderr);
  assert.match(r.stdout,/https:\/\/test-owner\.trycloudflare\.com\/claim#token=gc_claim_test_token/);
  assert.match(r.stdout,/You can close this terminal/);
  assert.doesNotMatch(r.stdout,/Keep this terminal open/);
  assert.ok(!r.commands.some(c=>c.args.includes('forward')));
  assert.ok(r.commands.some(c=>c.name==='ssh'&&c.args.includes('exit')));
});

test('saved private choice uses SSH forwarding instead of requiring HTTPS',()=>{
  const r=run(['--remote','test-server'],{GC_TEST_RESULT:JSON.stringify({stage:'already_claimed',hostPort:4731,accessMode:'private',publicUrl:''})});
  // Mock SSH deliberately closes after the link is handed off.
  assert.match(r.stderr,/server connection closed/);
  assert.match(r.stdout,/saved private-only choice is preserved/);
  assert.match(r.stdout,/http:\/\/127\.0\.0\.1:3003\/login/);
  assert.ok(r.commands.some(c=>c.args.includes('forward')));
});

test('remote setup uses the reported server port and falls back when a local port is occupied',()=>{
  const r=run(['--remote','production-alias','--private'],{GC_TEST_BUSY:'1'});
  assert.match(r.stdout,/http:\/\/127\.0\.0\.1:3004\/claim#token=gc_claim_test_token/);
  assert.match(r.stdout,/Keep this terminal open/);
  assert.ok(r.commands.some(c=>c.args.includes('127.0.0.1:3004:127.0.0.1:4731')));
  assert.ok(r.commands.some(c=>c.name==='ssh'&&c.args.includes('exit')));
  assert.match(r.remoteScript,/sha256sum -c install.sha256/);
  assert.ok(r.commands.some(c=>c.args.includes("sh -s -- 'latest' 'main' '1'")));
  assert.ok(!r.commands.some(c=>c.args.some(a=>a.includes('StrictHostKeyChecking=no'))));
});

test('reconnecting a claimed server returns its login without generating credentials',()=>{
  const r=run(['--remote','root@server'],{GC_TEST_RESULT:JSON.stringify({stage:'already_claimed',hostPort:3003,publicUrl:'https://gc.example.com',accessMode:'permanent',accessStatus:'ready'})});
  assert.match(r.stdout,/https:\/\/gc\.example\.com\/login/);
  assert.doesNotMatch(r.stdout,/claim#|Password:/);
});

test('failed installation closes SSH and does not print a success link',()=>{
  const r=run(['--remote','root@server'],{GC_TEST_INSTALL_FAIL:'1'});
  assert.notEqual(r.status,0); assert.doesNotMatch(r.stdout,/http:\/\/127/);
  assert.ok(r.commands.some(c=>c.args.includes('exit')));
});

test('invalid remote input is rejected before invoking SSH',()=>{
  const r=run(['--remote','root@server;touch /tmp/unsafe']);
  assert.notEqual(r.status,0); assert.equal(r.commands.length,0);
});

test('invalid result and occupied explicit port give actionable failures',()=>{
  const invalid=run(['--remote','server'],{GC_TEST_RESULT:'not json'});
  assert.match(invalid.stderr,/usable claim or login/);
  const busy=run(['--remote','server','--private','--local-port','3003'],{GC_TEST_BUSY:'1'});
  assert.match(busy.stderr,/port 3003 is busy/); assert.doesNotMatch(busy.stdout,/GroundControl is ready/);
});

test('local setup creates private Docker workspace and a verified claim link',()=>{
  const r=run(['--local']);
  assert.equal(r.status,0,r.stderr); assert.equal(r.envCreated,true);
  assert.match(r.stdout,/http:\/\/127\.0\.0\.1:39123\/claim#/);
  const create=r.commands.find(c=>c.name==='docker'&&c.args[0]==='run'&&c.args.includes('--name'));
  assert.ok(create.args.includes('127.0.0.1::3000'));
  assert.ok(create.args.includes('GC_DESKTOP_MODE=1'));
  assert.ok(create.args.some(a=>a.endsWith('/workspace:'+a.split(':')[0])));
  assert.ok(!create.args.includes('--privileged'));
  assert.ok(!create.args.some(a=>a.startsWith('/etc:')||a.startsWith('/root/.ssh:')));
});

test('local rerun reuses existing image, data and credentials',()=>{
  const r=run(['--local'],{GC_TEST_RESULT:JSON.stringify({stage:'already_claimed'})},true);
  assert.equal(r.status,0,r.stderr); assert.match(r.stdout,/\/login/);
  assert.ok(!r.commands.some(c=>c.args[0]==='pull'||c.args[0]==='run'));
});

test('local setup refuses another installation, a remote engine and an incompatible image',()=>{
  for (const [env,existing,message] of [
    [{GC_TEST_FOREIGN:'1'},true,/different GroundControl installation/],
    [{GC_TEST_ENDPOINT:'tcp://server:2376'},false,/local Docker context/],
    [{GC_TEST_OLD_IMAGE:'1'},false,/predates desktop setup/],
    [{GC_TEST_ORPHAN_DB:'1'},false,/no matching .env/],
  ]) {
    const r=run(['--local'],env,existing); assert.notEqual(r.status,0);assert.match(r.stderr,message);
    assert.ok(!r.commands.some(c=>c.args[0]==='run'&&c.args.includes('--name')));
  }
});

test('unavailable emulation leaves no generated keys and reports the next action',()=>{
  const r=run(['--local'],{GC_TEST_EMULATION_FAIL:'1'});
  assert.notEqual(r.status,0);assert.equal(r.envCreated,false);assert.match(r.stderr,/enable AMD64 emulation/);
});


test('setup directs users to finish workload prerequisites without claiming deployment readiness',()=>{
  const local=run(['--local']);
  assert.equal(local.status,0,local.stderr);
  assert.match(local.stdout,/Finish the workspace check/);
  assert.doesNotMatch(local.stdout,/Access is checked/);
  const remote=run(['--remote','test-server']);
  assert.match(remote.stdout,/Services → Install/);
  assert.match(remote.stdout,/Install any tools your app needs/);
  assert.doesNotMatch(remote.stdout,/Access is checked|Recovery: rerun setup/);
  assert.doesNotMatch(remote.stdout,/GroundControl is ready/);
});

test('stopped local Docker reports recovery before credentials or launch',()=>{
  const r=run(['--local'],{GC_TEST_DOCKER_DOWN:'1'});
  assert.notEqual(r.status,0);
  assert.match(r.stderr,/Start Docker Desktop\/Engine/);
  assert.equal(r.envCreated,false);
  assert.ok(!r.commands.some(c=>c.name==='docker'&&c.args[0]==='run'));
});

test('installer next steps preserve machine-readable stdout in JSON mode',()=>{
  const source=readFileSync(join(__dirname,'install'),'utf8');
  const log=source.match(/^log\(\) \{[\s\S]*?^\}/m)[0];
  const guidance=source.match(/^finish_setup_guidance\(\) \{[\s\S]*?^\}/m)[0];
  const r=spawnSync('bash',['-c',`JSON_MODE=1\n${log}\n${guidance}\nfinish_setup_guidance\nprintf '{"stage":"claim_required"}\\n'`],{encoding:'utf8'});
  assert.equal(r.status,0,r.stderr);
  assert.deepEqual(JSON.parse(r.stdout),{stage:'claim_required'});
  assert.match(r.stderr,/Services → Install/);
  assert.match(r.stderr,/No optional workload tools were installed/);
  assert.match(source,/Install the Docker Compose plugin.*verify docker compose version/);
  assert.equal((source.match(/^ +finish_setup_guidance$|^finish_setup_guidance$/gm)||[]).length,4);
});


test('remote installer defaults to main independently of image version',()=>{
  const r=run(['--remote','test-server','--version','candidate']);
  assert.ok(r.commands.some(c=>c.name==='ssh'&&c.args.includes("sh -s -- 'candidate' 'main' '0'")));
  assert.match(r.remoteScript,/groundcontrol\/\$2\/scripts/);
  assert.match(r.remoteScript,/fetch "\$base\/install"/);
  assert.match(r.remoteScript,/fetch "\$base\/install.sha256"/);
  assert.match(r.remoteScript,/sha256sum -c install.sha256/);
});

test('candidate launcher pins installer source and checksum to immutable commit',()=>{
  const sha='8443d4e02a38898175dd0c38cd1e1975af3640c5';
  const r=run(['--remote','test-server','--version','8443d4e','--installer-ref',sha]);
  assert.match(r.stdout,/GroundControl is reachable/);
  assert.ok(r.commands.some(c=>c.name==='ssh'&&c.args.includes(`sh -s -- '8443d4e' '${sha}' '0'`)));
});

test('invalid installer refs and local use are rejected before connection or launch',()=>{
  for(const ref of ['branch/name','../main','8443d4e',';touch /tmp/unsafe','']) {
    const r=run(['--remote','test-server','--installer-ref',ref]);
    assert.notEqual(r.status,0); assert.equal(r.commands.length,0);
  }
  const local=run(['--local','--installer-ref','a'.repeat(40)]);
  assert.notEqual(local.status,0); assert.match(local.stderr,/only applies to a remote server/);
  assert.equal(local.commands.length,0);
});


test('interactive remote key selection preserves defaults and explicit identity',()=>{
  const source=readFileSync(launcher,'utf8');
  const helper=source.match(/^choose_remote_identity\(\) \{[\s\S]*?^\}/m)[0];
  for(const [initial,answer,expected] of [
    ['', '', ''], ['', '~/my keys/server', '/test-home/my keys/server'],
    ['', '/tmp/test-key', '/tmp/test-key'], ['/given/key', '/ignored/key', '/given/key'],
  ]) {
    const r=spawnSync('bash',['-c',`${helper}\nprompt() { printf '%s' "$ANSWER"; }\nchoose_remote_identity\nprintf '\\nSELECTED=%s\\n' "$IDENTITY"`],{
      encoding:'utf8',env:{...process.env,HOME:'/test-home',IDENTITY:initial,ANSWER:answer},
    });
    assert.equal(r.status,0,r.stderr);
    assert.ok(r.stdout.endsWith(`SELECTED=${expected}\n`));
    if(!initial) assert.match(r.stdout,/Do not paste the key contents/);
  }
  assert.match(source,/TARGET="\$\(prompt[^\n]+; choose_remote_identity ;;/);
});

test('explicit SSH key path is passed as one argument without changing SSH settings',()=>{
  const dir=mkdtempSync(join(tmpdir(),'gc-key-test-'));
  const key=join(dir,'key with spaces');writeFileSync(key,'not a real key');
  try {
    const r=run(['--remote','saved-alias','-i',key]);
    const connect=r.commands.find(c=>c.name==='ssh'&&c.args.includes('-M'));
    assert.equal(connect.args[connect.args.indexOf('-i')+1],key);
    assert.doesNotMatch(r.stdout,/SSH private key path/);
    assert.ok(!connect.args.includes('IdentitiesOnly=yes'));
    const failed=run(['--remote','saved-alias'],{GC_TEST_SSH_FAIL:'1'});
    assert.match(failed.stderr,/enter its path.*-i \/path\/to\/key/);
  } finally {rmSync(dir,{recursive:true,force:true});}
});
