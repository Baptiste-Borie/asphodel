import assert from "node:assert/strict";
import { it } from "node:test";
import { buildDockItems, decideCardAction, mapActionsToCards, mapPriorityActionsToHand, splitCardActionMapByHand } from "./hand-action-mapping.js";
import type { AgentCardObservation, DecisionPrompt, MenuItem } from "./types.js";

function handCard(cardRef: string, name = "Mountain"): AgentCardObservation {
  return { cardRef, name, zone: "hand", ownerId: "player-1", controllerId: "player-1", faceDown: false, hidden: false, tapped: null, summoningSick: null, counters: null, power: null, toughness: null, typeLine: "Land" };
}

function menuItem(label: string, actionId: string, cardRef?: string | null): MenuItem {
  return { label, choice: { decisionId: "d-1", kind: "action", choice: actionId, reason: "human_choice" }, cardRef };
}

function menuPrompt(items: MenuItem[]): DecisionPrompt {
  return { kind: "menu", title: "Choose an action", items };
}

it("a hand card with exactly one legal action is playable and maps to that one action", () => {
  const hand = [handCard("mtn-1")];
  const items = [menuItem("Pass priority", "pass", null), menuItem("Play Mountain", "play-1", "mtn-1")];
  const mapping = mapPriorityActionsToHand(menuPrompt(items), hand);
  assert.ok(mapping.byCardRef.has("mtn-1"), "the hand card must be recognized as playable");
  assert.deepEqual(mapping.byCardRef.get("mtn-1")!.map(i => i.label), ["Play Mountain"]);
});

it("a hand card with no legal action is not present in byCardRef (not playable)", () => {
  const hand = [handCard("mtn-1"), handCard("swamp-1", "Swamp")];
  const items = [menuItem("Pass priority", "pass", null), menuItem("Play Mountain", "play-1", "mtn-1")];
  const mapping = mapPriorityActionsToHand(menuPrompt(items), hand);
  assert.equal(mapping.byCardRef.has("swamp-1"), false);
});

it("duplicate same-name hand cards map independently by cardRef, never collapsed by name", () => {
  const hand = [handCard("mtn-1", "Mountain"), handCard("mtn-2", "Mountain")];
  const items = [
    menuItem("Pass priority", "pass", null),
    menuItem("Play Mountain", "play-mtn-1", "mtn-1"),
    menuItem("Play Mountain", "play-mtn-2", "mtn-2"),
  ];
  const mapping = mapPriorityActionsToHand(menuPrompt(items), hand);
  assert.equal(mapping.byCardRef.size, 2);
  assert.equal(mapping.byCardRef.get("mtn-1")![0]!.choice.choice, "play-mtn-1");
  assert.equal(mapping.byCardRef.get("mtn-2")![0]!.choice.choice, "play-mtn-2");
});

it("Pass priority always stays unmapped (no cardRef), so it always remains in the action dock", () => {
  const hand = [handCard("mtn-1")];
  const items = [menuItem("Pass priority", "pass", null), menuItem("Play Mountain", "play-1", "mtn-1")];
  const mapping = mapPriorityActionsToHand(menuPrompt(items), hand);
  assert.deepEqual(mapping.unmapped.map(i => i.label), ["Pass priority"]);
});

it("an action whose cardRef is not currently a card in this hand stays unmapped (e.g. a battlefield-sourced ability)", () => {
  const hand = [handCard("mtn-1")];
  const items = [menuItem("Pass priority", "pass", null), menuItem("Activate Sol Ring", "activate-1", "sol-ring-battlefield")];
  const mapping = mapPriorityActionsToHand(menuPrompt(items), hand);
  assert.equal(mapping.byCardRef.size, 0);
  assert.deepEqual(mapping.unmapped.map(i => i.label), ["Pass priority", "Activate Sol Ring"]);
});

it("a value-kind prompt (X spells) is left entirely untouched by this patch", () => {
  const prompt: DecisionPrompt = { kind: "value", title: "Choose X", decisionId: "d-1", min: 0, max: 5, suggested: [0] };
  const mapping = mapPriorityActionsToHand(prompt, [handCard("mtn-1")]);
  assert.equal(mapping.byCardRef.size, 0);
  assert.deepEqual(mapping.unmapped, []);
});

