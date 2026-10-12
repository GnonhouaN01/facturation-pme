import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, onTestFinished, test } from "vitest";
import { z } from "zod";

import { declarerAction } from "../actions/action";

import { db, executerDansOrganisation } from "./client";
import { adresseDeTest, creerBanc, type Banc } from "./outils-test/email";
import { creerMembre, nettoyerMembres } from "./outils-test/membres";
import { creerDeuxOrganisations, type Organisations } from "./outils-test/organisations";
import { compteurDebit, temoinIsolation } from "./schema/technique";

// Les emails d'une action avec la vraie base, de vraies sessions et le vrai
// compteur : envoi après la validation, rien pour une transaction annulée.
// Transport en mémoire. Fiche : docs/features/envoi-emails.md, section 5.3,
// « Tests d'intégration ».

const MODELE = "essai.verification_envoi" as const;

let orgs: Organisations;

beforeAll(async () => {
  orgs = await creerDeuxOrganisations({ tables: [temoinIsolation] });
});

afterAll(async () => {
  try {
    await orgs?.nettoyer();
  } finally {
    await nettoyerMembres();
  }
});

// Banc propre au test, et nettoyage de ses compteurs à la fin du test.
function banc(valeurs: () => string[]): Banc {
  const b = creerBanc();
  onTestFinished(() => b.nettoyer(valeurs()));
  return b;
}

// Écrit une ligne témoin, demande un email, puis échoue si demandé.
function demo(destinataire: string, valeur: string, echouer = false) {
  return declarerAction({
    nom: "demo.email",
    droit: "organisation.membres.voir",
    entree: z.strictObject({}),
    journal: null,
    nouvelleAuthentification: false,
    debit: null,
    emails: [MODELE],
    executer: async (ctx) => {
      await ctx.tx.insert(temoinIsolation).values({ organisationId: ctx.organisationId, valeur });
      ctx.preparerEmail({ modele: MODELE, destinataire, parametres: {} });
      if (echouer) throw new Error("échec du service");
      return "fait";
    },
  });
}

async function lignesTemoin(valeur: string) {
  return executerDansOrganisation(orgs.a, (tx) =>
    tx.select().from(temoinIsolation).where(eq(temoinIsolation.valeur, valeur)),
  );
}

async function compte(cle: string): Promise<number | undefined> {
  const [ligne] = await db
    .select({ compte: compteurDebit.compte })
    .from(compteurDebit)
    .where(eq(compteurDebit.cle, cle));
  return ligne?.compte;
}

describe("envoi après la validation, avec la vraie base", () => {
  test("ligne validée, puis un message dans la boîte, compteurs incrémentés", async () => {
    const destinataire = adresseDeTest();
    const b = banc(() => [destinataire, orgs.a, "gmail"]);
    const m = await creerMembre({ organisationId: orgs.a, role: "proprietaire" });
    const valeur = `email-${m.utilisateurId}`;

    const resultat = await b.chaine.executerChaine(
      demo(destinataire, valeur),
      { entetes: m.entetes },
      {},
    );

    expect(resultat).toStrictEqual({
      ok: true,
      donnees: "fait",
      emails: { envoyes: 1, nonEnvoyes: 0 },
    });
    expect(await lignesTemoin(valeur)).toHaveLength(1);
    expect(b.transport.messages.map((message) => message.a)).toEqual([destinataire]);
    expect(await compte(b.verificateur.cle("email.destinataire", destinataire))).toBe(1);
    expect(await compte(b.verificateur.cle("email.destinataire_jour", destinataire))).toBe(1);
    expect(await compte(b.verificateur.cle("email.organisation", orgs.a))).toBe(1);
    expect(await compte(b.verificateur.cle("email.application", "gmail"))).toBe(1);
  });

  test("action qui échoue : aucune ligne, aucun message, aucun compteur", async () => {
    const destinataire = adresseDeTest();
    const b = banc(() => [destinataire, orgs.a, "gmail"]);
    const m = await creerMembre({ organisationId: orgs.a, role: "proprietaire" });
    const valeur = `email-echec-${m.utilisateurId}`;

    const resultat = await b.chaine.executerChaine(
      demo(destinataire, valeur, true),
      { entetes: m.entetes },
      {},
    );

    expect(resultat).toMatchObject({ ok: false, raison: "erreur" });
    expect(await lignesTemoin(valeur)).toEqual([]);
    expect(b.transport.messages).toEqual([]);
    for (const cle of b.cles([destinataire, orgs.a, "gmail"])) {
      expect(await compte(cle)).toBeUndefined();
    }
  });
});
