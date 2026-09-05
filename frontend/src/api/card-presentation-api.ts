import { apiRequest } from "./api-client.js";
import type { CardPresentation } from "../playtest/types.js";

/** One batch call to POST /cards/presentation — never one request per card, never per poll tick. */
export async function fetchCardPresentations(names: readonly string[]): Promise<Record<string, CardPresentation>> {
  const result = await apiRequest<{ cards: Record<string, CardPresentation> }>("/cards/presentation", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ names }),
  });
  return result.cards;
}
