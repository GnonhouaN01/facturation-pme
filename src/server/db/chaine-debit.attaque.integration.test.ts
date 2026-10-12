import { eq, inArray, like } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { z } from "zod";

import { creerChaine, declarerAction, type Chaine } from "../actions/action";
import { lireSession } from "../auth/session";
import { deriverSecret } from "../debit/cle";
import { creerVerificateur, type Verificateur } from "../debit/debit";
import { env } from "../env";
import { journaliser } from "../journal/audit";

import { db, executerDansOrganisation } from "./client";
import { creerCompteur } from "./debit";
import { creerMembre, nettoyerMembres } from "./outils-test/membres";
import { creerDeuxOrganisations, type Organisations } from "./outils-test/organisations";
import { lireAdhesion } from "./requetes/adhesions";
import { member, session } from "./schema/auth";
import { compteurDebit, temoinIsolation } from "./schema/technique";

// Tests d'attaque de l'étape 4 : les quatre obligatoires (PLAN.md section
// 4.3) et ceux de T-41. Fiche : docs/features/limitation-debit.md, section
// « Tests d'attaque ».

const MAXIMUM = 3;
const TROP = { ok: false, raison: "trop_de_requetes" } as const;
const REFUS = { ok: false, raison: "refuse" } as const;

let orgs: Organisations;
const utilisateurs: string[] = [];

let verificateurMemo: Verificateur | undefined;
function verificateur(): Verificateur {
  verificateurMemo ??= creerVerificateur({
    limites: { "membre.action": { maximum: MAXIMUM, fenetreSecondes: 3_600, par: "utilisateur" } },
    compteur: creerCompteur(db),
    secret: deriverSecret(env.BETTER_AUTH_SECRET),
  });
  return verificateurMemo;
}

// Chaîne réelle ; verifierDebit espionnée pour constater qu'elle n'est pas
// appelée.
function chaine() {
  const verifierDebit = vi.fn((nom: "membre.action", valeur: string) =>
    verificateur().verifierDebit(nom, valeur),
  );
  const c: Chaine = creerChaine({
    origineAttendue: env.BETTER_AUTH_URL,
    lireSession,
    executerDansOrganisation,
    lireAdhesion,
    journaliser,
    verifierDebit,
    envoyerEmail: async () => ({ envoye: false, raison: "non_autorise" }),
  });
  return { c, verifierDebit };
}

async function membre(organisationId: string, role = "proprietaire", organisationActive?: string) {
  const m = await creerMembre({
    organisationId,
    role,
    ...(organisationActive === undefined ? {} : { organisationActive }),
  });
  utilisateurs.push(m.utilisateurId);
  return m;
}

async function compte(utilisateurId: string): Promise<number | undefined> {
  const [ligne] = await db
    .select({ compte: compteurDebit.compte })
    .from(compteurDebit)
    .where(eq(compteurDebit.cle, verificateur().cle("membre.action", utilisateurId)));
  return ligne?.compte;
}

beforeAll(async () => {
  orgs = await creerDeuxOrganisations({ tables: [temoinIsolation] });
});

afterAll(async () => {
  try {
    if (utilisateurs.length > 0) {
      const cles = utilisateurs.map((id) => verificateur().cle("membre.action", id));
      await db.delete(compteurDebit).where(inArray(compteurDebit.cle, cles));
    }
  } finally {
    try {
      await orgs?.nettoyer();
    } finally {
      await nettoyerMembres();
    }
  }
});

// Lecture permise aux quatre rôles.
function demoLimitee() {
  return declarerAction({
    nom: "demo.limitee",
    droit: "organisation.membres.voir",
    entree: z.strictObject({}),
    journal: null,
    nouvelleAuthentification: false,
    debit: "membre.action",
    emails: [],
    executer: async () => "fait",
  });
}

// Réservée au Propriétaire.
function demoReservee() {
  return declarerAction({
    nom: "demo.reservee",
    droit: "organisation.supprimer",
    entree: z.strictObject({}),
    journal: null,
    nouvelleAuthentification: false,
    debit: "membre.action",
    emails: [],
    executer: async () => "fait",
  });
}

