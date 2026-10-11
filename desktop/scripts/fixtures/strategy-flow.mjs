import {populatedTableFixture} from './populated-table.mjs';

/** Presentation-only sequence: exact fixture choices, public state changes, no Forge simulation. */
export async function strategyFixture(count=2) {
  const fixture=await populatedTableFixture('digital',count);
  const initial=fixture.states[0], next=structuredClone(initial);
  const self=next.observation.players.find(player=>player.role==='self');
  const index=self.hand.findIndex(card=>card.name==='Elvish Mystic');
  const [arrival]=self.hand.splice(index,1);arrival.zone='battlefield';arrival.summoningSick=true;self.battlefield.push(arrival);
  self.handSize=self.hand.length;self.battlefieldSize=self.battlefield.length;
  self.life=37;self.battlefield[0].tapped=true;
  next.observation.game.activePlayerId=next.observation.players[1].playerId;
  next.observation.game.phase='main2';
  next.pendingDecision.decisionId='strategy-next-priority';
  next.pendingDecision.context={...next.observation.game,stackSize:0};
  next.pendingDecision.rendered.items[0].choice.decisionId=next.pendingDecision.decisionId;
  fixture.states=[initial,next];fixture.transition=['pass'];
  return fixture;
}
