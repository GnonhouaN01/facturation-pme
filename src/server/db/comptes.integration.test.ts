import { randomBytes, randomUUID } from "node:crypto";

import { eq, inArray, sql } from "drizzle-orm";
import { afterAll, describe, expect, test } from "vitest";

import { ETAPES, executerEtapes } from "../taches/etapes";
import { creerTraitementTache } from "../taches/quotidienne";

import { db } from "./client";
import {
  creerPurgeJetons,
  purgerComptesNonVerifies,
  purgerJetonsExpires,
  purgerSessionsExpirees,
} from "./comptes";
import { account, session, user, verification } from "./schema/auth";
import { compteurDebit } from "./schema/technique";

// Purge des comptes non vérifiés de plus de 7 jours (THREATS.md 7.2) : leurs
// comptes et sessions suivent par ON DELETE CASCADE ; un compte vérifié, ou
// récent, reste. Fiche : docs/features/inscription.md, section 4.6.

const crees: string[] = [];

afterAll(async () => {
  if (crees.length > 0) await db.delete(user).where(inArray(user.id, crees));
});

const JOUR = 24 * 60 * 60 * 1000;

async function creer(options: { verifie: boolean; ageJours: number }): Promise<string> {
  const id = randomUUID();
  crees.push(id);
  const date = new Date(Date.now() - options.ageJours * JOUR);
  await db.insert(user).values({
    id,
    name: "Compte de test",
    email: `test-${id}@exemple.test`,
    emailVerified: options.verifie,
    createdAt: date,
    updatedAt: date,
  });
  await db.insert(account).values({
    id: randomUUID(),
    accountId: id,
    providerId: "credential",
    userId: id,
    createdAt: date,
    updatedAt: date,
  });
  await db.insert(session).values({
    id: randomUUID(),
    token: randomUUID(),
    userId: id,
    expiresAt: new Date(Date.now() + JOUR),
    createdAt: date,
    updatedAt: date,
  });
  return id;
}

async function existe(id: string): Promise<boolean> {
  return (await db.select().from(user).where(eq(user.id, id))).length === 1;
}

describe("purgerComptesNonVerifies", () => {
  test("supprime un non vérifié de 8 jours, avec ses comptes et sessions ; garde les autres", async () => {
    const ancien = await creer({ verifie: false, ageJours: 8 });
    const recent = await creer({ verifie: false, ageJours: 6 });
    const verifie = await creer({ verifie: true, ageJours: 8 });

    const supprimes = await purgerComptesNonVerifies();

    expect(supprimes).toBeGreaterThanOrEqual(1);
    expect(await existe(ancien)).toBe(false);
    expect(await db.select().from(account).where(eq(account.userId, ancien))).toEqual([]);
    expect(await db.select().from(session).where(eq(session.userId, ancien))).toEqual([]);
    expect(await existe(recent)).toBe(true);
    expect(await existe(verifie)).toBe(true);
  });
});

// Purge des sessions expirées (S-63, 1.2) : une session expirée ne sert plus
// et contient une adresse IP et un navigateur. Fiche :
// docs/features/connexion.md, section 4.4, test 18.
describe("purgerSessionsExpirees", () => {
  test("supprime une session expirée, garde une session en cours et l'utilisateur", async () => {
    const id = await creer({ verifie: true, ageJours: 0 });
    const expiree = randomUUID();
    await db.insert(session).values({
      id: expiree,
      token: randomUUID(),
      userId: id,
      expiresAt: new Date(Date.now() - 60_000),
      createdAt: new Date(Date.now() - 8 * JOUR),
      updatedAt: new Date(Date.now() - 8 * JOUR),
    });

    const supprimees = await purgerSessionsExpirees();

    expect(supprimees).toBeGreaterThanOrEqual(1);
    const restantes = await db.select().from(session).where(eq(session.userId, id));
    // La session en cours, créée par creer() (expire dans un jour), reste.
    expect(restantes.map((s) => s.id)).not.toContain(expiree);
    expect(restantes).toHaveLength(1);
    expect(await existe(id)).toBe(true);
  });
});

