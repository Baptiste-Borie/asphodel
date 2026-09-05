import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import type { AgentChoice } from "../agent/baseline-agent.js";
import type { AgentObservation, ForgeExternalMatchSnapshot, ForgePendingExternalDecision, ForgePublicPlayerTelemetry } from "../forge/forge-protocol.js";
import { describeDecision, formatPhase } from "./human-cli-render.js";
import type { RecordedDecision } from "./decision-recorder.js";

/** backend/playtest-reports/ — see also its .gitignore entry; nothing under it is ever committed. */
const DEFAULT_REPORTS_ROOT = fileURLToPath(new URL("../../playtest-reports/", import.meta.url));
const MAX_LISTED_OPTIONS = 15;

export interface PlaytestReportInput {
  startedAt: Date;
  sessionId: string;
  seed: number;
  humanDeckName: string;
  agentDeckName: string;
  humanPlayerId: string;
  agentPlayerId: string;
  endedByHuman: boolean;
  snapshot: ForgeExternalMatchSnapshot;
  decisions: readonly RecordedDecision[];
  /** Override for tests; defaults to backend/playtest-reports/. */
  reportsRoot?: string;
}

export interface PlaytestReportResult {
  directory: string;
  summaryPath: string;
  decisionsPath: string;
}

function slugify(name: string): string {
  const slug = name.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return slug || "deck";
}

function timestampSlug(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}_${pad(date.getHours())}-${pad(date.getMinutes())}`;
}

/** Sortable chronologically, filesystem-safe, and identifiable by decks — e.g. "2026-09-05_22-30_uurg-vs-krenko". */
export function reportDirectoryName(startedAt: Date, humanDeckName: string, agentDeckName: string): string {
  return `${timestampSlug(startedAt)}_${slugify(humanDeckName)}-vs-${slugify(agentDeckName)}`;
}

function turnReached(snapshot: ForgeExternalMatchSnapshot): number | null {
  return snapshot.result?.turns ?? snapshot.pendingDecision?.context.turn ?? snapshot.observation?.game.turn ?? null;
}

function telemetryLines(label: string, telemetry: ForgePublicPlayerTelemetry | undefined): string[] {
  return [
    `${label}:`,
    `- attacks: ${telemetry?.attacks ?? "n/a"}`,
    `- damage: ${(telemetry?.damageToPlayers ?? 0) + (telemetry?.damageToCards ?? 0)}`,
    `- spells: ${telemetry?.spellsCast ?? "n/a"}`,
  ];
}

/** Reuses `describeDecision` (human-cli-render.ts) instead of a second decision-rendering system. */
function describeRecordedDecision(observation: AgentObservation, decision: ForgePendingExternalDecision, choice: AgentChoice): { chosenLabel: string; legalOptions: string[] } {
  const prompt = describeDecision(observation, decision);
  if (prompt.kind === "value") return { chosenLabel: String(choice.choice), legalOptions: [`Any integer from ${prompt.min} to ${prompt.max}`] };
  const chosen = prompt.items.find(item => item.choice.kind === choice.kind && item.choice.choice === choice.choice);
  return { chosenLabel: chosen?.label ?? String(choice.choice), legalOptions: prompt.items.map(item => item.label) };
}

function renderSummaryMarkdown(input: PlaytestReportInput): string {
  const status = input.endedByHuman ? "ended_by_human" : "completed";
  const lines: string[] = [
    "# Asphodel Playtest Report", "",
    `Generated: ${input.startedAt.toISOString()}`,
    `Session: ${input.sessionId}`,
    `Seed: ${input.seed}`, "",
    `Human deck: ${input.humanDeckName}`,
    `Asphodel deck: ${input.agentDeckName}`, "",
    `Status: ${status}`,
    `Turn reached: ${turnReached(input.snapshot) ?? "unknown"}`, "",
    `Asphodel decisions: ${input.decisions.length}`, "",
    "## Match summary", "",
    ...telemetryLines("Human", input.snapshot.publicTelemetry?.[input.humanPlayerId]), "",
    ...telemetryLines("Asphodel", input.snapshot.publicTelemetry?.[input.agentPlayerId]), "",
    "## Result", "",
  ];
  if (!input.endedByHuman && input.snapshot.result) {
    const result = input.snapshot.result;
    const winner = result.draw ? "Draw"
      : result.winnerId === input.humanPlayerId ? "Human"
      : result.winnerId === input.agentPlayerId ? "Asphodel"
      : (result.winnerId ?? "Unknown");
    lines.push(`Winner: ${winner}`, `Turns: ${result.turns}`, `Terminal reason: ${result.terminalReason}`, "");
  } else {
    lines.push("Result: playtest ended by human", "");
  }
  const combatDamage = input.snapshot.forgeAiStrategicFallbacks.filter(f => f.family === "combat_damage" && f.method === "assignCombatDamage").length;
  const unexpected = input.snapshot.forgeAiStrategicFallbacks.length - combatDamage;
  lines.push("## Engine delegated decisions", "", `- combat damage assignment: ${combatDamage}`);
  if (unexpected > 0) lines.push(`- other (unexpected): ${unexpected}`);
  lines.push("", "## Decision timeline", "");
  for (const recorded of input.decisions) {
    const described = describeRecordedDecision(recorded.observation, recorded.decision, recorded.choice);
    lines.push(`### ${recorded.reportId} — Turn ${recorded.decision.context.turn} / ${formatPhase(recorded.decision.context.phase)}`, "");
    lines.push(`Type: ${recorded.decision.type}`, `Forge decision: ${recorded.decision.decisionId}`, "");
    lines.push("Chosen:", described.chosenLabel, "");
    lines.push("Reason:", recorded.choice.reason, "");
    lines.push("Legal options:");
    for (const option of described.legalOptions.slice(0, MAX_LISTED_OPTIONS)) lines.push(`- ${option}`);
    if (described.legalOptions.length > MAX_LISTED_OPTIONS) lines.push(`- ... and ${described.legalOptions.length - MAX_LISTED_OPTIONS} more (see decisions.json for the complete list)`);
    lines.push("");
  }
  return lines.join("\n");
}

/** Raw DTOs, not a lossy text log — this is the corpus future regressions/comparisons read back. */
function renderDecisionsJson(input: PlaytestReportInput) {
  return {
    schemaVersion: 1,
    generatedAt: input.startedAt.toISOString(),
    match: {
      sessionId: input.sessionId,
      seed: input.seed,
      status: input.endedByHuman ? "ended_by_human" : "completed",
      humanDeck: input.humanDeckName,
      asphodelDeck: input.agentDeckName,
    },
    decisions: input.decisions.map(({ reportId, timestamp, observation, decision, choice }) => ({ reportId, timestamp, observation, decision, choice })),
  };
}

export async function writePlaytestReport(input: PlaytestReportInput): Promise<PlaytestReportResult> {
  const root = input.reportsRoot ?? DEFAULT_REPORTS_ROOT;
  const directory = resolve(root, reportDirectoryName(input.startedAt, input.humanDeckName, input.agentDeckName));
  await mkdir(directory, { recursive: true });
  const summaryPath = resolve(directory, "summary.md");
  const decisionsPath = resolve(directory, "decisions.json");
  await writeFile(summaryPath, renderSummaryMarkdown(input), "utf8");
  await writeFile(decisionsPath, JSON.stringify(renderDecisionsJson(input), null, 2), "utf8");
  return { directory, summaryPath, decisionsPath };
}
