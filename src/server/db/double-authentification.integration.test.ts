import { randomInt, randomUUID } from "node:crypto";

import { and, eq, inArray, like } from "drizzle-orm";
import { afterAll, afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { codeHotp, trancheCourante } from "../auth/tranche-totp";
import { env } from "../env";

import { db } from "./client";
import { bancInscription } from "./outils-test/inscription";
import { creerDeuxOrganisations } from "./outils-test/organisations";
import { member, session, twoFactor, user, verification } from "./schema/auth";
import { compteurDebit } from "./schema/technique";

// UC-04 et l'étape du code d'UC-02 avec la vraie base, par notre gestionnaire
// et l'instance de Better Auth aux options de l'application : activation,
// connexion par code et par code de secours, anti-rejeu (décision 4),
// limite par compte (décision 3), gestion, rôle exigeant, sessions, emails,
// et T-04 (report de la 1.3). Transport en mémoire, Have I Been Pwned simulé.
// L'horloge de JavaScript seule est avancée de 30 secondes entre deux codes
// (tranches de temps) ; la base garde la sienne. Fiche :
// docs/features/double-authentification.md, tests 19 à 25.

const banc = bancInscription({ adresses: 24 });
const ORIGINE = new URL(env.BETTER_AUTH_URL).origin;
const MOT_DE_PASSE = "une-phrase-de-passe-solide";

afterAll(() => banc.nettoyer());

function ip(): string {
  return `198.51.100.${randomInt(1, 255)}`;
}

function post(chemin: string, corps: unknown, cookie?: string, adresseIp = ip()): Request {
  const entetes: Record<string, string> = {
    "content-type": "application/json",
    origin: ORIGINE,
    "x-forwarded-for": adresseIp,
  };
  if (cookie) entetes.cookie = cookie;
  return new Request(`${ORIGINE}/api/auth${chemin}`, {
    method: "POST",
    headers: entetes,
    body: JSON.stringify(corps),
  });
}

function paire(reponse: Response, motif: RegExp): string | undefined {
  return reponse.headers
    .getSetCookie()
    .find((c) => motif.test(c))
    ?.split(";")[0];
}
const SESSION = /session_token=[^;]/u;
const ATTENTE = /two_factor=[^;]/u;

function base32(texte: string): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const caractere of texte.replaceAll(" ", "")) {
    bits += alphabet.indexOf(caractere).toString(2).padStart(5, "0");
  }
  const octets: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8)
    octets.push(Number.parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(octets).toString("utf8");
}

let decalage = 0;
// Passe à la tranche de 30 secondes suivante (horloge de JavaScript seule).
function trancheSuivante(): void {
  decalage += 30_000;
  vi.setSystemTime(Date.now() + 30_000);
}

function code(secret: string, ecart = 0): string {
  return codeHotp(secret, trancheCourante(Date.now()) + ecart);
}

