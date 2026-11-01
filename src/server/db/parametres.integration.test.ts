import { randomUUID } from "node:crypto";

import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, test } from "vitest";

import { executerChaine, executerChaineCompte } from "../actions/action";
import { servirLogo } from "../actions/exposer";
import { creationOrganisation } from "../actions/organisations";
import {
  ajoutTaux,
  enregistrementFiche,
  enregistrementLogo,
  etatTaux,
  instructionsPaiement,
  retraitLogo,
} from "../actions/parametres";
import { env } from "../env";

import { db, executerDansOrganisation } from "./client";
import { enregistrerPreuve } from "./nouvelle-authentification";
import { creerBanc } from "./outils-test/email";
import { codeDuRefus, verifierIsolation } from "./outils-test/isolation";
import { creerMembre, nettoyerMembres, type Membre } from "./outils-test/membres";
import { creerDeuxOrganisations, type Organisations } from "./outils-test/organisations";
import { lireParametres } from "./requetes/parametres";
import { journalAudit } from "./schema/technique";
import { organization, session } from "./schema/auth";
import { parametresOrganisation, tauxTva } from "./schema/parametres";

// Paramètres de l'organisation (2.2) avec la vraie base : isolation des deux
// tables sans suppression, contraintes en base, valeurs par défaut à la
// création, actions par la vraie chaîne (Propriétaires de A et de B),
// instructions de paiement avec une vraie preuve de nouvelle
// authentification et le transport en mémoire, route du logo. Les
// organisations qui reçoivent des paramètres restent sur dev (tables sans
// suppression, comme le journal). Fiche :
// docs/features/parametres-organisation.md, tests 11 et 12.

const PNG_1X1 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
const ORIGINE = new URL(env.BETTER_AUTH_URL).origin;
const REFUS = { ok: false, raison: "refuse" } as const;

const FICHE = {
  raisonSociale: "Test Kouamé & Fils",
  adresse: "Cocody\nAbidjan",
  ncc: "1234567 A",
  rccm: "CI-ABJ-2026-B-1",
  regimeImposition: "Réel normal",
  mentionsLegales: "<script>alert(1)</script>",
  validiteDevisJours: 15,
  echeanceFactureJours: 45,
};

let orgs: Organisations;
let proprietaireA: Membre;
let proprietaireA2: Membre;
let comptableA: Membre;
let proprietaireB: Membre;

beforeAll(async () => {
  orgs = await creerDeuxOrganisations({
    tables: [],
    tablesAjoutSeul: [parametresOrganisation, tauxTva, journalAudit],
  });
  [proprietaireA, proprietaireA2, comptableA, proprietaireB] = await Promise.all([
    creerMembre({ organisationId: orgs.a, role: "proprietaire" }),
    creerMembre({ organisationId: orgs.a, role: "proprietaire" }),
    creerMembre({ organisationId: orgs.a, role: "comptable" }),
    creerMembre({ organisationId: orgs.b, role: "proprietaire" }),
  ]);
});

afterAll(async () => {
  try {
    await orgs?.nettoyer();
  } finally {
    await nettoyerMembres();
  }
});

function appeler<T>(
  membre: Membre,
  declaration: Parameters<typeof executerChaine>[0],
  entree: unknown,
) {
  return executerChaine(declaration, { entetes: membre.entetes }, entree) as Promise<T>;
}

async function sessionDe(membre: Membre): Promise<string> {
  const [ligne] = await db
    .select({ id: session.id })
    .from(session)
    .where(eq(session.userId, membre.utilisateurId));
  if (!ligne) throw new Error("session de test introuvable");
  return ligne.id;
}

function lire(organisationId: string) {
  return executerDansOrganisation(organisationId, (tx) => lireParametres(tx));
}

function tauxDe(organisationId: string) {
  return executerDansOrganisation(organisationId, (tx) =>
    tx.select().from(tauxTva).where(eq(tauxTva.organisationId, organisationId)),
  );
}

function traces(organisationId: string, action: string) {
  return executerDansOrganisation(organisationId, (tx) =>
    tx
      .select({ id: journalAudit.id })
      .from(journalAudit)
      .where(and(eq(journalAudit.organisationId, organisationId), eq(journalAudit.action, action))),
  );
}

