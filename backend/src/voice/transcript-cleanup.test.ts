import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { stripWhisperTimestamps } from "./transcript-cleanup.js";

describe("stripWhisperTimestamps", () => {
  it("retire les préfixes horodatés et joint les segments", () => {
    const raw = [
      "[00:00:00.000 --> 00:00:01.200]  Je passe",
      "[00:00:01.200 --> 00:00:02.400]  la priorité",
    ].join("\n");

    assert.equal(stripWhisperTimestamps(raw), "Je passe la priorité");
  });

  it("ignore les lignes vides et les espaces superflus autour d'un segment", () => {
    const raw = "\n[00:00:00.000 --> 00:00:01.000]    j'attaque avec Krenko   \n\n";

    assert.equal(stripWhisperTimestamps(raw), "j'attaque avec Krenko");
  });

  it("retourne une chaîne vide quand aucune ligne n'a de timestamp", () => {
    assert.equal(stripWhisperTimestamps("[Nodejs-whisper] some log noise"), "");
  });

  it("retourne une chaîne vide pour une entrée vide", () => {
    assert.equal(stripWhisperTimestamps(""), "");
  });
});
