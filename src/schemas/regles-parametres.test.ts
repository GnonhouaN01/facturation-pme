import { describe, expect, test } from "vitest";

import {
  formaterTaux,
  lireDelai,
  normaliserTexte,
  REGLES_TEXTE,
  tauxEnCentiemes,
  texteValide,
} from "./regles-parametres";

// Règles des paramètres (2.2), partagées par le navigateur et le serveur.
// Fiche : docs/features/parametres-organisation.md, sections 3.2, 4 et 6,
// tests 1 et 2.

describe("normaliserTexte", () => {
  test.each([
    ["  Abidjan  ", "Abidjan"],
    ["Rue   des Jardins", "Rue des Jardins"],
    ["\n\nLigne 1\r\n  Ligne 2  \n\n", "Ligne 1\nLigne 2"],
    ["Ligne 1\n\nLigne 3", "Ligne 1\n\nLigne 3"],
    ["é", "é"],
  ])("%j donne %j", (saisie, attendu) => {
    expect(normaliserTexte(saisie)).toBe(attendu);
  });

  test.each(["", "   ", "\n \n"])("%j : non renseigné (null)", (saisie) => {
    expect(normaliserTexte(saisie)).toBeNull();
  });
});

describe("texteValide", () => {
  test("vide : valide (champ facultatif)", () => {
    expect(texteValide("", REGLES_TEXTE.ncc)).toBe(true);
  });

  test("longueur en points de code, comme char_length", () => {
    const max = REGLES_TEXTE.ncc.max;
    // Lettre hors du plan de base : deux unités UTF-16, un point de code.
    expect(texteValide("𝐀".repeat(max), { ...REGLES_TEXTE.ncc, motif: null })).toBe(true);
    expect(texteValide("A".repeat(max), REGLES_TEXTE.ncc)).toBe(true);
    expect(texteValide("A".repeat(max + 1), REGLES_TEXTE.ncc)).toBe(false);
  });

  test("saisie brute au-delà de quatre fois la borne : refusée avant normalisation", () => {
    const regle = REGLES_TEXTE.regimeImposition;
    expect(texteValide(" ".repeat(regle.max * 4 + 1) + "R", regle)).toBe(false);
  });

  test.each([
    ["tabulation", "a\tb"],
    ["marque de direction", "a‮b"],
    ["espace sans chasse", "a​b"],
    ["séparateur de ligne", "a b"],
    ["caractère nul", "a\u0000b"],
    ["retour chariot seul", "a\rb"],
  ])("%s : refusé", (_nom, saisie) => {
    expect(texteValide(saisie, REGLES_TEXTE.adresse)).toBe(false);
  });

  test("retour à la ligne : refusé sur une ligne, admis sur plusieurs, borné", () => {
    expect(texteValide("a\nb", REGLES_TEXTE.regimeImposition)).toBe(false);
    expect(texteValide("a\r\nb", REGLES_TEXTE.adresse)).toBe(true);
    expect(texteValide("1\n2\n3\n4\n5", REGLES_TEXTE.adresse)).toBe(true);
    expect(texteValide("1\n2\n3\n4\n5\n6", REGLES_TEXTE.adresse)).toBe(false);
  });

  test.each([
    ["CI-ABJ-2026-B-12345", true],
    ["1234567 A", true],
    ["12/345.6", true],
    ["<script>", false],
    ["12_34", false],
    ["12;34", false],
  ])("NCC et RCCM %j : %s", (saisie, attendu) => {
    expect(texteValide(saisie, REGLES_TEXTE.ncc)).toBe(attendu);
    expect(texteValide(saisie, REGLES_TEXTE.rccm)).toBe(attendu);
  });

  test("mentions légales : balises admises, stockées comme texte", () => {
    expect(texteValide("<script>alert(1)</script>", REGLES_TEXTE.mentionsLegales)).toBe(true);
  });
});

describe("lireDelai", () => {
  test.each([
    ["30", 30],
    [" 1 ", 1],
    ["365", 365],
  ])("%j donne %d", (saisie, attendu) => {
    expect(lireDelai(saisie)).toBe(attendu);
  });

  test.each(["0", "366", "-1", "1.5", "1e2", "", "trente", "٣٠"])("%j : refusé", (saisie) => {
    expect(lireDelai(saisie)).toBeNull();
  });
});

describe("tauxEnCentiemes (sans nombre à virgule, règle 8)", () => {
  test.each([
    ["18", 1800],
    ["18,5", 1850],
    ["18.50", 1850],
    ["9,5", 950],
    ["0", 0],
    ["0,01", 1],
    ["100", 10_000],
    [" 18 ", 1800],
  ])("%j donne %d", (saisie, attendu) => {
    expect(tauxEnCentiemes(saisie)).toBe(attendu);
  });

  test.each(["100,01", "101", "-1", "1e2", "18,555", "", "18 %", "18,", ",5", "١٨", "0x10"])(
    "%j : refusé",
    (saisie) => {
      expect(tauxEnCentiemes(saisie)).toBeNull();
    },
  );
});

describe("formaterTaux", () => {
  test.each([
    [1800, "18 %"],
    [1850, "18,5 %"],
    [1825, "18,25 %"],
    [950, "9,5 %"],
    [0, "0 %"],
    [10_000, "100 %"],
  ])("%d donne %j", (centiemes, attendu) => {
    expect(formaterTaux(centiemes)).toBe(attendu);
  });
});
