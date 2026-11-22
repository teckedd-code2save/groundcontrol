const {test} = require('node:test');
const assert = require('node:assert/strict');
const {spawnSync} = require('node:child_process');
const {mkdtempSync,readFileSync,rmSync} = require('node:fs');
const {tmpdir} = require('node:os');
const {join} = require('node:path');
const source = readFileSync(join(__dirname,'start'),'utf8');
const defs = source.slice(source.indexOf('guided_ipv4_has_tty() {'),source.indexOf('if [ "$MODE" = remote ]; then\n  [ -z "$IMAGE" ]'));
const install = readFileSync(join(__dirname,'install'),'utf8');
const capability = install.slice(install.indexOf('guided_ipv4_image_capable() {'),install.indexOf('finish_setup_guidance() {'));
const REV='a'.repeat(40);
const shell = [
  'set -euo pipefail',
  defs,
  'README_INTERACTIVE="$INTERACTIVE"; PRIVATE_REQUESTED=0; DIRECT_IPV4_REHEARSAL=0; ACCESS_MODE=private; INSTALLER_REF=main; VERSION=latest; PRIVATE=1; TARGET=server; SSH_ARGS=()',
  'guided_ipv4_has_tty() { [ "$HAS_TTY" = yes ]; }',
  'guide_step=0',
  'guided_ipv4_read() { guide_step=$((guide_step+1)); answer=""; if [ "$guide_step" = 1 ]; then answer="$OPTION"; fi; if [ "$STOP_STEP" = "$guide_step" ]; then answer=q; fi; }',
  'ui_heading() { printf "heading %s\\n" "$1"; }',
  'ui_link() { printf "link %s\\n" "$1"; }',
  'field() { printf "gc_fixture\\n"; }',
  'ssh() { printf "capability\\n" >> "$LOG"; printf "%s\\n" "$FORMAT"; }',
  'sleep() { :; }',
  'curl() { local src="" dst=""; while [ "$#" -gt 0 ]; do case "$1" in https://*) src="$1";; -o) dst="$2"; shift;; esac; shift; done; printf "download %s\\n" "$src" >> "$LOG"; if [[ "$src" = */trust/* ]]; then [ "$ROOTS" != absent ] || return 22; cp "$ASSETS/trust/lets-encrypt-isrg-roots.pem" "$dst"; if [ "$ROOTS" = wrong ]; then printf changed >> "$dst"; fi; else cp "$ASSETS/${src##*/}" "$dst"; fi; }',
  'python3() { if [ "$1" = -c ]; then return 0; fi; printf "verify %s\\n" "$*" >> "$LOG"; if [ "$2" = --verify-active ]; then [ "$POSTCHECK" = pass ]; return; fi; IFS= read -r secret; [ "$secret" = "$CHALLENGE" ] && [ "$VERIFY" = pass ] || return 7; if [ "$3" = --trial-check ]; then [ "$TRIAL_CHECK" = pass ] || return 8; printf "%064d\\n" 3; else printf "%064d\\n" 2; fi; }',
  'guided_ipv4_remote() { printf "remote %s\\n" "$2" >> "$LOG"; case "$2" in stage) return;; trial) [ "$TRIAL" = pass ] && [ "$3" = "$(printf %064d 2)" ];; challenge) printf "%s 8.8.4.4 %s 1790000000\\n" "$INSTANCE" "$CHALLENGE";; enable) [ "$SAVED" = yes ] || return 1; printf "  https://8.8.4.4\\n";; esac; }',
  'if guided_ipv4_offer; then printf "DONE\\n"; else printf "PREVIOUS\\n"; fi'
].join('\n');
function run(overrides={}){
  const d=mkdtempSync(join(tmpdir(),'gc-guided-443-test-'));
  try {
    const path=join(d,'events');
    const r=spawnSync('bash',['-c',shell],{cwd:d,encoding:'utf8',timeout:8000,
      env:{...process.env,CONTROL_DIR:d,ASSETS:__dirname,LOG:path,INTERACTIVE:'1',HAS_TTY:'yes',FORMAT:'1 '+REV+' guided', OPTION:'y',STOP_STEP:'no',ROOTS:'ok',INSTANCE:'gc_fixture',CHALLENGE:'b'.repeat(64),VERIFY:'pass',TRIAL:'pass',TRIAL_CHECK:'pass',POSTCHECK:'pass',SAVED:'yes',...overrides}});
    let log='';
    try {log=readFileSync(path,'utf8')} catch {}
    return {...r,log};
  } finally {rmSync(d,{recursive:true,force:true})}
}
test('old latest, no tty and unattended launch have no IPv4 mutations or downloads',()=>{
  for(const e of [{FORMAT:'<no value> '+REV},{INTERACTIVE:'0'},{HAS_TTY:'no'},{OPTION:'n'}]){
    const r=run(e);
    assert.equal(r.status,0,r.stderr);
    assert.match(r.stdout,/PREVIOUS/);
    assert.doesNotMatch(r.log,/remote|download/);
  }
});
test('standalone guided run verifies exact pinned client files and shows permanent link only after browser adoption and post-promotion check',()=>{
  const r=run();
  assert.equal(r.status,0,r.stderr);
  assert.match(r.stdout,/link https:\/\/8\.8\.4\.4\/login/);
  assert.match(r.stdout,/DONE/);
  assert.ok(r.stdout.includes('3'.padStart(64,'0')));
  assert.ok(!r.stdout.includes('2'.padStart(64,'0')));
  assert.doesNotMatch(r.stdout, /b{64}/);
  assert.equal((r.log.match(new RegExp(REV,'g'))||[]).length,3);
  assert.match(r.log,/trust\/lets-encrypt-isrg-roots\.pem/);
  assert.match(r.log,/remote stage[\s\S]*remote challenge[\s\S]*verify .*--challenge-stdin[\s\S]*remote trial[\s\S]*verify .*--trial-check[\s\S]*remote enable[\s\S]*verify .*--verify-active/);
  assert.doesNotMatch(r.log,/b{64}/);
});
test('missing or corrupt root bundle, cancel, wrong instance, failed verifier or failed adoption preserve recovery and never hand off',()=>{
  for(const e of [{ROOTS:'absent'},{ROOTS:'wrong'},{STOP_STEP:'2'},{INSTANCE:'gc_other'},{VERIFY:'fail'},{TRIAL:'fail'},{TRIAL_CHECK:'fail'},{STOP_STEP:'3'},{SAVED:'no'},{POSTCHECK:'fail'}]){
    const r=run(e);
    assert.equal(r.status,0,r.stderr);
    assert.match(r.stdout,/PREVIOUS/);
    assert.doesNotMatch(r.stdout,/link https:\/\/8/);
    if(e.ROOTS||e.STOP_STEP==='2') assert.doesNotMatch(r.log,/remote stage/);
    if(e.VERIFY||e.INSTANCE||e.TRIAL||e.TRIAL_CHECK||e.STOP_STEP==='3') {
      assert.doesNotMatch(r.log,/remote enable/);
      assert.match(r.log,/remote abort/);
    }
  }
});
test('installer recognizes only matching media capability on an immutable image, never expands mutable latest',()=>{
  const digest='ghcr.io/teckedd-code2save/groundcontrol@sha256:'+'b'.repeat(64);
  for(const [image,label,want] of [[digest,'1 '+REV,0],[digest,'<no value> '+REV,1],[digest,'1 invalid',1],['ghcr.io/teckedd-code2save/groundcontrol:latest','1 '+REV,1]]){
    const r=spawnSync('bash',['-c',capability+'\ndocker(){ printf "%s\\n" "$LABEL"; }\nguided_ipv4_image_capable "$IMAGE"'],{encoding:'utf8',env:{...process.env,IMAGE:image,LABEL:label}});
    assert.equal(r.status,want,r.stderr);
  }
});
