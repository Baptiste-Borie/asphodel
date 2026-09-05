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

  it("accepte le format sans \"x\" (export style) en plus du format historique", () => {
    const result = parseDeckList("Commander\n1 Uurg, Spawn of Turg\n\nMainboard\n99 Forest");
    assert.deepEqual(result.issues, []);
    assert.deepEqual(result.cards, [
      { quantity: 1, name: "Uurg, Spawn of Turg", section: "commander" },
      { quantity: 99, name: "Forest", section: "mainboard" },
    ]);
  });

  it("extrait l'empreinte (SET) NUMERO à la fois avec et sans \"x\"", () => {
    const result = parseDeckList(
      "Commander\n1x Uurg, Spawn of Turg (DMU) 225\n\nMainboard\n1 Uurg, Spawn of Turg (DMU) 225",
    );
    assert.deepEqual(result.issues, []);
    assert.deepEqual(result.cards, [
      { quantity: 1, name: "Uurg, Spawn of Turg", section: "commander", setCode: "dmu", collectorNumber: "225" },
      { quantity: 1, name: "Uurg, Spawn of Turg", section: "mainboard", setCode: "dmu", collectorNumber: "225" },
    ]);
  });

  it("conserve les noms contenant une virgule et une apostrophe avec une empreinte", () => {
    const result = parseDeckList("Commander\n1x Krenko, Tin Street Kingpin (C21) 15\n\nMainboard\n1x Urza's Saga (MH2) 244");
    assert.deepEqual(result.cards, [
      { quantity: 1, name: "Krenko, Tin Street Kingpin", section: "commander", setCode: "c21", collectorNumber: "15" },
      { quantity: 1, name: "Urza's Saga", section: "mainboard", setCode: "mh2", collectorNumber: "244" },
    ]);
  });

  it("accepte un numéro de collection alphanumérique et non purement numérique", () => {
    const result = parseDeckList("Commander\n1x Some Card (XYZ) 123a\n\nMainboard\n1x Other Card (XYZ) ★12");
    assert.equal(result.cards[0]!.collectorNumber, "123a");
    assert.equal(typeof result.cards[0]!.collectorNumber, "string");
    assert.equal(result.cards[1]!.collectorNumber, "★12");
  });

  it("normalise le code d'édition en minuscules", () => {
    const result = parseDeckList("Commander\n1x Some Card (dmu) 225");
    assert.equal(result.cards[0]!.setCode, "dmu");
  });

  it("garde le texte tel quel quand la suffixe d'empreinte est malformée (pas de crash, pas d'erreur)", () => {
    const result = parseDeckList("Commander\n1x Some Card (DMU\n\nMainboard\n1x Other Card ()  225");
    assert.deepEqual(result.issues, []);
    assert.equal(result.cards[0]!.name, "Some Card (DMU");
    assert.equal(result.cards[0]!.setCode, undefined);
    // "()"-only set code is not a valid set code shape either; kept as plain name text.
    assert.equal(result.cards[1]!.setCode, undefined);
  });

  it("tolère les espaces multiples autour de la quantité, du x et de l'empreinte", () => {
    const result = parseDeckList("Commander\n1   x    Uurg, Spawn of Turg   (DMU)   225");
    assert.deepEqual(result.issues, []);
    assert.equal(result.cards[0]!.name, "Uurg, Spawn of Turg");
    assert.equal(result.cards[0]!.setCode, "dmu");
    assert.equal(result.cards[0]!.collectorNumber, "225");
  });
});
