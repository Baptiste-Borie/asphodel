import { spawnSync } from 'node:child_process';
import { access, chmod, cp, mkdir, readFile, readdir, realpath, rm, stat, unlink, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { backup, DatabaseSync } from 'node:sqlite';
import { prepareForgeAssets } from './forge-assets.mjs';

const desktop = fileURLToPath(new URL('../', import.meta.url));
const root = resolve(desktop, '..');
const runtime = join(desktop, 'runtime');
function run(command, args, cwd = root) {
  const result = spawnSync(command, args, { cwd, stdio: 'inherit', shell: process.platform === 'win32' });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} failed (${result.status})`);
}
const exists = path => access(path).then(() => true, () => false);
const jar = join(root, 'forge-bridge/app/target/asphodel-forge-bridge.jar');
const assets = join(root, 'vendor/forge/forge-gui/res');
if (!await exists(jar) || !await exists(join(assets, 'cardsfolder'))) {
  throw new Error('Build Forge first: ./scripts/forge-build.sh');
}
const javaCommand = process.env.ASPHODEL_JAVA_HOME ? join(process.env.ASPHODEL_JAVA_HOME, 'bin/java') : 'java';
let javaHome = process.env.ASPHODEL_JAVA_HOME;
if (!javaHome) {
  const probe = spawnSync(javaCommand, ['-XshowSettings:properties', '-version'], { encoding: 'utf8' });
  javaHome = /java.home\s*=\s*(.+)/.exec(probe.stderr ?? '')?.[1]?.trim();
}
if (!javaHome || !await exists(join(javaHome, 'bin', process.platform === 'win32' ? 'jlink.exe' : 'jlink'))) {
  throw new Error('A JDK with jlink is required to build the app. Set ASPHODEL_JAVA_HOME to its directory.');
}
javaHome = await realpath(javaHome);
console.log('Building the existing frontend and backend…');
run('npm', ['run', 'build'], join(root, 'frontend'));
await rm(runtime, { recursive: true, force: true });
await mkdir(runtime, { recursive: true });
run(process.execPath, [join(root, 'backend/node_modules/typescript/bin/tsc'), '-p', join(desktop, 'tsconfig.backend.json')]);
await writeFile(join(runtime, 'package.json'), JSON.stringify({ type: 'module' }));
await cp(join(root, 'backend/package.json'), join(runtime, 'backend/package.json'));
await cp(join(root, 'backend/package-lock.json'), join(runtime, 'backend/package-lock.json'));
// Production dependencies live next to the emitted backend, outside the asar archive.
run('npm', ['ci', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund'], join(runtime, 'backend'));
await cp(join(root, 'backend/drizzle'), join(runtime, 'backend/drizzle'), { recursive: true });
await mkdir(join(runtime, 'backend/data'), { recursive: true });
const seed = new DatabaseSync(join(root, 'backend/data/asphodel.sqlite'), { readOnly: true });
try { await backup(seed, join(runtime, 'backend/data/asphodel.sqlite')); } finally { seed.close(); }
for (const name of ['scryfall-oracle-cards.jsonl.gz', 'scryfall-default-cards.jsonl.gz']) {
  const source = join(root, 'backend/data', name);
  if (await exists(source)) await cp(source, join(runtime, 'backend/data', name));
}
await cp(join(root, 'frontend/dist'), join(runtime, 'frontend'), { recursive: true });
await mkdir(dirname(join(runtime, 'forge-bridge/app/target/asphodel-forge-bridge.jar')), { recursive: true });
await cp(jar, join(runtime, 'forge-bridge/app/target/asphodel-forge-bridge.jar'));
await cp(assets, join(runtime, 'vendor/forge/forge-gui/res'), { recursive: true });
await prepareForgeAssets(join(runtime, 'vendor/forge/forge-gui/res'));
await mkdir(join(runtime, 'licenses'), { recursive: true });
await cp(join(root, 'vendor/forge/LICENSE'), join(runtime, 'licenses/Forge-LICENSE'));
await cp(join(root, 'forge-bridge/NOTICE.md'), join(runtime, 'licenses/Forge-NOTICE.md'));
console.log('Bundling the Java runtime…');
run(join(javaHome, 'bin', process.platform === 'win32' ? 'jlink.exe' : 'jlink'), [
  '--add-modules', 'java.base,java.desktop,java.logging,java.xml,jdk.unsupported,jdk.crypto.ec,java.management,java.naming,java.sql,java.net.http,jdk.charsets',
  '--strip-debug', '--no-header-files', '--no-man-pages', '--output', join(runtime, 'java'),
]);
// jlink's shared licence notices can be read-only and referenced by symlinks.
// Keep our own copies writable so repeat packaging can replace them.
async function writableNotices(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) await writableNotices(path);
    else if (entry.isSymbolicLink()) {
      const contents = await readFile(path);
      await unlink(path);
      await writeFile(path, contents, { mode: 0o644 });
    } else await chmod(path, (await stat(path)).mode | 0o200);
  }
}
await writableNotices(join(runtime, 'java/legal'));
// Artwork prepared with cache-art is reused across clean builds.
if (await exists(join(desktop, '.cache/card-art'))) await cp(join(desktop, '.cache/card-art'), join(runtime, 'card-art'), { recursive: true });
await writeFile(join(runtime, 'build-info.json'), JSON.stringify({ builtAt: new Date().toISOString(), platform: process.platform, architecture: process.arch }, null, 2));
console.log('Desktop runtime ready. Run npm start from desktop/.');
