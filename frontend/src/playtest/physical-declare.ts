/**
 * V2g "Physical Companion": renders the `physical_declare` decision — the human declares which
 * real card(s) (from their own physical deck) correspond to a hidden-zone event Forge just reported
 * (a draw, a mill, a scry reveal, …). Wires the existing `card-search.ts` combobox (built ahead of
 * time for exactly this milestone) to the prompt's `candidates`; one shared component handles both
 * a single declare (count 1) and the 7-card opening hand (count 7) — see the picked-slots grid
 * below, which reads fine at either size rather than needing two separate components.
 *
 * Never fakes a physical operation Forge/the backend's ManualPhysicalCardProvider doesn't already
 * consider legal: every submission is exactly `{ kind: "physical_identity", decisionId,
 * declaredNames, reason: "physical_declaration" }`, going through the SAME generic submitChoice
 * plumbing every other decision kind already uses (see playtest-view.ts).
 */
import { createCardSearch, type CardSearchCandidate } from "./card-search.js";
import type { AgentChoice, PhysicalDeclareCandidate } from "./types.js";

/**
 * Pure. Recomputes each candidate's remaining count after subtracting the picks already made this
 * round (mirrors the backend's own `ManualPhysicalCardProvider` bookkeeping) — a candidate whose
 * remaining count reaches 0 is dropped entirely, so it can no longer be selected again. Never
 * mutates the input; a name not present in `picked` passes through with its original count.
 */
export function remainingDeclareCandidates(
  candidates: readonly PhysicalDeclareCandidate[],
  picked: readonly string[],
): PhysicalDeclareCandidate[] {
  const pickedCounts = new Map<string, number>();
  for (const name of picked) pickedCounts.set(name, (pickedCounts.get(name) ?? 0) + 1);
  return candidates
    .map((candidate) => ({ name: candidate.name, remaining: candidate.remaining - (pickedCounts.get(candidate.name) ?? 0) }))
    .filter((candidate) => candidate.remaining > 0);
}

/** Pure. Exactly `count` picks are required before the declaration can be confirmed — never more, never fewer. */
export function isDeclareReadyToConfirm(picked: readonly string[], count: number): boolean {
  return picked.length === count;
}

/** Pure. `remainingDeclareCandidates` reshaped for `card-search.ts`'s own candidate shape (name doubles as id — declare candidates have no separate stable id). */
export function toCardSearchCandidates(candidates: readonly PhysicalDeclareCandidate[]): CardSearchCandidate[] {
  return candidates.map((candidate) => ({ id: candidate.name, name: candidate.name, remaining: candidate.remaining }));
}

export interface PhysicalDeclarePrompt {
  title: string;
  decisionId: string;
  count: number;
  candidates: PhysicalDeclareCandidate[];
}

/**
 * Builds the whole declaration surface into `container`: title, a "N / count" progress line, a
 * slot grid of what's been picked so far (each removable, to correct a mis-click before confirming),
 * the search box (hidden once every slot is filled), and a Confirm button enabled only once
 * `isDeclareReadyToConfirm` is true. Re-render on every call — this decision is short-lived and
 * never needs reconciled DOM nodes the way the battlefield does.
 */
export function renderPhysicalDeclare(
  container: HTMLElement,
  prompt: PhysicalDeclarePrompt,
  onChoose: (choice: AgentChoice) => void,
): void {
  let picked: string[] = [];

  const heading = document.createElement("h2");
  heading.textContent = prompt.title;

  const progress = document.createElement("p");
  progress.className = "table-picker-progress";

  const slots = document.createElement("div");
  slots.className = "physical-declare-slots";

  const searchHost = document.createElement("div");
  searchHost.className = "physical-declare-search";

  const confirm = document.createElement("button");
  confirm.type = "button";
  confirm.className = "decision-option decision-option--confirm";
  confirm.textContent = "Confirm";
  confirm.addEventListener("click", () => {
    if (!isDeclareReadyToConfirm(picked, prompt.count)) return;
    onChoose({ decisionId: prompt.decisionId, kind: "physical_identity", declaredNames: picked, reason: "physical_declaration" });
  });

  const search = createCardSearch({
    label: "Declare a card",
    placeholder: "Search your deck…",
    getCandidates: () => toCardSearchCandidates(remainingDeclareCandidates(prompt.candidates, picked)),
    onSelect: (candidate) => {
      picked = [...picked, candidate.name];
      render();
    },
  });

  function removePick(index: number): void {
    picked = picked.filter((_, i) => i !== index);
    render();
  }

  function render(): void {
    progress.textContent = `${picked.length} / ${prompt.count}`;

    slots.replaceChildren();
    for (let i = 0; i < prompt.count; i++) {
      const slot = document.createElement("div");
      const name = picked[i];
      slot.className = name ? "physical-declare-slot physical-declare-slot--filled" : "physical-declare-slot";
      if (name) {
        const label = document.createElement("span");
        label.textContent = name;
        const remove = document.createElement("button");
        remove.type = "button";
        remove.className = "physical-declare-slot-remove";
        remove.setAttribute("aria-label", `Remove ${name}`);
        remove.textContent = "×";
        remove.addEventListener("click", () => removePick(i));
        slot.append(label, remove);
      } else {
        slot.textContent = "?";
      }
      slots.append(slot);
    }

    const ready = isDeclareReadyToConfirm(picked, prompt.count);
    searchHost.hidden = ready;
    confirm.disabled = !ready;
  }

  searchHost.replaceChildren(search);
  container.replaceChildren(heading, progress, slots, searchHost, confirm);
  render();
}