// Purge des jetons expirés (S-63, 1.3) : Better Auth ne supprime les lignes
// expirées de verification qu'à l'occasion d'une recherche. Fiche :
// docs/features/mot-de-passe.md, section 9, test 22. Modifié à
// l'implémentation : les lignes sont créées et purgées dans une transaction
// annulée ensuite. Better Auth supprime lui-même toute ligne expirée à chaque
// recherche de jeton (findVerificationValue) : lancé en parallèle,
// reinitialisation.integration.test.ts pouvait effacer la ligne expirée avant
// la purge, qui comptait alors 0 (constaté dans npm run test:integration,
// jamais sur le fichier seul). Dans la transaction, la ligne est invisible des
// autres connexions ; ce que le test prouve ne change pas.
describe("purgerJetonsExpires", () => {
  test("liée à db : une fonction", () => {
    expect(typeof purgerJetonsExpires).toBe("function");
  });

  test("supprime une ligne expirée, garde une ligne valable", async () => {
    const expiree = randomUUID();
    const valable = randomUUID();
    const ANNULATION = new Error("annulation voulue");
    await expect(
      db.transaction(async (tx) => {
        await tx.insert(verification).values([
          {
            id: expiree,
            identifier: `reinitialisation:${randomUUID()}`,
            value: randomUUID(),
            expiresAt: new Date(Date.now() - 60_000),
          },
          {
            id: valable,
            identifier: `reinitialisation:${randomUUID()}`,
            value: randomUUID(),
            expiresAt: new Date(Date.now() + 30 * 60_000),
          },
        ]);
        const supprimees = await creerPurgeJetons(tx)();
        expect(supprimees).toBeGreaterThanOrEqual(1);
        const restantes = await tx
          .select({ id: verification.id })
          .from(verification)
          .where(inArray(verification.id, [expiree, valable]));
        expect(restantes.map((r) => r.id)).toEqual([valable]);
        throw ANNULATION;
      }),
    ).rejects.toBe(ANNULATION);
    // Rien n'a été validé : aucune ligne laissée sur dev.
    expect(
      await db
        .select()
        .from(verification)
        .where(inArray(verification.id, [expiree, valable])),
    ).toEqual([]);
  });
});

// La tâche quotidienne avec la vraie base et les vraies étapes : seules les
// lignes de compteur_debit expirées et les comptes non vérifiés de plus de
// 7 jours disparaissent ; un second appel, ou deux appels simultanés, ne
// changent rien de plus ; un appel refusé ne touche à rien. Secret de test
// injecté (la configuration de la base de test n'a pas de CRON_SECRET).
// Dans ce fichier, et non dans un fichier à part : un fichier lancé en
// parallèle purgerait les comptes de 8 jours créés ci-dessus entre leur
// création et l'appel de purgerComptesNonVerifies, qui pourrait alors ne
// rien supprimer elle-même (supprimes >= 1). Les tests d'un même fichier
// s'exécutent l'un après l'autre. Fiche : docs/features/tache-quotidienne.md,
// sections 3.1 et 3.2, test 8.

const SECRET = randomBytes(32).toString("base64url");

const traiter = creerTraitementTache({
  secret: SECRET,
  taches: { quotidienne: () => executerEtapes(ETAPES) },
});

const utilisateurs: string[] = [];
const cles: string[] = [];

afterAll(async () => {
  try {
    if (cles.length > 0) await db.delete(compteurDebit).where(inArray(compteurDebit.cle, cles));
  } finally {
    if (utilisateurs.length > 0) await db.delete(user).where(inArray(user.id, utilisateurs));
  }
});

async function appeler(autorisation?: string): Promise<Response> {
  return traiter(
    new Request("https://facturation.exemple.ci/api/taches/quotidienne", {
      headers: autorisation === undefined ? {} : { authorization: autorisation },
    }),
    { params: Promise.resolve({ tache: "quotidienne" }) },
  );
}

