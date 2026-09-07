# V2f — Dual Commanders / Partner Configurations

Base: V2e.8 `579fc58`. Forge remains exactly `6356c1ad565029c82513c96e42ad5492c1b09c4e`
(`git -C vendor/forge status --short` empty). Focused fix, not a visual milestone: a real Deck
Library deck using Frodo, Adventurous Hobbit + Sam, Loyal Attendant failed before ever reaching
Forge with "Asphodel Forge Deck Adapter V1b supports exactly one commander." — an adapter
limitation, not a real product restriction.

## 1. Root cause

`ForgeDeckAdapter.toForgeDeckSpec` (Node) and its mirror `ForgeDeckFactory.validate` (Java bridge)
both hard-rejected more than one commander-section card, even though `ArchidektDeckSource` already
accepted 1–2 (`INVALID_COMMANDER_COUNT` only outside that range), the DB schema never restricted
commander count, and `AgentObservationBuilder`/the live tabletop's `commanders: AgentCommanderObservation[]`
were already list-shaped throughout. Only the Deck-Library→Forge conversion path was blocking it.

## 2. The fix — structure only, never pair legality, in Node/the adapter

Both `ForgeDeckAdapter.ts` and `ForgeDeckFactory.java` now count **distinct commander card names**
(never summed quantity — two entries naming the same card, or one entry with quantity > 1, is a
malformed decklist, not "two commanders") and enforce: each commander appears exactly once; 0
commanders is invalid; 1 or 2 is valid; 3+ is `UNSUPPORTED_COMMANDER_CONFIGURATION`. Nothing here
decides whether a *specific* pair is legal — that stays entirely Forge's call.

## 3. Real Forge partner-pair legality — not reimplemented, not skipped

Vendor Forge already has the real, authoritative check: `forge-core`'s
`CardRules.canBePartnerCommanders(CardRules)` reads each card's own printed keywords (`Partner`,
`Partner with:<name>`, `Partner:<type>` for Friends forever, `Choose a Background`, `Doctor's
companion`) — nothing here parses Oracle text or guesses at legality. `ForgeDeckFactory.build`
calls it on the two resolved `PaperCard.getRules()` objects whenever exactly two commander names are
present; a false result throws a new `IllegalCommanderPairException`, mapped to bridge error code
`ILLEGAL_COMMANDER_PAIR` (naming both cards) alongside the existing `UNSUPPORTED_COMMANDER_CONFIGURATION`
and `FORGE_CARDS_NOT_FOUND` codes in `BridgeMain`'s dispatcher — surfaced generically through the
already-generic `ForgeBridgeError`, no new Node-side mapping needed. An illegal pair therefore fails
exactly like any other real Forge-side rejection, never silently accepted.

## 4. Deck pipeline consistency

Deck Library (`ForgeDeckAdapter`), Archidekt direct match, Archidekt → Deck Library, and the CLI
(`parseDeckArg`/`resolveDeckInput`, unchanged) all converge on the same `ArchidektDeckSource` and/or
`ForgeDeckAdapter` — a valid two-commander deck now produces an identical `ForgeDeckSpec` commander
shape regardless of origin, proven directly by a new test walking the same Frodo+Sam payload through
`ArchidektDeckSource.fetchDeckSpec` (the direct-match path) and through
`DeckService.importArchidektDeck` → persistence → `getDeck` → `ForgeDeckAdapter.toForgeDeckSpec`
(the Library path) and comparing the resulting commander lists.

## 5. Deck Library summary view was a real singular-assumption bug too

`DeckService.listDecks()` used to overwrite one `commander: {...} | null` field per row, so a
two-commander deck's library thumbnail showed an arbitrary, non-deterministic single commander.
Changed to `commanders: {name, imageUri}[]` (never re-sorted; the query's own row order). The
frontend deck tile now shows every commander's name (joined) and uses the first one's art for the
cover — no other UI change. The **live game board** already rendered commanders as a list
(`board-renderer.ts`'s command-zone rendering, `AgentObservation.commanders[]`) — nothing needed
there; this was purely a Deck Library browsing-view gap.

## 6. Tests

- **Node unit** (`forge-deck-adapter.test.ts`): a real two-commander pair is accepted and both
  entries preserved; a single commander entry appearing twice (quantity 2) is rejected as malformed,
  not "two commanders"; 3+ distinct commanders rejected as unsupported.
- **Node unit** (`deck-service.test.ts`): the full Archidekt→Library pipeline for a real two-commander
  deck, cross-checked against the direct-Archidekt-match shape.
- **Real Forge integration** (`forge-bridge.integration.test.ts`, +2): a real legal pair (Frodo &
  Sam) — both load into the command zone independently, both appear in `AgentObservation.commanders`,
  both are independently castable, Forge's own per-commander tax counter (`castsFromCommand`) tracks
  each independently, and casting one never touches the other's identity or state; a real illegal
  pair (Krenko, Tin Street Kingpin + Ayula, Queen Among Bears — no partner relationship at all) is
  rejected by Forge's own rules data, proving Asphodel never invents legality for an arbitrary pair.
- Full suites: backend 166/166, frontend 113/113, Forge bridge 61/61 (was 59 before this fix).

## 7. Out of scope (unchanged)

No Partner/Partner-with/Friends-forever/Background/Doctor's-companion rules text was written in
Node or the frontend — only a call into Forge's own existing `CardRules` method. No AI policy
change. No Physical Companion UI was built; the only defensive step taken for it was making sure no
part of this fix reintroduces a "one commander" assumption anywhere in the data model, so a future
compact human mirror can render `commanders` as the collection it already is everywhere else.
