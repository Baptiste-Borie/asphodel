import assert from "node:assert/strict";
import { it } from "node:test";
import { tableCardClassName } from "./card-view.js";

it("a tapped card carries the tapped class (the visual rotation hook)", () => {
  const className = tableCardClassName({ tapped: true, summoningSick: false }, false);
  assert.ok(className.split(" ").includes("table-card--tapped"));
});

it("an untapped card never carries the tapped class", () => {
  const className = tableCardClassName({ tapped: false, summoningSick: false }, false);
  assert.ok(!className.includes("table-card--tapped"));
});

it("a null tapped value (non-battlefield zones) is treated as untapped", () => {
  const className = tableCardClassName({ tapped: null, summoningSick: null }, false);
  assert.ok(!className.includes("table-card--tapped"));
});

it("selected adds the selected class independently of tapped", () => {
  const className = tableCardClassName({ tapped: true, summoningSick: false }, true);
  assert.ok(className.includes("table-card--tapped"));
  assert.ok(className.includes("table-card--selected"));
});

it("always starts with the base table-card class and includes any extra className", () => {
  const className = tableCardClassName({ tapped: false, summoningSick: false }, false, "table-card--hand");
  assert.ok(className.startsWith("table-card"));
  assert.ok(className.includes("table-card--hand"));
});

it("summoning sickness (V2e.5) carries its own dedicated class, independent of tapped/selected", () => {
  const className = tableCardClassName({ tapped: false, summoningSick: true }, false);
  assert.ok(className.includes("table-card--summoning-sick"));
  assert.ok(!className.includes("table-card--tapped"));
});

it("a non-sick creature never carries the summoning-sick class", () => {
  const className = tableCardClassName({ tapped: false, summoningSick: false }, false);
  assert.ok(!className.includes("table-card--summoning-sick"));
});

it("a null summoningSick value (non-creatures, non-battlefield zones) is treated as not sick", () => {
  const className = tableCardClassName({ tapped: false, summoningSick: null }, false);
  assert.ok(!className.includes("table-card--summoning-sick"));
});
