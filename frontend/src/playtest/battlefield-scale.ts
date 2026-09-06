export interface BattlefieldScale {
  /** Card width in px — the reserved slot height then follows from the fixed 5:7 aspect ratio. */
  cardWidthPx: number;
  /** Negative margin applied between adjacent cards to overlap/compress a crowded row. */
  overlapPx: number;
}

const BASE_WIDTH_PX = 160;
const MIN_WIDTH_PX = 96;
const MAX_OVERLAP_PX = 64;

/**
 * Pure. "Use the available table space": 1-6 permanents get full-size cards with no overlap; 7-10
 * start overlapping slightly (packing more per row) at the SAME size; beyond that, overlap keeps
 * growing before card width ever shrinks, and width only shrinks (down to a sane floor) once
 * overlap has already maxed out. Visual targets, not hardcoded mandates — see V2e.3 spec.
 */
export function computeBattlefieldScale(cardCount: number): BattlefieldScale {
  if (cardCount <= 6) return { cardWidthPx: BASE_WIDTH_PX, overlapPx: 0 };
  if (cardCount <= 10) {
    const t = (cardCount - 6) / 4;
    return { cardWidthPx: BASE_WIDTH_PX, overlapPx: Math.round(28 * t) };
  }
  if (cardCount <= 20) {
    const t = (cardCount - 10) / 10;
    return { cardWidthPx: BASE_WIDTH_PX, overlapPx: Math.round(28 + (MAX_OVERLAP_PX - 28) * t) };
  }
  const extraBeyond20 = cardCount - 20;
  return { cardWidthPx: Math.max(MIN_WIDTH_PX, BASE_WIDTH_PX - extraBeyond20 * 3), overlapPx: MAX_OVERLAP_PX };
}
