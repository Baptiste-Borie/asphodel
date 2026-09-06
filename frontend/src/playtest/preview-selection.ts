/**
 * Pure selection state for the battlefield card inspector (V2e.3) — deliberately separate from
 * `card-preview.ts`'s DOM rendering so it is directly unit-testable without a browser. Nothing
 * here ever resets on its own: a poll/re-render calling `isSelected`/`current` repeatedly can
 * never perturb the selection — only an explicit `toggle`/`close` call (a real click or Escape)
 * changes it. That is the whole guarantee behind "the selected card survives polling."
 */
export class PreviewSelection {
  private selected: string | null = null;

  current(): string | null {
    return this.selected;
  }

  isSelected(cardRef: string): boolean {
    return this.selected === cardRef;
  }

  /** Selects `cardRef`, replacing any previous selection — or closes if it was already selected. Returns the resulting open/closed state. */
  toggle(cardRef: string): "opened" | "closed" {
    if (this.selected === cardRef) {
      this.selected = null;
      return "closed";
    }
    this.selected = cardRef;
    return "opened";
  }

  close(): void {
    this.selected = null;
  }
}
