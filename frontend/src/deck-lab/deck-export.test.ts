import assert from 'node:assert/strict';
import test from 'node:test';
import { exportDeckText, deckTextFilename } from './deck-export';
import { parseDeckList } from '../../../backend/src/deck-parser.js';
import type { Sheet } from './deck-model';
const card=(name:string)=>({name} as any);
const sheet:Sheet={name:'Aang / Appa',cuts:[card('Cut idea')],groups:[
  {name:'Commander',commander:true,entries:[{card:card('Aang'),quantity:1},{card:card('Appa'),quantity:1}]},
  {name:'Lands',entries:[{card:card('Forest'),quantity:20}]},{name:'Ramp',entries:[{card:card('Forest'),quantity:17},{card:card('Sol Ring'),quantity:1}]},
  {name:'Maybe',maybeboard:true,entries:[{card:card('Idea'),quantity:2}]},
]};
test('default text round-trips two commanders and quantities; candidates and cuts stay outside the played deck',()=>{
  const text=exportDeckText(sheet);const parsed=parseDeckList(text);
  assert.deepEqual(parsed.issues,[]);assert.equal(parsed.summary.totalCards,40);
  assert.equal(parsed.cards.find(c=>c.name==='Forest')!.quantity,37);
  assert.equal(parsed.cards.filter(c=>c.section==='commander').length,2);
  assert.ok(!text.includes('Idea')&&!text.includes('Cut idea'));
});
test('optional candidate section is explicit; export never mutates the table and filenames cannot escape a directory',()=>{
  const before=JSON.stringify(sheet);assert.match(exportDeckText(sheet,true),/Maybeboard\n2 Idea/);
  assert.equal(JSON.stringify(sheet),before);assert.equal(deckTextFilename('../Aang / Appa'),'-Aang - Appa.txt');
  assert.equal(deckTextFilename(''), 'deck.txt');
});
