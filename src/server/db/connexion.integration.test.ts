import { randomInt } from "node:crypto";

import { eq, sql } from "drizzle-orm";
import { afterAll, afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { env } from "../env";

import { db } from "./client";
import { bancInscription } from "./outils-test/inscription";
import { session } from "./schema/auth";

// UC-02 avec la vraie base, par notre gestionnaire et l'instance de Better
// Auth aux options de l'application : connexion, échecs indiscernables
// (T-07), limite par compte (T-01), session sans prolongation, déconnexion
// vérifiée en base (T-03). Transport en mémoire, Have I Been Pwned simulé.
// Fiche : docs/features/connexion.md, tests 15 à 17.

const banc = bancInscription({ adresses: 12 });
const ORIGINE = new URL(env.BETTER_AUTH_URL).origin;
const MOT_DE_PASSE = "une-phrase-de-passe-solide";

afterAll(() => banc.nettoyer());

// Adresse IP propre à chaque requête, sauf demande contraire : seule la
// limite par compte est alors en jeu.
function ip(): string {
  return `198.51.100.${randomInt(1, 255)}`;
}

function post(
  chemin: string,
  corps: unknown,
  options: { cookie?: string; adresseIp?: string } = {},
): Request {
  const entetes: Record<string, string> = {
    "content-type": "application/json",
    origin: ORIGINE,
    "x-forwarded-for": options.adresseIp ?? ip(),
  };
  if (options.cookie) entetes.cookie = options.cookie;
  return new Request(`${ORIGINE}/api/auth${chemin}`, {
    method: "POST",
    headers: entetes,
    body: JSON.stringify(corps),
  });
}

function jetonRecu(email: string): string {
  const message = [...banc.transport.messages].reverse().find((m) => m.a === email);
  const trouve = message?.corps.match(/\/lien\/verification#([A-Za-z0-9_.-]+)/u);
  if (!trouve?.[1]) throw new Error("aucun lien de vérification reçu");
  return trouve[1];
}

// « nom=valeur » du cookie de session posé par une réponse.
function cookieSession(reponse: Response): string | undefined {
  const brut = reponse.headers.getSetCookie().find((c) => /session_token=[^;]/u.test(c));
  return brut?.split(";")[0];
}

function entetesCookie(cookie: string): Headers {
  return new Headers({ cookie });
}

// Compte inscrit ; vérifié par le lien reçu si demandé (la vérification ouvre
// une première session, dont le cookie est rendu).
async function compte(options: { verifie: boolean }) {
  const email = banc.adresse();
  await banc.traiter(post("/sign-up/email", { nom: "Awa Koné", email, motDePasse: MOT_DE_PASSE }));
  await banc.envoyer();
  let cookieVerification: string | undefined;
  if (options.verifie) {
    const reponse = await banc.traiter(post("/verify-email", { jeton: jetonRecu(email) }));
    cookieVerification = cookieSession(reponse);
  }
  return { email, cookieVerification };
}

function connecter(email: string, motDePasse = MOT_DE_PASSE, adresseIp?: string) {
  return banc.traiter(
    post("/sign-in/email", { email, motDePasse }, adresseIp ? { adresseIp } : {}),
  );
}

async function forme(reponse: Response) {
  return {
    statut: reponse.status,
    entetes: [...reponse.headers.entries()],
    corps: await reponse.text(),
  };
}

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

describe("échecs indiscernables (T-07)", () => {
  test("adresse inconnue, mauvais mot de passe, compte non vérifié : même réponse, 800 ms au moins, aucun email", async () => {
    const verifie = await compte({ verifie: true });
    const nonVerifie = await compte({ verifie: false });
    const inconnue = `personne-${randomInt(1_000_000)}@exemple.test`;
    await banc.envoyer();
    const emails = banc.transport.messages.length;

    const formes = [];
    for (const [email, motDePasse] of [
      [inconnue, MOT_DE_PASSE],
      [verifie.email, "un-mauvais-mot-de-passe"],
      [nonVerifie.email, MOT_DE_PASSE],
    ] as const) {
      const debut = performance.now();
      const reponse = await connecter(email, motDePasse);
      expect(performance.now() - debut, email).toBeGreaterThanOrEqual(790);
      formes.push(await forme(reponse));
    }

    expect(formes[0]).toEqual({
      statut: 401,
      entetes: [
        ["cache-control", "no-store"],
        ["content-type", "application/json; charset=utf-8"],
      ],
      corps: JSON.stringify({ ok: false, raison: "identifiants_incorrects" }),
    });
    expect(formes[1]).toEqual(formes[0]);
    expect(formes[2]).toEqual(formes[0]);

    await banc.envoyer();
    expect(banc.transport.messages.length).toBe(emails);
  });
});

describe("connexion et déconnexion (UC-02, T-03)", () => {
  test("connexion : session lisible, nouveau jeton ; déconnexion : ancien cookie refusé, ligne supprimée", async () => {
    const { email, cookieVerification } = await compte({ verifie: true });
    expect(cookieVerification).toBeDefined();

    const reponse = await connecter(email);
    expect(reponse.status).toBe(200);
    const texte = await reponse.text();
    expect(texte).toBe(JSON.stringify({ ok: true }));
    const cookie = cookieSession(reponse);
    if (!cookie) throw new Error("aucun cookie de session");
    // Le corps ne porte pas le jeton (S-82).
    expect(texte).not.toContain(cookie.split("=")[1]?.split(".")[0] ?? "jamais");

    const lue = await banc.lireSession(entetesCookie(cookie));
    expect(lue).not.toBeNull();
    // Nouvelle session, nouveau jeton (fixation de session, T-03).
    expect(cookie).not.toBe(cookieVerification);

    const sortie = await banc.traiter(post("/sign-out", {}, { cookie }));
    expect(sortie.status).toBe(200);
    expect(await sortie.json()).toEqual({ ok: true });
    expect(await banc.lireSession(entetesCookie(cookie))).toBeNull();
    const restantes = await db
      .select()
      .from(session)
      .where(eq(session.token, lue?.jeton ?? ""));
    expect(restantes).toEqual([]);
  });

  test("cookie de connexion : HttpOnly, SameSite=Lax, Max-Age de 7 jours", async () => {
    const { email } = await compte({ verifie: true });
    const reponse = await connecter(email);
    const brut = reponse.headers.getSetCookie().find((c) => c.includes("session_token="));
    expect(brut).toMatch(/HttpOnly/iu);
    expect(brut).toMatch(/SameSite=Lax/iu);
    expect(brut).toMatch(/Max-Age=604800/iu);
  });

  test("déconnexion sans cookie : { ok: true }", async () => {
    const reponse = await banc.traiter(post("/sign-out", {}));
    expect(reponse.status).toBe(200);
    expect(await reponse.json()).toEqual({ ok: true });
  });
});

describe("limite par compte (T-01, T-43)", () => {
  test("5 tentatives depuis 5 adresses IP : la sixième refusée, même avec le bon mot de passe", async () => {
    const { email } = await compte({ verifie: true });
    for (let i = 1; i <= 5; i += 1) {
      const reponse = await connecter(email, "un-mauvais-mot-de-passe", `203.0.113.${i}`);
      expect(reponse.status, `tentative ${i}`).toBe(401);
    }
    const sixieme = await connecter(email, MOT_DE_PASSE, "203.0.113.6");
    expect(sixieme.status).toBe(429);
    expect(await sixieme.json()).toEqual({ ok: false, raison: "trop_de_requetes" });
    expect(cookieSession(sixieme)).toBeUndefined();
  });

  test("adresse inconnue : même limite, même réponse (le blocage ne dit pas si le compte existe)", async () => {
    const inconnue = `personne-${randomInt(1_000_000)}@exemple.test`;
    for (let i = 1; i <= 5; i += 1) {
      expect((await connecter(inconnue, MOT_DE_PASSE, `203.0.113.${10 + i}`)).status).toBe(401);
    }
    const sixieme = await connecter(inconnue, MOT_DE_PASSE, "203.0.113.16");
    expect(sixieme.status).toBe(429);
  });

  test("aucune adresse email ni IP en clair dans compteur_debit", async () => {
    const { email } = await compte({ verifie: true });
    await connecter(email, MOT_DE_PASSE, "203.0.113.77");
    const lignes = await db.execute(
      sql`SELECT cle FROM compteur_debit WHERE cle LIKE 'auth.connexion%' AND (cle LIKE ${`%${email}%`} OR cle LIKE '%203.0.113.77%')`,
    );
    expect(lignes.rows).toEqual([]);
    const comptees = await db.execute(
      sql`SELECT count(*)::int AS n FROM compteur_debit WHERE cle LIKE 'auth.connexion_compte:%'`,
    );
    expect((comptees.rows[0] as { n: number }).n).toBeGreaterThan(0);
  });
});

describe("session sans prolongation (décision 3)", () => {
  test("lue alors qu'une prolongation serait due : expires_at inchangé", async () => {
    const { email } = await compte({ verifie: true });
    const reponse = await connecter(email);
    const cookie = cookieSession(reponse);
    if (!cookie) throw new Error("aucun cookie de session");
    const lue = await banc.lireSession(entetesCookie(cookie));
    if (!lue) throw new Error("session illisible");

    // Échéance reculée de deux jours : avec la prolongation par défaut (un
    // jour), la lecture suivante la repousserait à 7 jours.
    await db
      .update(session)
      .set({ expiresAt: sql`${session.expiresAt} - interval '2 days'` })
      .where(eq(session.token, lue.jeton));
    const [avant] = await db.select().from(session).where(eq(session.token, lue.jeton));

    expect(await banc.lireSession(entetesCookie(cookie))).not.toBeNull();

    const [apres] = await db.select().from(session).where(eq(session.token, lue.jeton));
    expect(apres?.expiresAt.getTime()).toBe(avant?.expiresAt.getTime());
  });
});

// Correctif de la 1.2 : une nouvelle connexion réussie depuis un navigateur
// déjà connecté révoque l'ancienne session en base. Fiche :
// docs/features/connexion.md, section 4.3.
describe("reconnexion : l'ancienne session est révoquée", () => {
  test("connexion avec un cookie valide : ancienne session supprimée, nouvelle lisible", async () => {
    const { email } = await compte({ verifie: true });
    const ancien = cookieSession(await connecter(email));
    if (!ancien) throw new Error("aucun cookie de session");
    const lue = await banc.lireSession(entetesCookie(ancien));
    if (!lue) throw new Error("session illisible");

    const reponse = await banc.traiter(
      post("/sign-in/email", { email, motDePasse: MOT_DE_PASSE }, { cookie: ancien }),
    );
    expect(reponse.status).toBe(200);
    const nouveau = cookieSession(reponse);
    if (!nouveau) throw new Error("aucun nouveau cookie");

    expect(nouveau).not.toBe(ancien);
    expect(await banc.lireSession(entetesCookie(ancien))).toBeNull();
    expect(await db.select().from(session).where(eq(session.token, lue.jeton))).toEqual([]);
    expect(await banc.lireSession(entetesCookie(nouveau))).not.toBeNull();
  });

  test("connexion échouée avec un cookie valide : l'ancienne session reste", async () => {
    const { email } = await compte({ verifie: true });
    const ancien = cookieSession(await connecter(email));
    if (!ancien) throw new Error("aucun cookie de session");

    const reponse = await banc.traiter(
      post("/sign-in/email", { email, motDePasse: "un-mauvais-mot-de-passe" }, { cookie: ancien }),
    );
    expect(reponse.status).toBe(401);
    expect(await banc.lireSession(entetesCookie(ancien))).not.toBeNull();
  });
});

// Report de la 1.2 (docs/features/connexion.md, « Limites connues »), traité
// en 1.3 : la vérification d'une seconde adresse depuis un navigateur
// connecté révoque la session précédente. Fiche :
// docs/features/mot-de-passe.md, section 8, test 21.
describe("vérification depuis un navigateur connecté (1.3)", () => {
  test("l'ancienne session est supprimée en base, la nouvelle est lisible", async () => {
    const premier = await compte({ verifie: true });
    const ancien = premier.cookieVerification;
    if (!ancien) throw new Error("aucun cookie de session");
    const lue = await banc.lireSession(entetesCookie(ancien));
    if (!lue) throw new Error("session illisible");

    const second = await compte({ verifie: false });
    const reponse = await banc.traiter(
      post("/verify-email", { jeton: jetonRecu(second.email) }, { cookie: ancien }),
    );
    expect(reponse.status).toBe(200);
    const nouveau = cookieSession(reponse);
    if (!nouveau) throw new Error("aucun nouveau cookie");

    expect(await banc.lireSession(entetesCookie(ancien))).toBeNull();
    expect(await db.select().from(session).where(eq(session.token, lue.jeton))).toEqual([]);
    expect(await banc.lireSession(entetesCookie(nouveau))).not.toBeNull();
  });
});
