import { fileURLToPath } from 'node:url';
import { installLocal } from './distribution.mjs';

try {
  console.log('Ferme Asphodel avant l’installation. Construction du paquet local…');
  const version = await installLocal(fileURLToPath(new URL('../', import.meta.url)));
  console.log(`Asphodel ${version} est installé. Cherche « Asphodel » dans le menu d’applications.`);
} catch (error) {
  console.error(`Installation interrompue : ${error.message}`);
  process.exitCode = 1;
}