describe("isolation des deux tables (sans suppression)", () => {
  test("parametres_organisation", async () => {
    await expect(
      verifierIsolation(parametresOrganisation, (organisationId) => ({ organisationId }), {
        sansSuppression: true,
      }),
    ).resolves.toBeUndefined();
  });

  test("taux_tva", async () => {
    await expect(
      verifierIsolation(
        tauxTva,
        (organisationId) => ({ organisationId, libelle: "Témoin", tauxCentiemes: 1800 }),
        { sansSuppression: true },
      ),
    ).resolves.toBeUndefined();
  });
});

describe("contraintes en base (CHECK, 23514)", () => {
  const ecrire = (valeurs: Partial<typeof parametresOrganisation.$inferInsert>) =>
    executerDansOrganisation(orgs.b, (tx) =>
      tx
        .insert(parametresOrganisation)
        .values({ organisationId: orgs.b, ...valeurs })
        .onConflictDoUpdate({ target: parametresOrganisation.organisationId, set: valeurs }),
    );

  test.each([
    ["adresse de 301 caractères", { adresse: "a".repeat(301) }],
    ["adresse vide", { adresse: "" }],
    ["NCC de 31 caractères", { ncc: "1".repeat(31) }],
    ["RCCM de 51 caractères", { rccm: "1".repeat(51) }],
    ["régime de 101 caractères", { regimeImposition: "r".repeat(101) }],
    ["mentions de 1001 caractères", { mentionsLegales: "m".repeat(1001) }],
    ["mobile money de 201 caractères", { paiementMobileMoney: "7".repeat(201) }],
    ["coordonnées de 501 caractères", { paiementBancaire: "b".repeat(501) }],
    ["délai 0", { validiteDevisJours: 0 }],
    ["délai 366", { echeanceFactureJours: 366 }],
    ["logo sans type", { logo: Buffer.from([1]) }],
    ["type sans logo", { logoType: "image/png" }],
    ["type SVG", { logo: Buffer.from([1]), logoType: "image/svg+xml" }],
    ["logo de 204 801 octets", { logo: Buffer.alloc(204_801, 1), logoType: "image/png" }],
  ])("%s : refusé", async (_nom, valeurs) => {
    expect(await codeDuRefus(ecrire(valeurs))).toBe("23514");
  });

  test("char_length compte les points de code : 300 lettres hors du plan de base acceptées", async () => {
    await ecrire({ adresse: "𝐀".repeat(300) });
    expect((await lire(orgs.b)).adresse).toBe("𝐀".repeat(300));
  });

  test.each([
    ["taux de 10 001", { libelle: "X", tauxCentiemes: 10_001 }],
    ["libellé vide", { libelle: "", tauxCentiemes: 7 }],
    ["libellé de 51 caractères", { libelle: "l".repeat(51), tauxCentiemes: 8 }],
  ])("taux, %s : refusé", async (_nom, valeurs) => {
    const code = await codeDuRefus(
      executerDansOrganisation(orgs.b, (tx) =>
        tx.insert(tauxTva).values({ organisationId: orgs.b, ...valeurs }),
      ),
    );
    expect(code).toBe("23514");
  });
});

describe("création d'une organisation : valeurs par défaut (UC-06 étape 2)", () => {
  test("ligne de paramètres (30 et 30) et deux taux actifs, 18 % et 0 %", async () => {
    const createur = await creerMembre({ organisationId: orgs.a, role: "lecteur" });
    const resultat = await executerChaineCompte(
      creationOrganisation,
      { entetes: createur.entetes },
      { raisonSociale: "Test valeurs par défaut" },
    );
    if (!resultat.ok) throw new Error(`création refusée : ${resultat.raison}`);
    const { organisationId } = resultat.donnees;

    const parametres = await lire(organisationId);
    expect(parametres.validiteDevisJours).toBe(30);
    expect(parametres.echeanceFactureJours).toBe(30);
    expect(parametres.raisonSociale).toBe("Test valeurs par défaut");
    const taux = await tauxDe(organisationId);
    expect(taux.map((t) => [t.tauxCentiemes, t.actif]).sort()).toEqual([
      [0, true],
      [1800, true],
    ]);
  });
});

