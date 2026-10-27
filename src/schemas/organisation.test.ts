import { describe, expect, test } from "vitest";

import {
  LONGUEUR_MAX_RAISON_SOCIALE,
  schemaChangementOrganisation,
  schemaCreationOrganisation,
} from "./organisation";

// Raison sociale de la création (2.1) et entrée du changement
// d'organisation. Fiche : docs/features/organisations.md, sections 4 et 5.

function creer(raisonSociale: unknown) {
  return schemaCreationOrganisation.safeParse({ raisonSociale });
}

describe("raison sociale", () => {
  test("normalisée : espaces de bord retirés, suites réduites, NFC", () => {
    // Espace insécable compris (séparateur d'espace) ; la tabulation, caractère
    // de contrôle, est refusée plus bas.
    const lue = creer("  Kouamé   & Fils  SARL  ");
    expect(lue.success && lue.data.raisonSociale).toBe("Kouamé & Fils SARL");
    // « e » suivi de l'accent combinant devient « é » précomposé.
    const nfd = creer("Societé Ivoirienne");
    expect(nfd.success && nfd.data.raisonSociale).toBe("Societé Ivoirienne");
  });

  test.each([
    ["vide", ""],
    ["espaces seuls", "    "],
    ["un caractère", "A"],
    ["trop long", "A".repeat(LONGUEUR_MAX_RAISON_SOCIALE + 1)],
    ["brut démesuré", `${" ".repeat(500)}AB`],
    ["signes seuls", "--- !!"],
    ["caractère de contrôle", "Kouamé\u0000SARL"],
    ["retour à la ligne", "Kouamé\nSARL"],
    ["tabulation", "Kouamé\tSARL"],
    ["marque de direction", "Kouamé ‮LRAS"],
    ["espace sans chasse", "Kou​amé"],
    ["nombre", 42],
    ["absent", undefined],
  ])("refusée : %s", (_cas, valeur) => {
    expect(creer(valeur).success).toBe(false);
  });

  test("100 caractères : acceptée", () => {
    expect(creer("A".repeat(LONGUEUR_MAX_RAISON_SOCIALE)).success).toBe(true);
  });

  test("schéma strict : une clé de plus est refusée", () => {
    for (const cle of ["organisationId", "role", "slug", "userId"]) {
      expect(
        schemaCreationOrganisation.safeParse({ raisonSociale: "Kouamé SARL", [cle]: "x" }).success,
      ).toBe(false);
    }
  });
});

describe("changement d'organisation", () => {
  test("un UUID seul", () => {
    expect(
      schemaChangementOrganisation.safeParse({
        organisationId: "5a1d2c3b-4e5f-4a6b-8c7d-9e0f1a2b3c4d",
      }).success,
    ).toBe(true);
    for (const valeur of ["", "org-1", "5a1d2c3b-4e5f-4a6b-8c7d", 1, null]) {
      expect(schemaChangementOrganisation.safeParse({ organisationId: valeur }).success).toBe(
        false,
      );
    }
    expect(
      schemaChangementOrganisation.safeParse({
        organisationId: "5a1d2c3b-4e5f-4a6b-8c7d-9e0f1a2b3c4d",
        role: "proprietaire",
      }).success,
    ).toBe(false);
  });
});
