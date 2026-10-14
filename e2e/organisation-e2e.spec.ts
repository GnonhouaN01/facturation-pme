import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { expect, test } from "@playwright/test";

import { ADRESSES_E2E } from "./comptes-e2e";
import { creerOutilOrganisation, REQUETE_SUPPRESSION } from "./organisation-e2e";

// Organisation de test du gabarit connecté (1.2), sans base : la connexion
// est remplacée par un faux. Conditions fixées par le développeur
// (décision 4), un test chacune : code dans e2e/ seulement ; base jetable ou
// service de la CI seulement, saut annoncé sinon, sans rien écrire ;
// DATABASE_URL seule, rôle de l'application ; identifiants tirés à chaque
// exécution ; suppression par liste exacte ; refus si VERCEL_ENV est défini.
// Fiche : docs/features/connexion.md, section 8.2, test 26.

type Appel = { texte: string; valeurs: unknown[] };

const UTILISATEUR = "0d6f6c4e-1d1e-4a57-9a51-3f2a7f0b9c11";
const JETABLE = "postgresql://app_facturation:x@127.0.0.1:35059/facturation_test";
const CI = "postgresql://app_facturation:mot-de-passe-de-test@localhost:5432/facturation_test";
const DEV = "postgresql://app_facturation:x@ep-exemple.eu-central-1.aws.neon.tech/neondb";
const PROPRIETAIRE = "postgresql://postgres:x@127.0.0.1:35059/facturation_test";
const ADRESSE = ADRESSES_E2E[0] ?? "";

function fauxPool() {
  const ouvertures: string[] = [];
  const appels: Appel[] = [];
  let fermetures = 0;
  const ouvrir = (adresse: string) => {
    ouvertures.push(adresse);
    return {
      query: async (texte: string, valeurs: unknown[]) => {
        appels.push({ texte, valeurs });
        // La lecture de l'utilisateur rend son identifiant ; le reste, une ligne.
        return { rows: [{ id: UTILISATEUR }], rowCount: 1 };
      },
      end: async () => {
        fermetures += 1;
      },
    };
  };
  return { ouvrir, ouvertures, appels, fermetures: () => fermetures };
}

function outil(
  source: Record<string, string | undefined>,
  pool = fauxPool(),
  execution = "a1b2c3d4",
) {
  return { pool, resultat: creerOutilOrganisation({ source, ouvrir: pool.ouvrir, execution }) };
}

function fichiers(dossier: string): string[] {
  return readdirSync(dossier, { recursive: true, withFileTypes: true })
    .filter((entree) => entree.isFile())
    .map((entree) => join(entree.parentPath, entree.name));
}

