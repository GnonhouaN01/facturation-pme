import { afterAll, beforeAll, describe, expect, test } from "vitest";

import { TEXTES_NAVIGATION } from "@/textes/navigation";

import { etablirContexte } from "../actions/action";
import { ROLES } from "../autorisation/matrice";
import { DROIT_GABARIT, entreesVisibles, lireGabarit } from "../autorisation/navigation";
import { env } from "../env";

import { creerMembre, nettoyerMembres } from "./outils-test/membres";
import { creerDeuxOrganisations, type Organisations } from "./outils-test/organisations";

// La lecture du gabarit de l'application, par etablirContexte, avec de vraies
// sessions Better Auth et la vraie base. La partie Next.js de lirePourPage
// (lecture de headers()) n'est éprouvée qu'en bout en bout. Ce test vit dans
// db/ pour l'outillage des membres. Fiche : docs/features/socle-interface.md,
// sections 2.4 et 2.5.

const REFUS = { ok: false, raison: "refuse" } as const;

const LIBELLES = {
  proprietaire: "Propriétaire",
  comptable: "Comptable",
  commercial: "Commercial",
  lecteur: "Lecteur",
} as const;

let orgs: Organisations;

beforeAll(async () => {
  orgs = await creerDeuxOrganisations({ tables: [] });
});

// Les organisations d'abord : un échec de nettoyerMembres ne doit pas les
// laisser sur dev.
afterAll(async () => {
  try {
    await orgs?.nettoyer();
  } finally {
    await nettoyerMembres();
  }
});

describe("lecture du gabarit, avec une vraie session", () => {
  test.each(ROLES)("%s : son rôle, son libellé et ses entrées", async (role) => {
    const membre = await creerMembre({ organisationId: orgs.a, role });

    const resultat = await etablirContexte({ entetes: membre.entetes }, DROIT_GABARIT, lireGabarit);

    expect(resultat).toStrictEqual({
      ok: true,
      donnees: { role, entrees: entreesVisibles(role) },
    });
    if (!resultat.ok) return;
    expect(resultat.donnees.entrees.map((entree) => entree.chemin)).toEqual(["/tableau-de-bord"]);
    expect(TEXTES_NAVIGATION.roles[resultat.donnees.role]).toBe(LIBELLES[role]);
  });

  test("membre de A dont l'organisation active est B : refuse", async () => {
    const membre = await creerMembre({
      organisationId: orgs.a,
      role: "proprietaire",
      organisationActive: orgs.b,
    });

    expect(
      await etablirContexte({ entetes: membre.entetes }, DROIT_GABARIT, lireGabarit),
    ).toStrictEqual(REFUS);
  });

  test("sans organisation active : refuse", async () => {
    const membre = await creerMembre({
      organisationId: orgs.a,
      role: "proprietaire",
      organisationActive: null,
    });

    expect(
      await etablirContexte({ entetes: membre.entetes }, DROIT_GABARIT, lireGabarit),
    ).toStrictEqual(REFUS);
  });

  // T-51 : un rôle écrit par Better Auth hors des quatre n'a aucun droit.
  test.each(["owner", "member", "__proto__", "comptable,proprietaire"])(
    "rôle inconnu %j : refuse",
    async (role) => {
      const membre = await creerMembre({ organisationId: orgs.a, role });

      expect(
        await etablirContexte({ entetes: membre.entetes }, DROIT_GABARIT, lireGabarit),
      ).toStrictEqual(REFUS);
    },
  );

  test("sans cookie : connexion_requise", async () => {
    const entetes = new Headers({ origin: new URL(env.BETTER_AUTH_URL).origin });

    expect(await etablirContexte({ entetes }, DROIT_GABARIT, lireGabarit)).toStrictEqual({
      ok: false,
      raison: "connexion_requise",
    });
  });
});
