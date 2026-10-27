import { randomUUID } from "node:crypto";

import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, test } from "vitest";

import {
  creerChaineCompte,
  executerChaineCompte,
  type DependancesChaineCompte,
} from "../actions/action";
import { changementOrganisation, creationOrganisation } from "../actions/organisations";
import { lireSession } from "../auth/session";
import { verifierDebit } from "../debit/debit";
import { env } from "../env";

import { db, executerDansOrganisation } from "./client";
import { organisationsDuCompte } from "./organisations";
import { creerMembre, nettoyerMembres, type Membre } from "./outils-test/membres";
import { creerDeuxOrganisations, type Organisations } from "./outils-test/organisations";
import { lireAdhesion } from "./requetes/adhesions";
import { nomOrganisationActive } from "./requetes/organisations";
import { member, organization, session } from "./schema/auth";
import { journalAudit } from "./schema/technique";
import { organisationActiveDe, reprendreOrganisationActive } from "./sessions";

// Créer une organisation et en changer (2.1), avec la vraie base, de vraies
// sessions et les vraies dépendances ; RR-8 : chaque lecture ou écriture des
// tables de Better Auth filtrée sur l'utilisateur ou l'organisation du
// contexte. Chaque création réelle laisse son organisation sur dev (trace en
// ajout seul) : deux par exécution. Fiche : docs/features/organisations.md,
// « Tests d'intégration ».

const REFUS = { ok: false, raison: "refuse" } as const;

let orgs: Organisations;
// Lecteur de A, sans organisation active : un utilisateur « sans organisation »
// au regard de la session.
let sansOrganisation: Membre;
// Membre de A (Lecteur) et de B (Comptable), organisation active A.
let deuxOrganisations: Membre;
// Membre de B seulement.
let tiers: Membre;

beforeAll(async () => {
  orgs = await creerDeuxOrganisations({ tables: [] });
  sansOrganisation = await creerMembre({
    organisationId: orgs.a,
    role: "lecteur",
    organisationActive: null,
  });
  deuxOrganisations = await creerMembre({ organisationId: orgs.a, role: "lecteur" });
  await db.insert(member).values({
    organizationId: orgs.b,
    userId: deuxOrganisations.utilisateurId,
    role: "comptable",
    createdAt: new Date(),
  });
  tiers = await creerMembre({ organisationId: orgs.b, role: "proprietaire" });
});

afterAll(async () => {
  try {
    await orgs?.nettoyer();
  } finally {
    await nettoyerMembres();
  }
});

async function organisationActive(utilisateurId: string): Promise<(string | null)[]> {
  const lignes = await db
    .select({ active: session.activeOrganizationId })
    .from(session)
    .where(eq(session.userId, utilisateurId));
  return lignes.map((ligne) => ligne.active);
}

async function jetonDe(utilisateurId: string): Promise<string> {
  const [ligne] = await db
    .select({ jeton: session.token })
    .from(session)
    .where(eq(session.userId, utilisateurId));
  if (!ligne) throw new Error("session introuvable");
  return ligne.jeton;
}

describe("créer une organisation (UC-06, F-010)", () => {
  test("organisation, Propriétaire, organisation active et trace, ensemble", async () => {
    const createur = await creerMembre({
      organisationId: orgs.a,
      role: "lecteur",
      organisationActive: null,
      doubleAuthentification: false,
    });
    const resultat = await executerChaineCompte(
      creationOrganisation,
      { entetes: createur.entetes },
      { raisonSociale: "  Test  Kouamé & Fils  " },
    );
    expect(resultat.ok).toBe(true);
    if (!resultat.ok) return;
    const { organisationId, doubleAuthentificationRequise } = resultat.donnees;
    expect(doubleAuthentificationRequise).toBe(true);

    const [ligne] = await db
      .select({ nom: organization.name, slug: organization.slug })
      .from(organization)
      .where(eq(organization.id, organisationId));
    expect(ligne).toEqual({ nom: "Test Kouamé & Fils", slug: organisationId });

    const adhesions = await db
      .select({ role: member.role })
      .from(member)
      .where(eq(member.organizationId, organisationId));
    expect(adhesions).toEqual([{ role: "proprietaire" }]);

    expect(await organisationActive(createur.utilisateurId)).toEqual([organisationId]);

    const traces = await executerDansOrganisation(organisationId, (tx) =>
      tx
        .select({
          action: journalAudit.action,
          auteur: journalAudit.auteurId,
          ressource: journalAudit.ressourceId,
        })
        .from(journalAudit),
    );
    expect(traces).toEqual([
      { action: "organisation.creee", auteur: createur.utilisateurId, ressource: organisationId },
    ]);
  });

  test("trace en échec : rien n'est écrit, ni organisation, ni adhésion, ni session", async () => {
    const createur = await creerMembre({
      organisationId: orgs.a,
      role: "lecteur",
      organisationActive: null,
    });
    const identifiant = randomUUID();
    const deps: DependancesChaineCompte = {
      origineAttendue: env.BETTER_AUTH_URL,
      comptesOuverts: true,
      nouvelIdentifiant: () => identifiant,
      lireSession,
      executerDansOrganisation,
      lireAdhesion,
      verifierDebit,
      journaliser: async () => {
        throw new Error("panne du journal");
      },
    };
    const resultat = await creerChaineCompte(deps).executerChaineCompte(
      creationOrganisation,
      { entetes: createur.entetes },
      { raisonSociale: "Test panne" },
    );
    expect(!resultat.ok && resultat.raison).toBe("erreur");
    expect(
      await db.select().from(organization).where(eq(organization.id, identifiant)),
    ).toHaveLength(0);
    expect(
      await db.select().from(member).where(eq(member.organizationId, identifiant)),
    ).toHaveLength(0);
    expect(await organisationActive(createur.utilisateurId)).toEqual([null]);
  });
});

