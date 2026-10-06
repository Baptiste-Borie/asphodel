import assert from 'node:assert/strict';
import test from 'node:test';
import { availablePrintings, printingKey, cardWithPrinting, enrichInspection } from './card-inspector';
import { ProjectHistory } from './project-history';
import { prepareProject, sheetFromProject } from './project-persistence';
import type { LabCard, LabPrinting } from '../../../shared/deck-lab';
import type { Sheet } from './deck-model';
const card = (): LabCard => ({name:'Aang // Korra',type_line:'Legendary Creature',cmc:4,mana_cost:'{2}{G}{U}',oracle_text:'Front rules\n\nBack rules',power:null,toughness:null,loyalty:null,set:'tla',set_name:'Avatar',collector_number:'1',rarity:'mythic',lang:'en',color_identity:['G','U'],image:'front-a',faces:[{name:'Aang',image:'front-a'},{name:'Korra',image:'back-a'}],related:['Korra']});
const other: LabPrinting={set:'tle',set_name:'Avatar special',collector_number:'9',rarity:'rare',lang:'fr',image:'front-b',faces:[{name:'Aang',image:'front-b'},{name:'Korra',image:'back-b'}]};
test('printing choices deduplicate by full identity and keep the saved printing first',()=>{
  const c=card();c.otherPrintings=[other,{...other},{...c}];const choices=availablePrintings(c);
  assert.deepEqual(choices.map(printingKey),[printingKey(c),printingKey(other)]);assert.equal((choices[0] as LabCard).otherPrintings,undefined);
});
test('choosing art changes every printing field and both faces while preserving Oracle rules and identity',()=>{
  const c=card(),next=cardWithPrinting(c,other);assert.equal(next.name,c.name);assert.equal(next.oracle_text,c.oracle_text);assert.deepEqual(next.color_identity,c.color_identity);
  for(const field of ['set','set_name','collector_number','rarity','lang','image','faces'] as const)assert.deepEqual(next[field],other[field]);
  assert.equal(c.image,'front-a');const noFaces={...other};delete noFaces.faces;assert.equal(cardWithPrinting(c,noFaces).faces,undefined);
});
test('catalog enrichment preserves custom art and recovers only a matching printing’s back face',()=>{
  const catalog=card();catalog.otherPrintings=[other];const saved=cardWithPrinting(card(),other);delete saved.faces;saved.oracle_text=null;
  const next=enrichInspection(saved,catalog);assert.equal(next.image,'front-b');assert.equal(next.set,'tle');assert.equal(next.faces![1]!.image,'back-b');assert.equal(next.oracle_text,catalog.oracle_text);
  const customNext=enrichInspection({...saved,image:'custom-art',set:'unknown',collector_number:'x'},catalog);assert.equal(customNext.image,'custom-art');assert.equal(customNext.faces,undefined);
});
test('a saved illustration reloads and undoes/redoes exactly with all 37 copies and entry ids intact',()=>{
  const s:Sheet={name:'Printing choice',cuts:[],groups:[{name:'Commander',commander:true,entries:[]},{name:'Ramp',entries:[{card:card(),quantity:37}]}]},h=new ProjectHistory(s);
  const before=prepareProject(s);h.begin('Printing');s.groups[1]!.entries[0]!.card=cardWithPrinting(card(),other);h.commit();const after=prepareProject(s);
  assert.equal(after.groups[1]!.entries[0]!.quantity,37);assert.equal(after.groups[1]!.entries[0]!.id,before.groups[1]!.entries[0]!.id);
  assert.deepEqual(sheetFromProject(after).groups,after.groups);h.undo();assert.deepEqual(prepareProject(s),before);h.redo();assert.deepEqual(prepareProject(s),after);
});