it("calling the mapping again with unchanged inputs (simulated re-polling) yields the same result — nothing incorrectly loses its playable status", () => {
  const hand = [handCard("mtn-1"), handCard("mtn-2")];
  const items = [menuItem("Pass priority", "pass", null), menuItem("Play Mountain", "play-mtn-1", "mtn-1"), menuItem("Play Mountain", "play-mtn-2", "mtn-2")];
  const first = mapPriorityActionsToHand(menuPrompt(items), hand);
  const second = mapPriorityActionsToHand(menuPrompt(items), hand);
  assert.deepEqual([...first.byCardRef.keys()].sort(), [...second.byCardRef.keys()].sort());
  assert.deepEqual(first.unmapped.map(i => i.label), second.unmapped.map(i => i.label));
});

it("mapActionsToCards (V2e.5): generalizes beyond the hand — e.g. battlefield attacker options, by cardRef", () => {
  const battlefieldRefs = ["goblin-1", "goblin-2", "goblin-3"];
  const items = [
    menuItem("Add Goblin (attacking)", "o-1", "goblin-1"),
    menuItem("Add Goblin (attacking)", "o-2", "goblin-2"),
    menuItem("Finish declaring attackers", "o-3", null),
  ];
  const mapping = mapActionsToCards(menuPrompt(items), battlefieldRefs);
  assert.equal(mapping.byCardRef.size, 2);
  assert.deepEqual(mapping.unmapped.map(i => i.label), ["Finish declaring attackers"]);
  // goblin-3 is visible but has no legal action right now — correctly absent, not fabricated.
  assert.equal(mapping.byCardRef.has("goblin-3"), false);
});

it("decideCardAction: exactly one legal action submits it directly", () => {
  const decision = decideCardAction([menuItem("Play Mountain", "play-1", "mtn-1")]);
  assert.equal(decision.kind, "submit");
  if (decision.kind === "submit") assert.equal(decision.choice.choice, "play-1");
});

it("decideCardAction: more than one legal action opens a contextual menu of exactly those options", () => {
  const items = [menuItem("Cast for {2}{R}", "cast-normal", "spell-1"), menuItem("Cast for alternate cost", "cast-alt", "spell-1")];
  const decision = decideCardAction(items);
  assert.equal(decision.kind, "menu");
  if (decision.kind === "menu") assert.deepEqual(decision.items.map(i => i.label), ["Cast for {2}{R}", "Cast for alternate cost"]);
});

it("splitCardActionMapByHand (V2e.6): a hand card AND a battlefield card can both be mapped from the SAME priority_action decision", () => {
  const items = [
    menuItem("Pass priority", "pass", null),
    menuItem("Cast Krenko, Tin Street Kingpin", "cast-krenko", "krenko-hand-1"),
    menuItem("Activate Skirk Prospector", "activate-skirk", "skirk-battlefield-1"),
  ];
  const combined = mapActionsToCards(menuPrompt(items), ["krenko-hand-1", "skirk-battlefield-1"]);
  const { hand, board } = splitCardActionMapByHand(combined, ["krenko-hand-1"]);
  assert.ok(hand.byCardRef.has("krenko-hand-1"), "the hand card must map to the hand bucket");
  assert.equal(hand.byCardRef.has("skirk-battlefield-1"), false, "the battlefield card must not leak into the hand bucket");
  assert.ok(board.byCardRef.has("skirk-battlefield-1"), "the battlefield permanent must map to the board bucket");
  assert.equal(board.byCardRef.has("krenko-hand-1"), false, "the hand card must not leak into the board bucket");
});

it("splitCardActionMapByHand: a Skirk-Prospector-style battlefield activation maps by cardRef, distinct from any hand card", () => {
  const items = [menuItem("Activate Skirk Prospector", "activate-skirk", "skirk-1")];
  const combined = mapActionsToCards(menuPrompt(items), ["skirk-1"]);
  const { hand, board } = splitCardActionMapByHand(combined, []); // empty hand this turn
  assert.equal(hand.byCardRef.size, 0);
  assert.deepEqual(board.byCardRef.get("skirk-1")?.map(i => i.choice.choice), ["activate-skirk"]);
});

