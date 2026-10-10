import { randomUUID } from "node:crypto";

import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { z } from "zod";

import { declarerAction, etablirContexte, executerChaine } from "../actions/action";
import { ROLES } from "../autorisation/matrice";
import { env } from "../env";

import { executerDansOrganisation } from "./client";
import { creerMembre, nettoyerMembres } from "./outils-test/membres";
import { creerDeuxOrganisations, type Organisations } from "./outils-test/organisations";
import { journalAudit, temoinIsolation } from "./schema/technique";

// La chaîne avec la vraie base, de vraies sessions Better Auth et les vraies
// dépendances. Déclarations de démonstration définies ici seulement : elles
// ne créent aucun point d'entrée. Ce test vit dans db/ : seuls les tests de
// db/ peuvent importer drizzle-orm. Fiche : docs/features/chaine-controles.md,
// sections 9 et 10.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const REFUS = { ok: false, raison: "refuse" } as const;

let orgs: Organisations;
const valeurA = `a-${randomUUID()}`;
const valeurB = `b-${randomUUID()}`;

beforeAll(async () => {
  orgs = await creerDeuxOrganisations({
    tables: [temoinIsolation],
    tablesAjoutSeul: [journalAudit],
  });
  await executerDansOrganisation(orgs.a, (tx) =>
    tx.insert(temoinIsolation).values({ organisationId: orgs.a, valeur: valeurA }),
  );
  await executerDansOrganisation(orgs.b, (tx) =>
    tx.insert(temoinIsolation).values({ organisationId: orgs.b, valeur: valeurB }),
  );
});

// Les organisations d'abord : un échec de nettoyerMembres ne doit pas les
// laisser sur dev. Les adhésions suivent l'organisation (ON DELETE CASCADE).
afterAll(async () => {
  try {
    await orgs?.nettoyer();
  } finally {
    await nettoyerMembres();
  }
});

// demo.lire : tous les rôles ; lit temoin_isolation et renvoie le contexte.
function demoLire() {
  return declarerAction({
    nom: "demo.lire",
    droit: "organisation.membres.voir",
    entree: z.strictObject({}),
    journal: null,
    nouvelleAuthentification: false,
    executer: async (ctx) => ({
      utilisateurId: ctx.utilisateurId,
      organisationId: ctx.organisationId,
      role: ctx.role,
      perimetre: ctx.perimetre,
      valeurs: (await ctx.tx.select({ valeur: temoinIsolation.valeur }).from(temoinIsolation)).map(
        (ligne) => ligne.valeur,
      ),
    }),
  });
}

// demo.ecrire : Propriétaire seul ; ligne témoin et trace.
function demoEcrire() {
  return declarerAction({
    nom: "demo.ecrire",
    droit: "organisation.supprimer",
    entree: z.strictObject({ valeur: z.string().max(100) }),
    journal: "organisation.parametres_modifies",
    nouvelleAuthentification: false,
    executer: async (ctx, entree) => {
      const [ligne] = await ctx.tx
        .insert(temoinIsolation)
        .values({ organisationId: ctx.organisationId, valeur: entree.valeur })
        .returning({ id: temoinIsolation.id });
      if (!ligne) throw new Error("insertion sans ligne renvoyée");
      await ctx.journaliser({ ressourceId: ligne.id });
      return { id: ligne.id };
    },
  });
}

// demo.oubli_trace : trace déclarée, jamais écrite.
function demoOubliTrace() {
  return declarerAction({
    nom: "demo.oubli_trace",
    droit: "organisation.supprimer",
    entree: z.strictObject({ valeur: z.string().max(100) }),
    journal: "organisation.parametres_modifies",
    nouvelleAuthentification: false,
    executer: async (ctx, entree) => {
      await ctx.tx
        .insert(temoinIsolation)
        .values({ organisationId: ctx.organisationId, valeur: entree.valeur });
      return "oubliée";
    },
  });
}

function lignesTemoin(organisationId: string, valeur: string) {
  return executerDansOrganisation(organisationId, (tx) =>
    tx.select().from(temoinIsolation).where(eq(temoinIsolation.valeur, valeur)),
  );
}

describe("demo.lire, par chacun des quatre rôles", () => {
  test.each(ROLES)(
    "%s : contexte de la session et de la base, lignes de son organisation seulement",
    async (role) => {
      const membre = await creerMembre({ organisationId: orgs.a, role });

      const resultat = await executerChaine(demoLire(), { entetes: membre.entetes }, {});

      expect(resultat).toStrictEqual({
        ok: true,
        donnees: {
          utilisateurId: membre.utilisateurId,
          organisationId: orgs.a,
          role,
          perimetre: "organisation",
          valeurs: [valeurA],
        },
      });
    },
  );

  test("membre de B : le service s'exécute dans la transaction de B", async () => {
    const membre = await creerMembre({ organisationId: orgs.b, role: "lecteur" });

    const resultat = await executerChaine(demoLire(), { entetes: membre.entetes }, {});

    expect(resultat).toMatchObject({
      ok: true,
      donnees: { organisationId: orgs.b, valeurs: [valeurB] },
    });
  });
});

