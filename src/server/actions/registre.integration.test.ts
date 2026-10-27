import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { z } from "zod";

import { peut, ROLES, type Role } from "../autorisation/matrice";
import { creerMembre, nettoyerMembres, type Membre } from "../db/outils-test/membres";
import { creerDeuxOrganisations, type Organisations } from "../db/outils-test/organisations";

import {
  declarerAction,
  executerChaine,
  executerChaineCompte,
  type DeclarationCompteQuelconque,
  type DeclarationQuelconque,
} from "./action";
import { REGISTRE, REGISTRE_COMPTE, type NomAction, type NomActionCompte } from "./registre";

// Niveau 2 de la section 8.4 : pour chaque action du registre et chacun des
// quatre rôles, un membre réel de ce rôle, avec une vraie session, appelle la
// chaîne. peut(role, droit) faux : refuse ; vrai : pas refuse, sur une
// ressource de sa propre organisation. Une action du registre sans son cas ne
// compile pas (CAS satisfies Record<NomAction, CasAction>), et le contrôle à
// l'exécution la refuse aussi. Fiche : docs/features/chaine-controles.md,
// sections 8.4 et 9.

// Données d'appel d'une action, construites pour l'organisation du membre.
type CasAction = {
  entree: (contexte: { organisationId: string }) => unknown;
};

// Un cas par action du registre réel. Vide en 0.4, comme le registre.
const CAS = {} satisfies Record<NomAction, CasAction>;

type Membres = Readonly<Record<Role, Membre>>;

let orgs: Organisations;
let membres: Membres;

