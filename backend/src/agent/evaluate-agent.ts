import { createHash } from "node:crypto";
import type { ForgeDeckSpec } from "../forge/forge-protocol.js";
import { AgentRunError, gameMetrics, runAgentMatch, type AgentMatchTransport, type AgentRunOptions, type AgentTraceEntry } from "./agent-runner.js";
import { EvaluationDiagnostics } from "./evaluation-diagnostics.js";
import type { VersionedAsphodelAgent } from "./policy-version.js";

export interface EvaluationOptions {
  agent: VersionedAsphodelAgent;
  client: AgentMatchTransport;
  decks: [ForgeDeckSpec, ForgeDeckSpec];
  seeds: readonly number[];
  opponent: "forge";
  limits?: Omit<AgentRunOptions, "seed" | "onDecision">;
  keepCombatSamples?: boolean;
  onGame?: (game: EvaluatedGame) => void | Promise<void>;
}
export interface EvaluatedGame {
  seed: number;
  policyVersion: string;
  status: "completed" | "timeout" | "stalled" | "cancelled" | "error";
  error: string | null;
  winner: "agent" | "opponent" | "draw" | null;
  metrics: ReturnType<typeof gameMetrics> | null;
  diagnostics: ReturnType<EvaluationDiagnostics["result"]>;
}
const mean = (numbers: number[]) => numbers.length ? numbers.reduce((a, b) => a + b, 0) / numbers.length : null;
export function aggregateGames(games: EvaluatedGame[]) {
  const completed = games.filter(g => g.status === "completed");
  const withMetrics = games.filter(g => g.metrics !== null);
  const values = (field: "turns" | "externalDecisions" | "damageDealt" | "attacks" | "spellsCast" | "landsPlayed") => completed.flatMap(g => typeof g.metrics?.[field] === "number" ? [g.metrics[field] as number] : []);
  const turns = values("turns").sort((a, b) => a - b);
  const offered = games.reduce((n, g) => n + g.diagnostics.attackOpportunities, 0);
  const taken = games.reduce((n, g) => n + g.diagnostics.attacksTaken, 0);
  const fallbacks: Record<string, number> = {};
  for (const game of games) for (const [key, count] of Object.entries(game.metrics?.fallbackCounts ?? {})) fallbacks[key] = (fallbacks[key] ?? 0) + count;
  const rate = (count: number) => games.length ? count / games.length : null;
  return {
    games: games.length, completed: completed.length, gamesWithMetrics: withMetrics.length, wins: completed.filter(g => g.winner === "agent").length,
    winRate: rate(completed.filter(g => g.winner === "agent").length), completionRate: rate(completed.length),
    averageTurns: mean(turns), medianTurns: turns.length ? (turns[Math.floor((turns.length - 1) / 2)]! + turns[Math.floor(turns.length / 2)]!) / 2 : null,
    averageDecisions: mean(values("externalDecisions")), averageDamage: mean(values("damageDealt")), averageAttacks: mean(values("attacks")),
    averageSpellsCast: mean(values("spellsCast")), averageLandsPlayed: mean(values("landsPlayed")),
    attackOpportunities: offered, attacksTaken: taken, attackConversionRate: offered ? taken / offered : null,
    timeouts: games.filter(g => g.status === "timeout").length, stalls: games.filter(g => g.status === "stalled").length,
    errors: games.filter(g => g.status === "error").length, cancelled: games.filter(g => g.status === "cancelled").length,
    timeoutErrorRate: rate(games.filter(g => g.status !== "completed").length), fallbackCounts: fallbacks,
    fallbackRate: withMetrics.length ? withMetrics.filter(g => Object.values(g.metrics!.fallbackCounts).some(n => n > 0)).length / withMetrics.length : null,
    fallbackRateDenominator: "games_with_metrics",
    unexpectedFallbacks: Object.entries(fallbacks).filter(([key]) => key !== "combat_damage:assignCombatDamage").reduce((n, [, count]) => n + count, 0),
    manaFallbacks: games.reduce((n, g) => n + (g.metrics?.manaFallbacks ?? 0), 0),
    // Damage/action/turn means are completed-game means; rates retain failures in their denominator.
    meanDenominator: "completed_games_with_metric", rateDenominator: "all_attempted_games",
  };
}

/** Sequential by design. The caller owns one bridge and can reuse it for the entire batch. */
export async function evaluateAgent(options: EvaluationOptions) {
  if (options.opponent !== "forge" || !options.seeds.length || options.seeds.some(s => !Number.isSafeInteger(s))) throw new Error("invalid_evaluation_configuration");
  const games: EvaluatedGame[] = [];
  for (const seed of options.seeds) {
    options.limits?.signal?.throwIfAborted();
    const diagnostics = new EvaluationDiagnostics(options.keepCombatSamples);
    const trace: AgentTraceEntry[] = [];
    let result: EvaluatedGame;
    try {
      const run = await runAgentMatch(options.client, options.agent, options.decks, { ...options.limits, seed,
        onDecision: (o, d, c) => { diagnostics.record(o, d, c); trace.push({ turn: d.context.turn, phase: d.context.phase, type: d.type, choice: c }); } });
      result = { seed, policyVersion: options.agent.version, status: "completed", error: null,
        winner: run.metrics.result?.draw ? "draw" : run.metrics.result?.winnerId === diagnostics.selfPlayerId ? "agent" : "opponent",
        metrics: run.metrics, diagnostics: diagnostics.result() };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      result = { seed, policyVersion: options.agent.version,
        status: options.limits?.signal?.aborted ? "cancelled" : /timeout/i.test(message) ? "timeout" : /agent_(idle|decision)_limit/.test(message) ? "stalled" : "error",
        error: message, winner: null, metrics: error instanceof AgentRunError && error.snapshot ? gameMetrics(error.snapshot, trace, diagnostics.selfPlayerId) : null,
        diagnostics: diagnostics.result() };
    }
    games.push(result);
    await options.onGame?.(result);
    // runAgentMatch cancels failures; continuing surfaces any cleanup failure as a subsequent game error.
    if (result.status === "cancelled") break;
  }
  return { schemaVersion: 1, policyVersion: options.agent.version, opponent: options.opponent,
    deckNames: options.decks.map(d => d.name), deckHash: createHash("sha256").update(JSON.stringify(options.decks)).digest("hex"),
    seeds: [...options.seeds], limits: { timeoutMs: options.limits?.timeoutMs ?? 120_000, maxDecisions: options.limits?.maxDecisions ?? 5000,
      maxIdlePolls: options.limits?.maxIdlePolls ?? 5000, pollIntervalMs: options.limits?.pollIntervalMs ?? 2 },
    aggregate: aggregateGames(games), games };
}

/** Compare observable behavior, excluding transport/game identifiers and process resource measurements. */
export function reproducibleGameResult(game: EvaluatedGame) {
  const { result: _result, selfPlayerId: _self, ...metrics } = game.metrics ?? { result: null, selfPlayerId: "" };
  return { seed: game.seed, policyVersion: game.policyVersion, status: game.status, winner: game.winner, error: game.error,
    metrics, semanticTraceHash: game.diagnostics.semanticTraceHash,
    attackOpportunities: game.diagnostics.attackOpportunities, attacksTaken: game.diagnostics.attacksTaken,
    stateSamples: game.diagnostics.stateSamples };
}
