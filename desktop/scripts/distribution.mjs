import { spawnSync } from 'node:child_process';
import { readFile, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const architectures = { x64: 'amd64', arm64: 'arm64' };
const artifactPattern = 'Asphodel-${version}-${arch}.${ext}';

export function runCommand(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, ...options });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} a échoué (${result.status ?? result.signal}).${result.stderr ? `\n${result.stderr.trim()}` : ''}`);
  return result.stdout?.trim() ?? '';
}

export async function distributionMetadata(desktop, ref = '') {
  const [metadata, lock] = await Promise.all(['package.json', 'package-lock.json'].map(async name => JSON.parse(await readFile(join(desktop, name), 'utf8'))));
  if (!/^\d+\.\d+\.\d+$/.test(metadata.version)) throw new Error('Une version stable x.y.z est requise pour ce paquet.');
  if (lock.version !== metadata.version || lock.packages[''].version !== metadata.version) throw new Error('package.json et package-lock.json doivent avoir la même version.');
  if (metadata.build.artifactName !== artifactPattern) throw new Error('Le nom du paquet doit inclure sa version et son architecture.');
  if (ref.startsWith('refs/tags/') && ref !== `refs/tags/v${metadata.version}`) throw new Error(`Le tag doit être v${metadata.version}, comme la version du paquet.`);
  return metadata;
}

export function debPath(desktop, metadata, architecture = process.arch) {
  if (!architectures[architecture]) throw new Error(`Architecture non prise en charge : ${architecture}`);
  return join(desktop, 'release', `Asphodel-${metadata.version}-${architectures[architecture]}.deb`);
}

export async function verifyDeb(file, metadata, architecture = process.arch, run = runCommand) {
  if (!architectures[architecture]) throw new Error(`Architecture non prise en charge : ${architecture}`);
  if (!(await stat(file)).isFile()) throw new Error('Le paquet .deb est introuvable.');
  const fields = run('dpkg-deb', ['--field', file, 'Package', 'Version', 'Architecture']);
  const expected = { Package: metadata.name, Version: metadata.version, Architecture: architectures[architecture] };
  const actual = Object.fromEntries(fields.split('\n').map(line => {
    const colon = line.indexOf(':'); return [line.slice(0, colon), line.slice(colon + 1).trim()];
  }));
  for (const [key, value] of Object.entries(expected)) {
    if (actual[key] !== value) throw new Error(`Paquet incorrect : ${key}=${actual[key] ?? 'absent'}, attendu ${value}.`);
  }
  const contents = run('dpkg-deb', ['--contents', file]).split('\n');
  const required = [
    './opt/Asphodel/asphodel', './opt/Asphodel/resources/app.asar',
    './opt/Asphodel/resources/runtime/frontend/index.html',
    './opt/Asphodel/resources/runtime/backend/src/app.js',
    './opt/Asphodel/resources/runtime/backend/node_modules/fastify/package.json',
    './opt/Asphodel/resources/runtime/backend/data/asphodel.sqlite',
    './opt/Asphodel/resources/runtime/java/bin/java',
    './opt/Asphodel/resources/runtime/forge-bridge/app/target/asphodel-forge-bridge.jar',
    './opt/Asphodel/resources/runtime/vendor/forge/forge-gui/res/cardsfolder/',
    './opt/Asphodel/resources/runtime/vendor/forge/forge-gui/res/asphodel-empty-custom-editions/',
    './opt/Asphodel/resources/runtime/vendor/forge/forge-gui/res/asphodel-empty-custom-editions/asphodel-directory.marker',
    './usr/share/applications/Asphodel.desktop',
  ];
  for (const path of required) if (!contents.some(line => line.endsWith(` ${path}`))) throw new Error(`Paquet incomplet : ${path}`);
  if (!contents.some(line => /\.\/usr\/share\/icons\/hicolor\/.*\/apps\/asphodel\.png$/.test(line))) throw new Error('L’icône du lanceur est absente.');
  if (contents.some(line => / \.\/(home|root)\//.test(line))) throw new Error('Le paquet ne doit pas contenir de données utilisateur.');
  return resolve(file);
}

export function installCommand(file, root = process.getuid?.() === 0) {
  const args = ['install', '--reinstall', resolve(file)];
  return root ? ['apt-get', args] : ['sudo', ['apt-get', ...args]];
}

export async function installLocal(desktop, { platform = process.platform, architecture = process.arch, root = process.getuid?.() === 0, run = runCommand } = {}) {
  if (platform !== 'linux') throw new Error('Cette installation est prévue pour Ubuntu/Debian.');
  const metadata = await distributionMetadata(desktop);
  const file = debPath(desktop, metadata, architecture);
  const nativeArchitecture = run('dpkg', ['--print-architecture']);
  if (nativeArchitecture !== architectures[architecture]) throw new Error(`Node et le système n’utilisent pas la même architecture (${architecture}/${nativeArchitecture}).`);
  // No sudo for compilation. Only apt performs the system installation.
  run('npm', ['run', 'dist:deb'], { cwd: desktop, stdio: 'inherit' });
  await verifyDeb(file, metadata, architecture, run);
  const [command, args] = installCommand(file, root);
  run(command, args, { stdio: 'inherit' });
  return metadata.version;
}
