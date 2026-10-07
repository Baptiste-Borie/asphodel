import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, writeFile, chmod, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ForgeBridgeClient, ForgeBridgeError } from './forge/forge-bridge-client.js';
test('real child pipes preserve recent failures across cleanup requests, ignore unrelated stderr and reset on a fresh process', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'asphodel-bridge-diag-')), executable = join(dir, 'fake-java');
  await writeFile(executable, `#!/usr/bin/env node
const rl=require('node:readline').createInterface({input:process.stdin});
rl.on('line',line=>{const r=JSON.parse(line);if(r.type==='ping'){
process.stderr.write('UNRELATED PRIVATE LOG\\nForge bridge request failed: Missing test resource\\n');
process.stdout.write(JSON.stringify({protocolVersion:r.protocolVersion,requestId:r.requestId,ok:false,error:{code:'INTERNAL_ERROR',message:'The Forge bridge could not process the request.',details:'java.lang.IllegalStateException'}})+'\\n');
}else process.stdout.write(JSON.stringify({protocolVersion:r.protocolVersion,requestId:r.requestId,ok:true,result:{}})+'\\n');});
rl.on('close',()=>process.exit(0));
`); await chmod(executable, 0o755);
  const bridge = new ForgeBridgeClient({ javaPath: executable, requestTimeoutMs: 1000 });
  try {
    await bridge.start(); await assert.rejects(bridge.request({ type: 'ping' }), e => e instanceof ForgeBridgeError && e.code === 'INTERNAL_ERROR' && e.requestType === 'ping');
    for (let i = 0; i < 20 && !bridge.getFailureDiagnostic(); i++) await new Promise(r => setTimeout(r, 5));
    assert.equal(bridge.getFailureDiagnostic(), 'Forge bridge request failed: Missing test resource');
    await bridge.request({ type: 'engine_info' }); assert.equal(bridge.getFailureDiagnostic(), 'Forge bridge request failed: Missing test resource');
    await bridge.stop(); await bridge.start(); assert.equal(bridge.getFailureDiagnostic(), undefined);
  } finally { await bridge.stop(); await rm(dir, { recursive: true, force: true }); }
});