test.describe("organisation de test, conditions de la décision 4", () => {
  test("1. code dans e2e/ seulement : aucun fichier de src/ ne l'importe ni ne reprend ses requêtes", () => {
    const fautifs = fichiers("src").filter((chemin) => {
      const contenu = readFileSync(chemin, "utf8");
      return contenu.includes("organisation-e2e") || contenu.includes(REQUETE_SUPPRESSION);
    });
    expect(fautifs).toEqual([]);
  });

  test("2. base jetable ou CI seulement : sinon saut annoncé, aucune connexion", async () => {
    for (const [nom, source] of [
      ["E2E_BASE=dev", { E2E_BASE: "dev", DATABASE_URL: JETABLE }],
      ["ni CI ni base jetable", { DATABASE_URL: JETABLE }],
      ["base jetable déclarée, hôte distant", { E2E_BASE_JETABLE: "1", DATABASE_URL: DEV }],
      ["CI déclarée, hôte distant", { CI: "true", DATABASE_URL: DEV }],
      ["marque jetable autre que 1", { E2E_BASE_JETABLE: "oui", DATABASE_URL: JETABLE }],
    ] as const) {
      const { pool, resultat } = outil(source);
      expect("saut" in resultat, nom).toBe(true);
      if ("saut" in resultat) {
        expect(resultat.saut, nom).toMatch(/^Organisation de test sautée : /);
        expect(resultat.saut, nom).toMatch(/base jetable|CI/);
      }
      expect(pool.ouvertures, nom).toEqual([]);
    }
  });

  test("2. témoins : base jetable (127.0.0.1) et service de la CI (localhost) acceptés", async () => {
    for (const source of [
      { E2E_BASE_JETABLE: "1", DATABASE_URL: JETABLE },
      { CI: "true", DATABASE_URL: CI },
    ]) {
      const { pool, resultat } = outil(source);
      expect("saut" in resultat).toBe(false);
      if ("saut" in resultat) continue;
      await resultat.rattacher(ADRESSE);
      expect(pool.ouvertures).toEqual([source.DATABASE_URL]);
      await resultat.nettoyer();
    }
  });

  test("3. DATABASE_URL seule, jamais DATABASE_URL_MIGRATION ni le rôle propriétaire", async () => {
    const sansBase = outil({ E2E_BASE_JETABLE: "1", DATABASE_URL_MIGRATION: PROPRIETAIRE });
    expect("saut" in sansBase.resultat).toBe(true);
    expect(sansBase.pool.ouvertures).toEqual([]);

    expect(() =>
      creerOutilOrganisation({
        source: { E2E_BASE_JETABLE: "1", DATABASE_URL: PROPRIETAIRE },
        ouvrir: fauxPool().ouvrir,
        execution: "a1b2c3d4",
      }),
    ).toThrow(/app_facturation/);
  });

  test("3. .env.local n'est jamais lu : ni le nom du fichier, ni dotenv, ni node:fs", () => {
    const source = readFileSync("e2e/organisation-e2e.ts", "utf8");
    expect(source).not.toMatch(/env\.local/);
    expect(source).not.toContain("dotenv");
    expect(source).not.toMatch(/["'](node:)?fs(\/promises)?["']/);
    expect(source).not.toContain("DATABASE_URL_MIGRATION");
  });

  test("4. identifiants tirés à chaque exécution : organisation et slug différents", async () => {
    const vus = new Set<string>();
    for (const execution of ["a1b2c3d4", "e5f6a7b8"]) {
      for (let i = 0; i < 2; i += 1) {
        const { pool, resultat } = outil(
          { E2E_BASE_JETABLE: "1", DATABASE_URL: JETABLE },
          fauxPool(),
          execution,
        );
        if ("saut" in resultat) throw new Error(resultat.saut);
        const { organisationId } = await resultat.rattacher(ADRESSE);
        expect(organisationId).toMatch(
          /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
        );
        const insertion = pool.appels.find((a) => a.texte.startsWith('INSERT INTO "organization"'));
        const slug = String(insertion?.valeurs[2]);
        expect(slug).toMatch(new RegExp(`^e2e-${execution}-[0-9a-f]{8}$`));
        vus.add(organisationId).add(slug);
        await resultat.nettoyer();
      }
    }
    expect(vus.size).toBe(8);
  });

  test("4. requêtes paramétrées : aucune valeur dans le texte des requêtes", async () => {
    const { pool, resultat } = outil({ E2E_BASE_JETABLE: "1", DATABASE_URL: JETABLE });
    if ("saut" in resultat) throw new Error(resultat.saut);
    const { organisationId } = await resultat.rattacher(ADRESSE);
    await resultat.nettoyer();
    for (const { texte } of pool.appels) {
      for (const valeur of [ADRESSE, organisationId, UTILISATEUR, "proprietaire"]) {
        expect(texte).not.toContain(valeur);
      }
    }
  });

  test("5. suppression par liste exacte : id = ANY($1::uuid[]), sans LIKE, connexion fermée", async () => {
    const { pool, resultat } = outil({ E2E_BASE_JETABLE: "1", DATABASE_URL: JETABLE });
    if ("saut" in resultat) throw new Error(resultat.saut);
    const a = await resultat.rattacher(ADRESSE);
    const b = await resultat.rattacher(ADRESSES_E2E[1] ?? "");

    await resultat.nettoyer();

    expect(REQUETE_SUPPRESSION).toBe('DELETE FROM "organization" WHERE id = ANY($1::uuid[])');
    const suppressions = pool.appels.filter((x) => x.texte.startsWith("DELETE"));
    expect(suppressions).toEqual([
      { texte: REQUETE_SUPPRESSION, valeurs: [[a.organisationId, b.organisationId]] },
    ]);
    for (const { texte } of pool.appels) expect(texte).not.toMatch(/\bLIKE\b|%/i);
    expect(pool.fermetures()).toBe(1);
  });

  test("5. rien créé : aucune connexion pour le nettoyage", async () => {
    const { pool, resultat } = outil({ E2E_BASE_JETABLE: "1", DATABASE_URL: JETABLE });
    if ("saut" in resultat) throw new Error(resultat.saut);
    expect(await resultat.nettoyer()).toBe(0);
    expect(pool.ouvertures).toEqual([]);
  });

  test("5. une adresse hors de l'exécution est refusée, sans connexion", async () => {
    const { pool, resultat } = outil({ E2E_BASE_JETABLE: "1", DATABASE_URL: JETABLE });
    if ("saut" in resultat) throw new Error(resultat.saut);
    for (const adresse of [
      "awa@exemple.ci",
      "e2e-00000000-1@exemple.invalid",
      "%@exemple.invalid",
    ]) {
      await expect(resultat.rattacher(adresse), adresse).rejects.toThrow(/adresse/);
    }
    expect(pool.ouvertures).toEqual([]);
  });

  test("6. refus si VERCEL_ENV est défini, quelle que soit sa valeur, sans connexion", () => {
    for (const valeur of ["production", "preview", "development", ""]) {
      const pool = fauxPool();
      expect(
        () =>
          creerOutilOrganisation({
            source: { VERCEL_ENV: valeur, E2E_BASE_JETABLE: "1", DATABASE_URL: JETABLE },
            ouvrir: pool.ouvrir,
            execution: "a1b2c3d4",
          }),
        valeur,
      ).toThrow(/VERCEL_ENV/);
      expect(pool.ouvertures, valeur).toEqual([]);
    }
  });
});
