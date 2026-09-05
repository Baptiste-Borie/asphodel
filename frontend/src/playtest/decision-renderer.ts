import type { AgentChoice, DecisionPrompt, WebPendingDecisionDTO } from "./types.js";

/**
 * Renders the decision the backend already built with `describeDecision` (human-decision-render.ts)
 * as clickable buttons. This module never re-derives a choice from raw Forge data — every button's
 * `choice` is exactly one of `rendered.items[].choice`, taken verbatim from the DTO. The user can
 * never type a `decisionId`/`objectId` by hand.
 */
export function renderDecision(
  container: HTMLElement,
  pending: WebPendingDecisionDTO,
  onChoose: (choice: AgentChoice) => void,
): void {
  container.replaceChildren();
  const heading = document.createElement("h3");
  heading.textContent = pending.rendered.title;
  container.append(heading);

  if (pending.rendered.kind === "value") {
    container.append(renderValuePrompt(pending.rendered, onChoose));
    return;
  }
  container.append(renderMenu(pending.rendered, onChoose));
}

function renderMenu(prompt: Extract<DecisionPrompt, { kind: "menu" }>, onChoose: (choice: AgentChoice) => void): HTMLElement {
  const list = document.createElement("div");
  list.className = "playtest-decision-menu";
  prompt.items.forEach((item, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "playtest-decision-option";
    const number = document.createElement("span");
    number.className = "playtest-decision-number";
    number.textContent = `[${index + 1}]`;
    const label = document.createElement("span");
    label.textContent = item.label;
    button.append(number, label);
    button.addEventListener("click", () => onChoose(item.choice));
    list.append(button);
  });
  return list;
}

function renderValuePrompt(
  prompt: Extract<DecisionPrompt, { kind: "value" }>,
  onChoose: (choice: AgentChoice) => void,
): HTMLElement {
  const wrap = document.createElement("div");
  wrap.className = "playtest-value-prompt";
  let value = prompt.suggested[0] ?? prompt.min;
  value = Math.min(prompt.max, Math.max(prompt.min, value));

  const controls = document.createElement("div");
  controls.className = "playtest-value-controls";
  const decrement = document.createElement("button");
  decrement.type = "button";
  decrement.textContent = "-";
  const display = document.createElement("span");
  display.className = "playtest-value-display";
  const increment = document.createElement("button");
  increment.type = "button";
  increment.textContent = "+";
  const confirm = document.createElement("button");
  confirm.type = "button";
  confirm.className = "primary-button";
  confirm.textContent = "Confirm";

  const render = () => {
    display.textContent = String(value);
    decrement.disabled = value <= prompt.min;
    increment.disabled = value >= prompt.max;
  };
  decrement.addEventListener("click", () => { value = Math.max(prompt.min, value - 1); render(); });
  increment.addEventListener("click", () => { value = Math.min(prompt.max, value + 1); render(); });
  confirm.addEventListener("click", () => onChoose({ decisionId: prompt.decisionId, kind: "value", choice: value, reason: "human_choice" }));
  render();

  controls.append(decrement, display, increment);
  wrap.append(controls, confirm);
  return wrap;
}