async function creerUtilisateur(options: { verifie: boolean; ageJours: number }): Promise<string> {
  const id = randomUUID();
  utilisateurs.push(id);
  const date = new Date(Date.now() - options.ageJours * JOUR);
  await db.insert(user).values({
    id,
    name: "Compte de test",
    email: `test-${id}@exemple.test`,
    emailVerified: options.verifie,
    createdAt: date,
    updatedAt: date,
  });
  await db.insert(account).values({
    id: randomUUID(),
    accountId: id,
    providerId: "credential",
    userId: id,
    createdAt: date,
    updatedAt: date,
  });
  await db.insert(session).values({
    id: randomUUID(),
    token: randomUUID(),
    userId: id,
    expiresAt: new Date(Date.now() + JOUR),
    createdAt: date,
    updatedAt: date,
  });
  return id;
}

// Clé d'essai : même forme qu'une vraie clé, nom de limite propre au test.
async function creerCompteur(ageHeures: number): Promise<string> {
  const cle = `essai_${randomUUID().replaceAll("-", "")}:${randomUUID().replaceAll("-", "")}${"0".repeat(32)}`;
  cles.push(cle);
  await db.insert(compteurDebit).values({
    cle,
    compte: 1,
    fenetreDebut: sql`now() - make_interval(hours => ${ageHeures}::integer)`,
  });
  return cle;
}

async function utilisateurExiste(id: string): Promise<boolean> {
  return (await db.select().from(user).where(eq(user.id, id))).length === 1;
}

async function compteurExiste(cle: string): Promise<boolean> {
  return (await db.select().from(compteurDebit).where(eq(compteurDebit.cle, cle))).length === 1;
}

type Jeu = {
  ancien: string;
  recent: string;
  verifie: string;
  expire: string;
  enCours: string;
};

async function preparer(): Promise<Jeu> {
  return {
    ancien: await creerUtilisateur({ verifie: false, ageJours: 8 }),
    recent: await creerUtilisateur({ verifie: false, ageJours: 6 }),
    verifie: await creerUtilisateur({ verifie: true, ageJours: 8 }),
    // La plus longue fenêtre de LIMITES est de 24 heures.
    expire: await creerCompteur(48),
    enCours: await creerCompteur(0),
  };
}

async function etat(jeu: Jeu) {
  return {
    ancien: await utilisateurExiste(jeu.ancien),
    sessionsAncien: (await db.select().from(session).where(eq(session.userId, jeu.ancien))).length,
    recent: await utilisateurExiste(jeu.recent),
    verifie: await utilisateurExiste(jeu.verifie),
    expire: await compteurExiste(jeu.expire),
    enCours: await compteurExiste(jeu.enCours),
  };
}

const INTACT = {
  ancien: true,
  sessionsAncien: 1,
  recent: true,
  verifie: true,
  expire: true,
  enCours: true,
};
const PURGE = {
  ancien: false,
  sessionsAncien: 0,
  recent: true,
  verifie: true,
  expire: false,
  enCours: true,
};

describe("tâche quotidienne, vraie base", () => {
  test("appels refusés (sans secret, secret forgé) : rien ne disparaît", async () => {
    const jeu = await preparer();

    expect((await appeler()).status).toBe(404);
    expect((await appeler(`Bearer ${randomBytes(32).toString("base64url")}`)).status).toBe(404);

    expect(await etat(jeu)).toEqual(INTACT);
  });

  test("appel autorisé : seules les lignes expirées disparaissent ; un second appel ne change rien", async () => {
    const jeu = await preparer();

    const premier = await appeler(`Bearer ${SECRET}`);
    expect(premier.status).toBe(200);
    expect(await premier.text()).toBe('{"ok":true}');
    expect(await etat(jeu)).toEqual(PURGE);

    const second = await appeler(`Bearer ${SECRET}`);
    expect(second.status).toBe(200);
    expect(await etat(jeu)).toEqual(PURGE);
  });

  test("deux appels simultanés : deux 200, même état final", async () => {
    const jeu = await preparer();

    const reponses = await Promise.all([appeler(`Bearer ${SECRET}`), appeler(`Bearer ${SECRET}`)]);

    expect(reponses.map((r) => r.status)).toEqual([200, 200]);
    expect(await etat(jeu)).toEqual(PURGE);
  });
});
