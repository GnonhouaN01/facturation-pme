import { describe, expect, test } from "vitest";

import { formaterMontant, formaterMontantColonne } from "./montants";

// Formats de DESIGN-SYSTEM.md (« Formats ») : entier, espace comme séparateur
// de milliers, suivi de « F CFA ». Toutes les espaces sont insécables
// (U+00A0). Fiche : docs/features/socle-interface.md, section 11.2.

const INSECABLE = " ";
const FINE = " ";

// Écrit avec des espaces ordinaires pour la lisibilité, puis converti.
const insecable = (texte: string) => texte.replaceAll(" ", INSECABLE);

const VALEURS: ReadonlyArray<[number, string]> = [
  [0, "0"],
  [1, "1"],
  [999, "999"],
  [1_000, "1 000"],
  [12_345, "12 345"],
  [1_180_000, "1 180 000"],
  [1_000_000_000, "1 000 000 000"],
  [Number.MAX_SAFE_INTEGER, "9 007 199 254 740 991"],
];

describe("formaterMontantColonne", () => {
  test.each(VALEURS)("%d donne « %s », sans l'unité", (montant, attendu) => {
    expect(formaterMontantColonne(montant)).toBe(insecable(attendu));
  });

  test("-0 donne 0, sans signe", () => {
    expect(formaterMontantColonne(-0)).toBe("0");
  });
});

describe("formaterMontant", () => {
  test.each(VALEURS)("%d donne « %s F CFA »", (montant, attendu) => {
    expect(formaterMontant(montant)).toBe(insecable(`${attendu} F CFA`));
  });

  test("-0 donne 0 F CFA, sans signe", () => {
    expect(formaterMontant(-0)).toBe(insecable("0 F CFA"));
  });

  test("ni espace ordinaire ni espace fine : un montant ne se coupe pas et garde la chasse de DM Mono", () => {
    for (const [montant] of VALEURS) {
      const texte = formaterMontant(montant);
      expect(texte, String(montant)).not.toContain(" ");
      expect(texte, String(montant)).not.toContain(FINE);
    }
  });
});

// R-01 : un montant est un entier. Un nombre à virgule, non fini ou au-delà
// des entiers sûrs est une erreur de programmation, pas une valeur à arrondir.
// Un montant négatif est refusé jusqu'à la 5.5 (décision 5).
const REFUSES: ReadonlyArray<[string, number]> = [
  ["un nombre à virgule", 1.5],
  ["un dixième", 0.1],
  ["NaN", Number.NaN],
  ["l'infini", Number.POSITIVE_INFINITY],
  ["l'infini négatif", Number.NEGATIVE_INFINITY],
  ["2 puissance 53", 2 ** 53],
  ["-1", -1],
  ["un montant négatif", -1_180_000],
  ["-(2 puissance 53)", -(2 ** 53)],
];

describe("valeurs refusées", () => {
  test.each(REFUSES)("formaterMontant refuse %s par RangeError", (_nom, montant) => {
    expect(() => formaterMontant(montant)).toThrow(RangeError);
  });

  test.each(REFUSES)("formaterMontantColonne refuse %s par RangeError", (_nom, montant) => {
    expect(() => formaterMontantColonne(montant)).toThrow(RangeError);
  });
});
