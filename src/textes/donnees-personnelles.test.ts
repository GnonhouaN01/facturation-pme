import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, test } from "vitest";

import {
  A_COMPLETER,
  ADRESSE_CONTACT,
  SITE_ARTCI,
  TEXTES_DONNEES_PERSONNELLES,
} from "./donnees-personnelles";

// Page « Données personnelles » et verrou d'ouverture des comptes : tant
// qu'un texte porte « À COMPLÉTER », les comptes ne s'ouvrent pas en
// production. Fiche : docs/features/donnees-personnelles.md, sections 1 et 3.

function lire(chemin: string): string {
  return readFileSync(fileURLToPath(new URL(chemin, import.meta.url)), "utf8");
}

// Toutes les chaînes d'une valeur, à toute profondeur.
function chaines(valeur: unknown): string[] {
  if (typeof valeur === "string") return [valeur];
  if (Array.isArray(valeur)) return valeur.flatMap(chaines);
  if (typeof valeur === "object" && valeur !== null) return Object.values(valeur).flatMap(chaines);
  return [];
}

function marques(valeur: unknown): string[] {
  return chaines(valeur).filter((texte) => texte.includes(A_COMPLETER));
}

// Fermés tant que la ligne exacte figure dans le source ; à true ou retirée
// (PR 2 de la 1.3, #52) : ouverts.
const FERMES = /^export const COMPTES_OUVERTS_EN_PRODUCTION = false;$/mu;

function comptesOuverts(source: string): boolean {
  return !FERMES.test(source);
}

function problemesVerrou(ouverts: boolean, textes: unknown): string[] {
  return ouverts ? marques(textes).map((texte) => `encore à compléter : ${texte}`) : [];
}

describe("verrou d'ouverture des comptes", () => {
  test("dépôt : aucune marque « À COMPLÉTER » si les comptes sont ouverts en production", () => {
    const ouverts = comptesOuverts(lire("../server/auth/points-entree.ts"));
    expect(problemesVerrou(ouverts, TEXTES_DONNEES_PERSONNELLES)).toEqual([]);
  });

  test.each<[string, string, boolean]>([
    ["constante à false", "export const COMPTES_OUVERTS_EN_PRODUCTION = false;\n", false],
    ["constante à true", "export const COMPTES_OUVERTS_EN_PRODUCTION = true;\n", true],
    ["constante retirée", "export const AUTRE = false;\n", true],
    ["false seulement en commentaire", "// COMPTES_OUVERTS_EN_PRODUCTION = false;\n", true],
  ])("démonstration, %s", (_nom, source, attendu) => {
    expect(comptesOuverts(source)).toBe(attendu);
  });

  test.each<[string, boolean, unknown, string[]]>([
    [
      "ouverts, une marque",
      true,
      { a: [`${A_COMPLETER} : délai`] },
      [`encore à compléter : ${A_COMPLETER} : délai`],
    ],
    ["fermés, une marque", false, { a: [`${A_COMPLETER} : délai`] }, []],
    ["ouverts, aucune marque", true, { a: ["Texte complet."] }, []],
  ])("démonstration, %s", (_nom, ouverts, textes, attendus) => {
    expect(problemesVerrou(ouverts, textes)).toEqual(attendus);
  });
});

describe("textes de la page", () => {
  // « À COMPLÉTER : <quoi> », ou « À COMPLÉTER (<quoi>) » pour la ligne
  // des formalités ARTCI, écrite telle que demandée.
  test("chaque marque nomme ce qui manque", () => {
    const trouvees = marques(TEXTES_DONNEES_PERSONNELLES);
    for (const texte of trouvees) {
      expect(texte).toMatch(/À COMPLÉTER(?: : | \()\S/u);
    }
  });

  test("la page ne porte aucun texte en dur, marque comprise", () => {
    const page = lire("../app/(public)/donnees-personnelles/page.tsx");
    expect(page).not.toContain(A_COMPLETER);
    expect(page).not.toContain("gmail.com");
  });

  test("responsable, contact et autorité de contrôle", () => {
    const tout = chaines(TEXTES_DONNEES_PERSONNELLES).join("\n");
    expect(ADRESSE_CONTACT).toBe("facturation.pme.civ@gmail.com");
    expect(SITE_ARTCI).toBe("https://www.autoritedeprotection.ci");
    expect(tout).toContain("Ngolo Gnonhoua");
    expect(tout).toContain("Abidjan, Côte d'Ivoire");
    expect(tout).toContain("loi n° 2013-450");
    expect(tout).toContain(`mailto:${ADRESSE_CONTACT}`);
    expect(tout).toContain(SITE_ARTCI);
  });

  test("formalités ARTCI : marque exacte demandée", () => {
    expect(chaines(TEXTES_DONNEES_PERSONNELLES)).toContain(
      `Formalités ARTCI : ${A_COMPLETER} (déclaration préalable et demande d'autorisation de transfert, numéro de récépissé).`,
    );
  });

  test("cookies : les deux noms posés par Better Auth, et eux seuls", () => {
    const tout = chaines(TEXTES_DONNEES_PERSONNELLES).join("\n");
    const noms = [...tout.matchAll(/__Secure-better-auth\.[a-z_]+/gu)].map(([nom]) => nom);
    expect([...new Set(noms)].sort()).toEqual([
      "__Secure-better-auth.session_token",
      "__Secure-better-auth.two_factor",
    ]);
  });
});
