import { randomInt, randomUUID } from "node:crypto";

import { and, eq, sql } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { z } from "zod";

import { declarerAction, executerChaine } from "../actions/action";
import { env } from "../env";

import { db } from "./client";
import {
  DUREE_NOUVELLE_AUTHENTIFICATION_SECONDES,
  enregistrerPreuve,
  identifiantPreuve,
} from "./nouvelle-authentification";
import { bancInscription } from "./outils-test/inscription";
import { creerMembre, nettoyerMembres, type Membre } from "./outils-test/membres";
import { creerDeuxOrganisations, type Organisations } from "./outils-test/organisations";
import { session, user, verification } from "./schema/auth";

// La nouvelle authentification (1.6) avec la vraie base : preuve posée par
// le point /api/auth/verify-password (notre gestionnaire et l'instance de
// Better Auth aux options de l'application), puis consommée par l'étape 8 de
// la vraie chaîne, dans la transaction de l'action : usage unique, liée à la
// session et à l'utilisateur, 5 minutes, rendue quand l'action est annulée,
// une seule action pour deux simultanées. Transport en mémoire, Have I Been
// Pwned simulé. Dans src/server/db/ : seul dossier dont les tests importent
// db. Fiche : docs/features/nouvelle-authentification.md, tests 5 et 6.

const banc = bancInscription({ adresses: 4 });
const ORIGINE = new URL(env.BETTER_AUTH_URL).origin;
const MOT_DE_PASSE = "une-phrase-de-passe-solide";
const NOUVELLE_AUTH = { ok: false, raison: "nouvelle_authentification_requise" } as const;
const REFUS = { ok: false, raison: "refuse" } as const;

let orgs: Organisations;

beforeAll(async () => {
  orgs = await creerDeuxOrganisations({ tables: [] });
});

// Les organisations d'abord, puis les membres, puis les comptes du banc.
afterAll(async () => {
  try {
    await orgs?.nettoyer();
  } finally {
    try {
      await nettoyerMembres();
    } finally {
      await banc.nettoyer();
    }
  }
});