it("splitCardActionMapByHand: Pass remains unmapped/dock on both sides", () => {
  const items = [menuItem("Pass priority", "pass", null), menuItem("Cast Krenko", "cast-krenko", "krenko-1")];
  const combined = mapActionsToCards(menuPrompt(items), ["krenko-1"]);
  const { hand, board } = splitCardActionMapByHand(combined, ["krenko-1"]);
  assert.deepEqual(hand.unmapped.map(i => i.label), ["Pass priority"]);
  assert.deepEqual(board.unmapped.map(i => i.label), ["Pass priority"]);
});

it("splitCardActionMapByHand: duplicate card names (two Mountains, one in hand one on the battlefield) remain distinct by cardRef", () => {
  const items = [
    menuItem("Play Mountain", "play-mtn", "mtn-hand-1"),
    menuItem("Activate Mountain-ability", "activate-mtn", "mtn-battlefield-1"),
  ];
  const combined = mapActionsToCards(menuPrompt(items), ["mtn-hand-1", "mtn-battlefield-1"]);
  const { hand, board } = splitCardActionMapByHand(combined, ["mtn-hand-1"]);
  assert.deepEqual(hand.byCardRef.get("mtn-hand-1")?.map(i => i.choice.choice), ["play-mtn"]);
  assert.deepEqual(board.byCardRef.get("mtn-battlefield-1")?.map(i => i.choice.choice), ["activate-mtn"]);
  assert.equal(hand.byCardRef.has("mtn-battlefield-1"), false);
  assert.equal(board.byCardRef.has("mtn-hand-1"), false);
});

// --- buildDockItems (V2g.1: "expose physical hand actions in Companion mode") ---------------

it("DIGITAL: a hand-mapped cast action is filtered from the dock, exactly as before", () => {
  const items = [menuItem("Pass priority", "pass", null), menuItem("Cast Stinkweed Imp", "cast-imp", "imp-hand-1")];
  const combined = mapActionsToCards(menuPrompt(items), ["imp-hand-1"]);
  const { hand, board } = splitCardActionMapByHand(combined, ["imp-hand-1"]);
  const dock = buildDockItems({ hand, board, unmapped: combined.unmapped }, "digital");
  assert.deepEqual(dock.map(i => i.label), ["Pass priority"]);
});

it("PHYSICAL: the same hand-mapped cast action remains in the dock", () => {
  const items = [menuItem("Pass priority", "pass", null), menuItem("Cast Stinkweed Imp", "cast-imp", "imp-hand-1")];
  const combined = mapActionsToCards(menuPrompt(items), ["imp-hand-1"]);
  const { hand, board } = splitCardActionMapByHand(combined, ["imp-hand-1"]);
  const dock = buildDockItems({ hand, board, unmapped: combined.unmapped }, "physical");
  assert.deepEqual(dock.map(i => i.label).sort(), ["Cast Stinkweed Imp", "Pass priority"].sort());
});

it("PHYSICAL: a legal play_land action mapped to hand remains in the dock", () => {
  const items = [menuItem("Pass priority", "pass", null), menuItem("Play Forest", "play-forest", "forest-hand-1")];
  const combined = mapActionsToCards(menuPrompt(items), ["forest-hand-1"]);
  const { hand, board } = splitCardActionMapByHand(combined, ["forest-hand-1"]);
  const dock = buildDockItems({ hand, board, unmapped: combined.unmapped }, "physical");
  assert.ok(dock.some(i => i.label === "Play Forest" && i.choice.choice === "play-forest"));
});

it("PHYSICAL: Pass priority remains available", () => {
  const items = [menuItem("Pass priority", "pass", null), menuItem("Cast Lightning Bolt", "cast-bolt", "bolt-hand-1")];
  const combined = mapActionsToCards(menuPrompt(items), ["bolt-hand-1"]);
  const { hand, board } = splitCardActionMapByHand(combined, ["bolt-hand-1"]);
  const dock = buildDockItems({ hand, board, unmapped: combined.unmapped }, "physical");
  assert.ok(dock.some(i => i.label === "Pass priority"));
});

