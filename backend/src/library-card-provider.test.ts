import test from 'node:test';
import assert from 'node:assert/strict';
import { createDatabase } from './db/client.js';
import { cards } from './db/schema.js';
import { LibraryCardProvider } from './cards/library-card-provider.js';

test('persisted deck metadata resolves offline while unknown cards/printings use the catalogue', async () => {
  const database = await createDatabase('file::memory:');
  const requests: string[] = [];
  const provider = new LibraryCardProvider(database.db, {
    findByExactName: async name => { requests.push(name); return null; },
    findBySetAndCollector: async (set, collector) => { requests.push(`${set}/${collector}`); return null; },
  });
  try {
    await database.db.insert(cards).values({
      name: 'Sol Ring', normalizedName: 'sol ring', scryfallId: 'sol-ring',
      manaCost: '{1}', manaValue: 1, typeLine: 'Artifact', oracleText: '{T}: Add {C}{C}.', colors: [], colorIdentity: [],
    });
    assert.equal((await provider.findByExactName('  SOL RING  '))?.oracleText, '{T}: Add {C}{C}.');
    assert.deepEqual(requests, []);
    assert.equal(await provider.findByExactName('New Card'), null);
    assert.equal(await provider.findBySetAndCollector('CMM', '396'), null);
    assert.deepEqual(requests, ['New Card', 'CMM/396']);
  } finally { database.close(); }
});
