import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readdir, readFile, rm, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { prepareForgeAssets, EMPTY_FORGE_EDITIONS, FORGE_DIRECTORY_MARKER } from '../scripts/forge-assets.mjs';

test('headless custom editions directory exists before packaging and repeated preparation preserves vendor resources',async()=>{
  const assets=await mkdtemp(join(tmpdir(),'asphodel-forge-assets-'));
  try {
    await mkdir(join(assets,'editions')); await writeFile(join(assets,'editions','real.txt'),'vendor edition');
    await prepareForgeAssets(assets); await prepareForgeAssets(assets);
    const files=await readdir(join(assets,EMPTY_FORGE_EDITIONS));
    assert.deepEqual(files,[FORGE_DIRECTORY_MARKER]);
    assert.deepEqual(files.filter(name=>name.endsWith('.txt')),[],'the pinned Forge reader still sees zero custom editions');
    assert.equal(await readFile(join(assets,'editions','real.txt'),'utf8'),'vendor edition');
    const bridge=await readFile(new URL('../../forge-bridge/app/src/main/java/com/asphodel/forgebridge/ForgeDataRepository.java',import.meta.url),'utf8');
    assert.ok(bridge.includes(`directory("${EMPTY_FORGE_EDITIONS}")`),'the packaged folder matches the path required by the unchanged Java bridge');
  } finally {await rm(assets,{recursive:true,force:true});}
});
