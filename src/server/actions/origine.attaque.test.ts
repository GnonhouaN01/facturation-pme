import { describe, expect, test } from "vitest";

import { verifierOrigine } from "./origine";

// Tests d'attaque de la menace T-17 (requête d'un autre site), exigence S-81.
// Fonction pure, sans base. Fiche : docs/features/chaine-controles.md,
// section 3.3.

const ATTENDUE = "https://facturation.exemple.ci";

function entetes(valeurs: Record<string, string>): Headers {
  return new Headers(valeurs);
}

describe("verifierOrigine : acceptée", () => {
  test("Origin égale à l'adresse configurée", () => {
    expect(verifierOrigine(entetes({ origin: ATTENDUE }), ATTENDUE)).toBe(true);
  });

  test("Origin égale, Sec-Fetch-Site: same-origin", () => {
    const requete = entetes({ origin: ATTENDUE, "sec-fetch-site": "same-origin" });

    expect(verifierOrigine(requete, ATTENDUE)).toBe(true);
  });

  test("adresse locale avec port", () => {
    const locale = "http://localhost:3000";

    expect(verifierOrigine(entetes({ origin: locale }), locale)).toBe(true);
  });

  test("adresse configurée avec barre finale ou chemin : seule son origine compte", () => {
    const requete = entetes({ origin: ATTENDUE });

    expect(verifierOrigine(requete, `${ATTENDUE}/`)).toBe(true);
    expect(verifierOrigine(requete, `${ATTENDUE}/api/auth`)).toBe(true);
  });
});

describe("verifierOrigine : refusée", () => {
  test.each([
    ["autre port", "https://facturation.exemple.ci:8443"],
    ["autre schéma", "http://facturation.exemple.ci"],
    ["sous-domaine", "https://piege.facturation.exemple.ci"],
    ["domaine parent", "https://exemple.ci"],
    ["suffixe ajouté", "https://facturation.exemple.ci.attaquant.test"],
    ["préfixe ajouté", "https://attaquant-facturation.exemple.ci"],
    ["autre site", "https://attaquant.test"],
    ["identifiants dans l'adresse", "https://facturation.exemple.ci@attaquant.test"],
    ["deux origines", `${ATTENDUE}, https://attaquant.test`],
    ["null", "null"],
    ["vide", ""],
  ])("Origin %s : refusée", (_nom, origine) => {
    expect(verifierOrigine(entetes({ origin: origine }), ATTENDUE)).toBe(false);
  });

  test("Origin absente : refusée", () => {
    expect(verifierOrigine(entetes({}), ATTENDUE)).toBe(false);
  });

  test("Origin absente, Referer de la bonne adresse : refusée", () => {
    expect(verifierOrigine(entetes({ referer: `${ATTENDUE}/` }), ATTENDUE)).toBe(false);
  });

  test("Origin absente, Host égal : refusée (l'en-tête de la requête ne fait pas foi)", () => {
    const requete = entetes({
      host: "facturation.exemple.ci",
      "x-forwarded-host": "facturation.exemple.ci",
    });

    expect(verifierOrigine(requete, ATTENDUE)).toBe(false);
  });

  test.each(["cross-site", "same-site", "none", ""])(
    "Origin égale, Sec-Fetch-Site: %s : refusée",
    (site) => {
      const requete = entetes({ origin: ATTENDUE, "sec-fetch-site": site });

      expect(verifierOrigine(requete, ATTENDUE)).toBe(false);
    },
  );
});