it("PHYSICAL: board-mapped actions are not duplicated into the dock (kept on their existing direct-card surface)", () => {
  const items = [
    menuItem("Pass priority", "pass", null),
    menuItem("Cast Krenko, Tin Street Kingpin", "cast-krenko", "krenko-hand-1"),
    menuItem("Activate Skirk Prospector", "activate-skirk", "skirk-battlefield-1"),
  ];
  const combined = mapActionsToCards(menuPrompt(items), ["krenko-hand-1", "skirk-battlefield-1"]);
  const { hand, board } = splitCardActionMapByHand(combined, ["krenko-hand-1"]);
  const dock = buildDockItems({ hand, board, unmapped: combined.unmapped }, "physical");
  assert.deepEqual(dock.map(i => i.label).sort(), ["Cast Krenko, Tin Street Kingpin", "Pass priority"].sort());
  assert.equal(dock.some(i => i.label === "Activate Skirk Prospector"), false, "still represented by the clickable battlefield card, not the dock");
});

it("DIGITAL: command-zone / battlefield behavior is unchanged — a command-zone-mapped action stays out of the dock", () => {
  const items = [menuItem("Cast Commander", "cast-cmdr", "cmdr-1")];
  const combined = mapActionsToCards(menuPrompt(items), ["cmdr-1"]); // no hand refs — a command-zone card is never "hand"
  const { hand, board } = splitCardActionMapByHand(combined, []);
  const digitalDock = buildDockItems({ hand, board, unmapped: combined.unmapped }, "digital");
  assert.deepEqual(digitalDock, []);
});

// --- buildDockItems (V2g.1 fix: never leave the Physical dock completely empty) -------------

it("PHYSICAL: a decision ENTIRELY mapped to board/command-zone cards (no unmapped option, no hand action) falls back to the compact explicit list — never an empty dock", () => {
  const items = [menuItem("Cast Commander", "cast-cmdr", "cmdr-1")];
  const combined = mapActionsToCards(menuPrompt(items), ["cmdr-1"]);
  const { hand, board } = splitCardActionMapByHand(combined, []);
  const physicalDock = buildDockItems({ hand, board, unmapped: combined.unmapped }, "physical");
  assert.deepEqual(physicalDock.map(i => i.label), ["Cast Commander"]);
  assert.equal(physicalDock[0], items[0], "the exact same MenuItem object is surfaced — never a rebuilt copy");
});

it('PHYSICAL: "Choose your Ring-bearer"-shaped decision (every option board-mapped, no Pass/Cancel) surfaces ALL legal creatures explicitly', () => {
  const items = [
    menuItem("Griffin Sentinel", "select-griffin", "griffin-1"),
    menuItem("Bear Cub", "select-bear", "bear-1"),
  ];
  const combined = mapActionsToCards(menuPrompt(items), ["griffin-1", "bear-1"]);
  const { hand, board } = splitCardActionMapByHand(combined, []); // no hand refs — both are battlefield creatures
  const physicalDock = buildDockItems({ hand, board, unmapped: combined.unmapped }, "physical");
  assert.deepEqual(physicalDock.map(i => i.choice.choice).sort(), ["select-bear", "select-griffin"]);
});

it("PHYSICAL: the board fallback never fires when the dock already has an unmapped option (e.g. Pass) — board keeps its plain direct-card affordance, uncluttered", () => {
  const items = [
    menuItem("Pass priority", "pass", null),
    menuItem("Activate Skirk Prospector", "activate-skirk", "skirk-battlefield-1"),
  ];
  const combined = mapActionsToCards(menuPrompt(items), ["skirk-battlefield-1"]);
  const { hand, board } = splitCardActionMapByHand(combined, []);
  const physicalDock = buildDockItems({ hand, board, unmapped: combined.unmapped }, "physical");
  assert.deepEqual(physicalDock.map(i => i.label), ["Pass priority"]);
});