describe("les quatre tests d'attaque obligatoires", () => {
  test("sans session : connexion_requise, rien n'est compté", async () => {
    const { c, verifierDebit } = chaine();
    const entetes = new Headers({ origin: new URL(env.BETTER_AUTH_URL).origin });

    const resultat = await c.executerChaine(demoLimitee(), { entetes }, {});

    expect(resultat).toStrictEqual({ ok: false, raison: "connexion_requise" });
    expect(verifierDebit).not.toHaveBeenCalled();
  });

  test("autre organisation : refuse, seul le compteur de l'attaquant bouge", async () => {
    const victime = await membre(orgs.a);
    const attaquant = await membre(orgs.b, "proprietaire", orgs.a);

    const resultat = await chaine().c.executerChaine(
      demoLimitee(),
      { entetes: attaquant.entetes },
      {},
    );

    expect(resultat).toStrictEqual(REFUS);
    expect(await compte(attaquant.utilisateurId)).toBe(1);
    expect(await compte(victime.utilisateurId)).toBeUndefined();
  });

  test("rôle insuffisant : chaque refus est compté, puis trop_de_requetes", async () => {
    const lecteur = await membre(orgs.a, "lecteur");
    const { c } = chaine();

    for (let i = 0; i < MAXIMUM; i += 1) {
      expect(
        await c.executerChaine(demoReservee(), { entetes: lecteur.entetes }, {}),
      ).toStrictEqual(REFUS);
    }
    const resultat = await c.executerChaine(demoReservee(), { entetes: lecteur.entetes }, {});

    expect(resultat).toStrictEqual(TROP);
    expect(await compte(lecteur.utilisateurId)).toBe(MAXIMUM + 1);
  });

  test("entrée falsifiée : invalide, et seul l'utilisateur de la session est compté", async () => {
    const m = await membre(orgs.a);
    const autre = await membre(orgs.a);

    const resultat = await chaine().c.executerChaine(
      demoLimitee(),
      { entetes: m.entetes },
      { utilisateurId: autre.utilisateurId, debit: "autre", cle: "membre.action:0", compte: 0 },
    );

    expect(resultat).toMatchObject({ ok: false, raison: "invalide" });
    expect(await compte(m.utilisateurId)).toBe(1);
    expect(await compte(autre.utilisateurId)).toBeUndefined();
  });
});

describe("T-41 : épuiser par des requêtes répétées", () => {
  test("échecs répétés : au-delà du maximum, le service ne s'exécute plus", async () => {
    const m = await membre(orgs.a);
    const executer = vi.fn(async () => {
      throw new Error("échec du service");
    });
    const declaration = declarerAction({
      nom: "demo.echec",
      droit: "organisation.membres.voir",
      entree: z.strictObject({}),
      journal: null,
      nouvelleAuthentification: false,
      debit: "membre.action",
      emails: [],
      executer,
    });
    const { c } = chaine();

    const resultats = [];
    for (let i = 0; i < 2 * MAXIMUM; i += 1) {
      resultats.push(await c.executerChaine(declaration, { entetes: m.entetes }, {}));
    }

    expect(resultats.slice(0, MAXIMUM).every((r) => !r.ok && r.raison === "erreur")).toBe(true);
    expect(resultats.slice(MAXIMUM)).toEqual(Array.from({ length: MAXIMUM }, () => TROP));
    expect(executer).toHaveBeenCalledTimes(MAXIMUM);
  });

  test("changer d'organisation active ne remet pas le compteur à zéro", async () => {
    const m = await membre(orgs.a);
    await db.insert(member).values({
      organizationId: orgs.b,
      userId: m.utilisateurId,
      role: "proprietaire",
      createdAt: new Date(),
    });
    const { c } = chaine();

    for (let i = 0; i < MAXIMUM - 1; i += 1) {
      await c.executerChaine(demoLimitee(), { entetes: m.entetes }, {});
    }
    await db
      .update(session)
      .set({ activeOrganizationId: orgs.b })
      .where(eq(session.userId, m.utilisateurId));
    const dansB = [
      await c.executerChaine(demoLimitee(), { entetes: m.entetes }, {}),
      await c.executerChaine(demoLimitee(), { entetes: m.entetes }, {}),
    ];

    expect(dansB).toEqual([{ ok: true, donnees: "fait" }, TROP]);
  });

  test("un membre au-delà de sa limite ne gêne pas un autre membre de la même organisation", async () => {
    const bruyant = await membre(orgs.a);
    const voisin = await membre(orgs.a);
    const { c } = chaine();

    for (let i = 0; i <= MAXIMUM; i += 1) {
      await c.executerChaine(demoLimitee(), { entetes: bruyant.entetes }, {});
    }
    const resultat = await c.executerChaine(demoLimitee(), { entetes: voisin.entetes }, {});

    expect(resultat).toStrictEqual({ ok: true, donnees: "fait" });
  });
});

describe("données personnelles (S-54)", () => {
  test("aucune ligne du compteur ne contient l'identifiant de l'utilisateur", async () => {
    const m = await membre(orgs.a);

    await chaine().c.executerChaine(demoLimitee(), { entetes: m.entetes }, {});

    expect(await compte(m.utilisateurId)).toBe(1);
    const avecIdentifiant = await db
      .select()
      .from(compteurDebit)
      .where(like(compteurDebit.cle, `%${m.utilisateurId}%`));
    expect(avecIdentifiant).toEqual([]);
    expect(verificateur().cle("membre.action", m.utilisateurId)).toMatch(
      /^membre\.action:[0-9a-f]{64}$/,
    );
  });
});
