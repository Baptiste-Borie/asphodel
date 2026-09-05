import { parseArgs } from "node:util";
import { ForgeBridgeClient } from "../forge/forge-bridge-client.js";
import { ForgeExternalMatchClient } from "../forge/forge-external-match-client.js";
import { commanderFixtures } from "../forge/testing/commander-fixtures.js";
import type { ForgeDeckSpec } from "../forge/forge-protocol.js";
import { BaselineAsphodelAgentV2b } from "../agent/improved-agent.js";
import { AgentRunError } from "../agent/agent-runner.js";
import { runHumanVsAgentMatch } from "./human-vs-agent-runner.js";
import { HumanQuitError, TerminalHumanDecisionProvider } from "./terminal-human-decision-provider.js";
import { describeAgentAction, renderGameEnd } from "./human-cli-render.js";

const { values } = parseArgs({ options: {
  "human-deck": { type: "string" }, "ai-deck": { type: "string" }, seed: { type: "string", default: "42" },
} });

const HUMAN_PLAYER_ID = "player-1";
const AGENT_PLAYER_ID = "player-2";

async function loadDecks(): Promise<[ForgeDeckSpec, ForgeDeckSpec]> {
  const humanDeckId = values["human-deck"], aiDeckId = values["ai-deck"];
  if (!humanDeckId && !aiDeckId) return commanderFixtures();
  if (!humanDeckId || !aiDeckId) throw new Error("Provide both --human-deck and --ai-deck, or neither to use the default fixture decks.");
  // Loaded lazily: the Deck Library needs a local sqlite database the fixture path does not.
  const [{ createDatabase }, { ScryfallCardProvider }, { DeckService }, { ForgeDeckAdapter }] = await Promise.all([
    import("../db/client.js"), import("../cards/scryfall-provider.js"), import("../decks/deck-service.js"), import("../forge/forge-deck-adapter.js"),
  ]);
  const database = await createDatabase();
  try {
    const deckService = new DeckService(database.db, new ScryfallCardProvider());
    const adapter = new ForgeDeckAdapter();
    const [humanDeck, aiDeck] = await Promise.all([deckService.getDeck(Number(humanDeckId)), deckService.getDeck(Number(aiDeckId))]);
    return [adapter.toForgeDeckSpec(humanDeck), adapter.toForgeDeckSpec(aiDeck)];
  } finally {
    database.close();
  }
}

function isHumanQuit(error: unknown): boolean {
  if (error instanceof HumanQuitError) return true;
  if (!(error instanceof AgentRunError)) return false;
  const cause = error.cause;
  return cause instanceof HumanQuitError || (cause instanceof AggregateError && cause.errors.some(e => e instanceof HumanQuitError));
}

const decks = await loadDecks();
const bridge = new ForgeBridgeClient();
const abort = new AbortController();
const interrupt = () => abort.abort(new Error("human_vs_agent_interrupted"));
process.once("SIGINT", interrupt);
process.once("SIGTERM", interrupt);
const human = new TerminalHumanDecisionProvider(process.stdin, process.stdout, abort.signal);
const agent = new BaselineAsphodelAgentV2b();

try {
  await bridge.start();
  console.log("Human vs Asphodel — you are Player 1, Asphodel (V2b) is Player 2.");
  console.log('Type a number to choose, "h" for help, "quit" to end the session.\n');
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
        const description = describeAgentAction(observation, decision, choice);
        if (description) console.log(description);
      },
    },
  );
  const humanTelemetry = run.snapshot.publicTelemetry?.[HUMAN_PLAYER_ID];
  const agentTelemetry = run.snapshot.publicTelemetry?.[AGENT_PLAYER_ID];
  const humanIsWinner = run.snapshot.result ? (run.snapshot.result.draw ? null : run.snapshot.result.winnerId === HUMAN_PLAYER_ID) : null;
  console.log(renderGameEnd(run.snapshot.result ?? null, run.snapshot.progress, run.snapshot.forgeAiStrategicFallbacks, humanIsWinner).join("\n"));
  console.log(`Human — attacks: ${humanTelemetry?.attacks ?? "n/a"}, damage: ${(humanTelemetry?.damageToPlayers ?? 0) + (humanTelemetry?.damageToCards ?? 0)}, spells: ${humanTelemetry?.spellsCast ?? "n/a"}`);
  console.log(`Asphodel — attacks: ${agentTelemetry?.attacks ?? "n/a"}, damage: ${(agentTelemetry?.damageToPlayers ?? 0) + (agentTelemetry?.damageToCards ?? 0)}, spells: ${agentTelemetry?.spellsCast ?? "n/a"}`);
} catch (error) {
  if (isHumanQuit(error)) {
    console.log("\nSession ended.");
  } else {
    console.error("\nHuman vs Asphodel session failed:", error);
    process.exitCode = 1;
  }
} finally {
  human.close();
  process.off("SIGINT", interrupt);
  process.off("SIGTERM", interrupt);
  await bridge.stop();
}
