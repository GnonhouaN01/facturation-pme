import { randomUUID } from "node:crypto";

import { eq, inArray, sql } from "drizzle-orm";
import { Pool } from "pg";
import { afterAll, describe, expect, test } from "vitest";

import { cleCompteur, deriverSecret } from "../debit/cle";
import { creerVerificateur, purgerCompteurs } from "../debit/debit";
import { env } from "../env";

import { creerAcces, db } from "./client";
import { creerCompteur } from "./debit";
import { compteurDebit } from "./schema/technique";

// Le compteur de débit avec la vraie base : atomicité sous la concurrence,
// fenêtre, plafond, purge. Les clés d'essai portent un nom de limite propre à
// l'exécution, hors de LIMITES, et sont supprimées à la fin. Fiche :
// docs/features/limitation-debit.md, sections 2, 4, 5 et 7.

const pools: Pool[] = [];
const cles: string[] = [];

// Un Pool de plusieurs dizaines de connexions : les appels sont réellement
// simultanés dans la base, et non mis en file par le Pool.
function compteurSur(max: number) {
  const pool = new Pool({ connectionString: env.DATABASE_URL, max });
  pools.push(pool);
  return creerCompteur(creerAcces(pool).db);
}

// Clé d'essai : même forme qu'une vraie clé, nom de limite unique.
function cleEssai(): string {
  const cle = `essai_${randomUUID().replaceAll("-", "")}:${randomUUID().replaceAll("-", "")}${"0".repeat(32)}`;
  cles.push(cle);
  return cle;
}

async function ligne(cle: string) {
  const [resultat] = await db.select().from(compteurDebit).where(eq(compteurDebit.cle, cle));
  return resultat;
}

afterAll(async () => {
  try {
    if (cles.length > 0) await db.delete(compteurDebit).where(inArray(compteurDebit.cle, cles));
  } finally {
    await Promise.all(pools.map((pool) => pool.end()));
  }
});

describe("consommer : une instruction atomique (section 4)", () => {
  test("clé neuve : compte 1, fenêtre ouverte maintenant", async () => {
    const compteur = creerCompteur(db);
    const cle = cleEssai();

    expect(await compteur.consommer(cle, { maximum: 5, fenetreSecondes: 60 })).toBe(1);

    const lue = await ligne(cle);
    expect(lue?.compte).toBe(1);
    expect(Math.abs((lue?.fenetreDebut.getTime() ?? 0) - Date.now())).toBeLessThan(60_000);
  });

  test("fenêtre en cours : le compte monte, le début ne bouge pas", async () => {
    const compteur = creerCompteur(db);
    const cle = cleEssai();
    const regle = { maximum: 5, fenetreSecondes: 3_600 };

    await compteur.consommer(cle, regle);
    const debut = (await ligne(cle))?.fenetreDebut;
    const compte = await compteur.consommer(cle, regle);

    expect(compte).toBe(2);
    expect((await ligne(cle))?.fenetreDebut).toEqual(debut);
  });

  test("fenêtre expirée : le compte repart à 1, avec un nouveau début", async () => {
    const compteur = creerCompteur(db);
    const cle = cleEssai();
    await db.insert(compteurDebit).values({
      cle,
      compte: 4,
      fenetreDebut: sql`now() - interval '2 hours'`,
    });
    const ancien = (await ligne(cle))?.fenetreDebut;

    const compte = await compteur.consommer(cle, { maximum: 5, fenetreSecondes: 60 });

    expect(compte).toBe(1);
    const lue = await ligne(cle);
    expect(lue?.compte).toBe(1);
    expect(lue?.fenetreDebut.getTime()).toBeGreaterThan(ancien?.getTime() ?? Infinity);
  });

  test("plafond : le compte ne dépasse jamais maximum + 1", async () => {
    const compteur = creerCompteur(db);
    const cle = cleEssai();
    const regle = { maximum: 3, fenetreSecondes: 3_600 };

    const comptes: number[] = [];
    for (let i = 0; i < 50; i += 1) comptes.push(await compteur.consommer(cle, regle));

    expect(Math.max(...comptes)).toBe(4);
    expect((await ligne(cle))?.compte).toBe(4);
  });
});

describe("concurrence : cent requêtes simultanées comptent pour cent", () => {
  test("clé neuve, maximum 1 000 : comptes 1 à 100, compte final 100", async () => {
    const compteur = compteurSur(50);
    const cle = cleEssai();
    const regle = { maximum: 1_000, fenetreSecondes: 3_600 };

    const comptes = await Promise.all(
      Array.from({ length: 100 }, () => compteur.consommer(cle, regle)),
    );

    expect([...comptes].sort((a, b) => a - b)).toEqual(
      Array.from({ length: 100 }, (_, i) => i + 1),
    );
    expect((await ligne(cle))?.compte).toBe(100);
  });

  test("maximum 10 : exactement 10 tentatives sous la limite, compte final 11", async () => {
    const compteur = compteurSur(50);
    const cle = cleEssai();
    const regle = { maximum: 10, fenetreSecondes: 3_600 };

    const comptes = await Promise.all(
      Array.from({ length: 100 }, () => compteur.consommer(cle, regle)),
    );

    expect(comptes.filter((compte) => compte <= regle.maximum)).toHaveLength(10);
    expect((await ligne(cle))?.compte).toBe(11);
  });
});

describe("purge des lignes expirées (section 7)", () => {
  test("purger : supprime la ligne expirée, garde la ligne en cours", async () => {
    const compteur = creerCompteur(db);
    const expiree = cleEssai();
    const enCours = cleEssai();
    await db.insert(compteurDebit).values([
      { cle: expiree, compte: 1, fenetreDebut: sql`now() - interval '2 hours'` },
      { cle: enCours, compte: 1, fenetreDebut: sql`now() - interval '10 minutes'` },
    ]);

    const supprimees = await compteur.purger(3_600);

    expect(supprimees).toBeGreaterThanOrEqual(1);
    expect(await ligne(expiree)).toBeUndefined();
    expect(await ligne(enCours)).toBeDefined();
  });

  test("purgerCompteurs : au-delà de la plus longue fenêtre de LIMITES, la ligne disparaît", async () => {
    const expiree = cleEssai();
    await db.insert(compteurDebit).values({
      cle: expiree,
      compte: 1,
      fenetreDebut: sql`now() - interval '2 days'`,
    });

    await purgerCompteurs();

    expect(await ligne(expiree)).toBeUndefined();
  });
});

describe("verificateur sur le vrai compteur", () => {
  test("vrai jusqu'au maximum, faux au-delà ; clé en empreinte, sans la valeur", async () => {
    const secret = deriverSecret(env.BETTER_AUTH_SECRET);
    const verificateur = creerVerificateur({
      limites: { "membre.action": { maximum: 2, fenetreSecondes: 3_600, par: "utilisateur" } },
      compteur: creerCompteur(db),
      secret,
    });
    const utilisateur = randomUUID();
    const cle = verificateur.cle("membre.action", utilisateur);
    cles.push(cle);

    const reponses = [
      await verificateur.verifierDebit("membre.action", utilisateur),
      await verificateur.verifierDebit("membre.action", utilisateur),
      await verificateur.verifierDebit("membre.action", utilisateur),
    ];

    expect(reponses).toEqual([true, true, false]);
    expect(cle).toBe(cleCompteur("membre.action", utilisateur, secret));
    expect(cle).not.toContain(utilisateur);
    expect((await ligne(cle))?.compte).toBe(3);
  });
});
