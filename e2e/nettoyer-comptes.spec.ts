import { readFileSync } from "node:fs";

import { expect, test } from "@playwright/test";

import { ADRESSES_E2E, adresseE2E } from "./comptes-e2e";
import { nettoyer, REQUETE_NETTOYAGE } from "./nettoyer-comptes";

// Nettoyage des comptes de bout en bout (globalTeardown), sans base : la
// connexion est remplacée par un faux. Conditions fixées par le développeur
// sur la PR 2 de la 1.1 : DATABASE_URL seule, jamais DATABASE_URL_MIGRATION ;
// suppression de la liste exacte des adresses de l'exécution, toutes en
// .invalid, sans LIKE ni motif ; refus si VERCEL_ENV est défini. Fiche :
// docs/features/inscription.md, test 12.

type Appel = { texte: string; valeurs: unknown[] };

function fauxPool(options: { echec?: boolean } = {}) {
  const ouvertures: string[] = [];
  const appels: Appel[] = [];
  let fermetures = 0;
  const ouvrir = (adresse: string) => {
    ouvertures.push(adresse);
    return {
      query: async (texte: string, valeurs: unknown[]) => {
        appels.push({ texte, valeurs });
        if (options.echec) throw new Error("base en panne");
        return { rowCount: 2 };
      },
      end: async () => {
        fermetures += 1;
      },
    };
  };
  return { ouvrir, ouvertures, appels, fermetures: () => fermetures };
}

const BASE = "postgresql://app_facturation:factice@127.0.0.1:1/factice";
const MIGRATION = "postgresql://proprietaire:factice@127.0.0.1:1/factice";

function sansLocales() {
  let lectures = 0;
  return {
    lire: () => {
      lectures += 1;
      return {};
    },
    lectures: () => lectures,
  };
}

test.describe("nettoyage des comptes de bout en bout", () => {
  test("refuse de tourner si VERCEL_ENV est défini, quelle que soit sa valeur", async () => {
    for (const valeur of ["production", "preview", "development", ""]) {
      const pool = fauxPool();
      const locales = sansLocales();

      await expect(
        nettoyer({
          source: { VERCEL_ENV: valeur, DATABASE_URL: BASE },
          lireLocales: locales.lire,
          adresses: ADRESSES_E2E,
          ouvrir: pool.ouvrir,
        }),
        valeur,
      ).rejects.toThrow(/VERCEL_ENV/);
      expect(pool.ouvertures, valeur).toEqual([]);
      expect(locales.lectures(), valeur).toBe(0);
    }
  });

  test("DATABASE_URL seule : DATABASE_URL_MIGRATION n'est jamais prise, même à défaut", async () => {
    for (const [nom, source, locales] of [
      ["dans l'environnement", { DATABASE_URL_MIGRATION: MIGRATION }, {}],
      ["dans .env.local", {}, { DATABASE_URL_MIGRATION: MIGRATION }],
    ] as const) {
      const pool = fauxPool();

      await expect(
        nettoyer({
          source,
          lireLocales: () => locales,
          adresses: ADRESSES_E2E,
          ouvrir: pool.ouvrir,
        }),
        nom,
      ).rejects.toThrow(/DATABASE_URL absente/);
      expect(pool.ouvertures, nom).toEqual([]);
    }

    const pool = fauxPool();
    await nettoyer({
      source: { DATABASE_URL: BASE, DATABASE_URL_MIGRATION: MIGRATION },
      lireLocales: () => ({ DATABASE_URL_MIGRATION: MIGRATION }),
      adresses: ADRESSES_E2E,
      ouvrir: pool.ouvrir,
    });
    expect(pool.ouvertures).toEqual([BASE]);

    // Et le fichier ne nomme jamais la variable de migration.
    const source = readFileSync("e2e/nettoyer-comptes.ts", "utf8");
    expect(source).not.toContain("DATABASE_URL_MIGRATION");
    expect(source).toContain("DATABASE_URL");
  });

  test("supprime la liste exacte des adresses de l'exécution, par égalité, sans LIKE ni motif", async () => {
    const pool = fauxPool();

    const supprimes = await nettoyer({
      source: { DATABASE_URL: BASE },
      lireLocales: () => ({}),
      adresses: ADRESSES_E2E,
      ouvrir: pool.ouvrir,
    });

    expect(supprimes).toBe(2);
    expect(pool.appels).toHaveLength(1);
    const [appel] = pool.appels;
    expect(appel?.texte).toBe(REQUETE_NETTOYAGE);
    expect(REQUETE_NETTOYAGE).toBe('DELETE FROM "user" WHERE email = ANY($1::text[])');
    expect(REQUETE_NETTOYAGE).not.toMatch(/like|%|_|~|similar|regexp/i);
    expect(appel?.valeurs).toEqual([[...ADRESSES_E2E]]);
    expect(pool.fermetures()).toBe(1);
  });

  test("la liste : toutes les adresses que les tests peuvent créer, toutes en .invalid, sans caractère de motif", () => {
    const attendues = ["mobile-390", "ordinateur-1280"].flatMap((projet) =>
      Array.from({ length: 30 }, (_, rang) => adresseE2E(projet, rang)),
    );

    expect([...ADRESSES_E2E]).toEqual(attendues);
    expect(new Set(ADRESSES_E2E).size).toBe(ADRESSES_E2E.length);
    for (const adresse of ADRESSES_E2E) {
      expect(adresse).toMatch(/^e2e-[0-9a-f]{8}-\d{1,2}@exemple\.invalid$/);
    }
  });

  test("refuse une liste vide, une adresse hors .invalid ou une adresse à caractère de motif", async () => {
    for (const adresses of [
      [],
      [...ADRESSES_E2E, "awa@exemple.ci"],
      ["e2e-%@exemple.invalid"],
      ["e2e-_@exemple.invalid"],
      ["victime@exemple.invalid.ci"],
    ]) {
      const pool = fauxPool();

      await expect(
        nettoyer({
          source: { DATABASE_URL: BASE },
          lireLocales: () => ({}),
          adresses,
          ouvrir: pool.ouvrir,
        }),
        adresses.at(-1) ?? "liste vide",
      ).rejects.toThrow();
      expect(pool.ouvertures).toEqual([]);
    }
  });

  test("la connexion est fermée même si la suppression échoue", async () => {
    const pool = fauxPool({ echec: true });

    await expect(
      nettoyer({
        source: { DATABASE_URL: BASE },
        lireLocales: () => ({}),
        adresses: ADRESSES_E2E,
        ouvrir: pool.ouvrir,
      }),
    ).rejects.toThrow();
    expect(pool.fermetures()).toBe(1);
  });
});
