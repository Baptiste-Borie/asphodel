import { readFile } from "node:fs/promises";
import { ForgeBridgeClient } from "../forge/forge-bridge-client.js";
import { ForgeExternalMatchClient } from "../forge/forge-external-match-client.js";
import type { ForgeDeckSpec } from "../forge/forge-protocol.js";
import { commanderFixtures } from "../forge/testing/commander-fixtures.js";
import { BaselineAsphodelAgent } from "./baseline-agent.js";
import { runAgentMatch } from "./agent-runner.js";

// Optional JSON file is a tuple of ForgeDeckSpecs; native Forge validates the decks.
const decks: [ForgeDeckSpec, ForgeDeckSpec] = process.argv[2]
  ? JSON.parse(await readFile(process.argv[2], "utf8")) as [ForgeDeckSpec, ForgeDeckSpec] : commanderFixtures();
const bridge = new ForgeBridgeClient();
const cancellation = new AbortController();
const interrupt = () => cancellation.abort(new Error("agent_interrupted"));
process.once("SIGINT", interrupt);
process.once("SIGTERM", interrupt);
try {
  await bridge.start();
  const result = await runAgentMatch(new ForgeExternalMatchClient(bridge), new BaselineAsphodelAgent(), decks,
    { seed: 42, signal: cancellation.signal });
  console.log(JSON.stringify({ metrics: result.metrics, trace: result.trace }, null, 2));
} finally {
  process.off("SIGINT", interrupt);
  process.off("SIGTERM", interrupt);
  await bridge.stop();
}
