# Deck Lab

Open `/#deck-lab`, or choose **Deck Lab** in the navigation. Start the backend and frontend with their existing `npm run dev` commands.

## Complete local search

Search reads the existing `backend/data/scryfall-default-cards.jsonl.gz` snapshot (or `SCRYFALL_PRINTING_BULK_PATH`). The first request creates a separate, derived SQLite index at `backend/data/deck-lab-search.sqlite`. It does not modify the user's deck database or call the Scryfall API. On a later process start, a changed snapshot triggers an index rebuild; otherwise the index is reused. A missing snapshot produces an explicit error rather than silently returning demo cards.

- `/cards/search/catalog` supplies set names/codes, types and available languages from the actual snapshot.
- `POST /cards/search` returns totals plus batches of 60 cards by default (maximum 120). The browser appends batches without rebuilding earlier results. New searches cancel and supersede previous requests.
- All visible filters work. Type selections are AND; set selections are OR. Different fields combine with AND.
- Colors accept W/U/B/R/G or their English names, and C for colorless. A plain color requires those colors; `=UG` requires exactly blue-green; `<=UG` allows any subset, including colorless.
- Mana value accepts a number or `<`, `<=`, `>`, `>=`, `=` comparisons.
- Results default to distinct Oracle cards. Choose **All printings** to include alternate versions. Filters are applied before deduplication, so an oracle's printing outside the chosen sets never hides a matching card.
- Languages are limited to those actually present in the local Default Cards snapshot; this is not an all-languages Scryfall mirror.
- The snapshot date is displayed. This is the complete **local snapshot**, not a live feed of newly released cards.

Advanced local syntax supports `name:`, `o:`/`oracle:`, `t:`/`type:`, `set:`/`s:`/`e:`, `r:`/`rarity:`, `lang:`, `mv`/`cmc`, `c`/`color`, `id`/`identity`, and `f:commander`, plus quoted phrases, parentheses, AND, OR, NOT and `-` negation. This is an explicitly documented subset, not the whole Scryfall language. Unsupported fields are rejected visibly.

Example: `(set:tla OR set:tle) t:creature mv<=4`.

Verified against the installed snapshot: 117,852 printings overall; TLA OR TLE yields **524 distinct cards / 711 printings**.

## Session workspace

Selection remains independent of deck sheets and survives filters, batch loading, Images/Full switching and Search/Builder navigation. Adding a card does not rerender search results. When browsing printings, Selection retains the chosen printing and stores one entry per card name.

Deck sheets and Selection still live in memory and reset on refresh. The explicitly opened sample sheet has 140 candidates with authored categories. A new sheet starts with Unsorted. Category naming, moving via menus, cuts/restores and statistics are available for review. There is no deck saving or drag-and-drop yet, and no automatic categorization or recommendations.

The interface uses Asphodel's charcoal surfaces and violet accents. Artwork loads from static Scryfall image URLs and requires network access.

## Validation

- `npm run build --prefix backend` and `npm run build --prefix frontend`.
- From backend: `./node_modules/.bin/tsx --test src/app.test.ts src/deck-lab-search.test.ts`.
- Browser: `PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs TABLETOP_URL=http://127.0.0.1:5180 node scripts/deck-lab-search-check.mjs`.

Browser checks use the real local API, including every TLA/TLE batch, Selection and Builder transfer, and advanced filters. The expected Avatar totals above intentionally refer to the installed snapshot and may need updating after a bulk refresh.
