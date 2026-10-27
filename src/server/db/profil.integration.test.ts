import { randomInt } from "node:crypto";

import { and, eq, like } from "drizzle-orm";
import { afterAll, afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { env } from "../env";

import { db } from "./client";
import { bancInscription } from "./outils-test/inscription";
import { lireProfil } from "./profil";
import { creerDeuxOrganisations } from "./outils-test/organisations";
import { account, member, session, user, verification } from "./schema/auth";
import { compteurDebit } from "./schema/technique";
import { sessionsDe } from "./sessions";

// UC-05, le changement du mot de passe depuis une session (S-17) et la
// correction du nom avec la vraie base, par notre gestionnaire et l'instance
// de Better Auth aux options de l'application. Transport en mémoire, Have I
// Been Pwned simulé. Fiche : docs/features/profil-sessions.md, tests 12 à 14.

const banc = bancInscription({ adresses: 18 });
const ORIGINE = new URL(env.BETTER_AUTH_URL).origin;
const MOT_DE_PASSE = "une-phrase-de-passe-solide";
const NOUVEAU = "une-autre-phrase-bien-longue";

afterAll(() => banc.nettoyer());

// Have I Been Pwned simulé : aucun mot de passe du test n'y figure.
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

function ip(): string {
  return `198.51.100.${randomInt(1, 255)}`;
}

function post(chemin: string, corps: unknown, cookie?: string): Request {
  const entetes: Record<string, string> = {
    "content-type": "application/json",
    origin: ORIGINE,
    "x-forwarded-for": ip(),
    "user-agent":
      "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36",
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

// Compte vérifié, puis autant de sessions que demandé (une par connexion).
async function compte(sessions: number) {
  const email = banc.adresse();
  await banc.traiter(post("/sign-up/email", { nom: "Tiers", email, motDePasse: MOT_DE_PASSE }));
  await banc.envoyer();
  const verification = await banc.traiter(
    post("/verify-email", { jeton: jetonVerification(email) }),
  );
  const cookies = [paireSession(verification)];
  for (let i = 1; i < sessions; i += 1) {
    const connexion = await banc.traiter(
      post("/sign-in/email", { email, motDePasse: MOT_DE_PASSE }),
    );
    cookies.push(paireSession(connexion));
  }
  if (cookies.some((c) => c === undefined)) throw new Error("session non ouverte");
  const [ligne] = await db.select({ id: user.id }).from(user).where(eq(user.email, email));
  return { email, id: ligne?.id ?? "", cookies: cookies as string[] };
}

async function sessionLisible(cookie: string): Promise<boolean> {
  return (await banc.lireSession(new Headers({ cookie }))) !== null;
}

async function idSession(cookie: string): Promise<string> {
  const jeton = decodeURIComponent(cookie.slice(cookie.indexOf("=") + 1)).split(".")[0] ?? "";
  const [ligne] = await db.select({ id: session.id }).from(session).where(eq(session.token, jeton));
  if (!ligne) throw new Error("session introuvable");
  return ligne.id;
}

async function lire(reponse: Response) {
  return { statut: reponse.status, corps: (await reponse.json()) as Record<string, unknown> };
}

describe("UC-05 : sessions de l'utilisateur seulement (test 12)", () => {
  test("sessionsDe : les sessions non expirées de A, sans jeton, aucune de B", async () => {
    const a = await compte(3);
    const b = await compte(1);
    const lues = await sessionsDe(a.id);
    expect(lues).toHaveLength(3);
    for (const lue of lues) {
      expect(Object.keys(lue).sort()).toEqual(
        ["adresseIp", "expireLe", "id", "navigateur", "ouverteLe"].sort(),
      );
    }
    const idB = await idSession(b.cookies[0]!);
    expect(lues.map((l) => l.id)).not.toContain(idB);
    expect(JSON.stringify(lues)).not.toMatch(/token|jeton/iu);
  });

  test("fermer une session de A : supprimée, refusée ensuite ; la courante reste", async () => {
    const a = await compte(2);
    const [courante, autre] = a.cookies as [string, string];
    const id = await idSession(autre);
    expect(
      await lire(await banc.traiter(post("/revoke-session", { session: id }, courante))),
    ).toEqual({
      statut: 200,
      corps: { ok: true },
    });
    expect(await sessionLisible(autre)).toBe(false);
    expect(await sessionLisible(courante)).toBe(true);
    expect(await sessionsDe(a.id)).toHaveLength(1);
  });

  test("la session de B, un identifiant inexistant, la courante : même réponse, rien supprimé", async () => {
    const a = await compte(1);
    const b = await compte(1);
    const [courante] = a.cookies as [string];
    const corps = async (id: string) => {
      const recue = await banc.traiter(post("/revoke-session", { session: id }, courante));
      return { statut: recue.status, texte: await recue.text() };
    };
    const deB = await corps(await idSession(b.cookies[0]!));
    const inexistante = await corps("00000000-0000-4000-8000-000000000000");
    const sienne = await corps(await idSession(courante));
    expect(deB).toEqual(inexistante);
    expect(sienne).toEqual(inexistante);
    expect(await sessionLisible(b.cookies[0]!)).toBe(true);
    expect(await sessionLisible(courante)).toBe(true);
  });

  test("fermer les autres : seule la courante reste ; celles de B intactes", async () => {
    const a = await compte(3);
    const b = await compte(1);
    const [courante, ...autres] = a.cookies as [string, ...string[]];
    expect((await banc.traiter(post("/revoke-other-sessions", {}, courante))).status).toBe(200);
    expect(await sessionLisible(courante)).toBe(true);
    for (const cookie of autres) expect(await sessionLisible(cookie)).toBe(false);
    expect(await sessionLisible(b.cookies[0]!)).toBe(true);
  });
});

describe("changement du mot de passe depuis une session (test 13)", () => {
  test("succès : session remplacée, autres fermées, lien de réinitialisation supprimé, email", async () => {
    const a = await compte(2);
    const [courante, autre] = a.cookies as [string, string];
    await banc.traiter(post("/request-password-reset", { email: a.email }));
    await banc.envoyer();
    const enAttente = () =>
      db
        .select({ id: verification.id })
        .from(verification)
        .where(
          and(like(verification.identifier, "reinitialisation:%"), eq(verification.value, a.id)),
        );
    expect(await enAttente()).toHaveLength(1);
    const avant = banc.transport.messages.length;

    const reponse = await banc.traiter(
      post(
        "/change-password",
        { motDePasseActuel: MOT_DE_PASSE, nouveauMotDePasse: NOUVEAU },
        courante,
      ),
    );
    const neuve = paireSession(reponse);
    expect(reponse.status).toBe(200);
    expect(await reponse.text()).toBe(JSON.stringify({ ok: true }));
    expect(neuve).toBeDefined();
    expect(await sessionLisible(neuve!)).toBe(true);
    expect(await sessionLisible(courante)).toBe(false);
    expect(await sessionLisible(autre)).toBe(false);
    expect(await sessionsDe(a.id)).toHaveLength(1);
    expect(await enAttente()).toHaveLength(0);

    await banc.envoyer();
    const recus = banc.transport.messages.slice(avant).filter((m) => m.a === a.email);
    expect(recus.map((m) => m.sujet)).toEqual(["Votre mot de passe a été modifié"]);
    expect(recus[0]?.corps).toContain("depuis une session ouverte");

    const ancien = await banc.traiter(
      post("/sign-in/email", { email: a.email, motDePasse: MOT_DE_PASSE }),
    );
    expect(ancien.status).toBe(401);
    const nouveau = await banc.traiter(
      post("/sign-in/email", { email: a.email, motDePasse: NOUVEAU }),
    );
    expect(nouveau.status).toBe(200);
  });

  test("mot de passe actuel faux : rien changé ; 9e essai du jour : trop_de_requetes ; compteur sans valeur en clair", async () => {
    const a = await compte(1);
    const [courante] = a.cookies as [string];
    const [hachageAvant] = await db
      .select({ motDePasse: account.password })
      .from(account)
      .where(eq(account.userId, a.id));
    for (let i = 0; i < 8; i += 1) {
      const recue = await banc.traiter(
        post(
          "/change-password",
          { motDePasseActuel: `faux-mot-de-passe-${i}`, nouveauMotDePasse: NOUVEAU },
          courante,
        ),
      );
      expect((await lire(recue)).corps.raison).toBe("mot_de_passe_incorrect");
    }
    const neuvieme = await banc.traiter(
      post(
        "/change-password",
        { motDePasseActuel: MOT_DE_PASSE, nouveauMotDePasse: NOUVEAU },
        courante,
      ),
    );
    expect(await lire(neuvieme)).toEqual({
      statut: 429,
      corps: { ok: false, raison: "trop_de_requetes" },
    });
    const [hachageApres] = await db
      .select({ motDePasse: account.password })
      .from(account)
      .where(eq(account.userId, a.id));
    expect(hachageApres).toEqual(hachageAvant);
    expect(await sessionLisible(courante)).toBe(true);
    const cles = await db.select({ cle: compteurDebit.cle }).from(compteurDebit);
    expect(JSON.stringify(cles)).not.toContain(a.id);
  }, 120_000);

  test("sans session : connexion_requise, rien changé", async () => {
    const recue = await banc.traiter(
      post("/change-password", { motDePasseActuel: MOT_DE_PASSE, nouveauMotDePasse: NOUVEAU }),
    );
    expect(await lire(recue)).toEqual({
      statut: 401,
      corps: { ok: false, raison: "connexion_requise" },
    });
  });
});

describe("correction du nom (test 14)", () => {
  test("écrit pour A seulement, B inchangé", async () => {
    const a = await compte(1);
    const b = await compte(1);
    expect(
      (await banc.traiter(post("/update-user", { nom: "  Awa Koné  " }, a.cookies[0]))).status,
    ).toBe(200);
    expect(await lireProfil(a.id)).toEqual({ nom: "Awa Koné", email: a.email });
    expect(await lireProfil(b.id)).toEqual({ nom: "Tiers", email: b.email });
  });
});

// 2.1, report de la 1.5 : la session neuve reprend l'organisation active de
// la session remplacée, adhésion relue (docs/features/organisations.md,
// section 5).
describe("changement du mot de passe : organisation active reprise (2.1)", () => {
  test("membre de A, organisation active A : la session neuve garde A", async () => {
    const orgs = await creerDeuxOrganisations({ tables: [] });
    try {
      const a = await compte(1);
      const [courante] = a.cookies as [string];
      await db
        .insert(member)
        .values({ organizationId: orgs.a, userId: a.id, role: "lecteur", createdAt: new Date() });
      await db
        .update(session)
        .set({ activeOrganizationId: orgs.a })
        .where(eq(session.userId, a.id));

      const reponse = await banc.traiter(
        post(
          "/change-password",
          { motDePasseActuel: MOT_DE_PASSE, nouveauMotDePasse: NOUVEAU },
          courante,
        ),
      );
      expect(reponse.status).toBe(200);
      const lignes = await db
        .select({ active: session.activeOrganizationId })
        .from(session)
        .where(eq(session.userId, a.id));
      expect(lignes).toEqual([{ active: orgs.a }]);
    } finally {
      await orgs.nettoyer();
    }
  });
});
