import type { AgentChoice, MenuItem } from "./types.js";

export interface HandActionMenu {
  element: HTMLElement;
  isOpen(): boolean;
  /** Opens (replacing any previous content) a small menu of `items` anchored just above `anchor`; picking one calls `onChoose` with its exact, already-legal choice and closes. */
  openFor(anchor: HTMLElement, items: readonly MenuItem[], onChoose: (choice: AgentChoice) => void): void;
  close(): void;
}

/**
 * The small contextual menu shown when a playable hand card has more than one legal action (V2e.4)
 * — e.g. a card castable for two different costs. Every option is exactly one of the Forge-legal
 * `MenuItem`s handed to `openFor`; nothing here invents or reorders a choice. Closes on Escape, on
 * an outside click, or once an option is chosen — never left open pointing at a stale decision.
 */
export function createHandActionMenu(): HandActionMenu {
  const element = document.createElement("div");
  element.className = "table-hand-menu";
  element.hidden = true;
  let open = false;

  function close(): void {
    open = false;
    element.hidden = true;
    element.replaceChildren();
  }

  function openFor(anchor: HTMLElement, items: readonly MenuItem[], onChoose: (choice: AgentChoice) => void): void {
    element.replaceChildren();
    for (const item of items) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "table-hand-menu-option";
      button.textContent = item.label;
      button.addEventListener("click", (event) => {
        event.stopPropagation();
        onChoose(item.choice);
        close();
      });
      element.append(button);
    }
    const rect = anchor.getBoundingClientRect();
    element.style.left = `${rect.left + rect.width / 2}px`;
    element.style.top = `${rect.top}px`;
    element.hidden = false;
    open = true;
  }

  element.addEventListener("click", (event) => event.stopPropagation());
  document.addEventListener("click", () => { if (open) close(); });
  document.addEventListener("keydown", (event) => { if (event.key === "Escape" && open) close(); });

  return { element, isOpen: () => open, openFor, close };
}
