import { createInterface, type Interface } from "node:readline/promises";
import type { AgentObservation, ForgePendingExternalDecision as Decision } from "../forge/forge-protocol.js";
import type { AgentChoice } from "../agent/baseline-agent.js";
import { HumanEndMatchError, type HumanDecisionProvider } from "./human-decision-provider.js";
import { describeDecision, renderBoard, renderEventDelta, renderHeader, type DecisionPrompt, type MenuItem } from "./human-cli-render.js";

export { HumanEndMatchError };

const HELP_TEXT = [
  "Type the number of your choice and press Enter.",
  "Other commands: h/help (this text), state/board (reprint the board), end / quit — end the playtest and generate a report.",
];

/**
 * Renders context and reads numbered choices from a terminal. Never constructs an option Forge
 * did not supply: every menu item and every numeric bound comes straight from `describeDecision`,
 * which in turn only reads the pending decision's own fields. Invalid input (non-number,
 * out-of-range, empty) is rejected locally and re-prompted — nothing is ever submitted to Forge
 * for an invalid answer. All rendering lives in `human-cli-render.ts`; this class only does I/O.
 */
export class TerminalHumanDecisionProvider implements HumanDecisionProvider {
  private readonly rl: Interface;
  private readonly output: NodeJS.WritableStream;
  private previous: AgentObservation | null = null;

  constructor(
    input: NodeJS.ReadableStream = process.stdin,
    output: NodeJS.WritableStream = process.stdout,
    private readonly signal?: AbortSignal,
  ) {
    this.output = output;
    this.rl = createInterface({ input, output });
  }

  close(): void {
    this.rl.close();
  }

  async choose(observation: AgentObservation, d: Decision): Promise<AgentChoice> {
    const delta = renderEventDelta(this.previous, observation);
    this.previous = observation;
    if (delta.length) { this.write(""); this.write("Since your last decision:"); this.print(delta.map(line => `  ${line}`)); }
    this.print(renderHeader(observation));
    this.print(renderBoard(observation));
    const prompt = describeDecision(observation, d);
    return prompt.kind === "value" ? this.chooseValue(prompt) : this.chooseMenu(observation, prompt);
  }

  private print(lines: string[]): void {
    for (const line of lines) this.write(line);
  }

  private write(line: string): void {
    this.output.write(`${line}\n`);
  }

  private async chooseMenu(observation: AgentObservation, prompt: Extract<DecisionPrompt, { kind: "menu" }>): Promise<AgentChoice> {
    while (true) {
      this.write("");
      this.write(prompt.title);
      prompt.items.forEach((item: MenuItem, i: number) => this.write(`  ${i + 1}. ${item.label}`));
      const answer = (await this.rl.question("> ", { signal: this.signal })).trim();
      const command = this.handleCommand(answer);
      if (command === "end") throw new HumanEndMatchError();
      if (command === "help") { this.write(HELP_TEXT.join("\n")); continue; }
      if (command === "board") { this.print(renderHeader(observation)); this.print(renderBoard(observation)); continue; }
      const index = Number(answer);
      if (!Number.isInteger(index) || index < 1 || index > prompt.items.length) {
        this.write(`Invalid choice. Enter a number from 1 to ${prompt.items.length}.`);
        continue;
      }
      return prompt.items[index - 1]!.choice;
    }
  }

  private async chooseValue(prompt: Extract<DecisionPrompt, { kind: "value" }>): Promise<AgentChoice> {
    while (true) {
      this.write("");
      this.write(`${prompt.title} (${prompt.min}-${prompt.max})`);
      const answer = (await this.rl.question("> ", { signal: this.signal })).trim();
      const command = this.handleCommand(answer);
      if (command === "end") throw new HumanEndMatchError();
      if (command === "help") { this.write(HELP_TEXT.join("\n")); continue; }
      if (command === "board") continue;
      const value = Number(answer);
      if (!Number.isInteger(value) || value < prompt.min || value > prompt.max) {
        this.write(`Invalid value. Enter a whole number from ${prompt.min} to ${prompt.max}.`);
        continue;
      }
      return { decisionId: prompt.decisionId, kind: "value", choice: value, reason: "human_choice" };
    }
  }

  private handleCommand(answer: string): "end" | "help" | "board" | null {
    const normalized = answer.toLowerCase();
    if (normalized === "end" || normalized === "quit") return "end";
    if (normalized === "h" || normalized === "help") return "help";
    if (normalized === "state" || normalized === "board") return "board";
    return null;
  }
}
