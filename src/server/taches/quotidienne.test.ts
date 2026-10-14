import { randomBytes } from "node:crypto";

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { ETAPES, executerEtapes, type Etape } from "./etapes";
import { creerTraitementTache } from "./quotidienne";

// Exécution de la tâche quotidienne : les étapes dans l'ordre, chacune lancée
// même si une autre échoue ; 200 ou 500, corps fixes, Cache-Control: no-store ;
// une ligne de journal par étape, champs choisis, jamais le message d'une
// erreur. Fiche : docs/features/tache-quotidienne.md, sections 2.1, 3.1 et
// 3.3, test 4.

vi.mock("@/server/env", () => ({
  env: {
    DATABASE_URL: "postgresql://app_facturation:factice@localhost:5432/factice",
    BETTER_AUTH_SECRET: "secret-factice-de-trente-deux-caracteres",
    BETTER_AUTH_URL: "https://facturation.exemple.ci",
  },
  secretTache: { secret: null },
}));

const SECRET = randomBytes(32).toString("base64url");

type Sortie = { niveau: string; ligne: string };

let sorties: Sortie[] = [];

beforeEach(() => {
  sorties = [];
  for (const niveau of ["log", "info", "warn", "error", "debug"] as const) {
    vi.spyOn(console, niveau).mockImplementation((...args: unknown[]) => {
      sorties.push({ niveau, ligne: args.map(String).join(" ") });
    });
  }
});

afterEach(() => {
  vi.restoreAllMocks();
});

function etape(nom: Etape["nom"], executer: () => Promise<number>): Etape {
  return { nom, executer };
}

async function appelerQuotidienne(etapes: readonly Etape[]): Promise<Response> {
  const traiter = creerTraitementTache({
    secret: SECRET,
    taches: { quotidienne: () => executerEtapes(etapes) },
  });
  return traiter(
    new Request("https://facturation.exemple.ci/api/taches/quotidienne", {
      headers: { authorization: `Bearer ${SECRET}` },
    }),
    { params: Promise.resolve({ tache: "quotidienne" }) },
  );
}

// Lignes [tache] décodées : préfixe fixe, puis un objet JSON.
function lignesTache(): { niveau: string; objet: Record<string, unknown> }[] {
  return sorties.map(({ niveau, ligne }) => {
    expect(ligne.startsWith("[tache] ")).toBe(true);
    return { niveau, objet: JSON.parse(ligne.slice("[tache] ".length)) as Record<string, unknown> };
  });
}

describe("les étapes de la première version", () => {
  // Modifié en 1.2 : étape sessions_expirees ajoutée (docs/features/connexion.md,
  // section 4.4, test 18).
  test("compteurs_debit, comptes_non_verifies puis sessions_expirees, et rien d'autre", () => {
    expect(ETAPES.map((e) => e.nom)).toEqual([
      "compteurs_debit",
      "comptes_non_verifies",
      "sessions_expirees",
    ]);
    expect(Object.isFrozen(ETAPES)).toBe(true);
  });
});

describe("exécution", () => {
  test("deux réussites : dans l'ordre, 200 {ok:true}, no-store, une ligne info par étape", async () => {
    const ordre: string[] = [];
    const reponse = await appelerQuotidienne([
      etape("compteurs_debit", async () => (ordre.push("compteurs_debit"), 12)),
      etape("comptes_non_verifies", async () => (ordre.push("comptes_non_verifies"), 0)),
    ]);

    expect(ordre).toEqual(["compteurs_debit", "comptes_non_verifies"]);
    expect(reponse.status).toBe(200);
    expect(await reponse.text()).toBe('{"ok":true}');
    expect(reponse.headers.get("cache-control")).toBe("no-store");
    expect(reponse.headers.get("content-type")).toMatch(/^application\/json/);

    const lignes = lignesTache();
    expect(lignes.map((l) => l.niveau)).toEqual(["info", "info"]);
    expect(lignes.map((l) => Object.keys(l.objet))).toEqual([
      ["etape", "resultat", "lignes", "dureeMs"],
      ["etape", "resultat", "lignes", "dureeMs"],
    ]);
    expect(lignes[0]?.objet).toMatchObject({
      etape: "compteurs_debit",
      resultat: "ok",
      lignes: 12,
    });
    expect(lignes[1]?.objet).toMatchObject({
      etape: "comptes_non_verifies",
      resultat: "ok",
      lignes: 0,
    });
    for (const { objet } of lignes) {
      expect(Number.isSafeInteger(objet.dureeMs)).toBe(true);
      expect(objet.dureeMs as number).toBeGreaterThanOrEqual(0);
    }
  });

  test("la première étape lève : la seconde est lancée, 500 {ok:false}, no-store", async () => {
    const seconde = vi.fn(async () => 3);
    const reponse = await appelerQuotidienne([
      etape("compteurs_debit", async () => {
        throw new Error("panne");
      }),
      etape("comptes_non_verifies", seconde),
    ]);

    expect(seconde).toHaveBeenCalledTimes(1);
    expect(reponse.status).toBe(500);
    expect(await reponse.text()).toBe('{"ok":false}');
    expect(reponse.headers.get("cache-control")).toBe("no-store");

    const lignes = lignesTache();
    expect(lignes.map((l) => [l.niveau, l.objet.etape, l.objet.resultat])).toEqual([
      ["error", "compteurs_debit", "erreur"],
      ["info", "comptes_non_verifies", "ok"],
    ]);
  });

  test("la seconde étape lève : 500, la première consignée ok", async () => {
    const reponse = await appelerQuotidienne([
      etape("compteurs_debit", async () => 1),
      etape("comptes_non_verifies", async () => {
        throw new Error("panne");
      }),
    ]);

    expect(reponse.status).toBe(500);
    expect(lignesTache().map((l) => l.objet.resultat)).toEqual(["ok", "erreur"]);
  });

  test("deux appels successifs : deux 200, chaque étape lancée deux fois", async () => {
    const premiere = vi.fn(async () => 0);
    const seconde = vi.fn(async () => 0);
    const etapes = [etape("compteurs_debit", premiere), etape("comptes_non_verifies", seconde)];

    expect((await appelerQuotidienne(etapes)).status).toBe(200);
    expect((await appelerQuotidienne(etapes)).status).toBe(200);
    expect(premiere).toHaveBeenCalledTimes(2);
    expect(seconde).toHaveBeenCalledTimes(2);
  });
});

