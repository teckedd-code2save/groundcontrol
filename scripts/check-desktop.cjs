// Acceptance helper: run with `docker exec -i ... node` in a disposable,
// unclaimed desktop instance. It creates only a synthetic test administrator.
const assert = require('node:assert/strict');
const { randomBytes } = require('node:crypto');
const { io } = require('socket.io-client');

async function main() {
  assert.equal(process.env.GC_DESKTOP_MODE, '1', 'Acceptance requires desktop mode');
  assert.ok(process.env.GC_TEST_CLAIM_TOKEN, 'Supply the disposable instance claim token');
  const base='http://127.0.0.1:3000';
  let session='';
  async function call(path, payload) {
    const response=await fetch(base+path,{
      method:payload===undefined?'GET':'POST',
      headers:{'Content-Type':'application/json',Cookie:session},
      body:payload===undefined?undefined:JSON.stringify(payload),
      signal:AbortSignal.timeout(90000),
    });
    const body=await response.json();
    return {response,body};
  }
  assert.equal((await call('/api/auth/claim')).body.claimed,false,'Never run on an owned installation');
  const claimed=await call('/api/auth/claim',{
    token:process.env.GC_TEST_CLAIM_TOKEN,username:'desktop-acceptance',password:'GcAcceptance!Aa1'+randomBytes(20).toString('hex'),
  });
  assert.equal(claimed.response.status,200);
  session=claimed.response.headers.get('set-cookie').split(';')[0];
  const status=await call('/api/instance/publish');
  assert.equal(status.body.localDesktop,true);
  const published=await call('/api/instance/publish',{action:'private'});
  assert.equal(published.body.verification.ok,true,JSON.stringify(published.body.verification));
  assert.equal(published.body.verification.checks.hostExecution.status,'skipped');
  assert.equal((await call('/api/instance/publish',{action:'caddy',hostname:'gc.example.com'})).response.status,400);
  const hosts=(await call('/api/vps')).body;
  const local=hosts.find(x=>x.isLocal&&x.isActive);
  assert.ok(local);
  const scan=(await call('/api/onboarding/probe')).body;
  assert.ok(!scan.questions.some(x=>x.category==='proxy'),'Desktop onboarding should not ask for a host proxy');
  assert.ok(!scan.containers.some(x=>x.name==='groundcontrol-web'||x.image.startsWith('groundcontrol-host-bridge')));
  await new Promise((resolve,reject)=>{
    const socket=io(base,{transports:['websocket'],extraHeaders:{Cookie:session}});
    const timeout=setTimeout(()=>finish(new Error('Desktop terminal did not return command output')),20000);
    let output='',finished=false;
    function finish(error){if(finished)return;finished=true;clearTimeout(timeout);socket.emit('terminal:close');socket.disconnect();error?reject(error):resolve();}
    socket.on('connect_error',finish);
    socket.on('terminal:error',data=>finish(new Error(data.message)));
    socket.on('connect',()=>socket.emit('terminal:start',{vpsId:local.id,cols:100,rows:30},response=>{if(!response.ok)finish(new Error(response.error));}));
    socket.on('terminal:ready',()=>socket.emit('terminal:input',"printf 'gc-desktop-%s\\n' accepted\r"));
    socket.on('terminal:output',chunk=>{output+=chunk;if(output.includes('gc-desktop-accepted'))finish();});
  });
  console.log(JSON.stringify({claim:'passed',privateVerification:'passed',nativeHostAccess:'excluded',publicPublishing:'blocked',onboarding:'passed',interactiveTerminal:'passed'}));
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
