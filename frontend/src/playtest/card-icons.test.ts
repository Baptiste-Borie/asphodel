import assert from "node:assert/strict";
import { it } from "node:test";
import { keywordIconSpec, keywordIconSpecs } from "./card-icons.js";

it("recognizes every keyword in the bridge's fixed combatKeywords allowlist", () => {
  for (const keyword of [
    "flying", "reach", "menace", "vigilance", "deathtouch",
    "first_strike", "double_strike", "trample", "indestructible", "lifelink", "defender",
  ]) {
    assert.ok(keywordIconSpec(keyword), `expected an icon for "${keyword}"`);
  }
});

it("never invents an icon for something outside the allowlist", () => {
  assert.equal(keywordIconSpec("haste"), undefined);
  assert.equal(keywordIconSpec("flash"), undefined);
  assert.equal(keywordIconSpec(""), undefined);
});

it("keywordIconSpecs returns nothing for no/empty/unrecognized keywords", () => {
  assert.deepEqual(keywordIconSpecs(null), []);
  assert.deepEqual(keywordIconSpecs(undefined), []);
  assert.deepEqual(keywordIconSpecs([]), []);
  assert.deepEqual(keywordIconSpecs(["haste"]), []);
});

it("keywordIconSpecs returns one entry per recognized keyword, each with a full-word label", () => {
  const specs = keywordIconSpecs(["vigilance", "flying"]);
  assert.deepEqual(specs.map((s) => s.label).sort(), ["Flying", "Vigilance"]);
});

it("keywordIconSpecs drops unrecognized entries but keeps the recognized ones", () => {
  const specs = keywordIconSpecs(["haste", "trample"]);
  assert.deepEqual(specs.map((s) => s.keyword), ["trample"]);
});

it("keywordIconSpecs is stable-ordered (allowlist order) regardless of input order", () => {
  const a = keywordIconSpecs(["trample", "flying"]);
  const b = keywordIconSpecs(["flying", "trample"]);
  assert.deepEqual(a.map((s) => s.keyword), b.map((s) => s.keyword));
});