beforeEach(() => {
  vi.stubGlobal("fetch", async (entree: string | URL | Request) => {
    const url = new URL(entree instanceof Request ? entree.url : entree);
    if (url.hostname !== "api.pwnedpasswords.com") throw new Error("appel inattendu");
    return new Response("0000000000000000000000000000000000A:1\r\n");
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function post(chemin: string, corps: unknown, cookie?: string): Request {
  const entetes: Record<string, string> = {
    "content-type": "application/json",
    origin: ORIGINE,
    "x-forwarded-for": `198.51.100.${randomInt(1, 255)}`,
  };
  if (cookie) entetes.cookie = cookie;
  return new Request(`${ORIGINE}/api/auth${chemin}`, {
    method: "POST",
    headers: entetes,
    body: JSON.stringify(corps),
  });
}

function paireSession(reponse: Response): string | undefined {
  return reponse.headers
    .getSetCookie()
    .find((c) => /session_token=[^;]/u.test(c))
    ?.split(";")[0];
}

function jetonVerification(email: string): string {
  const message = [...banc.transport.messages].reverse().find((m) => m.a === email);
  const trouve = message?.corps.match(/\/lien\/verification#([A-Za-z0-9_.-]+)/u);
  if (!trouve?.[1]) throw new Error("aucun lien de vérification reçu");
  return trouve[1];
}

// Compte vérifié, sans second facteur ; la vérification ouvre une session.
async function compteConnecte() {
  const email = banc.adresse();
  await banc.traiter(post("/sign-up/email", { nom: "Awa Koné", email, motDePasse: MOT_DE_PASSE }));
  await banc.envoyer();
  const reponse = await banc.traiter(post("/verify-email", { jeton: jetonVerification(email) }));
  const cookie = paireSession(reponse);
  if (!cookie) throw new Error("aucune session ouverte");
  const [ligne] = await db.select({ id: user.id }).from(user).where(eq(user.email, email));
  const [ouverte] = await db
    .select({ id: session.id })
    .from(session)
    .where(eq(session.userId, ligne?.id ?? ""));
  return { email, cookie, id: ligne?.id ?? "", sessionId: ouverte?.id ?? "" };
}

async function preuves(utilisateurId: string) {
  return db
    .select({ identifier: verification.identifier, expiresAt: verification.expiresAt })
    .from(verification)
    .where(
      and(
        eq(verification.value, utilisateurId),
        sql`${verification.identifier} like 'nouvelle-authentification:%'`,
      ),
    );
}

async function sessionDe(membre: Membre): Promise<string> {
  const [ligne] = await db
    .select({ id: session.id })
    .from(session)
    .where(eq(session.userId, membre.utilisateurId));
  if (!ligne) throw new Error("session de test introuvable");
  return ligne.id;
}

// demo.sensible : tous les rôles ont le droit ; renvoie l'organisation.
function demoSensible(executer?: () => Promise<string>) {
  return declarerAction({
    nom: "demo.sensible",
    droit: "organisation.membres.voir",
    entree: z.strictObject({ valeur: z.string().max(20) }),
    journal: null,
    nouvelleAuthentification: true,
    debit: null,
    emails: [],
    executer: async (ctx) => (executer ? executer() : ctx.organisationId),
  });
}

async function agir(
  membre: Membre,
  entree: unknown = { valeur: "x" },
  executer?: () => Promise<string>,
) {
  return executerChaine(demoSensible(executer), { entetes: membre.entetes }, entree);
}

describe("le point /api/auth/verify-password (section 2)", () => {
  test("mot de passe juste : preuve de la session de la requête, 5 minutes à l'horloge de la base", async () => {
    const compte = await compteConnecte();

    const reponse = await banc.traiter(
      post("/verify-password", { motDePasse: MOT_DE_PASSE }, compte.cookie),
    );

    expect(reponse.status).toBe(200);
    expect(await reponse.json()).toEqual({ ok: true });
    expect(reponse.headers.getSetCookie()).toEqual([]);
    const lues = await preuves(compte.id);
    expect(lues.map((l) => l.identifier)).toEqual([identifiantPreuve(compte.sessionId)]);
    const [{ ecart } = { ecart: 0 }] = (
      await db.execute<{ ecart: number }>(
        sql`select extract(epoch from (${verification.expiresAt} - now()))::float as ecart
            from ${verification} where ${verification.identifier} = ${identifiantPreuve(compte.sessionId)}`,
      )
    ).rows;
    expect(ecart).toBeGreaterThan(DUREE_NOUVELLE_AUTHENTIFICATION_SECONDES - 30);
    expect(ecart).toBeLessThanOrEqual(DUREE_NOUVELLE_AUTHENTIFICATION_SECONDES);
  });

  test("mot de passe faux : mot_de_passe_incorrect, aucune preuve", async () => {
    const compte = await compteConnecte();

    const reponse = await banc.traiter(
      post("/verify-password", { motDePasse: "pas-le-bon-mot-de-passe" }, compte.cookie),
    );

    expect(await reponse.json()).toEqual({ ok: false, raison: "mot_de_passe_incorrect" });
    expect(await preuves(compte.id)).toEqual([]);
  });

  test("une nouvelle preuve remplace la précédente de la même session", async () => {
    const compte = await compteConnecte();
    for (let i = 0; i < 2; i += 1) {
      await banc.traiter(post("/verify-password", { motDePasse: MOT_DE_PASSE }, compte.cookie));
    }
    expect(await preuves(compte.id)).toHaveLength(1);
  });
});

describe("l'étape 8 de la chaîne (section 4)", () => {
  test.each(["proprietaire", "comptable", "commercial", "lecteur"])(
    "%s sans preuve : nouvelle_authentification_requise",
    async (role) => {
      const membre = await creerMembre({ organisationId: orgs.a, role });
      expect(await agir(membre)).toStrictEqual(NOUVELLE_AUTH);
    },
  );

  test("avec la preuve de sa session : une action, une seule", async () => {
    const membre = await creerMembre({ organisationId: orgs.a, role: "proprietaire" });
    await enregistrerPreuve(membre.utilisateurId, await sessionDe(membre));

    expect(await agir(membre)).toStrictEqual({ ok: true, donnees: orgs.a });
    expect(await agir(membre)).toStrictEqual(NOUVELLE_AUTH);
    expect(await preuves(membre.utilisateurId)).toEqual([]);
  });

  test("preuve d'une autre session, d'un autre utilisateur, ou expirée : refus", async () => {
    const membre = await creerMembre({ organisationId: orgs.a, role: "proprietaire" });
    const autre = await creerMembre({ organisationId: orgs.a, role: "proprietaire" });
    const sessionId = await sessionDe(membre);

    await enregistrerPreuve(membre.utilisateurId, randomUUID());
    expect(await agir(membre)).toStrictEqual(NOUVELLE_AUTH);

    await enregistrerPreuve(autre.utilisateurId, sessionId);
    expect(await agir(membre)).toStrictEqual(NOUVELLE_AUTH);

    await enregistrerPreuve(membre.utilisateurId, sessionId);
    await db
      .update(verification)
      .set({ expiresAt: sql`now() - interval '1 second'` })
      .where(eq(verification.identifier, identifiantPreuve(sessionId)));
    expect(await agir(membre)).toStrictEqual(NOUVELLE_AUTH);
    await db
      .delete(verification)
      .where(
        sql`${verification.value} in (${membre.utilisateurId}, ${autre.utilisateurId}) and ${verification.identifier} like 'nouvelle-authentification:%'`,
      );
  });

  test("deux actions simultanées avec une même preuve : une seule passe", async () => {
    const membre = await creerMembre({ organisationId: orgs.a, role: "proprietaire" });
    await enregistrerPreuve(membre.utilisateurId, await sessionDe(membre));

    const resultats = await Promise.all([agir(membre), agir(membre)]);

    expect(resultats.filter((r) => r.ok)).toHaveLength(1);
    expect(resultats).toContainEqual(NOUVELLE_AUTH);
  });

  test("action annulée (entrée invalide, service qui refuse) : la preuve reste", async () => {
    const membre = await creerMembre({ organisationId: orgs.a, role: "proprietaire" });
    await enregistrerPreuve(membre.utilisateurId, await sessionDe(membre));

    expect(await agir(membre, { valeur: 3 })).toStrictEqual({
      ok: false,
      raison: "invalide",
      champs: ["valeur"],
    });
    expect(await preuves(membre.utilisateurId)).toHaveLength(1);

    const refuse = await agir(membre, { valeur: "x" }, async () => {
      throw new Error("service en panne");
    });
    expect(refuse).toMatchObject({ ok: false, raison: "erreur" });
    expect(await preuves(membre.utilisateurId)).toHaveLength(1);

    expect(await agir(membre)).toStrictEqual({ ok: true, donnees: orgs.a });
  });

  test("membre d'une autre organisation, ou rôle sans le droit : refuse, la preuve reste", async () => {
    const membre = await creerMembre({ organisationId: orgs.a, role: "lecteur" });
    await enregistrerPreuve(membre.utilisateurId, await sessionDe(membre));
    const sensibleProprietaire = declarerAction({
      nom: "demo.sensible_proprietaire",
      droit: "organisation.supprimer",
      entree: z.strictObject({}),
      journal: null,
      nouvelleAuthentification: true,
      debit: null,
      emails: [],
      executer: async () => "jamais",
    });

    expect(
      await executerChaine(sensibleProprietaire, { entetes: membre.entetes }, {}),
    ).toStrictEqual(REFUS);
    expect(await preuves(membre.utilisateurId)).toHaveLength(1);

    const ailleurs = await creerMembre({
      organisationId: orgs.a,
      role: "proprietaire",
      organisationActive: orgs.b,
    });
    await enregistrerPreuve(ailleurs.utilisateurId, await sessionDe(ailleurs));
    expect(await agir(ailleurs)).toStrictEqual(REFUS);
    expect(await preuves(ailleurs.utilisateurId)).toHaveLength(1);
    await db
      .delete(verification)
      .where(
        sql`${verification.value} in (${membre.utilisateurId}, ${ailleurs.utilisateurId}) and ${verification.identifier} like 'nouvelle-authentification:%'`,
      );
  });
});
