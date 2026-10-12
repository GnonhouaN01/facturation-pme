import { randomUUID } from "node:crypto";

import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, onTestFinished, test } from "vitest";
import { z } from "zod";

import { declarerAction } from "../actions/action";
import { env } from "../env";

import { db, executerDansOrganisation } from "./client";
import { adresseDeTest, creerBanc, LIMITES_TEST, type Banc } from "./outils-test/email";
import { creerMembre, nettoyerMembres, type Membre } from "./outils-test/membres";
import { creerDeuxOrganisations, type Organisations } from "./outils-test/organisations";
import { compteurDebit, journalAudit, temoinIsolation } from "./schema/technique";

// Tests d'attaque de l'envoi d'emails : les quatre obligatoires (PLAN.md
// section 4.3), ceux de T-40 (relais de courrier indésirable, PLAN.md section
// 4.5 : écrit au jalon 0) et l'absence de données personnelles. Vraie base,
// vraies sessions, vrai compteur, transport en mémoire. Fiche :
// docs/features/envoi-emails.md, « Tests d'attaque ».

const MODELE = "essai.verification_envoi" as const;
const MAX_ORGANISATION = LIMITES_TEST["email.organisation"].maximum;
const MAX_APPLICATION = LIMITES_TEST["email.application"].maximum;
const MAX_DESTINATAIRE = LIMITES_TEST["email.destinataire"].maximum;

let orgs: Organisations;

beforeAll(async () => {
  orgs = await creerDeuxOrganisations({
    tables: [temoinIsolation],
    tablesAjoutSeul: [journalAudit],
  });
});

// Organisations d'abord, puis membres, dans un finally : un échec ne laisse
// aucune organisation sur dev (CLAUDE.md, « Pièges connus »).
afterAll(async () => {
  try {
    await orgs?.nettoyer();
  } finally {
    await nettoyerMembres();
  }
});

function banc(valeurs: () => string[]): Banc {
  const b = creerBanc();
  onTestFinished(() => b.nettoyer(valeurs()));
  return b;
}

async function membre(organisationId: string, role = "proprietaire", organisationActive?: string) {
  return creerMembre({
    organisationId,
    role,
    ...(organisationActive === undefined ? {} : { organisationActive }),
  });
}

// Demande un email par destinataire. Le destinataire vient de la fermeture,
// comme d'une ressource lue en base, jamais de l'entrée.
function envoi(
  destinataires: string[],
  droit: "organisation.membres.voir" | "organisation.supprimer" = "organisation.membres.voir",
) {
  return declarerAction({
    nom: "demo.envoi",
    droit,
    entree: z.strictObject({}),
    journal: null,
    nouvelleAuthentification: false,
    debit: null,
    emails: [MODELE],
    executer: async (ctx) => {
      for (const destinataire of destinataires) {
        ctx.preparerEmail({ modele: MODELE, destinataire, parametres: {} });
      }
      return "fait";
    },
  });
}

async function executer(b: Banc, m: Membre, destinataires: string[], entree: unknown = {}) {
  return b.chaine.executerChaine(envoi(destinataires), { entetes: m.entetes }, entree);
}

async function lignesCompteur(cles: string[]) {
  return db.select().from(compteurDebit).where(inArray(compteurDebit.cle, cles));
}

