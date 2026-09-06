import assert from 'node:assert/strict';
import { it } from 'node:test';
import { cardLocations, diffLocations } from './visual-transitions.js';
import { visibleFace } from './table-scene.js';
import { collectVisibleCardNames } from './board-renderer.js';
import type { AgentObservation, AgentCardObservation, AgentSelfPlayerObservation } from './types.js';
const card = (cardRef: string, zone: AgentCardObservation['zone']): AgentCardObservation => ({ cardRef, zone, name: 'Forest', ownerId: 'a', controllerId: 'a', hidden: false, faceDown: false, tapped: false, summoningSick: false, counters: null, power: null, toughness: null, typeLine: 'Land' });
function observation(): AgentObservation {
  const self: AgentSelfPlayerObservation = { playerId: 'a', role: 'self', name: 'You', life: 40, startingLife: 40, handSize: 2, librarySize: 90, graveyardSize: 0, exileSize: 0, commandZoneSize: 0, battlefieldSize: 0, externalController: true, hand: [card('one','hand'),card('two','hand')], battlefield: [], graveyard: [], exile: [], command: [], commanders: [] };
  return { gameRef: 'g', selfPlayerId: 'a', game: { turn: 1, phase: 'main1', activePlayerId: 'a', priorityPlayerId: 'a' }, players: [self], stack: [] };
}
it('moves only the exact cardRef among identical cards without mutating observations', () => {
  const before = observation(), after = structuredClone(before);
  const self = after.players[0] as AgentSelfPlayerObservation;
  self.hand.shift(); self.battlefield.push(card('one','battlefield'));
  assert.deepEqual(diffLocations(before,after), [{ cardRef: 'one', from: { playerId:'a',zone:'hand',tapped:false }, to:{ playerId:'a',zone:'battlefield',tapped:false } }]);
  assert.equal((before.players[0] as AgentSelfPlayerObservation).hand.length,2);
});
it('tracks the public stack and destinations, including controller changes', () => {
  const before = observation(), after = structuredClone(before);
  after.stack.push({ stackRef:'s',position:0,sourceCardRef:'one',sourceCardName:'Forest',controllerId:'b',description:null,hidden:false,faceDown:false });
  assert.equal(diffLocations(before,after)[0]?.to.zone,'stack');
  assert.equal(diffLocations(before,after)[0]?.to.playerId,'b');
});
it('does not infer unknown arrivals or animate between games', () => {
  const before = observation(), after = structuredClone(before);
  after.players[0]!.battlefield.push(card('new','battlefield'));
  assert.deepEqual(diffLocations(before,after),[]);
  after.gameRef='other'; assert.deepEqual(diffLocations(before,after),[]);
});
it('never indexes opponent hand even if malformed extra data is present', () => {
  const state=observation(); const opponent={...state.players[0],playerId:'b',role:'opponent',hand:[card('secret','hand')]};
  state.players.push(opponent as unknown as AgentObservation['players'][number]);
  assert.equal(cardLocations(state).has('secret'),false);
});
it('hidden and face-down cards never request art, even if a name is present', () => {
  const state=observation(); const self=state.players[0] as AgentSelfPlayerObservation;
  self.hand[0]!.hidden=true; self.hand[1]!.faceDown=true;
  assert.deepEqual(collectVisibleCardNames(state),[]);
  assert.equal(visibleFace(self.hand[0]!),false); assert.equal(visibleFace(self.hand[1]!),false);
});