describe("journal : jamais le message d'une erreur (S-54, T-35)", () => {
  const ADRESSE = "awa.kone@exemple.invalid";
  const SQL = 'delete from "user" where "email" = $1';

  // Erreur au message bavard, avec une cause qui porte un code PostgreSQL,
  // comme une erreur de Drizzle qui enveloppe celle de pg.
  class DatabaseError extends Error {}
  function erreurBavarde(): Error {
    const cause = Object.assign(new Error(`${SQL} params: ${ADRESSE}`), { code: "57P01" });
    const erreur = new DatabaseError(`Failed query: ${SQL}\nparams: ${ADRESSE}`, { cause });
    erreur.stack = `DatabaseError: ${ADRESSE}\n    at purger (src/server/db/comptes.ts:20:5)`;
    return erreur;
  }

  test("classe et code seulement ; ni adresse, ni requête, ni pile, ni secret", async () => {
    await appelerQuotidienne([
      etape("compteurs_debit", async () => 0),
      etape("comptes_non_verifies", async () => {
        throw erreurBavarde();
      }),
    ]);

    const lignes = lignesTache();
    expect(lignes[1]).toEqual({
      niveau: "error",
      objet: {
        etape: "comptes_non_verifies",
        resultat: "erreur",
        classe: "DatabaseError",
        code: "57P01",
        dureeMs: expect.any(Number) as number,
      },
    });
    const tout = sorties.map((s) => s.ligne).join("\n");
    for (const interdit of [
      ADRESSE,
      "delete from",
      "Failed query",
      "params",
      "comptes.ts",
      SECRET,
    ]) {
      expect(tout).not.toContain(interdit);
    }
  });

  test("valeur levée hostile (accesseur qui lève, Proxy) : la tâche ne lève pas", async () => {
    const accesseur = {
      get constructor(): never {
        throw new Error(`accesseur ${ADRESSE}`);
      },
    };
    const mandataire = new Proxy(
      {},
      {
        get() {
          throw new Error(`mandataire ${ADRESSE}`);
        },
        has() {
          throw new Error(`mandataire ${ADRESSE}`);
        },
      },
    );

    const reponse = await appelerQuotidienne([
      etape("compteurs_debit", () => Promise.reject(accesseur)),
      etape("comptes_non_verifies", () => Promise.reject(mandataire)),
    ]);

    expect(reponse.status).toBe(500);
    expect(sorties.map((s) => s.ligne).join("\n")).not.toContain(ADRESSE);
    expect(sorties).toHaveLength(2);
  });

  test("console qui lève : la tâche ne lève pas, la réponse part", async () => {
    vi.restoreAllMocks();
    for (const niveau of ["info", "error"] as const) {
      vi.spyOn(console, niveau).mockImplementation(() => {
        throw new Error("console défaillante");
      });
    }

    const reponse = await appelerQuotidienne([
      etape("compteurs_debit", async () => 0),
      etape("comptes_non_verifies", async () => {
        throw erreurBavarde();
      }),
    ]);

    expect(reponse.status).toBe(500);
  });
});
