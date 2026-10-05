import assert from 'node:assert/strict';
import test from 'node:test';
import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { debPath, distributionMetadata, installLocal, runCommand, verifyDeb } from '../scripts/distribution.mjs';

const metadata = { name: 'asphodel-desktop', version: '0.1.1', build: { artifactName: 'Asphodel-${version}-${arch}.${ext}' } };
const fixtureFiles = [
  'opt/Asphodel/asphodel', 'opt/Asphodel/resources/app.asar',
  'opt/Asphodel/resources/runtime/frontend/index.html', 'opt/Asphodel/resources/runtime/backend/src/app.js',
  'opt/Asphodel/resources/runtime/backend/node_modules/fastify/package.json', 'opt/Asphodel/resources/runtime/backend/data/asphodel.sqlite',
  'opt/Asphodel/resources/runtime/java/bin/java', 'opt/Asphodel/resources/runtime/forge-bridge/app/target/asphodel-forge-bridge.jar',
  'usr/share/applications/Asphodel.desktop', 'usr/share/icons/hicolor/256x256/apps/asphodel.png',
];
async function workspace() {
  const desktop = await mkdtemp(join(tmpdir(), 'asphodel install $ ; '));
  await writeFile(join(desktop, 'package.json'), JSON.stringify(metadata));
  await writeFile(join(desktop, 'package-lock.json'), JSON.stringify({ version: metadata.version, packages: { '': { version: metadata.version } } }));
  return desktop;
}
async function packageFixture(desktop, { version = metadata.version, architecture = 'amd64', omit = '', includeUserData = false } = {}) {
  const root = join(desktop, 'fixture');
  await rm(root, { recursive: true, force: true });
  await mkdir(join(root, 'DEBIAN'), { recursive: true });
  await chmod(join(root, 'DEBIAN'), 0o755);
  await writeFile(join(root, 'DEBIAN/control'), `Package: asphodel-desktop\nVersion: ${version}\nArchitecture: ${architecture}\nMaintainer: Asphodel tests\nDescription: Distribution test fixture, not a runnable app\n`);
  for (const file of fixtureFiles.filter(file => file !== omit)) {
    await mkdir(dirname(join(root, file)), { recursive: true });
    await writeFile(join(root, file), 'test fixture');
  }
  await mkdir(join(root, 'opt/Asphodel/resources/runtime/vendor/forge/forge-gui/res/cardsfolder'), { recursive: true });
  if (includeUserData) {
    await mkdir(join(root, 'home/test/.config/Asphodel'), { recursive: true });
    await writeFile(join(root, 'home/test/.config/Asphodel/decks.sqlite'), 'not allowed in a package');
  }
  const file = debPath(desktop, metadata, 'x64');
  await mkdir(dirname(file), { recursive: true });
  runCommand('dpkg-deb', ['--build', '--root-owner-group', root, file]);
  return file;
}

test('release version matches lockfile and release tags', async () => {
  const desktop = await workspace();
  try {
    assert.equal((await distributionMetadata(desktop, 'refs/heads/main')).version, '0.1.1');
    await distributionMetadata(desktop, 'refs/tags/v0.1.1');
    await assert.rejects(distributionMetadata(desktop, 'refs/tags/v0.1.0'), /tag/);
    await writeFile(join(desktop, 'package-lock.json'), JSON.stringify({ version: '0.1.0', packages: { '': { version: '0.1.0' } } }));
    await assert.rejects(distributionMetadata(desktop), /même version/);
  } finally { await rm(desktop, { recursive: true, force: true }); }
});

test('real Debian archives validate launcher and bundled components; reject stale, wrong-architecture or incomplete packages', { skip: process.platform !== 'linux' }, async () => {
  const desktop = await workspace();
  try {
    const file = await packageFixture(desktop);
    assert.equal(file, join(desktop, 'release', 'Asphodel-0.1.1-amd64.deb'));
    assert.equal(await verifyDeb(file, metadata, 'x64'), file);
    await packageFixture(desktop, { version: '0.1.0' });
    await assert.rejects(verifyDeb(file, metadata, 'x64'), /Version/);
    await packageFixture(desktop, { architecture: 'arm64' });
    await assert.rejects(verifyDeb(file, metadata, 'x64'), /Architecture/);
    await packageFixture(desktop, { omit: 'opt/Asphodel/resources/runtime/forge-bridge/app/target/asphodel-forge-bridge.jar' });
    await assert.rejects(verifyDeb(file, metadata, 'x64'), /incomplet/);
    await packageFixture(desktop, { includeUserData: true });
    await assert.rejects(verifyDeb(file, metadata, 'x64'), /données utilisateur/);
  } finally { await rm(desktop, { recursive: true, force: true }); }
});

test('installation builds and validates before sudo; paths with shell characters remain one argument', { skip: process.platform !== 'linux' }, async () => {
  const desktop = await workspace();
  const calls = [];
  try {
    const file = await packageFixture(desktop);
    const run = (command, args, options) => {
      calls.push([command, args, options]);
      if (command === 'dpkg') return 'amd64';
      if (command === 'npm' || command === 'sudo') return '';
      return runCommand(command, args, options);
    };
    await installLocal(desktop, { platform: 'linux', architecture: 'x64', root: false, run });
    assert.deepEqual(calls.map(([command]) => command), ['dpkg', 'npm', 'dpkg-deb', 'dpkg-deb', 'sudo']);
    assert.deepEqual(calls[1][1], ['run', 'dist:deb']);
    assert.equal(calls[1][2].cwd, desktop);
    assert.deepEqual(calls.at(-1)[1], ['apt-get', 'install', '--reinstall', file]);
  } finally { await rm(desktop, { recursive: true, force: true }); }
});

test('failed build or rejected package never reaches privileged installation', { skip: process.platform !== 'linux' }, async () => {
  const desktop = await workspace();
  try {
    for (const failedBuild of [true, false]) {
      await packageFixture(desktop, { version: '0.1.0' });
      let installed = false;
      const run = (command, args, options) => {
        if (command === 'dpkg') return 'amd64';
        if (command === 'npm') { if (failedBuild) throw new Error('build failed'); return ''; }
        if (command === 'sudo' || command === 'apt-get') { installed = true; return ''; }
        return runCommand(command, args, options);
      };
      await assert.rejects(installLocal(desktop, { platform: 'linux', architecture: 'x64', root: false, run }), failedBuild ? /build failed/ : /Version/);
      assert.equal(installed, false);
    }
    await assert.rejects(installLocal(desktop, { platform: 'darwin' }), /Ubuntu\/Debian/);
  } finally { await rm(desktop, { recursive: true, force: true }); }
});
