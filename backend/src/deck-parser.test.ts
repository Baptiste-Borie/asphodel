import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseDeckList } from "./deck-parser.js";

describe("parseDeckList", () => {
  it("parse les sections, les quantités et les noms complets", () => {
    const result = parseDeckList(`Commander
1x Krenko, Tin Street Kingpin

Mainboard
1x Hazoret's Monument
1x Battle-Rattle Shaman
30x Mountain`);

    assert.deepEqual(result.issues, []);
    assert.deepEqual(result.cards, [
      {
        quantity: 1,
        name: "Krenko, Tin Street Kingpin",
        section: "commander",
      },
      {
        quantity: 1,
        name: "Hazoret's Monument",
        section: "mainboard",
      },
      {
        quantity: 1,
        name: "Battle-Rattle Shaman",
        section: "mainboard",
      },
      { quantity: 30, name: "Mountain", section: "mainboard" },
    ]);
    assert.deepEqual(result.summary, { entries: 4, totalCards: 33 });
  });

  it("accepte les retours à la ligne Windows et les titres sans tenir compte de la casse", () => {
    const result = parseDeckList(
      "COMMANDER\r\n1x Krenko, Tin Street Kingpin\r\nMAINBOARD\r\n1x Sol Ring",
    );

    assert.equal(result.issues.length, 0);
    assert.equal(result.cards.length, 2);
  });

  it("signale les lignes invalides avec leur numéro", () => {
    const result = parseDeckList(`Commander
Krenko, Tin Street Kingpin
Mainboard
0x Mountain`);

    assert.equal(result.cards.length, 0);
    assert.deepEqual(result.issues, [
      {
        line: 2,
        content: "Krenko, Tin Street Kingpin",
        message: "Format attendu : quantité x nom de la carte (exemple : 1x Sol Ring).",
      },
      {
        line: 4,
        content: "0x Mountain",
        message: "La quantité doit être un entier supérieur à zéro.",
      },
    ]);
  });
});