it("PHYSICAL: the board fallback never fires when the dock already has a hand-mapped action", () => {
  const items = [
    menuItem("Cast Krenko, Tin Street Kingpin", "cast-krenko", "krenko-hand-1"),
    menuItem("Activate Skirk Prospector", "activate-skirk", "skirk-battlefield-1"),
  ];
  const combined = mapActionsToCards(menuPrompt(items), ["krenko-hand-1", "skirk-battlefield-1"]);
  const { hand, board } = splitCardActionMapByHand(combined, ["krenko-hand-1"]);
  const physicalDock = buildDockItems({ hand, board, unmapped: combined.unmapped }, "physical");
  assert.deepEqual(physicalDock.map(i => i.label), ["Cast Krenko, Tin Street Kingpin"]);
});

it("DIGITAL: the board fallback never applies — Digital always relies on direct-card clicking for board-only decisions, unchanged", () => {
  const items = [menuItem("Griffin Sentinel", "select-griffin", "griffin-1")];
  const combined = mapActionsToCards(menuPrompt(items), ["griffin-1"]);
  const { hand, board } = splitCardActionMapByHand(combined, []);
  const digitalDock = buildDockItems({ hand, board, unmapped: combined.unmapped }, "digital");
  assert.deepEqual(digitalDock, []);
});

it("exact AgentChoice/action id is preserved end to end through buildDockItems", () => {
  const items = [menuItem("Cast Lightning Bolt", "cast-bolt-exact-id", "bolt-hand-1")];
  const combined = mapActionsToCards(menuPrompt(items), ["bolt-hand-1"]);
  const { hand, board } = splitCardActionMapByHand(combined, ["bolt-hand-1"]);
  const dock = buildDockItems({ hand, board, unmapped: combined.unmapped }, "physical");
  assert.equal(dock.length, 1);
  assert.equal(dock[0]!.choice.choice, "cast-bolt-exact-id");
  assert.equal(dock[0]!.choice.decisionId, "d-1");
  assert.equal(dock[0], items[0], "the exact same MenuItem object is surfaced — never a rebuilt copy");
});

it("PHYSICAL: duplicate same-name hand cards do not collapse — each keeps its own distinct dock entry", () => {
  const items = [
    menuItem("Play Mountain", "play-mtn-1", "mtn-1"),
    menuItem("Play Mountain", "play-mtn-2", "mtn-2"),
  ];
  const combined = mapActionsToCards(menuPrompt(items), ["mtn-1", "mtn-2"]);
  const { hand, board } = splitCardActionMapByHand(combined, ["mtn-1", "mtn-2"]);
  const dock = buildDockItems({ hand, board, unmapped: combined.unmapped }, "physical");
  assert.equal(dock.length, 2);
  assert.deepEqual(dock.map(i => i.choice.choice).sort(), ["play-mtn-1", "play-mtn-2"]);
});

it("PHYSICAL: when the Forge decision changes, stale hand actions disappear (buildDockItems is a pure function of the CURRENT mapping only)", () => {
  const before = [menuItem("Cast Stinkweed Imp", "cast-imp", "imp-hand-1"), menuItem("Pass priority", "pass", null)];
  const combinedBefore = mapActionsToCards(menuPrompt(before), ["imp-hand-1"]);
  const splitBefore = splitCardActionMapByHand(combinedBefore, ["imp-hand-1"]);
  const dockBefore = buildDockItems({ ...splitBefore, unmapped: combinedBefore.unmapped }, "physical");
  assert.ok(dockBefore.some(i => i.label === "Cast Stinkweed Imp"));

  // Next decision: the Imp already resolved off the stack — no longer a legal hand action at all.
  const after = [menuItem("Pass priority", "pass", null)];
  const combinedAfter = mapActionsToCards(menuPrompt(after), ["imp-hand-1"]);
  const splitAfter = splitCardActionMapByHand(combinedAfter, ["imp-hand-1"]);
  const dockAfter = buildDockItems({ ...splitAfter, unmapped: combinedAfter.unmapped }, "physical");
  assert.equal(dockAfter.some(i => i.label === "Cast Stinkweed Imp"), false);
  assert.deepEqual(dockAfter.map(i => i.label), ["Pass priority"]);
});
