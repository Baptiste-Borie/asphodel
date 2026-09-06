import type { AgentChoice, DecisionPrompt, WebPendingDecisionDTO } from "./types.js";

/** Pure. Human-readable decision family — never a raw Forge type string in the UI. */
export function describeDecisionFamily(type: string): string {
  switch (type) {
    case "priority_action": return "Priority";
    case "target_selection": return "Target";
    case "mode_selection": return "Mode";
    case "value_selection": return "Value";
    case "optional_cost_selection": return "Optional Cost";
    case "cost_object_selection": return "Cost Selection";
    case "mana_payment": return "Mana Payment";
    case "attackers_selection": return "Combat — Attackers";
    case "blockers_selection": return "Combat — Blockers";
    case "combat_order_selection": return "Combat — Order";
    case "yes_no": return "Confirm";
    case "object_selection": return "Selection";
    case "ordering_selection": return "Ordering";
    default: return "Decision";
  }
}

function isPassOption(label: string): boolean {
  return /^pass/i.test(label);
}

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
  container.classList.toggle("table-decision-dock--complex", pending.rendered.kind === "value" || pending.rendered.items.length > 5);

  const context = document.createElement("p");
  context.className = "decision-context";
  context.textContent = `${describeDecisionFamily(pending.type)} · Turn ${pending.context.turn} · ${pending.context.phase} · Stack: ${pending.context.stackSize || "empty"}`;
  container.append(context);

  const heading = document.createElement("h3");
  heading.className = "decision-title";
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
  list.className = "decision-menu";
  prompt.items.forEach((item) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = isPassOption(item.label) ? "decision-option decision-option--pass" : "decision-option";
    button.textContent = isPassOption(item.label) ? `${item.label} →` : item.label;
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
  wrap.className = "decision-value-prompt";
  let value = prompt.suggested[0] ?? prompt.min;
  value = Math.min(prompt.max, Math.max(prompt.min, value));

  const controls = document.createElement("div");
  controls.className = "decision-value-controls";
  const decrement = document.createElement("button");
  decrement.type = "button";
  decrement.className = "decision-value-step";
  decrement.textContent = "−";
  decrement.setAttribute("aria-label", "Decrease");
  const display = document.createElement("span");
  display.className = "decision-value-display";
  const increment = document.createElement("button");
  increment.type = "button";
  increment.className = "decision-value-step";
  increment.textContent = "+";
  increment.setAttribute("aria-label", "Increase");
  const confirm = document.createElement("button");
  confirm.type = "button";
  confirm.className = "decision-option decision-option--confirm";
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
