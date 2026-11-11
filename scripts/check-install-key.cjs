const { test } = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join } = require("node:path");
const { spawnSync } = require("node:child_process");
const source = readFileSync(join(__dirname, "install"), "utf8");
const start = source.indexOf("# Resolve a missing encryption setting");
const end = source.indexOf('\nif [ "$UPGRADE" -eq 1 ]', start);
assert(start >= 0 && end > start);
const key = "ab".repeat(32);
const envKey = "cd".repeat(32);
function run({existing = 1, envFile = "HOST_PORT=3003\n", runtimeKey = "", fileKey = key, inspectFails = false, copyFails = false} = {}) {
  const root = mkdtempSync(join(tmpdir(), "gc-key-test-"));
  const install = join(root, "install");
  mkdirSync(install);
  if (envFile !== null) writeFileSync(join(install, ".env"), envFile);
  const script = `set -euo pipefail
fail() { printf '%s\\n' "$*" >&2; exit 1; }
log() { :; }
random_hex() { printf '%064d' 0; }
docker() {
  case "$1" in
    inspect) [ "$INSPECT_FAILS" = 0 ] || return 1; printf '%s\\n' "GROUNDCONTROL_SECRET=$RUNTIME_KEY";;
    cp) [ "$COPY_FAILS" = 0 ] || return 1; printf '%s' "$FILE_KEY" > "$3";;
    *) return 99;;
  esac
}
` + source.slice(start, end);
  const result = spawnSync("bash", ["-c", script], {encoding:"utf8", env:{...process.env, INSTALL_DIR:install, EXISTING:String(existing), HOST_PORT:"3003", RUNTIME_KEY:runtimeKey, FILE_KEY:fileKey, INSPECT_FAILS:inspectFails?"1":"0", COPY_FAILS:copyFails?"1":"0"}});
  const after = existsSync(join(install, ".env")) ? readFileSync(join(install, ".env"), "utf8") : null;
  rmSync(root,{recursive:true,force:true});
  assert(!result.stdout.includes(key) && !result.stderr.includes(key), "must not expose key");
  return {...result, after};
}
test("migrates canonical file key without docker exec (works stopped)",()=>{const r=run();assert.equal(r.status,0);assert(r.after.includes(key));});
test("preserves effective environment key over stale file key",()=>{const r=run({runtimeKey:envKey});assert.equal(r.status,0);assert(r.after.includes(envKey));assert(!r.after.includes(key));});
test("recovers existing key when .env is missing",()=>{const r=run({envFile:null});assert.equal(r.status,0);assert(r.after.includes(key));});
test("inspect failure leaves .env unchanged",()=>{const r=run({inspectFails:true});assert.notEqual(r.status,0);assert.equal(r.after,"HOST_PORT=3003\n");});
test("copy failure leaves .env unchanged",()=>{const r=run({copyFails:true});assert.notEqual(r.status,0);assert.equal(r.after,"HOST_PORT=3003\n");});
test("copy failure does not create missing .env",()=>{const r=run({copyFails:true,envFile:null});assert.notEqual(r.status,0);assert.equal(r.after,null);});
test("rejects invalid or unsafe key without generating replacement",()=>{for(const fileKey of ["","x".repeat(64),"ab\n".repeat(32),"$EXPAND", key+"\nBAD=1"]) {const r=run({fileKey});assert.notEqual(r.status,0);assert.equal(r.after,"HOST_PORT=3003\n");}});
test("keeps explicitly configured .env key untouched",()=>{const value=`GROUNDCONTROL_SECRET=${envKey}\nJWT_SECRET=present\nHOST_PORT=3003\n`;const r=run({envFile:value,inspectFails:true});assert.equal(r.status,0);assert.equal(r.after,value);});
test("fresh installation generates key",()=>{const r=run({existing:0,envFile:null});assert.equal(r.status,0);assert(r.after.includes("GROUNDCONTROL_SECRET="+"0".repeat(64)));});
test("missing runtime with existing config fails closed",()=>{const r=run({existing:0});assert.notEqual(r.status,0);assert.equal(r.after,"HOST_PORT=3003\n");});