describe("les quatre tests d'attaque obligatoires", () => {
  test("sans session : connexion_requise, aucun email, aucun compteur d'envoi", async () => {
    const destinataire = adresseDeTest();
    const b = banc(() => [destinataire, orgs.a, "gmail"]);
    const entetes = new Headers({ origin: new URL(env.BETTER_AUTH_URL).origin });

    const resultat = await b.chaine.executerChaine(envoi([destinataire]), { entetes }, {});

    expect(resultat).toStrictEqual({ ok: false, raison: "connexion_requise" });
    expect(b.transport.messages).toEqual([]);
    expect(await lignesCompteur(b.cles([destinataire, orgs.a, "gmail"]))).toEqual([]);
  });

  test("autre organisation : refuse, aucun email, le compteur de A ne bouge pas", async () => {
    const destinataire = adresseDeTest();
    const b = banc(() => [destinataire, orgs.a, orgs.b, "gmail"]);
    const attaquant = await membre(orgs.b, "proprietaire", orgs.a);

    const resultat = await executer(b, attaquant, [destinataire]);

    expect(resultat).toStrictEqual({ ok: false, raison: "refuse" });
    expect(b.transport.messages).toEqual([]);
    expect(await lignesCompteur(b.cles([destinataire, orgs.a, orgs.b, "gmail"]))).toEqual([]);
  });

  test("rôle insuffisant : refus à l'étape 6, aucun email", async () => {
    const destinataire = adresseDeTest();
    const b = banc(() => [destinataire, orgs.a, "gmail"]);
    const lecteur = await membre(orgs.a, "lecteur");

    const resultat = await b.chaine.executerChaine(
      envoi([destinataire], "organisation.supprimer"),
      { entetes: lecteur.entetes },
      {},
    );

    expect(resultat).toStrictEqual({ ok: false, raison: "refuse" });
    expect(b.transport.messages).toEqual([]);
    expect(await lignesCompteur(b.cles([destinataire, orgs.a, "gmail"]))).toEqual([]);
  });

  test.each([
    ["destinataire", { destinataire: "victime@exemple.invalid" }],
    ["cc", { cc: "victime@exemple.invalid" }],
    ["bcc", { bcc: "victime@exemple.invalid" }],
    ["from", { from: "banque@exemple.invalid" }],
    ["organisationId", { organisationId: "00000000-0000-4000-8000-000000000000" }],
  ])("entrée falsifiée (%s) : invalide, aucun email", async (_nom, entree) => {
    const destinataire = adresseDeTest();
    const b = banc(() => [destinataire, orgs.a, "gmail"]);
    const m = await membre(orgs.a);

    const resultat = await executer(b, m, [destinataire], entree);

    expect(resultat).toMatchObject({ ok: false, raison: "invalide" });
    expect(b.transport.messages).toEqual([]);
  });
});

describe("T-40 : l'application ne sert pas de relais", () => {
  test("plafond par organisation : au-delà, refus sans rien remettre ; l'autre organisation envoie", async () => {
    const adresses = Array.from({ length: MAX_ORGANISATION + 1 }, adresseDeTest);
    const autre = adresseDeTest();
    const b = banc(() => [...adresses, autre, orgs.a, orgs.b, "gmail"]);
    const ma = await membre(orgs.a);
    const mb = await membre(orgs.b);

    const resultatA = await executer(b, ma, adresses);

    expect(resultatA).toStrictEqual({
      ok: true,
      donnees: "fait",
      emails: { envoyes: MAX_ORGANISATION, nonEnvoyes: 1 },
    });
    expect(b.transport.messages.map((m) => m.a)).toEqual(adresses.slice(0, MAX_ORGANISATION));

    // Une nouvelle action de A, plus tard : toujours refusée.
    const encoreA = await executer(b, ma, [adresseDeTest()]);
    expect(encoreA).toMatchObject({ ok: true, emails: { envoyes: 0, nonEnvoyes: 1 } });

    const resultatB = await executer(b, mb, [autre]);
    expect(resultatB).toMatchObject({ ok: true, emails: { envoyes: 1, nonEnvoyes: 0 } });
    expect(b.transport.messages.at(-1)?.a).toBe(autre);
  });

  test("même destinataire depuis deux organisations : la limite par destinataire tient", async () => {
    const cible = adresseDeTest();
    const b = banc(() => [cible, orgs.a, orgs.b, "gmail"]);
    const ma = await membre(orgs.a);
    const mb = await membre(orgs.b);

    const envois = [];
    for (let i = 0; i < MAX_DESTINATAIRE + 1; i += 1) {
      envois.push(await executer(b, i % 2 === 0 ? ma : mb, [cible]));
    }

    expect(envois.map((r) => (r as { emails: { envoyes: number } }).emails.envoyes)).toEqual([
      ...Array<number>(MAX_DESTINATAIRE).fill(1),
      0,
    ]);
    expect(b.transport.messages).toHaveLength(MAX_DESTINATAIRE);
  });

  test("même destinataire sous des variantes d'adresse (décision 10) : un seul compteur", async () => {
    const identifiant = randomUUID().replaceAll("-", "");
    const variantes = [
      `cible${identifiant}@gmail.com`,
      `c.i.b.l.e${identifiant}+relance@gmail.com`,
      `CIBLE${identifiant}+x@GMAIL.COM`,
    ];
    const b = banc(() => [...variantes, orgs.a, "gmail"]);
    const m = await membre(orgs.a);

    const resultat = await executer(b, m, variantes);

    expect(resultat).toMatchObject({
      ok: true,
      emails: { envoyes: MAX_DESTINATAIRE, nonEnvoyes: variantes.length - MAX_DESTINATAIRE },
    });
  });

  test("plafond de l'application : au-delà, refus pour toutes les organisations", async () => {
    const adressesA = Array.from({ length: MAX_ORGANISATION }, adresseDeTest);
    const adressesB = Array.from({ length: MAX_ORGANISATION }, adresseDeTest);
    const b = banc(() => [...adressesA, ...adressesB, orgs.a, orgs.b, "gmail"]);
    const ma = await membre(orgs.a);
    const mb = await membre(orgs.b);

    const resultatA = await executer(b, ma, adressesA);
    const resultatB = await executer(b, mb, adressesB);

    const envoyesA = (resultatA as { emails: { envoyes: number } }).emails.envoyes;
    const envoyesB = (resultatB as { emails: { envoyes: number } }).emails.envoyes;
    expect(envoyesA + envoyesB).toBe(MAX_APPLICATION);
    expect(b.transport.messages).toHaveLength(MAX_APPLICATION);
  });
});

