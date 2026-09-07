import type { CardActionMap } from "./hand-action-mapping.js";
import type { MenuItem } from "./types.js";

export interface PreviewAction {
  label: string;
  items: readonly MenuItem[];
}

/**
 * Pure. What the card preview panel's explicit action control (V2f.1 §2) should show for whichever
 * card is currently previewed — `null` when nothing is previewed, or the current board action
 * mapping has no legal action for that exact card (never a guess from card metadata; only ever
 * `boardActionMap`'s own already-legal entries). A single legal action shows its own Forge-provided
 * label verbatim; several show a neutral count — the actual choice of what to DO with them (submit
 * directly vs open a menu) is left entirely to `decideCardAction`, called only once the control is
 * explicitly triggered, never merely from the click that opened the preview.
 */
export function computePreviewAction(previewedCardRef: string | null, boardActionMap: CardActionMap | undefined): PreviewAction | null {
  if (!previewedCardRef) return null;
  const items = boardActionMap?.byCardRef.get(previewedCardRef);
  if (!items || items.length === 0) return null;
  const label = items.length === 1 ? items[0]!.label : `Choose action (${items.length})`;
  return { label, items };
}
