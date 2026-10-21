import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { z } from "zod";

import { creerChaine, declarerAction, type Chaine } from "../actions/action";
import { lireSession } from "../auth/session";
import { deriverSecret } from "../debit/cle";
import { creerVerificateur, type Verificateur } from "../debit/debit";
import { env } from "../env";
import { journaliser } from "../journal/audit";

import { db, executerDansOrganisation } from "./client";
import { creerCompteur } from "./debit";
import { consommerPreuve } from "./nouvelle-authentification";
import { creerMembre, nettoyerMembres } from "./outils-test/membres";
import { creerDeuxOrganisations, type Organisations } from "./outils-test/organisations";
import { lireAdhesion } from "./requetes/adhesions";
import { compteurDebit, temoinIsolation } from "./schema/technique";

// L'étape 4 de la chaîne avec la vraie base, de vraies sessions et le vrai
// compteur. Limite de test passée au vérificateur : aucune limite de
// démonstration dans LIMITES. Fiche : docs/features/limitation-debit.md,
// sections 2.1 et 10.

const MAXIMUM = 3;

let orgs: Organisations;
const utilisateurs: string[] = [];

// Construits à la demande : une fonction encore vide fait échouer le test qui
// l'appelle, pas le chargement du fichier.
let verificateurMemo: Verificateur | undefined;
function verificateur(): Verificateur {
  verificateurMemo ??= creerVerificateur({
    limites: { "membre.action": { maximum: MAXIMUM, fenetreSecondes: 3_600, par: "utilisateur" } },
    compteur: creerCompteur(db),
    secret: deriverSecret(env.BETTER_AUTH_SECRET),
  });
  return verificateurMemo;
}

function chaine(): Chaine {
  return creerChaine({
    origineAttendue: env.BETTER_AUTH_URL,
    lireSession,
    executerDansOrganisation,
    lireAdhesion,
    journaliser,
    verifierDebit: (nom, valeur) => verificateur().verifierDebit(nom, valeur),
    envoyerEmail: async () => ({ envoye: false, raison: "non_autorise" }),
    consommerNouvelleAuthentification: consommerPreuve,
  });
}

async function membre(organisationId: string, role = "proprietaire") {
  const m = await creerMembre({ organisationId, role });
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

// Compteurs d'abord, puis organisations, puis membres : un échec à une étape
// n'empêche pas les suivantes.
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

// Écrit une ligne témoin, puis échoue : la transaction est annulée.
function demoEchec(valeur: string) {
  return declarerAction({
    nom: "demo.echec",
    droit: "organisation.membres.voir",
    entree: z.strictObject({}),
    journal: null,
    nouvelleAuthentification: false,
    debit: "membre.action",
    emails: [],
    executer: async (ctx) => {
      await ctx.tx.insert(temoinIsolation).values({ organisationId: ctx.organisationId, valeur });
      throw new Error("échec du service");
    },
  });
}

describe("étape 4 avec la vraie base", () => {
  test("sous la limite : l'action réussit, le compte vaut 1", async () => {
    const m = await membre(orgs.a);

    const resultat = await chaine().executerChaine(demoLimitee(), { entetes: m.entetes }, {});

    expect(resultat).toStrictEqual({ ok: true, donnees: "fait" });
    expect(await compte(m.utilisateurId)).toBe(1);
  });

  test("au-delà de la limite : trop_de_requetes", async () => {
    const m = await membre(orgs.a);
    const c = chaine();

    for (let i = 0; i < MAXIMUM; i += 1) {
      expect(await c.executerChaine(demoLimitee(), { entetes: m.entetes }, {})).toStrictEqual({
        ok: true,
        donnees: "fait",
      });
    }
    const resultat = await c.executerChaine(demoLimitee(), { entetes: m.entetes }, {});

    expect(resultat).toStrictEqual({ ok: false, raison: "trop_de_requetes" });
    expect(await compte(m.utilisateurId)).toBe(MAXIMUM + 1);
  });

  test("action annulée par une erreur du service : rien d'écrit, mais la tentative est comptée", async () => {
    const m = await membre(orgs.a);
    const valeur = `echec-${m.utilisateurId}`;

    const resultat = await chaine().executerChaine(demoEchec(valeur), { entetes: m.entetes }, {});

    expect(resultat).toMatchObject({ ok: false, raison: "erreur" });
    const lignes = await executerDansOrganisation(orgs.a, (tx) =>
      tx.select().from(temoinIsolation).where(eq(temoinIsolation.valeur, valeur)),
    );
    expect(lignes).toEqual([]);
    expect(await compte(m.utilisateurId)).toBe(1);
  });
});