describe("changer d'organisation (UC-11, F-014, S-01, S-02)", () => {
  test("vers une organisation dont on est membre : session mise à jour, rôle de B ensuite", async () => {
    const resultat = await executerChaineCompte(
      changementOrganisation,
      { entetes: deuxOrganisations.entetes },
      { organisationId: orgs.b },
    );
    expect(resultat).toEqual({ ok: true, donnees: { doubleAuthentificationRequise: false } });
    expect(await organisationActive(deuxOrganisations.utilisateurId)).toEqual([orgs.b]);
    const lue = await lireSession(deuxOrganisations.entetes);
    expect(lue?.organisationActiveId).toBe(orgs.b);
  });

  test("vers B sans en être membre, vers une organisation inexistante : même refus, session inchangée", async () => {
    const avant = await organisationActive(sansOrganisation.utilisateurId);
    for (const organisationId of [orgs.b, randomUUID()]) {
      expect(
        await executerChaineCompte(
          changementOrganisation,
          { entetes: sansOrganisation.entetes },
          { organisationId },
        ),
      ).toEqual(REFUS);
    }
    expect(await organisationActive(sansOrganisation.utilisateurId)).toEqual(avant);
  });

  test("sans session : connexion_requise", async () => {
    const entetes = new Headers({ origin: new URL(env.BETTER_AUTH_URL).origin });
    expect(
      await executerChaineCompte(changementOrganisation, { entetes }, { organisationId: orgs.a }),
    ).toEqual({ ok: false, raison: "connexion_requise" });
  });
});

describe("lectures des tables de Better Auth (RR-8)", () => {
  test("organisationsDuCompte : celles de l'utilisateur seulement, triées par nom", async () => {
    const lues = await organisationsDuCompte(deuxOrganisations.utilisateurId);
    expect(lues.map((o) => o.id).sort()).toEqual([orgs.a, orgs.b].sort());
    expect(lues.find((o) => o.id === orgs.b)?.role).toBe("comptable");
    expect(Object.keys(lues[0] ?? {}).sort()).toEqual(["id", "nom", "role"]);
    expect((await organisationsDuCompte(tiers.utilisateurId)).map((o) => o.id)).toEqual([orgs.b]);
    expect(await organisationsDuCompte(randomUUID())).toEqual([]);
  });

  test("nomOrganisationActive : celle de la transaction, jamais l'autre", async () => {
    expect(await executerDansOrganisation(orgs.a, (tx) => nomOrganisationActive(tx))).toBe(
      `Test ${orgs.a}`,
    );
    expect(await executerDansOrganisation(randomUUID(), (tx) => nomOrganisationActive(tx))).toBe(
      null,
    );
  });

  test("reprise après le mot de passe : seulement avec l'adhésion, seulement la session donnée", async () => {
    const membre = await creerMembre({ organisationId: orgs.a, role: "lecteur" });
    const jeton = await jetonDe(membre.utilisateurId);
    expect(await organisationActiveDe(jeton)).toBe(orgs.a);
    await db.update(session).set({ activeOrganizationId: null }).where(eq(session.token, jeton));

    // Sans adhésion à B : rien.
    await reprendreOrganisationActive(membre.utilisateurId, jeton, orgs.b);
    expect(await organisationActiveDe(jeton)).toBe(null);
    // Jeton d'un autre utilisateur : rien.
    const jetonTiers = await jetonDe(tiers.utilisateurId);
    await reprendreOrganisationActive(membre.utilisateurId, jetonTiers, orgs.a);
    expect(await organisationActiveDe(jetonTiers)).toBe(orgs.b);
    // Valeur qui n'est pas un UUID : rien, sans requête en erreur.
    await reprendreOrganisationActive(membre.utilisateurId, jeton, "pas-un-uuid");
    expect(await organisationActiveDe(jeton)).toBe(null);
    // Adhésion réelle : reprise.
    await reprendreOrganisationActive(membre.utilisateurId, jeton, orgs.a);
    expect(await organisationActiveDe(jeton)).toBe(orgs.a);
    expect(await organisationActiveDe("jeton-inconnu")).toBe(null);
  });
});
