import { randomUUID } from "node:crypto";

import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { z } from "zod";

import { declarerAction, executerChaine } from "../actions/action";
import { env } from "../env";

import { db, executerDansOrganisation } from "./client";
import { creerMembre, nettoyerMembres, type Membre } from "./outils-test/membres";
import { creerDeuxOrganisations, type Organisations } from "./outils-test/organisations";
import { member, session } from "./schema/auth";
import { journalAudit, temoinIsolation } from "./schema/technique";

// Tests d'attaque de la chaîne, avec la vraie base et de vraies sessions :
// T-17, T-30, T-51, T-52, entrée falsifiée, session et organisation active
// falsifiées. Ce test vit dans db/ : seuls les tests de db/ peuvent importer
// drizzle-orm et la base. Fiche : docs/features/chaine-controles.md,
// « Tests d'attaque ».

const REFUS = { ok: false, raison: "refuse" } as const;
const CONNEXION = { ok: false, raison: "connexion_requise" } as const;
const ORIGINE = new URL(env.BETTER_AUTH_URL).origin;

let orgs: Organisations;

beforeAll(async () => {
  orgs = await creerDeuxOrganisations({
    tables: [temoinIsolation],
    tablesAjoutSeul: [journalAudit],
  });
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

function demoLire() {
  return declarerAction({
    nom: "demo.lire",
    droit: "organisation.membres.voir",
    entree: z.strictObject({}),
    journal: null,
    nouvelleAuthentification: false,
    executer: async (ctx) => ({ organisationId: ctx.organisationId, role: ctx.role }),
  });
}

// Propriétaire seul. N'écrit que si la chaîne l'y autorise : aucun test de ce
// fichier n'attend une écriture validée, donc aucune trace ne reste sur dev.
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

// Droit du Propriétaire et du Comptable, refusé au Lecteur : sert au
// changement de rôle comptable → lecteur (T-52).
function demoReservee() {
  return declarerAction({
    nom: "demo.reservee",
    droit: "catalogue.modifier",
    entree: z.strictObject({}),
    journal: null,
    nouvelleAuthentification: false,
    executer: async (ctx) => ctx.role,
  });
}

// Lit une ligne de temoin_isolation par son identifiant ; introuvable sinon.
function demoRessource() {
  return declarerAction({
    nom: "demo.ressource",
    droit: "organisation.membres.voir",
    entree: z.strictObject({ id: z.uuid() }),
    journal: null,
    nouvelleAuthentification: false,
    executer: async (ctx, entree) => {
      const [ligne] = await ctx.tx
        .select({ valeur: temoinIsolation.valeur })
        .from(temoinIsolation)
        .where(eq(temoinIsolation.id, entree.id));
      if (!ligne) return ctx.introuvable();
      return ligne.valeur;
    },
  });
}

async function insererTemoin(organisationId: string, valeur: string): Promise<string> {
  const [ligne] = await executerDansOrganisation(organisationId, (tx) =>
    tx
      .insert(temoinIsolation)
      .values({ organisationId, valeur })
      .returning({ id: temoinIsolation.id }),
  );
  if (!ligne) throw new Error("insertion sans ligne renvoyée");
  return ligne.id;
}

// Lignes portant la valeur, dans A et dans B.
async function lignesEcrites(valeur: string): Promise<number> {
  let total = 0;
  for (const organisationId of [orgs.a, orgs.b]) {
    const lignes = await executerDansOrganisation(organisationId, (tx) =>
      tx.select().from(temoinIsolation).where(eq(temoinIsolation.valeur, valeur)),
    );
    total += lignes.length;
  }
  return total;
}

function avecEntetes(membre: Membre, modifier: (entetes: Headers) => void): Headers {
  const entetes = new Headers(membre.entetes);
  modifier(entetes);
  return entetes;
}

// Remplace la valeur du cookie de session (nom=jeton.signature).
function remplacerCookie(membre: Membre, transformer: (valeur: string) => string): Headers {
  return avecEntetes(membre, (entetes) => {
    const cookie = entetes.get("cookie") ?? "";
    const egal = cookie.indexOf("=");
    if (egal < 0) throw new Error("cookie de session absent des en-têtes");
    entetes.set("cookie", `${cookie.slice(0, egal + 1)}${transformer(cookie.slice(egal + 1))}`);
  });
}

function falsifierSignature(valeur: string): string {
  const point = valeur.lastIndexOf(".");
  if (point < 0) throw new Error("cookie sans signature");
  const caractere = valeur.charAt(point + 1) === "A" ? "B" : "A";
  return `${valeur.slice(0, point + 1)}${caractere}${valeur.slice(point + 2)}`;
}

function changerOrganisationActive(membre: Membre, valeur: string | null) {
  return db
    .update(session)
    .set({ activeOrganizationId: valeur })
    .where(eq(session.userId, membre.utilisateurId));
}

describe("sans session : connexion_requise", () => {
  test("aucun cookie", async () => {
    const entetes = new Headers({ origin: ORIGINE });

    expect(await executerChaine(demoLire(), { entetes }, {})).toStrictEqual(CONNEXION);
  });

  test("cookie signé dont le jeton n'existe plus en base", async () => {
    const membre = await creerMembre({ organisationId: orgs.a, role: "proprietaire" });
    await db.delete(session).where(eq(session.userId, membre.utilisateurId));

    expect(await executerChaine(demoLire(), { entetes: membre.entetes }, {})).toStrictEqual(
      CONNEXION,
    );
  });

  test("signature modifiée", async () => {
    const membre = await creerMembre({ organisationId: orgs.a, role: "proprietaire" });
    const entetes = remplacerCookie(membre, falsifierSignature);

    expect(await executerChaine(demoLire(), { entetes }, {})).toStrictEqual(CONNEXION);
  });

  test("jeton valide sans signature", async () => {
    const membre = await creerMembre({ organisationId: orgs.a, role: "proprietaire" });
    const entetes = remplacerCookie(membre, (valeur) => {
      const decode = decodeURIComponent(valeur);
      return decode.slice(0, decode.lastIndexOf("."));
    });

    expect(await executerChaine(demoLire(), { entetes }, {})).toStrictEqual(CONNEXION);
  });

  test("session expirée", async () => {
    const membre = await creerMembre({ organisationId: orgs.a, role: "proprietaire" });
    await db
      .update(session)
      .set({ expiresAt: new Date(Date.now() - 60_000) })
      .where(eq(session.userId, membre.utilisateurId));

    expect(await executerChaine(demoLire(), { entetes: membre.entetes }, {})).toStrictEqual(
      CONNEXION,
    );
  });
});

describe("autre organisation (S-01, T-30)", () => {
  test("membre de B, organisation active A forcée en base : refuse", async () => {
    const membre = await creerMembre({ organisationId: orgs.b, role: "proprietaire" });
    await changerOrganisationActive(membre, orgs.a);

    expect(await executerChaine(demoLire(), { entetes: membre.entetes }, {})).toStrictEqual(REFUS);
  });

  test("membre de B : une ligne de A et une ligne inexistante donnent des résultats égaux", async () => {
    const membre = await creerMembre({ organisationId: orgs.b, role: "proprietaire" });
    const ligneA = await insererTemoin(orgs.a, `ressource-a-${randomUUID()}`);
    const valeurB = `ressource-b-${randomUUID()}`;
    const ligneB = await insererTemoin(orgs.b, valeurB);
    const requete = { entetes: membre.entetes };

    const deA = await executerChaine(demoRessource(), requete, { id: ligneA });
    const inexistante = await executerChaine(demoRessource(), requete, { id: randomUUID() });

    expect(deA).toStrictEqual(inexistante);
    expect(deA).toStrictEqual(REFUS);
    // Témoin : la même action trouve bien une ligne de B.
    expect(await executerChaine(demoRessource(), requete, { id: ligneB })).toStrictEqual({
      ok: true,
      donnees: valeurB,
    });
  });

  test("membre de A (lecteur) et de B (proprietaire), organisation active A : rôle de A appliqué", async () => {
    const membre = await creerMembre({ organisationId: orgs.a, role: "lecteur" });
    await db.insert(member).values({
      organizationId: orgs.b,
      userId: membre.utilisateurId,
      role: "proprietaire",
      createdAt: new Date(),
    });
    const valeur = `deux-organisations-${randomUUID()}`;

    expect(await executerChaine(demoLire(), { entetes: membre.entetes }, {})).toStrictEqual({
      ok: true,
      donnees: { organisationId: orgs.a, role: "lecteur" },
    });
    expect(
      await executerChaine(demoEcrire(), { entetes: membre.entetes }, { valeur }),
    ).toStrictEqual(REFUS);
    expect(await lignesEcrites(valeur)).toBe(0);
  });
});

describe("rôle insuffisant", () => {
  test.each(["comptable", "commercial", "lecteur"])(
    "%s sur demo.ecrire : refuse, aucune ligne écrite",
    async (role) => {
      const membre = await creerMembre({ organisationId: orgs.a, role });
      const valeur = `role-${role}-${randomUUID()}`;

      const resultat = await executerChaine(demoEcrire(), { entetes: membre.entetes }, { valeur });

      expect(resultat).toStrictEqual(REFUS);
      expect(await lignesEcrites(valeur)).toBe(0);
    },
  );
});

describe("entrée falsifiée", () => {
  test.each([
    ["organisationId de B", () => ({ organisationId: orgs.b })],
    ["role", () => ({ role: "proprietaire" })],
    ["auteurId d'un autre utilisateur", () => ({ auteurId: randomUUID() })],
  ])(
    "%s dans l'entrée : invalide, rien d'écrit, valeur absente du résultat",
    async (_nom, ajout) => {
      const membre = await creerMembre({ organisationId: orgs.a, role: "proprietaire" });
      const valeur = `falsifiee-${randomUUID()}`;
      const champ = ajout();

      const resultat = await executerChaine(
        demoEcrire(),
        { entetes: membre.entetes },
        { valeur, ...champ },
      );

      expect(resultat).toMatchObject({ ok: false, raison: "invalide" });
      expect(JSON.stringify(resultat)).not.toContain(Object.values(champ)[0]);
      expect(await lignesEcrites(valeur)).toBe(0);
    },
  );

  test("entrées non objet ou très profondes : invalide", async () => {
    const membre = await creerMembre({ organisationId: orgs.a, role: "proprietaire" });
    let profonde: unknown = "fond";
    for (let i = 0; i < 100_000; i += 1) profonde = { a: profonde };
    let tableaux: unknown = [];
    for (let i = 0; i < 100_000; i += 1) tableaux = [tableaux];

    for (const brute of [null, undefined, "texte", 42, true, [], { valeur: profonde }, tableaux]) {
      const resultat = await executerChaine(demoEcrire(), { entetes: membre.entetes }, brute);

      expect(resultat).toMatchObject({ ok: false, raison: "invalide" });
    }
  });
});

describe("T-17 : requête d'un autre site avec une session valide", () => {
  test.each([
    ["Origin d'un autre site", (e: Headers) => e.set("origin", "https://attaquant.test")],
    ["Origin absente", (e: Headers) => e.delete("origin")],
    ["Sec-Fetch-Site: cross-site", (e: Headers) => e.set("sec-fetch-site", "cross-site")],
  ])("%s : refuse, rien d'écrit", async (_nom, modifier) => {
    const membre = await creerMembre({ organisationId: orgs.a, role: "proprietaire" });
    const valeur = `t17-${randomUUID()}`;

    const resultat = await executerChaine(
      demoEcrire(),
      { entetes: avecEntetes(membre, modifier) },
      { valeur },
    );

    expect(resultat).toStrictEqual(REFUS);
    expect(await lignesEcrites(valeur)).toBe(0);
  });
});

describe("T-51 : rôle hors de la liste", () => {
  test.each(["owner", "admin", "member", "", "comptable,proprietaire", "Proprietaire"])(
    "member.role = %j : refuse pour demo.lire et demo.ecrire",
    async (role) => {
      const membre = await creerMembre({ organisationId: orgs.a, role });
      const valeur = `t51-${randomUUID()}`;
      const requete = { entetes: membre.entetes };

      expect(await executerChaine(demoLire(), requete, {})).toStrictEqual(REFUS);
      expect(await executerChaine(demoEcrire(), requete, { valeur })).toStrictEqual(REFUS);
      expect(await lignesEcrites(valeur)).toBe(0);
    },
  );
});

describe("T-52 : membre retiré ou rétrogradé", () => {
  test("adhésion supprimée après l'ouverture de la session : refuse à la requête suivante", async () => {
    const membre = await creerMembre({ organisationId: orgs.a, role: "proprietaire" });
    const requete = { entetes: membre.entetes };
    expect(await executerChaine(demoLire(), requete, {})).toMatchObject({ ok: true });

    await db.delete(member).where(eq(member.id, membre.membreId));

    expect(await executerChaine(demoLire(), requete, {})).toStrictEqual(REFUS);
  });

  test("rôle passé de comptable à lecteur : la requête suivante applique le nouveau rôle", async () => {
    const membre = await creerMembre({ organisationId: orgs.a, role: "comptable" });
    const requete = { entetes: membre.entetes };
    expect(await executerChaine(demoReservee(), requete, {})).toStrictEqual({
      ok: true,
      donnees: "comptable",
    });

    await db.update(member).set({ role: "lecteur" }).where(eq(member.id, membre.membreId));

    expect(await executerChaine(demoReservee(), requete, {})).toStrictEqual(REFUS);
    expect(await executerChaine(demoLire(), requete, {})).toStrictEqual({
      ok: true,
      donnees: { organisationId: orgs.a, role: "lecteur" },
    });
  });

  test("concurrence : la suppression de l'adhésion attend la fin de l'action en cours (FOR SHARE)", async () => {
    const membre = await creerMembre({ organisationId: orgs.a, role: "lecteur" });
    let signalerEntree!: () => void;
    const entree = new Promise<void>((resoudre) => (signalerEntree = resoudre));
    let liberer!: () => void;
    const liberation = new Promise<void>((resoudre) => (liberer = resoudre));
    const bloquante = declarerAction({
      nom: "demo.bloquante",
      droit: "organisation.membres.voir",
      entree: z.strictObject({}),
      journal: null,
      nouvelleAuthentification: false,
      executer: async () => {
        signalerEntree();
        await liberation;
        return "terminée";
      },
    });

    const action = executerChaine(bloquante, { entetes: membre.entetes }, {});
    try {
      // L'action tient l'adhésion quand son service a commencé. Si la chaîne
      // échoue avant, la course le signale au lieu d'attendre indéfiniment.
      await Promise.race([
        entree,
        action.then(() => {
          throw new Error("action terminée avant d'atteindre le service");
        }),
      ]);

      let supprimee = false;
      const suppression = db
        .delete(member)
        .where(eq(member.id, membre.membreId))
        .then(() => {
          supprimee = true;
        });
      await new Promise((resoudre) => setTimeout(resoudre, 1_500));
      expect(supprimee).toBe(false);

      liberer();
      expect(await action).toStrictEqual({ ok: true, donnees: "terminée" });
      await suppression;
      expect(supprimee).toBe(true);
    } finally {
      liberer();
    }

    expect(await executerChaine(demoLire(), { entetes: membre.entetes }, {})).toStrictEqual(REFUS);
  });
});

describe("organisation active falsifiée", () => {
  test.each([
    ["absente", null],
    ["vide", ""],
    ["pas un UUID", "pas-un-uuid"],
    ["injection", "' OR '1'='1"],
    ["UUID d'une organisation inexistante", randomUUID()],
  ])("%s : refuse", async (_nom, valeur) => {
    const membre = await creerMembre({ organisationId: orgs.a, role: "proprietaire" });
    await changerOrganisationActive(membre, valeur);

    expect(await executerChaine(demoLire(), { entetes: membre.entetes }, {})).toStrictEqual(REFUS);
  });
});