describe("fiche (F-011)", () => {
  test("organisation sans ligne : lecture des valeurs par défaut", async () => {
    const parametres = await lire(orgs.a);
    expect(parametres).toMatchObject({
      adresse: null,
      ncc: null,
      rccm: null,
      validiteDevisJours: 30,
      echeanceFactureJours: 30,
      logoType: null,
    });
  });

  test("écrite pour A (paramètres et raison sociale), B inchangée, une trace", async () => {
    const nomB = await executerDansOrganisation(orgs.b, (tx) =>
      tx.select({ nom: organization.name }).from(organization).where(eq(organization.id, orgs.b)),
    );
    const avant = (await traces(orgs.a, "organisation.parametres_modifies")).length;

    const resultat = await appeler(proprietaireA, enregistrementFiche, FICHE);

    expect(resultat).toMatchObject({ ok: true });
    expect(await lire(orgs.a)).toMatchObject({
      raisonSociale: "Test Kouamé & Fils",
      adresse: "Cocody\nAbidjan",
      ncc: "1234567 A",
      rccm: "CI-ABJ-2026-B-1",
      mentionsLegales: "<script>alert(1)</script>",
      validiteDevisJours: 15,
      echeanceFactureJours: 45,
    });
    const nomBApres = await executerDansOrganisation(orgs.b, (tx) =>
      tx.select({ nom: organization.name }).from(organization).where(eq(organization.id, orgs.b)),
    );
    expect(nomBApres).toEqual(nomB);
    expect((await traces(orgs.a, "organisation.parametres_modifies")).length).toBe(avant + 1);
  });

  test("Comptable de A : refuse, rien écrit", async () => {
    expect(await appeler(comptableA, enregistrementFiche, { ...FICHE, ncc: "999" })).toEqual(REFUS);
    expect((await lire(orgs.a)).ncc).toBe("1234567 A");
  });

  test("entrée invalide : invalide, rien écrit", async () => {
    const resultat = await appeler(proprietaireA, enregistrementFiche, {
      ...FICHE,
      validiteDevisJours: 0,
    });
    expect(resultat).toMatchObject({ ok: false, raison: "invalide" });
    expect((await lire(orgs.a)).validiteDevisJours).toBe(15);
  });
});

describe("taux de TVA (UC-07 étape 2)", () => {
  test("ajout « 9,5 » : 950, actif ; doublon : refuse", async () => {
    expect(
      await appeler(proprietaireA, ajoutTaux, { libelle: "Réduit", taux: "9,5" }),
    ).toMatchObject({ ok: true });
    const ajoute = (await tauxDe(orgs.a)).find((t) => t.tauxCentiemes === 950);
    expect(ajoute).toMatchObject({ libelle: "Réduit", actif: true });

    expect(await appeler(proprietaireA, ajoutTaux, { libelle: "Autre", taux: "9.50" })).toEqual(
      REFUS,
    );
  });

  test("désactiver puis réactiver ; taux de B ou inexistant : même refus, B intact", async () => {
    const [tauxA] = (await tauxDe(orgs.a)).filter((t) => t.tauxCentiemes === 950);
    if (!tauxA) throw new Error("taux de A absent");
    await executerDansOrganisation(orgs.b, (tx) =>
      tx.insert(tauxTva).values({ organisationId: orgs.b, libelle: "B", tauxCentiemes: 500 }),
    );
    const [tauxB] = await tauxDe(orgs.b);
    if (!tauxB) throw new Error("taux de B absent");

    expect(
      await appeler(proprietaireA, etatTaux, { tauxId: tauxA.id, actif: false }),
    ).toMatchObject({
      ok: true,
    });
    expect((await tauxDe(orgs.a)).find((t) => t.id === tauxA.id)?.actif).toBe(false);
    expect(await appeler(proprietaireA, etatTaux, { tauxId: tauxA.id, actif: true })).toMatchObject(
      {
        ok: true,
      },
    );

    const versB = await appeler(proprietaireA, etatTaux, { tauxId: tauxB.id, actif: false });
    const inexistant = await appeler(proprietaireA, etatTaux, {
      tauxId: randomUUID(),
      actif: false,
    });
    expect(versB).toEqual(REFUS);
    expect(inexistant).toEqual(versB);
    expect((await tauxDe(orgs.b))[0]?.actif).toBe(true);
  });

  test("plafond de 20 taux : le 21e est refusé", async () => {
    const existants = (await tauxDe(orgs.a)).length;
    await executerDansOrganisation(orgs.a, (tx) =>
      tx.insert(tauxTva).values(
        Array.from({ length: 20 - existants }, (_v, i) => ({
          organisationId: orgs.a,
          libelle: `Plafond ${i}`,
          tauxCentiemes: 2000 + i,
        })),
      ),
    );
    expect(await appeler(proprietaireA, ajoutTaux, { libelle: "21e", taux: "50" })).toEqual(REFUS);
    expect((await tauxDe(orgs.a)).length).toBe(20);
  });
});

