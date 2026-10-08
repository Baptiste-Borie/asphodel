import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, writeFile, readFile, stat, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { build, Platform } from 'electron-builder';
import { EMPTY_FORGE_EDITIONS, FORGE_DIRECTORY_MARKER, prepareForgeAssets } from '../scripts/forge-assets.mjs';

test('real electron-builder resource packaging drops the old empty directory but preserves its Forge-ignored marker', { skip: process.platform !== 'linux', timeout: 60_000 }, async()=>{
  const root=await mkdtemp(join(tmpdir(),'asphodel-forge-packaging-'));
  const project=join(root,'app'), electron=join(root,'electron'), runtime=join(project,'runtime');
  const relativeAssets='vendor/forge/forge-gui/res', assets=join(runtime,relativeAssets);
  try {
    await mkdir(project,{recursive:true}); await mkdir(electron,{recursive:true});
    await writeFile(join(project,'package.json'),JSON.stringify({name:'asphodel-packaging-test',version:'0.1.14',main:'main.cjs',description:'Resource packaging fixture',author:'Asphodel tests'}));
    await writeFile(join(project,'main.cjs'),'// Packaging fixture; never launched.\n');
    // Stub distribution avoids downloading or launching Chromium. The production
    // electron-builder resource walker, matchers and output layout still run.
    await writeFile(join(electron,'electron'),'#!/bin/sh\nexit 0\n',{mode:0o755});
    await mkdir(join(assets,EMPTY_FORGE_EDITIONS),{recursive:true});
    const config={appId:'test.asphodel.packaging',electronVersion:'44.5.1',electronDist:electron,npmRebuild:false,asar:true,
      files:['main.cjs','package.json'],extraResources:[{from:'runtime',to:'runtime'}]};
    const pack=async output=>build({projectDir:project,targets:Platform.LINUX.createTarget('dir'),publish:'never',config:{...structuredClone(config),directories:{output}}});
    await pack(join(root,'before'));
    const location=output=>join(root,output,'linux-unpacked/resources/runtime',relativeAssets,EMPTY_FORGE_EDITIONS);
    await assert.rejects(stat(location('before')), {code:'ENOENT'});
    await prepareForgeAssets(assets); await pack(join(root,'after'));
    assert.ok((await stat(location('after'))).isDirectory());
    assert.equal(await readFile(join(location('after'),FORGE_DIRECTORY_MARKER),'utf8'),await readFile(join(assets,EMPTY_FORGE_EDITIONS,FORGE_DIRECTORY_MARKER),'utf8'));
  } finally {await rm(root,{recursive:true,force:true});}
});
