import { readFile, writeFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { ForgeBridgeClient } from "../forge/forge-bridge-client.js";
import { ForgeExternalMatchClient } from "../forge/forge-external-match-client.js";
import { commanderFixtures } from "../forge/testing/commander-fixtures.js";
import { BaselineAsphodelAgentV2a } from "./policy-version.js";
import { BaselineAsphodelAgentV2b } from "./improved-agent.js";
import { evaluateAgent } from "./evaluate-agent.js";

const { values } = parseArgs({ options: {
  games: { type: "string", default: "20" }, "seed-start": { type: "string", default: "1" }, seeds: { type: "string" },
  policy: { type: "string", default: "v2b" }, deck: { type: "string", default: "krenko" }, opponent: { type: "string", default: "forge" },
  json: { type: "string" }, diagnostics: { type: "boolean", default: false },
} });
const count = Number(values.games), start = Number(values["seed-start"]);
if (!Number.isSafeInteger(count) || count < 1 || count > 10000 || !Number.isSafeInteger(start)
  || !["v2a", "v2b"].includes(values.policy) || values.deck !== "krenko" || values.opponent !== "forge") throw new Error("Invalid evaluation arguments");
const seeds = values.seeds ? values.seeds.split(",").map(Number) : Array.from({ length: count }, (_, i) => start + i);
const bridge = new ForgeBridgeClient();
const abort = new AbortController();
const interrupt = () => abort.abort(new Error("evaluation_interrupted"));
process.once("SIGINT", interrupt); process.once("SIGTERM", interrupt);
try {
  await bridge.start();
  const engine = await bridge.request({ type: "engine_info" });
  const resources: { seed: number; rssKb: number | null; threads: number | null; nodeHeapBytes: number }[] = [];
  const report = await evaluateAgent({ agent: values.policy === "v2a" ? new BaselineAsphodelAgentV2a() : new BaselineAsphodelAgentV2b(), client: new ForgeExternalMatchClient(bridge),
    decks: commanderFixtures(), seeds, opponent: "forge", keepCombatSamples: values.diagnostics, limits: { signal: abort.signal },
    onGame: async game => {
      const status = await readFile(`/proc/${bridge.pid}/status`, "utf8").catch(() => "");
      const field = (name: string) => { const value = status.match(new RegExp(`^${name}:\\s+(\\d+)`, "m"))?.[1]; return value ? Number(value) : null; };
      resources.push({ seed: game.seed, rssKb: field("VmRSS"), threads: field("Threads"), nodeHeapBytes: process.memoryUsage().heapUsed });
      console.error(JSON.stringify({ seed: game.seed, status: game.status, winner: game.winner, turns: game.metrics?.turns, attacks: game.metrics?.attacks, damage: game.metrics?.damageDealt, error: game.error }));
      if (values.json) await writeFile(`${values.json}.latest`, JSON.stringify(game, null, 2));
    } });
  const output = { ...report, engine, bridgePid: bridge.pid, resources };
  if (values.json) await writeFile(values.json, JSON.stringify(output, null, 2));
  console.log(JSON.stringify(report.aggregate, null, 2));
  if (report.aggregate.completionRate !== 1) process.exitCode = 1;
} finally {
  process.off("SIGINT", interrupt); process.off("SIGTERM", interrupt);
  await bridge.stop();
}