describe("logo (S-53) et sa route", () => {
  function requete(membre?: Membre): Request {
    return new Request(`${ORIGINE}/parametres/logo`, {
      headers: membre ? membre.entetes : new Headers(),
    });
  }

  test("enregistré par le Propriétaire, servi aux membres de A seulement", async () => {
    expect(await appeler(proprietaireA, enregistrementLogo, { contenu: PNG_1X1 })).toMatchObject({
      ok: true,
    });
    expect((await lire(orgs.a)).logoType).toBe("image/png");

    const servi = await servirLogo(requete(comptableA));
    expect(servi.status).toBe(200);
    expect(servi.headers.get("content-type")).toBe("image/png");
    expect(Buffer.from(await servi.arrayBuffer()).toString("base64")).toBe(PNG_1X1);

    const deB = await servirLogo(requete(proprietaireB));
    const sansSession = await servirLogo(requete());
    for (const reponse of [deB, sansSession]) {
      expect(reponse.status).toBe(404);
      expect((await reponse.arrayBuffer()).byteLength).toBe(0);
    }
    expect([...deB.headers.entries()].sort()).toEqual([...sansSession.headers.entries()].sort());
  });

  test("HTML renommé : invalide, logo inchangé ; Comptable : refuse", async () => {
    const html = Buffer.from("<html><script>alert(1)</script></html>").toString("base64");
    expect(await appeler(proprietaireA, enregistrementLogo, { contenu: html })).toMatchObject({
      ok: false,
      raison: "invalide",
    });
    expect(await appeler(comptableA, enregistrementLogo, { contenu: PNG_1X1 })).toEqual(REFUS);
    expect((await lire(orgs.a)).logoType).toBe("image/png");
  });

  test("retiré : la route répond comme sans logo", async () => {
    expect(await appeler(proprietaireA, retraitLogo, {})).toMatchObject({ ok: true });
    expect((await lire(orgs.a)).logoType).toBeNull();
    const reponse = await servirLogo(requete(proprietaireA));
    expect(reponse.status).toBe(404);
  });
});