describe("données personnelles (S-54)", () => {
  test("aucune ligne du compteur ne contient l'adresse ni l'identifiant de l'organisation", async () => {
    const destinataire = adresseDeTest();
    const b = banc(() => [destinataire, orgs.a, "gmail"]);
    const m = await membre(orgs.a);

    await executer(b, m, [destinataire]);

    const lignes = await lignesCompteur(b.cles([destinataire, orgs.a, "gmail"]));
    expect(lignes.length).toBeGreaterThan(0);
    for (const ligne of lignes) {
      expect(ligne.cle).not.toContain(destinataire);
      expect(ligne.cle).not.toContain(destinataire.split("@")[0] as string);
      expect(ligne.cle).not.toContain(orgs.a);
      expect(ligne.cle).not.toContain("gmail");
    }
  });

  test("une action journalisée qui envoie : l'entrée du journal ne contient pas l'adresse", async () => {
    const destinataire = adresseDeTest();
    const b = banc(() => [destinataire, orgs.a, "gmail"]);
    const m = await membre(orgs.a);

    const resultat = await b.chaine.executerChaine(
      declarerAction({
        nom: "demo.envoi_journalise",
        droit: "organisation.fiche.modifier",
        entree: z.strictObject({}),
        journal: "organisation.parametres_modifies",
        nouvelleAuthentification: false,
        debit: null,
        emails: [MODELE],
        executer: async (ctx) => {
          ctx.preparerEmail({ modele: MODELE, destinataire, parametres: {} });
          await ctx.journaliser({ ressourceId: ctx.organisationId });
          return "fait";
        },
      }),
      { entetes: m.entetes },
      {},
    );

    expect(resultat).toMatchObject({ ok: true, emails: { envoyes: 1, nonEnvoyes: 0 } });
    const entrees = await executerDansOrganisation(orgs.a, (tx) =>
      tx.select().from(journalAudit).where(eq(journalAudit.auteurId, m.utilisateurId)),
    );
    expect(entrees).toHaveLength(1);
    expect(JSON.stringify(entrees)).not.toContain(destinataire.split("@")[0] as string);
  });
});