describe("demo.ecrire par le Propriétaire", () => {
  // Laisse l'organisation A sur dev, avec son entrée (journal-audit.md,
  // décision 8).
  test("ligne témoin et trace écrites ensemble ; trace à l'organisation et à l'auteur de la session", async () => {
    const membre = await creerMembre({ organisationId: orgs.a, role: "proprietaire" });
    const valeur = `ecrire-${randomUUID()}`;

    const resultat = await executerChaine(demoEcrire(), { entetes: membre.entetes }, { valeur });

    expect(resultat).toStrictEqual({ ok: true, donnees: { id: expect.stringMatching(UUID) } });
    const id = (resultat as { donnees: { id: string } }).donnees.id;
    const lignes = await lignesTemoin(orgs.a, valeur);
    expect(lignes).toHaveLength(1);
    expect(lignes[0]).toMatchObject({ id, organisationId: orgs.a });

    const traces = await executerDansOrganisation(orgs.a, (tx) =>
      tx.select().from(journalAudit).where(eq(journalAudit.ressourceId, id)),
    );
    expect(traces).toHaveLength(1);
    expect(traces[0]).toMatchObject({
      organisationId: orgs.a,
      auteurId: membre.utilisateurId,
      action: "organisation.parametres_modifies",
      typeRessource: "organisation",
      ressourceId: id,
    });
    expect(await lignesTemoin(orgs.b, valeur)).toEqual([]);
  });
});

describe("demo.oubli_trace", () => {
  test("erreur avec incident ; la ligne témoin n'existe pas (transaction annulée)", async () => {
    const membre = await creerMembre({ organisationId: orgs.a, role: "proprietaire" });
    const valeur = `oubli-${randomUUID()}`;

    const resultat = await executerChaine(
      demoOubliTrace(),
      { entetes: membre.entetes },
      { valeur },
    );

    expect(resultat).toStrictEqual({
      ok: false,
      raison: "erreur",
      incident: expect.stringMatching(UUID),
    });
    expect(await lignesTemoin(orgs.a, valeur)).toEqual([]);
  });
});

describe("demo.sensible : nouvelle authentification fermée en 0.4", () => {
  test.each(ROLES)("%s : refuse, service jamais appelé", async (role) => {
    const membre = await creerMembre({ organisationId: orgs.a, role });
    const executer = vi.fn(async () => "jamais");
    const sensible = declarerAction({
      nom: "demo.sensible",
      droit: "organisation.membres.voir",
      entree: z.strictObject({}),
      journal: null,
      nouvelleAuthentification: true,
      executer,
    });

    const resultat = await executerChaine(sensible, { entetes: membre.entetes }, {});

    expect(resultat).toStrictEqual(REFUS);
    expect(executer).not.toHaveBeenCalled();
  });
});

describe("etablirContexte, avec une vraie session", () => {
  test("lecteur : contexte de la session et de la base, lignes de son organisation seulement", async () => {
    const membre = await creerMembre({ organisationId: orgs.a, role: "lecteur" });

    const resultat = await etablirContexte(
      { entetes: membre.entetes },
      "organisation.membres.voir",
      async (ctx) => ({
        utilisateurId: ctx.utilisateurId,
        organisationId: ctx.organisationId,
        role: ctx.role,
        valeurs: (
          await ctx.tx.select({ valeur: temoinIsolation.valeur }).from(temoinIsolation)
        ).map((ligne) => ligne.valeur),
      }),
    );

    expect(resultat).toMatchObject({
      ok: true,
      donnees: {
        utilisateurId: membre.utilisateurId,
        organisationId: orgs.a,
        role: "lecteur",
        valeurs: expect.arrayContaining([valeurA]),
      },
    });
    expect((resultat as { donnees: { valeurs: string[] } }).donnees.valeurs).not.toContain(valeurB);
  });

  test("lecteur sur un droit refusé (journal.consulter) : refuse", async () => {
    const membre = await creerMembre({ organisationId: orgs.a, role: "lecteur" });

    expect(
      await etablirContexte({ entetes: membre.entetes }, "journal.consulter", async () => "jamais"),
    ).toStrictEqual(REFUS);
  });

  test("sans cookie : connexion_requise", async () => {
    const entetes = new Headers({ origin: new URL(env.BETTER_AUTH_URL).origin });

    expect(
      await etablirContexte({ entetes }, "organisation.membres.voir", async () => "jamais"),
    ).toStrictEqual({ ok: false, raison: "connexion_requise" });
  });
});