describe("instructions de paiement (S-14, S-33, T-12)", () => {
  const ENTREE = {
    mobileMoney: "Orange Money : 07 00 00 00 00",
    bancaire: "Banque Test\nCI000 01",
  };

  test("sans preuve : nouvelle_authentification_requise, rien écrit", async () => {
    const banc = creerBanc();
    const resultat = await banc.chaine.executerChaine(
      instructionsPaiement,
      { entetes: proprietaireA.entetes },
      ENTREE,
    );
    expect(resultat).toEqual({ ok: false, raison: "nouvelle_authentification_requise" });
    expect((await lire(orgs.a)).paiementMobileMoney).toBeNull();
  });

  test("avec preuve : écrites, trace, un email par Propriétaire de A seulement, sans les valeurs", async () => {
    const banc = creerBanc();
    await enregistrerPreuve(proprietaireA.utilisateurId, await sessionDe(proprietaireA));

    const resultat = await banc.chaine.executerChaine(
      instructionsPaiement,
      { entetes: proprietaireA.entetes },
      ENTREE,
    );

    expect(resultat).toMatchObject({ ok: true, donnees: { modifiees: true } });
    expect(await lire(orgs.a)).toMatchObject({
      paiementMobileMoney: ENTREE.mobileMoney,
      paiementBancaire: ENTREE.bancaire,
    });
    expect((await traces(orgs.a, "organisation.instructions_paiement_modifiees")).length).toBe(1);
    const destinataires = banc.transport.messages.map((m) => m.a).sort();
    const attendus = await Promise.all(
      [proprietaireA, proprietaireA2].map(async (m) => `test-${m.utilisateurId}@exemple.test`),
    );
    expect(destinataires).toEqual(attendus.sort());
    for (const message of banc.transport.messages) {
      expect(message.sujet).toBe("Instructions de paiement modifiées");
      expect(message.corps).toContain("Test Kouamé & Fils");
      expect(message.corps).not.toContain("07 00 00 00 00");
      expect(message.corps).not.toContain("CI000");
    }
    await banc.nettoyer([orgs.a, ...destinataires]);
  });

  test("preuve consommée : la modification suivante en demande une autre", async () => {
    const banc = creerBanc();
    const resultat = await banc.chaine.executerChaine(
      instructionsPaiement,
      { entetes: proprietaireA.entetes },
      { ...ENTREE, bancaire: "" },
    );
    expect(resultat).toEqual({ ok: false, raison: "nouvelle_authentification_requise" });
  });

  test("mêmes valeurs, avec preuve : trace, aucun email (décision 5)", async () => {
    const banc = creerBanc();
    await enregistrerPreuve(proprietaireA.utilisateurId, await sessionDe(proprietaireA));

    const resultat = await banc.chaine.executerChaine(
      instructionsPaiement,
      { entetes: proprietaireA.entetes },
      ENTREE,
    );

    expect(resultat).toMatchObject({ ok: true, donnees: { modifiees: false } });
    expect(banc.transport.messages).toEqual([]);
    expect((await traces(orgs.a, "organisation.instructions_paiement_modifiees")).length).toBe(2);
  });

  test("entrée invalide avec preuve : invalide, la preuve reste pour l'essai suivant", async () => {
    const banc = creerBanc();
    await enregistrerPreuve(proprietaireA.utilisateurId, await sessionDe(proprietaireA));

    const invalide = await banc.chaine.executerChaine(
      instructionsPaiement,
      { entetes: proprietaireA.entetes },
      { ...ENTREE, mobileMoney: "a‮b" },
    );
    expect(invalide).toMatchObject({ ok: false, raison: "invalide" });

    const valide = await banc.chaine.executerChaine(
      instructionsPaiement,
      { entetes: proprietaireA.entetes },
      { ...ENTREE, bancaire: "" },
    );
    expect(valide).toMatchObject({ ok: true, donnees: { modifiees: true } });
    await banc.nettoyer([orgs.a, ...banc.transport.messages.map((m) => m.a)]);
  });

  test("Comptable de A et Propriétaire de B : rien sur A (refuse ou écrit sur B seulement)", async () => {
    const banc = creerBanc();
    await enregistrerPreuve(comptableA.utilisateurId, await sessionDe(comptableA));
    expect(
      await banc.chaine.executerChaine(
        instructionsPaiement,
        { entetes: comptableA.entetes },
        ENTREE,
      ),
    ).toEqual(REFUS);

    await enregistrerPreuve(proprietaireB.utilisateurId, await sessionDe(proprietaireB));
    await banc.chaine.executerChaine(
      instructionsPaiement,
      { entetes: proprietaireB.entetes },
      { mobileMoney: "B", bancaire: "" },
    );
    expect((await lire(orgs.a)).paiementMobileMoney).toBe(ENTREE.mobileMoney);
    expect(banc.transport.messages.map((m) => m.a)).toEqual([
      `test-${proprietaireB.utilisateurId}@exemple.test`,
    ]);
    await banc.nettoyer([orgs.b, ...banc.transport.messages.map((m) => m.a)]);
  });
});
