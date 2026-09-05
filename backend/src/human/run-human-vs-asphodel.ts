import { parseArgs } from "node:util";
import { ForgeBridgeClient } from "../forge/forge-bridge-client.js";
import { ForgeExternalMatchClient } from "../forge/forge-external-match-client.js";
import { commanderFixtures } from "../forge/testing/commander-fixtures.js";
import type { ForgeDeckSpec } from "../forge/forge-protocol.js";
import { isArchidektDeckUrl } from "../decks/archidekt-deck-source.js";
import { BaselineAsphodelAgentV2b } from "../agent/improved-agent.js";
import { runHumanVsAgentMatch } from "./human-vs-agent-runner.js";
import { TerminalHumanDecisionProvider } from "./terminal-human-decision-provider.js";
import { describeAgentAction, renderGameEnd } from "./human-cli-render.js";
import { DecisionRecorder } from "./decision-recorder.js";
import { writePlaytestReport } from "./playtest-report.js";

const { values } = parseArgs({ options: {
  "human-deck": { type: "string" }, "ai-deck": { type: "string" }, seed: { type: "string", default: "42" },
} });

const HUMAN_PLAYER_ID = "player-1";
const AGENT_PLAYER_ID = "player-2";

function totalCards(deck: ForgeDeckSpec): number {
  return deck.cards.reduce((sum, card) => sum + card.quantity, 0);
}

/** A bare id ("12") loads the local Deck Library; an archidekt.com URL loads a public Archidekt deck. Omitting the flag keeps that seat's fixture. */
async function resolveDeckArg(value: string | undefined, fallback: ForgeDeckSpec): Promise<ForgeDeckSpec> {
  if (!value) return fallback;
  if (isArchidektDeckUrl(value)) {
    const { ArchidektDeckSource } = await import("../decks/archidekt-deck-source.js");
    return new ArchidektDeckSource().fetchDeckSpec(value);
  }
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id < 1) {
    throw new Error(`--human-deck/--ai-deck must be a positive integer Deck Library id or an archidekt.com deck URL, got: ${value}`);
  }
  // Loaded lazily: the Deck Library needs a local sqlite database the fixture/Archidekt paths do not.
  const [{ createDatabase }, { ScryfallCardProvider }, { DeckService }, { ForgeDeckAdapter }] = await Promise.all([
    import("../db/client.js"), import("../cards/scryfall-provider.js"), import("../decks/deck-service.js"), import("../forge/forge-deck-adapter.js"),
  ]);
  const database = await createDatabase();
  try {
    const deckService = new DeckService(database.db, new ScryfallCardProvider());
    return new ForgeDeckAdapter().toForgeDeckSpec(await deckService.getDeck(id));
  } finally {
    database.close();
  }
}

async function loadDecks(): Promise<[ForgeDeckSpec, ForgeDeckSpec]> {
  const [defaultHumanDeck, defaultAgentDeck] = commanderFixtures();
  return [
    await resolveDeckArg(values["human-deck"], defaultHumanDeck),
    await resolveDeckArg(values["ai-deck"], defaultAgentDeck),
  ];
}

const startedAt = new Date();
const decks = await loadDecks();
const bridge = new ForgeBridgeClient();
const abort = new AbortController();
const interrupt = () => abort.abort(new Error("human_vs_agent_interrupted"));
process.once("SIGINT", interrupt);
process.once("SIGTERM", interrupt);
const human = new TerminalHumanDecisionProvider(process.stdin, process.stdout, abort.signal);
const agent = new BaselineAsphodelAgentV2b();
const recorder = new DecisionRecorder();

try {
  await bridge.start();
  console.log(`Human deck: ${decks[0].name} — ${totalCards(decks[0])} cards`);
  console.log(`Asphodel deck: ${decks[1].name} — ${totalCards(decks[1])} cards`);
  console.log("\nHuman vs Asphodel — you are Player 1, Asphodel (V2b) is Player 2.");
  console.log('Type a number to choose, "h" for help, "end" (or "quit") to end the playtest and generate a report.\n');

  const run = await runHumanVsAgentMatch(
    new ForgeExternalMatchClient(bridge),
    human,
    agent,
    decks,
    HUMAN_PLAYER_ID,
    AGENT_PLAYER_ID,
    {
      seed: Number(values.seed),
      signal: abort.signal,
      onDecision: (owner, observation, decision, choice) => {
        if (owner !== "agent") return;
        recorder.record(observation, decision, choice);
        const description = describeAgentAction(observation, decision, choice);
        if (description) console.log(description);
      },
    },
  );

  const report = await writePlaytestReport({
    startedAt, sessionId: run.sessionId, seed: Number(values.seed),
    humanDeckName: decks[0].name, agentDeckName: decks[1].name,
    humanPlayerId: HUMAN_PLAYER_ID, agentPlayerId: AGENT_PLAYER_ID,
    endedByHuman: run.endedByHuman, snapshot: run.snapshot, decisions: recorder.all(),
  });

  if (run.endedByHuman) {
    console.log("\nPLAYTEST ENDED\n");
    console.log(`Turn reached: ${run.snapshot.pendingDecision?.context.turn ?? run.snapshot.observation?.game.turn ?? "unknown"}`);
    console.log(`Asphodel decisions recorded: ${recorder.all().length}`);
  } else {
    const humanTelemetry = run.snapshot.publicTelemetry?.[HUMAN_PLAYER_ID];
    const agentTelemetry = run.snapshot.publicTelemetry?.[AGENT_PLAYER_ID];
    const humanIsWinner = run.snapshot.result ? (run.snapshot.result.draw ? null : run.snapshot.result.winnerId === HUMAN_PLAYER_ID) : null;
    console.log(renderGameEnd(run.snapshot.result ?? null, run.snapshot.progress, run.snapshot.forgeAiStrategicFallbacks, humanIsWinner).join("\n"));
    console.log(`Human — attacks: ${humanTelemetry?.attacks ?? "n/a"}, damage: ${(humanTelemetry?.damageToPlayers ?? 0) + (humanTelemetry?.damageToCards ?? 0)}, spells: ${humanTelemetry?.spellsCast ?? "n/a"}`);
    console.log(`Asphodel — attacks: ${agentTelemetry?.attacks ?? "n/a"}, damage: ${(agentTelemetry?.damageToPlayers ?? 0) + (agentTelemetry?.damageToCards ?? 0)}, spells: ${agentTelemetry?.spellsCast ?? "n/a"}`);
  }
  console.log("\nPlaytest report written:");
  console.log(`  ${report.summaryPath}`);
  console.log(`  ${report.decisionsPath}`);
} catch (error) {
  console.error("\nHuman vs Asphodel session failed:", error);
  process.exitCode = 1;
} finally {
  human.close();
  process.off("SIGINT", interrupt);
  process.off("SIGTERM", interrupt);
  await bridge.stop();
}
