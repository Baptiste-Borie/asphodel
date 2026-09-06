import assert from "node:assert/strict";
import { it } from "node:test";
import { tableCardClassName } from "./card-view.js";

it("a tapped card carries the tapped class (the visual rotation hook)", () => {
  const className = tableCardClassName({ tapped: true }, false);
  assert.ok(className.split(" ").includes("table-card--tapped"));
});

it("an untapped card never carries the tapped class", () => {
  const className = tableCardClassName({ tapped: false }, false);
  assert.ok(!className.includes("table-card--tapped"));
});

it("a null tapped value (non-battlefield zones) is treated as untapped", () => {
  const className = tableCardClassName({ tapped: null }, false);
  assert.ok(!className.includes("table-card--tapped"));
});

it("selected adds the selected class independently of tapped", () => {
  const className = tableCardClassName({ tapped: true }, true);
  assert.ok(className.includes("table-card--tapped"));
  assert.ok(className.includes("table-card--selected"));
});

it("always starts with the base table-card class and includes any extra className", () => {
  const className = tableCardClassName({ tapped: false }, false, "table-card--hand");
  assert.ok(className.startsWith("table-card"));
  assert.ok(className.includes("table-card--hand"));
});
