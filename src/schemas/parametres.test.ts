import { describe, expect, test } from "vitest";

import {
  schemaAjoutTaux,
  schemaEtatTaux,
  schemaFiche,
  schemaInstructions,
  schemaLogo,
  schemaRetraitLogo,
} from "./parametres";

// Entrées des actions de la 2.2 : objets stricts, normalisation, entiers.
// Les logos construits ici sont testés en détail par
// src/lib/image/logo.attaque.test.ts. Fiche :
// docs/features/parametres-organisation.md, test 2.

const FICHE = {
  raisonSociale: "  Kouamé   & Fils ",
  adresse: "Cocody, rue des Jardins\r\nAbidjan",
  ncc: "1234567 A",
  rccm: "",
  regimeImposition: "Réel normal",
  mentionsLegales: "",
  validiteDevisJours: 30,
  echeanceFactureJours: 45,
};

// PNG minimal de 1 × 1 pixel : signature, IHDR, IDAT, IEND.
const PNG_1X1 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

describe("schemaFiche", () => {
  test("normalise, vide en null, entiers gardés", () => {
    expect(schemaFiche.parse(FICHE)).toEqual({
      raisonSociale: "Kouamé & Fils",
      adresse: "Cocody, rue des Jardins\nAbidjan",
      ncc: "1234567 A",
      rccm: null,
      regimeImposition: "Réel normal",
      mentionsLegales: null,
      validiteDevisJours: 30,
      echeanceFactureJours: 45,
    });
  });

  test.each([
    ["délai 0", { validiteDevisJours: 0 }],
    ["délai 366", { echeanceFactureJours: 366 }],
    ["délai à virgule", { validiteDevisJours: 30.5 }],
    ["délai en texte", { validiteDevisJours: "30" }],
    ["NCC avec chevron", { ncc: "<12>" }],
    ["marque de direction", { adresse: "Abidjan‮" }],
    ["raison sociale vide", { raisonSociale: "" }],
    ["régime sur deux lignes", { regimeImposition: "Réel\nnormal" }],
    ["mentions trop longues", { mentionsLegales: "m".repeat(1001) }],
    ["instructions de paiement glissées", { mobileMoney: "07 00 00 00 00" }],
    ["organisation forcée", { organisationId: "00000000-0000-4000-8000-000000000000" }],
    ["champ absent", { ncc: undefined }],
  ])("%s : refusé", (_nom, modification) => {
    expect(schemaFiche.safeParse({ ...FICHE, ...modification }).success).toBe(false);
  });
});

describe("schemaAjoutTaux", () => {
  test("taux converti en centièmes, libellé normalisé", () => {
    expect(schemaAjoutTaux.parse({ libelle: " Taux  réduit ", taux: "9,5" })).toEqual({
      libelle: "Taux réduit",
      taux: 950,
    });
  });

  test.each([
    ["libellé vide", { libelle: " ", taux: "18" }],
    ["taux au-delà de 100", { libelle: "X", taux: "100,5" }],
    ["taux en nombre", { libelle: "X", taux: 18 }],
    ["centièmes fournis", { libelle: "X", taux: "18", tauxCentiemes: 1 }],
  ])("%s : refusé", (_nom, entree) => {
    expect(schemaAjoutTaux.safeParse(entree).success).toBe(false);
  });
});

describe("schemaEtatTaux", () => {
  test("identifiant et booléen seulement", () => {
    const tauxId = "6f1d1f4e-8a2b-4c3d-9e0f-1a2b3c4d5e6f";
    expect(schemaEtatTaux.parse({ tauxId, actif: false })).toEqual({ tauxId, actif: false });
    expect(schemaEtatTaux.safeParse({ tauxId: "1", actif: false }).success).toBe(false);
    expect(schemaEtatTaux.safeParse({ tauxId, actif: "non" }).success).toBe(false);
  });
});

describe("schemaLogo", () => {
  test("PNG valide : octets décodés, type tiré de la signature", () => {
    const lu = schemaLogo.parse({ contenu: PNG_1X1 }).contenu;
    expect(lu.type).toBe("image/png");
    expect(lu.octets).toBeInstanceOf(Uint8Array);
    expect(lu.octets.length).toBeGreaterThan(8);
  });

  test.each([
    ["vide", ""],
    ["base64 non strict", "iVBORw0KGgo AAAA"],
    ["HTML renommé", Buffer.from("<html><script>alert(1)</script></html>").toString("base64")],
    ["trop long", "A".repeat(273_072)],
  ])("%s : refusé", (_nom, contenu) => {
    expect(schemaLogo.safeParse({ contenu }).success).toBe(false);
  });

  test("type annoncé : clé en trop, refusée", () => {
    expect(schemaLogo.safeParse({ contenu: PNG_1X1, type: "image/png" }).success).toBe(false);
  });
});

describe("schemaRetraitLogo et schemaInstructions", () => {
  test("retrait : objet vide strict", () => {
    expect(schemaRetraitLogo.parse({})).toEqual({});
    expect(schemaRetraitLogo.safeParse({ x: 1 }).success).toBe(false);
  });

  test("instructions : deux textes sur plusieurs lignes, vides en null", () => {
    expect(
      schemaInstructions.parse({
        mobileMoney: "Orange Money : 07 00 00 00 00",
        bancaire: "",
      }),
    ).toEqual({ mobileMoney: "Orange Money : 07 00 00 00 00", bancaire: null });
    expect(
      schemaInstructions.safeParse({ mobileMoney: "a\n".repeat(4), bancaire: "" }).success,
    ).toBe(false);
    expect(
      schemaInstructions.safeParse({ mobileMoney: "", bancaire: "", adresse: "x" }).success,
    ).toBe(false);
  });
});