function jetonVerification(email: string): string {
  const message = [...banc.transport.messages].reverse().find((m) => m.a === email);
  const trouve = message?.corps.match(/\/lien\/verification#([A-Za-z0-9_.-]+)/u);
  if (!trouve?.[1]) throw new Error("aucun lien de vérification reçu");
  return trouve[1];
}

// Compte vérifié ; la vérification ouvre une session, dont le cookie est rendu.
async function compteVerifie() {
  const email = banc.adresse();
  await banc.traiter(post("/sign-up/email", { nom: "Awa Koné", email, motDePasse: MOT_DE_PASSE }));
  await banc.envoyer();
  const reponse = await banc.traiter(post("/verify-email", { jeton: jetonVerification(email) }));
  const cookie = paire(reponse, SESSION);
  if (!cookie) throw new Error("aucune session ouverte par la vérification");
  const [ligne] = await db.select({ id: user.id }).from(user).where(eq(user.email, email));
  return { email, cookie, id: ligne?.id ?? "" };
}

type Active = Awaited<ReturnType<typeof compteVerifie>> & {
  secret: string;
  cle: string;
  codes: string[];
};

async function activer(compte?: Awaited<ReturnType<typeof compteVerifie>>): Promise<Active> {
  const c = compte ?? (await compteVerifie());
  const activation = await banc.traiter(
    post("/two-factor/enable", { motDePasse: MOT_DE_PASSE }, c.cookie),
  );
  const lu = (await activation.json()) as { ok: boolean; cle: string; codes: string[] };
  expect(lu.ok).toBe(true);
  const secret = base32(lu.cle);
  const confirmation = await banc.traiter(
    post("/two-factor/confirm-enable", { code: code(secret) }, c.cookie),
  );
  expect(confirmation.status).toBe(200);
  const cookie = paire(confirmation, SESSION) ?? c.cookie;
  trancheSuivante();
  return { ...c, cookie, secret, cle: lu.cle, codes: lu.codes };
}

async function demanderCode(email: string): Promise<string> {
  const reponse = await banc.traiter(post("/sign-in/email", { email, motDePasse: MOT_DE_PASSE }));
  expect(await reponse.json()).toEqual({ ok: true, etape: "code" });
  const cookie = paire(reponse, ATTENTE);
  if (!cookie) throw new Error("aucun cookie d'attente");
  return cookie;
}

async function sessions(id: string) {
  return db.select({ token: session.token }).from(session).where(eq(session.userId, id));
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(Date.now() + decalage);
  vi.stubGlobal("fetch", async (entree: string | URL | Request) => {
    const url = new URL(entree instanceof Request ? entree.url : entree);
    if (url.hostname !== "api.pwnedpasswords.com") throw new Error("appel inattendu");
    return new Response("0000000000000000000000000000000000A:1\r\n");
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("activation (UC-04)", () => {
  test("complète : ligne vérifiée, second facteur actif ; ni secret ni code en clair en base ; autres sessions fermées ; email", async () => {
    const c = await compteVerifie();
    // Deux autres sessions, ouvertes avant l'activation.
    for (let i = 0; i < 2; i++) {
      await banc.traiter(post("/sign-in/email", { email: c.email, motDePasse: MOT_DE_PASSE }));
    }
    expect((await sessions(c.id)).length).toBe(3);

    const actif = await activer(c);
    const [ligne] = await db.select().from(twoFactor).where(eq(twoFactor.userId, c.id));
    expect(ligne?.verified).toBe(true);
    const [u] = await db
      .select({ actif: user.twoFactorEnabled })
      .from(user)
      .where(eq(user.id, c.id));
    expect(u?.actif).toBe(true);

    const restantes = await sessions(c.id);
    expect(restantes).toHaveLength(1);
    expect(await banc.lireSession(new Headers({ cookie: actif.cookie }))).not.toBeNull();

    const tout = JSON.stringify([
      await db.select().from(twoFactor).where(eq(twoFactor.userId, c.id)),
      await db.select().from(verification),
      await db.select().from(compteurDebit),
    ]);
    expect(tout).not.toContain(actif.secret);
    expect(tout).not.toContain(actif.cle.replaceAll(" ", ""));
    for (const codeSecours of actif.codes) expect(tout).not.toContain(codeSecours);

    await banc.envoyer();
    expect(
      banc.transport.messages.some(
        (m) => m.a === c.email && m.sujet === "Double authentification activée",
      ),
    ).toBe(true);
  });

  test("code faux : rien n'est activé", async () => {
    const c = await compteVerifie();
    const activation = await banc.traiter(
      post("/two-factor/enable", { motDePasse: MOT_DE_PASSE }, c.cookie),
    );
    const { cle } = (await activation.json()) as { cle: string };
    const juste = code(base32(cle));
    const faux = juste === "000000" ? "000001" : "000000";
    const reponse = await banc.traiter(
      post("/two-factor/confirm-enable", { code: faux }, c.cookie),
    );
    expect(await reponse.json()).toEqual({ ok: false, raison: "code_incorrect" });
    const [u] = await db
      .select({ actif: user.twoFactorEnabled })
      .from(user)
      .where(eq(user.id, c.id));
    expect(u?.actif).toBe(false);
  });
});

describe("connexion à deux étapes (UC-02, 3a et 3b)", () => {
  test("étape 1 sans session ; code juste : session ; même code ensuite, ou tranche plus ancienne : refusés (décision 4)", async () => {
    const actif = await activer();
    const avant = (await sessions(actif.id)).length;
    const attente = await demanderCode(actif.email);
    expect((await sessions(actif.id)).length).toBe(avant);

    const juste = code(actif.secret);
    const reponse = await banc.traiter(post("/two-factor/verify-totp", { code: juste }, attente));
    expect(reponse.status).toBe(200);
    const cookie = paire(reponse, SESSION);
    expect(await banc.lireSession(new Headers({ cookie: cookie ?? "" }))).not.toBeNull();

    const autre = await demanderCode(actif.email);
    expect(
      await (await banc.traiter(post("/two-factor/verify-totp", { code: juste }, autre))).json(),
    ).toEqual({
      ok: false,
      raison: "code_incorrect",
    });
    const encore = await demanderCode(actif.email);
    const precedent = code(actif.secret, -1);
    expect(
      await (
        await banc.traiter(post("/two-factor/verify-totp", { code: precedent }, encore))
      ).json(),
    ).toEqual({
      ok: false,
      raison: "code_incorrect",
    });
  });

  test("cinq codes faux puis le bon, sur une même attente : connexion_expiree", async () => {
    const actif = await activer();
    const attente = await demanderCode(actif.email);
    const juste = code(actif.secret);
    const faux = juste === "000000" ? "000001" : "000000";
    for (let i = 0; i < 5; i++) {
      await banc.traiter(post("/two-factor/verify-totp", { code: faux }, attente));
    }
    expect(
      await (await banc.traiter(post("/two-factor/verify-totp", { code: juste }, attente))).json(),
    ).toEqual({
      ok: false,
      raison: "connexion_expiree",
    });
  });

  test("code de secours : accepté une fois, refusé ensuite ; notification", async () => {
    const actif = await activer();
    const [premier] = actif.codes;
    const a = await demanderCode(actif.email);
    expect(
      (await banc.traiter(post("/two-factor/verify-backup-code", { code: premier }, a))).status,
    ).toBe(200);
    const b = await demanderCode(actif.email);
    expect(
      await (
        await banc.traiter(post("/two-factor/verify-backup-code", { code: premier }, b))
      ).json(),
    ).toEqual({
      ok: false,
      raison: "code_incorrect",
    });
    await banc.envoyer();
    expect(
      banc.transport.messages.some(
        (m) => m.a === actif.email && m.sujet === "Code de secours utilisé",
      ),
    ).toBe(true);
  });

  test("concurrence : deux usages simultanés d'un même code, sur deux attentes, donnent une seule session", async () => {
    const actif = await activer();
    for (const [chemin, valeur] of [
      ["/two-factor/verify-backup-code", actif.codes[1] ?? ""],
      ["/two-factor/verify-totp", code(actif.secret)],
    ] as const) {
      const a = await demanderCode(actif.email);
      const b = await demanderCode(actif.email);
      const reponses = await Promise.all([
        banc.traiter(post(chemin, { code: valeur }, a)),
        banc.traiter(post(chemin, { code: valeur }, b)),
      ]);
      expect(reponses.map((r) => r.status).sort(), chemin).toEqual([200, 400]);
      trancheSuivante();
    }
  });
});

describe("limite par compte (décision 3)", () => {
  // Délai de 180 s : 21 essais et 5 connexions, chacun avec plusieurs
  // allers-retours vers Neon (dev), et 800 ms de plancher par connexion.
  test("le 21e code en 24 heures, depuis des adresses IP différentes : trop_de_requetes et alerte ; aucune valeur en clair", async () => {
    const actif = await activer();
    const juste = code(actif.secret);
    const faux = juste === "000000" ? "000001" : "000000";
    let essais = 0;
    while (essais < 20) {
      const attente = await demanderCode(actif.email);
      for (let i = 0; i < 5 && essais < 20; i++, essais++) {
        await banc.traiter(post("/two-factor/verify-totp", { code: faux }, attente));
      }
    }
    const attente = await demanderCode(actif.email);
    const reponse = await banc.traiter(post("/two-factor/verify-totp", { code: juste }, attente));
    expect(reponse.status).toBe(429);
    expect(await reponse.json()).toEqual({ ok: false, raison: "trop_de_requetes" });
    await banc.envoyer();
    expect(
      banc.transport.messages.some(
        (m) => m.a === actif.email && m.sujet === "Codes de vérification refusés",
      ),
    ).toBe(true);
    const cles = await db
      .select({ cle: compteurDebit.cle })
      .from(compteurDebit)
      .where(like(compteurDebit.cle, "auth.double_auth_compte:%"));
    expect(cles.length).toBeGreaterThan(0);
    expect(JSON.stringify(cles)).not.toContain(actif.id);
  }, 180_000);
});

describe("gestion (UC-04, section 5)", () => {
  test("nouveaux codes : exigent mot de passe et code ; les anciens refusés ensuite", async () => {
    const actif = await activer();
    const reponse = await banc.traiter(
      post(
        "/two-factor/generate-backup-codes",
        { motDePasse: MOT_DE_PASSE, code: code(actif.secret) },
        actif.cookie,
      ),
    );
    const { codes } = (await reponse.json()) as { codes: string[] };
    expect(codes).toHaveLength(10);
    const attente = await demanderCode(actif.email);
    expect(
      await (
        await banc.traiter(
          post("/two-factor/verify-backup-code", { code: actif.codes[2] }, attente),
        )
      ).json(),
    ).toEqual({
      ok: false,
      raison: "code_incorrect",
    });
    expect(
      (await banc.traiter(post("/two-factor/verify-backup-code", { code: codes[0] }, attente)))
        .status,
    ).toBe(200);
  });

  test("mauvais mot de passe : mot_de_passe_incorrect, le code de secours sert encore ensuite", async () => {
    const actif = await activer();
    const reponse = await banc.traiter(
      post(
        "/two-factor/disable",
        { motDePasse: "un-mauvais-mot-de-passe", code: actif.codes[3] },
        actif.cookie,
      ),
    );
    expect(await reponse.json()).toEqual({ ok: false, raison: "mot_de_passe_incorrect" });
    const attente = await demanderCode(actif.email);
    expect(
      (
        await banc.traiter(
          post("/two-factor/verify-backup-code", { code: actif.codes[3] }, attente),
        )
      ).status,
    ).toBe(200);
  });

  test("remplacement : second facteur actif tout du long ; ancien secret refusé dès l'étape 3 ; nouvelle application acceptée", async () => {
    const actif = await activer();
    const etape3 = await banc.traiter(
      post("/two-factor/replace", { motDePasse: MOT_DE_PASSE, code: actif.codes[4] }, actif.cookie),
    );
    const nouveau = (await etape3.json()) as { ok: boolean; cle: string; codes: string[] };
    expect(nouveau.ok).toBe(true);
    const actifEnBase = async () =>
      (await db.select({ a: user.twoFactorEnabled }).from(user).where(eq(user.id, actif.id)))[0]?.a;
    expect(await actifEnBase()).toBe(true);

    trancheSuivante();
    const attente = await demanderCode(actif.email);
    expect(
      await (
        await banc.traiter(post("/two-factor/verify-totp", { code: code(actif.secret) }, attente))
      ).json(),
    ).toEqual({
      ok: false,
      raison: "code_incorrect",
    });

    const secret = base32(nouveau.cle);
    expect(
      (await banc.traiter(post("/two-factor/confirm-enable", { code: code(secret) }, actif.cookie)))
        .status,
    ).toBe(200);
    expect(await actifEnBase()).toBe(true);
    trancheSuivante();
    const suivante = await demanderCode(actif.email);
    expect(
      (await banc.traiter(post("/two-factor/verify-totp", { code: code(secret) }, suivante)))
        .status,
    ).toBe(200);
    await banc.envoyer();
    expect(
      banc.transport.messages.some(
        (m) => m.a === actif.email && m.sujet === "Application d'authentification remplacée",
      ),
    ).toBe(true);
  });

  test("désactivation : ligne supprimée, autres sessions supprimées ; la connexion ne demande plus de code", async () => {
    const actif = await activer();
    const autre = await demanderCode(actif.email);
    await banc.traiter(post("/two-factor/verify-backup-code", { code: actif.codes[5] }, autre));
    expect((await sessions(actif.id)).length).toBe(2);
    const reponse = await banc.traiter(
      post(
        "/two-factor/disable",
        { motDePasse: MOT_DE_PASSE, code: code(actif.secret) },
        actif.cookie,
      ),
    );
    expect(reponse.status).toBe(200);
    expect(await db.select().from(twoFactor).where(eq(twoFactor.userId, actif.id))).toEqual([]);
    expect((await sessions(actif.id)).length).toBe(1);
    const connexion = await banc.traiter(
      post("/sign-in/email", { email: actif.email, motDePasse: MOT_DE_PASSE }),
    );
    expect(await connexion.json()).toEqual({ ok: true });
  });
});

describe("rôle exigeant : désactivation impossible (section 7.3)", () => {
  test("Propriétaire de A, Comptable de B : refusée ; Commercial : acceptée ; seules les adhésions de l'utilisateur comptent", async () => {
    const organisations = await creerDeuxOrganisations({ tables: [] });
    try {
      const proprietaire = await activer();
      const comptable = await activer();
      const commercial = await activer();
      await db.insert(member).values([
        {
          organizationId: organisations.a,
          userId: proprietaire.id,
          role: "proprietaire",
          createdAt: new Date(),
        },
        {
          organizationId: organisations.b,
          userId: comptable.id,
          role: "comptable",
          createdAt: new Date(),
        },
        {
          organizationId: organisations.a,
          userId: commercial.id,
          role: "commercial",
          createdAt: new Date(),
        },
      ]);
      for (const compte of [proprietaire, comptable]) {
        const reponse = await banc.traiter(
          post(
            "/two-factor/disable",
            { motDePasse: MOT_DE_PASSE, code: code(compte.secret) },
            compte.cookie,
          ),
        );
        expect(reponse.status).toBe(403);
        expect(await reponse.json()).toEqual({
          ok: false,
          raison: "double_authentification_obligatoire",
        });
      }
      const reponse = await banc.traiter(
        post(
          "/two-factor/disable",
          { motDePasse: MOT_DE_PASSE, code: code(commercial.secret) },
          commercial.cookie,
        ),
      );
      expect(reponse.status).toBe(200);
    } finally {
      await db
        .delete(member)
        .where(inArray(member.organizationId, [organisations.a, organisations.b]));
      await organisations.nettoyer();
    }
  });
});

describe("T-04 (report de la 1.3) : la réinitialisation ne contourne pas le second facteur", () => {
  test("après une réinitialisation réussie, la connexion demande toujours le code", async () => {
    const actif = await activer();
    await banc.traiter(post("/request-password-reset", { email: actif.email }));
    await banc.envoyer();
    const message = [...banc.transport.messages].reverse().find((m) => m.a === actif.email);
    const jeton = message?.corps.match(/\/lien\/reinitialisation#([A-Za-z0-9]{24})/u)?.[1];
    expect(jeton).toBeDefined();
    const nouveau = "une-autre-phrase-de-passe-neuve";
    expect(
      (await banc.traiter(post("/reset-password", { jeton, motDePasse: nouveau }))).status,
    ).toBe(200);
    const connexion = await banc.traiter(
      post("/sign-in/email", { email: actif.email, motDePasse: nouveau }),
    );
    expect(await connexion.json()).toEqual({ ok: true, etape: "code" });
    expect(paire(connexion, SESSION)).toBeUndefined();
    expect(await sessions(actif.id)).toEqual([]);
  });
});

describe("requêtes de db/double-authentification.ts et db/sessions.ts", () => {
  test("revoquerAutresSessions ne touche que l'utilisateur visé, et garde le jeton donné", async () => {
    const { revoquerAutresSessions } = await import("./sessions");
    const a = await compteVerifie();
    const b = await compteVerifie();
    await banc.traiter(post("/sign-in/email", { email: a.email, motDePasse: MOT_DE_PASSE }));
    const garde = (await banc.lireSession(new Headers({ cookie: a.cookie })))?.jeton ?? "";
    await revoquerAutresSessions(a.id, garde);
    expect((await sessions(a.id)).map((s) => s.token)).toEqual([garde]);
    expect((await sessions(b.id)).length).toBe(1);
  });

  test("état, codes restants, préparation du remplacement, adresse : sur l'utilisateur visé seulement", async () => {
    const lectures = await import("./double-authentification");
    const actif = await activer();
    const autre = await compteVerifie();
    expect(await lectures.etatDoubleAuth(actif.id)).toEqual({ ligne: "active", codesRestants: 10 });
    expect(await lectures.etatDoubleAuth(autre.id)).toEqual({ ligne: "aucune", codesRestants: 0 });
    await lectures.preparerRemplacement(actif.id);
    expect((await lectures.etatDoubleAuth(actif.id)).ligne).toBe("a_confirmer");
    expect(await lectures.adresseUtilisateur(actif.id)).toBe(actif.email);
    expect(await lectures.adresseUtilisateur(randomUUID())).toBeNull();
  });

  test("reserverTranche : une tranche réservée une fois ; deux réservations simultanées, une seule réussit ; une tranche plus ancienne refusée", async () => {
    const lectures = await import("./double-authentification");
    const actif = await activer();
    const t = trancheCourante(Date.now()) + 100;
    const simultanees = await Promise.all([
      lectures.reserverTranche(actif.id, t),
      lectures.reserverTranche(actif.id, t),
    ]);
    expect(simultanees.sort()).toEqual([false, true]);
    expect(await lectures.reserverTranche(actif.id, t - 1)).toBe(false);
    expect(await lectures.reserverTranche(actif.id, t + 1)).toBe(true);
    const lignes = await db
      .select()
      .from(verification)
      .where(and(eq(verification.identifier, `double-auth-tranche:${actif.id}`)));
    expect(lignes).toHaveLength(1);
    expect(lignes[0]?.value).toBe(String(t + 1));
  });
});
