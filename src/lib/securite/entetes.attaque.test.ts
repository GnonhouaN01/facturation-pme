import { describe, expect, test } from "vitest";

import { politiqueSecurite } from "./entetes";

// T-34 : un nonce qui sortirait de sa valeur ajouterait une source ou une
// directive à la politique (« 'nonce-x' 'unsafe-inline' », « x; script-src * »).
// politiqueSecurite refuse tout nonce qui n'est pas du base64.
// Fiche : docs/features/socle-interface.md, section 5.3.

describe("politiqueSecurite refuse un nonce qui sortirait de sa valeur", () => {
  test.each([
    ["apostrophe", "abc' 'unsafe-inline"],
    ["point-virgule", "abc; script-src *"],
    ["espace", "abc https://attaquant.exemple"],
    ["tabulation", "abc\thttps://attaquant.exemple"],
    ["retour à la ligne", "abc\r\nX-Injecte: 1"],
    ["virgule", "abc, script-src *"],
    ["vide", ""],
  ])("%s : refusé", (_nom, nonce) => {
    for (const developpement of [false, true]) {
      expect(() => politiqueSecurite({ nonce, developpement })).toThrow();
    }
  });

  test("témoin : un nonce base64 de 16 octets est accepté", () => {
    expect(() =>
      politiqueSecurite({ nonce: "q83vEjRWeJA0Ulh4mrzN7w==", developpement: false }),
    ).not.toThrow();
  });
});
