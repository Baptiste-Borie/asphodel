import assert from "node:assert/strict";
import { it } from "node:test";
import { PreviewSelection } from "./preview-selection.js";

it("selecting a card opens it, and it survives repeated reads (simulated polling)", () => {
  const selection = new PreviewSelection();
  assert.equal(selection.toggle("card-a"), "opened");
  for (let i = 0; i < 20; i++) assert.ok(selection.isSelected("card-a"), "must not reset on its own across repeated polls");
  assert.equal(selection.current(), "card-a");
});

it("toggling the SAME already-selected card closes it", () => {
  const selection = new PreviewSelection();
  selection.toggle("card-a");
  assert.equal(selection.toggle("card-a"), "closed");
  assert.equal(selection.current(), null);
  assert.equal(selection.isSelected("card-a"), false);
});

it("clicking a DIFFERENT card replaces the selection rather than closing it", () => {
  const selection = new PreviewSelection();
  selection.toggle("card-a");
  assert.equal(selection.toggle("card-b"), "opened");
  assert.equal(selection.current(), "card-b");
  assert.equal(selection.isSelected("card-a"), false);
});

it("close() always clears the selection regardless of what was selected", () => {
  const selection = new PreviewSelection();
  selection.toggle("card-a");
  selection.close();
  assert.equal(selection.current(), null);
});
