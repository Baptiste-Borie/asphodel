import assert from "node:assert/strict";
import { it } from "node:test";
import { commanderTaxLabel } from "./commander-tax.js";

it("is null when the tax is genuinely zero (never cast from the command zone)", () => {
  assert.equal(commanderTaxLabel({ commanderTaxGeneric: 0 }), null);
});

it("is null when the field is absent — an older bridge, never guessed/defaulted", () => {
  assert.equal(commanderTaxLabel({ commanderTaxGeneric: undefined }), null);
});

it("formats a positive tax as a plain +N badge", () => {
  assert.equal(commanderTaxLabel({ commanderTaxGeneric: 2 }), "+2");
  assert.equal(commanderTaxLabel({ commanderTaxGeneric: 8 }), "+8");
});
