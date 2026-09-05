import assert from "node:assert/strict";
import { it } from "node:test";
import { CardPresentationStore, selectMissingNames } from "./card-presentation-store.js";
import type { CardPresentation } from "./types.js";

function presentation(name: string): CardPresentation {
  return { name, manaCost: "{1}", manaValue: 1, typeLine: "Artifact", oracleText: null, imageUri: null };
}

it("selectMissingNames dedupes and excludes already-cached names, preserving first-seen order", () => {
  const cache = new Map<string, CardPresentation | null>([["Sol Ring", presentation("Sol Ring")]]);
  assert.deepEqual(selectMissingNames(cache, ["Sol Ring", "Forest", "Forest", "Zuran Orb"]), ["Forest", "Zuran Orb"]);
});

it("fetches only names it has never seen, and never re-fetches a resolved name", async () => {
  const calls: string[][] = [];
  const store = new CardPresentationStore(async (names) => {
    calls.push([...names]);
    return Object.fromEntries(names.map((n) => [n, presentation(n)]));
  });
  await store.ensure(["Sol Ring", "Forest"]);
  await store.ensure(["Sol Ring", "Forest", "Zuran Orb"]);
  assert.deepEqual(calls, [["Sol Ring", "Forest"], ["Zuran Orb"]]);
  assert.equal(store.get("Sol Ring")?.name, "Sol Ring");
  assert.equal(store.get("Zuran Orb")?.name, "Zuran Orb");
});

it("caches an unresolved name as null and never retries it", async () => {
  let calls = 0;
  const store = new CardPresentationStore(async () => {
    calls++;
    return {};
  });
  await store.ensure(["Unknown Card"]);
  await store.ensure(["Unknown Card"]);
  assert.equal(calls, 1);
  assert.equal(store.get("Unknown Card"), null);
});

it("a name with no presentation requested yet reports undefined, distinct from a resolved null", () => {
  const store = new CardPresentationStore(async () => ({}));
  assert.equal(store.get("Never Requested"), undefined);
});

it("concurrent ensure() calls for the same missing name share one in-flight request", async () => {
  let calls = 0;
  let resolveFetch: (value: Record<string, CardPresentation>) => void = () => {};
  const store = new CardPresentationStore(async (names) => {
    calls++;
    return new Promise((resolve) => { resolveFetch = () => resolve(Object.fromEntries(names.map((n) => [n, presentation(n)]))); });
  });
  const first = store.ensure(["Sol Ring"]);
  const second = store.ensure(["Sol Ring"]);
  resolveFetch();
  await Promise.all([first, second]);
  assert.equal(calls, 1);
});
