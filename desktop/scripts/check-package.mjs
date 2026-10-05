import { fileURLToPath } from 'node:url';
import { debPath, distributionMetadata, verifyDeb } from './distribution.mjs';

try {
  const desktop = fileURLToPath(new URL('../', import.meta.url));
  const metadata = await distributionMetadata(desktop, process.env.GITHUB_REF ?? '');
  if (process.argv.includes('--version-only')) console.log(`Version vérifiée : ${metadata.version}`);
  else {
    const file = await verifyDeb(debPath(desktop, metadata), metadata);
    console.log(`Paquet vérifié : ${file}\nLanceur, icône, frontend, backend, Java et ressources Forge présents.`);
  }
} catch (error) { console.error(error.message); process.exitCode = 1; }