beforeAll(async () => {
  orgs = await creerDeuxOrganisations({ tables: [] });
  const entrees = await Promise.all(
    ROLES.map(async (role) => [role, await creerMembre({ organisationId: orgs.a, role })] as const),
  );
  membres = Object.fromEntries(entrees) as Record<Role, Membre>;
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

// Actions du registre sans cas, et cas sans action.
function couverture(
  registre: readonly DeclarationQuelconque[],
  cas: Readonly<Record<string, CasAction>>,
): { sansCas: string[]; casEnTrop: string[] } {
  const noms = registre.map((declaration) => declaration.nom);
  return {
    sansCas: noms.filter((nom) => !Object.hasOwn(cas, nom)),
    casEnTrop: Object.keys(cas).filter((nom) => !noms.includes(nom)),
  };
}

// Écarts entre la réponse de la chaîne et la matrice, pour chaque action et
// chaque rôle. Une action sans cas est un écart.
async function ecartsParRole(
  registre: readonly DeclarationQuelconque[],
  cas: Readonly<Record<string, CasAction>>,
): Promise<string[]> {
  const ecarts: string[] = [];
  for (const declaration of registre) {
    const casAction = Object.hasOwn(cas, declaration.nom) ? cas[declaration.nom] : undefined;
    if (casAction === undefined) {
      ecarts.push(`${declaration.nom} : aucun cas`);
      continue;
    }
    for (const role of ROLES) {
      const resultat = await executerChaine(
        declaration,
        { entetes: membres[role].entetes },
        casAction.entree({ organisationId: orgs.a }),
      );
      const refuse = !resultat.ok && resultat.raison === "refuse";
      const autorise = peut(role, declaration.droit);
      if (autorise && refuse) ecarts.push(`${declaration.nom}, ${role} : refusé à tort`);
      if (!autorise && !refuse) ecarts.push(`${declaration.nom}, ${role} : accepté à tort`);
    }
  }
  return ecarts;
}

describe("registre réel", () => {
  test("chaque action a son cas, et chaque cas son action", () => {
    expect(couverture(REGISTRE, CAS)).toEqual({ sansCas: [], casEnTrop: [] });
  });

  test("pour chaque action et chaque rôle, la chaîne suit la matrice", async () => {
    expect(await ecartsParRole(REGISTRE, CAS)).toEqual([]);
  });
});

// Actions de compte (2.1) : hors de la matrice, ouvertes à tout utilisateur
// connecté. Pour chacune, un cas : sans session, connexion_requise ; avec
// une vraie session et une entrée valide, acceptée. Une action de compte
// sans cas ne compile pas. Fiche : docs/features/organisations.md, section 3.
type CasCompte = {
  entree: (contexte: { organisationId: string }) => unknown;
};

const CAS_COMPTE = {
  // Laisse une organisation sur dev (trace en ajout seul).
  "organisation.creer": { entree: () => ({ raisonSociale: "Test registre" }) },
  "organisation.changer": { entree: ({ organisationId }) => ({ organisationId }) },
} satisfies Record<NomActionCompte, CasCompte>;

describe("registre des actions de compte", () => {
  test("chaque action a son cas, et chaque cas son action", () => {
    const noms = REGISTRE_COMPTE.map((declaration) => declaration.nom).sort();
    expect(Object.keys(CAS_COMPTE).sort()).toEqual(noms);
  });

  test("sans session : connexion_requise ; avec une session : acceptée", async () => {
    const sansSession = new Headers({ origin: membres.lecteur.entetes.get("origin") ?? "" });
    for (const declaration of REGISTRE_COMPTE) {
      const cas: CasCompte = CAS_COMPTE[declaration.nom];
      const entree = cas.entree({ organisationId: orgs.a });
      expect(
        await executerChaineCompte(
          declaration as DeclarationCompteQuelconque,
          { entetes: sansSession },
          entree,
        ),
        declaration.nom,
      ).toEqual({ ok: false, raison: "connexion_requise" });
      const resultat = await executerChaineCompte(
        declaration as DeclarationCompteQuelconque,
        { entetes: membres.lecteur.entetes },
        entree,
      );
      expect(resultat.ok, declaration.nom).toBe(true);
    }
  });
});

// Registre de démonstration : la mécanique du niveau 2, prouvée sur des
// déclarations qui n'existent que dans ce test (section 9).
const SCHEMA = z.strictObject({});

function demo(nom: string, droit: DeclarationQuelconque["droit"], introuvable = false) {
  return declarerAction({
    nom,
    droit,
    entree: SCHEMA,
    journal: null,
    nouvelleAuthentification: false,
    debit: null,
    emails: [],
    executer: async (ctx) => (introuvable ? ctx.introuvable() : ctx.role),
  }) as DeclarationQuelconque;
}

const SANS_ENTREE: CasAction = { entree: () => ({}) };

describe("registre de démonstration", () => {
  test("droits des quatre rôles, du Propriétaire seul, du portefeuille : aucun écart", async () => {
    const registre = [
      demo("demo.registre_lire", "organisation.membres.voir"),
      demo("demo.registre_supprimer", "organisation.supprimer"),
      demo("demo.registre_clients", "clients.voir"),
      demo("demo.registre_export", "exports.csv"),
    ];
    const cas = Object.fromEntries(registre.map((d) => [d.nom, SANS_ENTREE]));

    expect(couverture(registre, cas)).toEqual({ sansCas: [], casEnTrop: [] });
    expect(await ecartsParRole(registre, cas)).toEqual([]);
  });

  test("action sans cas : signalée par le contrôle à l'exécution et par le parcours", async () => {
    const registre = [
      demo("demo.registre_lire", "organisation.membres.voir"),
      demo("demo.registre_sans_cas", "organisation.membres.voir"),
    ];
    const cas = { "demo.registre_lire": SANS_ENTREE };

    expect(couverture(registre, cas)).toEqual({
      sansCas: ["demo.registre_sans_cas"],
      casEnTrop: [],
    });
    expect(await ecartsParRole(registre, cas)).toEqual(["demo.registre_sans_cas : aucun cas"]);
  });

  test("cas sans action : signalé", () => {
    const registre = [demo("demo.registre_lire", "organisation.membres.voir")];
    const cas = { "demo.registre_lire": SANS_ENTREE, "demo.retiree": SANS_ENTREE };

    expect(couverture(registre, cas)).toEqual({ sansCas: [], casEnTrop: ["demo.retiree"] });
  });

  test("témoin : une action qui refuse ses rôles autorisés produit un écart par rôle", async () => {
    const registre = [demo("demo.registre_toujours_refusee", "organisation.membres.voir", true)];
    const cas = { "demo.registre_toujours_refusee": SANS_ENTREE };

    expect(await ecartsParRole(registre, cas)).toEqual(
      ROLES.map((role) => `demo.registre_toujours_refusee, ${role} : refusé à tort`),
    );
  });

  test("une action sans cas ne compile pas (vérifié par npm run typecheck)", () => {
    // @ts-expect-error demo.b n'a pas de cas
    const incomplet = { "demo.a": SANS_ENTREE } satisfies Record<"demo.a" | "demo.b", CasAction>;

    expect(Object.keys(incomplet)).toEqual(["demo.a"]);
  });
});
