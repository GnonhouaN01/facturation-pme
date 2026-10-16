import { createHash, randomInt, randomUUID } from "node:crypto";

import { and, eq, inArray, like, sql } from "drizzle-orm";
import { afterAll, afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { env } from "../env";

import { db } from "./client";
import { bancInscription } from "./outils-test/inscription";
import { marquerAdresseVerifiee, supprimerJetonsReinitialisation } from "./reinitialisation";
import { compteurDebit } from "./schema/technique";
import { session, user, verification } from "./schema/auth";

// UC-03 avec la vraie base, par notre gestionnaire et l'instance de Better
// Auth aux options de l'application : demande indiscernable (T-07), jeton
// haché (S-15), usage unique, autres jetons supprimés, sessions fermées
// (S-17), compte non vérifié marqué vérifié (décision B), contrôles avant la
// consommation, concurrence, limites. Transport en mémoire, Have I Been
// Pwned simulé. Dans src/server/db/ : seul dossier dont les tests importent
// db. Fiche : docs/features/mot-de-passe.md, tests 18 à 20 et 22.

const banc = bancInscription({ adresses: 24 });
const ORIGINE = new URL(env.BETTER_AUTH_URL).origin;
const MOT_DE_PASSE = "une-phrase-de-passe-solide";
const NOUVEAU = "une-phrase-de-passe-neuve-2026";
const COMPROMIS = "mot-de-passe-compromis-2026";

// Lignes de verification créées à la main par ce fichier (fonctions de base).
const lignesCreees: string[] = [];

afterAll(async () => {
  try {
    if (lignesCreees.length > 0) {
      await db.delete(verification).where(inArray(verification.id, lignesCreees));
    }
  } finally {
    await banc.nettoyer();
  }
});

// Adresse IP propre à chaque requête (10.0.0.0/8, 16 millions de valeurs) :
// les limites par adresse IP ne se croisent pas d'un test à l'autre ; seule
// la limite par adresse email est en jeu.
function ip(): string {
  return `10.${randomInt(256)}.${randomInt(256)}.${randomInt(1, 255)}`;
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

function messagesPour(email: string) {
  return banc.transport.messages.filter((m) => m.a === email);
}

function jetonVerification(email: string): string {
  const message = [...messagesPour(email)]
    .reverse()
    .find((m) => /lien\/verification#/u.test(m.corps));
  const trouve = message?.corps.match(/\/lien\/verification#([A-Za-z0-9_.-]+)/u);
  if (!trouve?.[1]) throw new Error("aucun lien de vérification reçu");
  return trouve[1];
}

function jetonsReinitialisation(email: string): string[] {
  return messagesPour(email)
    .map((m) => m.corps.match(/\/lien\/reinitialisation#([A-Za-z0-9]{24})(?:\s|$)/u)?.[1])
    .filter((jeton): jeton is string => jeton !== undefined);
}

function cookieSession(reponse: Response): string | undefined {
  const brut = reponse.headers.getSetCookie().find((c) => /session_token=[^;]/u.test(c));
  return brut?.split(";")[0];
}

async function compte(options: { verifie: boolean }) {
  const email = banc.adresse();
  await banc.traiter(post("/sign-up/email", { nom: "Awa Koné", email, motDePasse: MOT_DE_PASSE }));
  await banc.envoyer();
  let cookieVerification: string | undefined;
  if (options.verifie) {
    const reponse = await banc.traiter(post("/verify-email", { jeton: jetonVerification(email) }));
    cookieVerification = cookieSession(reponse);
  }
  const [ligne] = await db.select({ id: user.id }).from(user).where(eq(user.email, email));
  if (!ligne) throw new Error("compte non créé");
  return { email, id: ligne.id, cookieVerification };
}

async function demander(email: string, adresseIp?: string) {
  const reponse = await banc.traiter(
    post("/request-password-reset", { email }, adresseIp ? { adresseIp } : {}),
  );
  await banc.envoyer();
  return reponse;
}

function reinitialiser(jeton: string, motDePasse = NOUVEAU) {
  return banc.traiter(post("/reset-password", { jeton, motDePasse }));
}

function connecter(email: string, motDePasse: string) {
  return banc.traiter(post("/sign-in/email", { email, motDePasse }));
}

async function forme(reponse: Response) {
  return {
    statut: reponse.status,
    entetes: [...reponse.headers.entries()],
    corps: await reponse.text(),
  };
}

async function sessionsDe(id: string) {
  return db.select().from(session).where(eq(session.userId, id));
}

// Have I Been Pwned simulé : COMPROMIS est compromis, tout autre non.
beforeEach(() => {
  const empreinte = createHash("sha1").update(COMPROMIS).digest("hex").toUpperCase();
  vi.stubGlobal("fetch", async (entree: string | URL | Request) => {
    const url = new URL(entree instanceof Request ? entree.url : entree);
    if (url.hostname !== "api.pwnedpasswords.com") throw new Error("appel inattendu");
    const lignes = ["0000000000000000000000000000000000A:1"];
    if (url.pathname === `/range/${empreinte.slice(0, 5)}`) lignes.push(`${empreinte.slice(5)}:9`);
    return new Response(lignes.join("\r\n"));
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("demande indiscernable (T-07, S-11)", () => {
  test("compte vérifié, compte non vérifié, adresse inconnue : même réponse, 800 ms au moins ; email pour les deux comptes seulement", async () => {
    const verifie = await compte({ verifie: true });
    const nonVerifie = await compte({ verifie: false });
    const inconnue = `personne-${randomUUID()}@exemple.test`;

    const formes = [];
    for (const email of [verifie.email, nonVerifie.email, inconnue]) {
      const debut = performance.now();
      const reponse = await demander(email);
      expect(performance.now() - debut, email).toBeGreaterThanOrEqual(790);
      formes.push(await forme(reponse));
    }
    expect(formes[0]).toEqual({
      statut: 200,
      entetes: [
        ["cache-control", "no-store"],
        ["content-type", "application/json; charset=utf-8"],
      ],
      corps: JSON.stringify({ ok: true }),
    });
    expect(formes[1]).toEqual(formes[0]);
    expect(formes[2]).toEqual(formes[0]);

    expect(jetonsReinitialisation(verifie.email)).toHaveLength(1);
    expect(jetonsReinitialisation(nonVerifie.email)).toHaveLength(1);
    expect(messagesPour(inconnue)).toEqual([]);
  });
});

describe("le jeton (S-15)", () => {
  test("stocké sous son empreinte : ni le jeton, ni reset-password:<jeton> en base", async () => {
    const { email, id } = await compte({ verifie: true });
    await demander(email);
    const [jeton] = jetonsReinitialisation(email);
    if (!jeton) throw new Error("aucun lien reçu");
    expect(jeton).toMatch(/^[A-Za-z0-9]{24}$/u);

    const lignes = await db.select().from(verification).where(eq(verification.value, id));
    expect(lignes).toHaveLength(1);
    expect(lignes[0]?.identifier).toMatch(/^reinitialisation:[A-Za-z0-9_-]{43}$/u);
    expect(JSON.stringify(lignes)).not.toContain(jeton);
    const enClair = await db
      .select()
      .from(verification)
      .where(eq(verification.identifier, `reset-password:${jeton}`));
    expect(enClair).toEqual([]);
  });

  test("l'empreinte lue en base, présentée comme jeton : refusée ; le jeton sert encore", async () => {
    const { email, id } = await compte({ verifie: true });
    await demander(email);
    const [ligne] = await db.select().from(verification).where(eq(verification.value, id));
    const empreinte = ligne?.identifier.slice("reinitialisation:".length) ?? "";
    const refus = await reinitialiser(empreinte);
    expect(refus.status).toBe(400);
    const [jeton] = jetonsReinitialisation(email);
    expect((await reinitialiser(jeton ?? "")).status).toBe(200);
  });

  test("second usage : lien_invalide ; jeton expiré : lien_invalide", async () => {
    const a = await compte({ verifie: true });
    await demander(a.email);
    const [jeton] = jetonsReinitialisation(a.email);
    expect(await (await reinitialiser(jeton ?? "")).json()).toEqual({ ok: true });
    expect(await (await reinitialiser(jeton ?? "", "une-autre-phrase-de-passe")).json()).toEqual({
      ok: false,
      raison: "lien_invalide",
    });

    const b = await compte({ verifie: true });
    await demander(b.email);
    const [expire] = jetonsReinitialisation(b.email);
    await db
      .update(verification)
      .set({ expiresAt: sql`now() - interval '1 minute'` })
      .where(eq(verification.value, b.id));
    expect(await (await reinitialiser(expire ?? "")).json()).toEqual({
      ok: false,
      raison: "lien_invalide",
    });
  });

  test("mot de passe compromis puis trop court : refusés, le même jeton sert ensuite (section 3.3)", async () => {
    const { email } = await compte({ verifie: true });
    await demander(email);
    const [jeton] = jetonsReinitialisation(email);
    expect(await (await reinitialiser(jeton ?? "", COMPROMIS)).json()).toEqual({
      ok: false,
      raison: "mot_de_passe_compromis",
    });
    expect(await (await reinitialiser(jeton ?? "", "court")).json()).toEqual({
      ok: false,
      raison: "mot_de_passe_trop_court",
    });
    expect(await (await reinitialiser(jeton ?? "")).json()).toEqual({ ok: true });
  });
});

describe("après la réinitialisation (S-17, section 4)", () => {
  test("mot de passe changé, toutes les sessions supprimées, notification, autres jetons supprimés", async () => {
    const { email, id, cookieVerification } = await compte({ verifie: true });
    const connexion = await connecter(email, MOT_DE_PASSE);
    const cookieConnexion = cookieSession(connexion);
    expect(await sessionsDe(id)).toHaveLength(2);

    await demander(email);
    await demander(email);
    const [premier, second] = jetonsReinitialisation(email);
    expect(premier).not.toBe(second);

    const reponse = await reinitialiser(second ?? "");
    expect(reponse.status).toBe(200);
    expect(reponse.headers.getSetCookie()).toEqual([]);
    await banc.envoyer();

    expect(await sessionsDe(id)).toEqual([]);
    for (const cookie of [cookieVerification, cookieConnexion]) {
      expect(await banc.lireSession(new Headers({ cookie: cookie ?? "" }))).toBeNull();
    }
    const notifications = messagesPour(email).filter((m) =>
      m.sujet.includes("Votre mot de passe a été modifié"),
    );
    expect(notifications).toHaveLength(1);
    expect(await db.select().from(verification).where(eq(verification.value, id))).toEqual([]);
    expect(await (await reinitialiser(premier ?? "")).json()).toEqual({
      ok: false,
      raison: "lien_invalide",
    });

    expect((await connecter(email, MOT_DE_PASSE)).status).toBe(401);
    expect((await connecter(email, NOUVEAU)).status).toBe(200);
  });

  test("compte non vérifié (décision B) : devient vérifié, connexion possible", async () => {
    const { email, id } = await compte({ verifie: false });
    await demander(email);
    const [jeton] = jetonsReinitialisation(email);
    expect((await reinitialiser(jeton ?? "")).status).toBe(200);
    const [ligne] = await db.select().from(user).where(eq(user.id, id));
    expect(ligne?.emailVerified).toBe(true);
    expect((await connecter(email, NOUVEAU)).status).toBe(200);
  });
});

describe("concurrence : deux réinitialisations simultanées avec le même jeton", () => {
  test("une seule réussit ; le mot de passe en base est celui de la réussite", async () => {
    const { email } = await compte({ verifie: true });
    await demander(email);
    const [jeton] = jetonsReinitialisation(email);
    const A = "premiere-phrase-de-passe-2026";
    const B = "seconde-phrase-de-passe-2026";

    const [ra, rb] = await Promise.all([
      reinitialiser(jeton ?? "", A),
      reinitialiser(jeton ?? "", B),
    ]);
    const corps = [await ra.json(), await rb.json()];
    const reussites = corps.filter((c) => (c as { ok: boolean }).ok === true);
    expect(reussites).toHaveLength(1);
    expect(corps).toContainEqual({ ok: false, raison: "lien_invalide" });

    const gagnant = (corps[0] as { ok: boolean }).ok ? A : B;
    const perdant = gagnant === A ? B : A;
    expect((await connecter(email, gagnant)).status).toBe(200);
    expect((await connecter(email, perdant)).status).toBe(401);
  });
});

describe("limites (S-11, T-43)", () => {
  test("la troisième demande en une heure pour une même adresse, depuis trois adresses IP : trop_de_requetes, compte connu ou non", async () => {
    const { email } = await compte({ verifie: true });
    const inconnue = `personne-${randomUUID()}@exemple.test`;
    for (const adresse of [email, inconnue]) {
      const statuts = [];
      for (let i = 0; i < 3; i += 1) statuts.push((await demander(adresse, ip())).status);
      expect(statuts, adresse).toEqual([200, 200, 429]);
    }
    const cles = await db
      .select({ cle: compteurDebit.cle })
      .from(compteurDebit)
      .where(like(compteurDebit.cle, "auth.reinitialisation_compte:%"));
    expect(cles.length).toBeGreaterThanOrEqual(2);
    expect(JSON.stringify(cles)).not.toContain("exemple.test");
    expect(JSON.stringify(cles)).not.toContain("personne-");
  });
});

describe("fonctions de base de la réinitialisation (section 4.2)", () => {
  test("supprimerJetonsReinitialisation : seulement les lignes reinitialisation: du compte visé", async () => {
    const a = await compte({ verifie: true });
    const b = await compte({ verifie: true });
    const expire = new Date(Date.now() + 60_000);
    const lignes = [
      { identifier: `reinitialisation:${randomUUID()}`, value: a.id },
      { identifier: `reinitialisation:${randomUUID()}`, value: b.id },
      { identifier: `autre:${randomUUID()}`, value: a.id },
    ].map((ligne) => ({ id: randomUUID(), ...ligne, expiresAt: expire }));
    lignesCreees.push(...lignes.map((l) => l.id));
    await db.insert(verification).values(lignes);

    const supprimees = await supprimerJetonsReinitialisation(a.id);

    expect(supprimees).toBe(1);
    const restantes = await db
      .select({ id: verification.id })
      .from(verification)
      .where(
        inArray(
          verification.id,
          lignes.map((l) => l.id),
        ),
      );
    expect(restantes.map((r) => r.id).sort()).toEqual([lignes[1]?.id, lignes[2]?.id].sort());
  });

  test("marquerAdresseVerifiee : seulement le compte visé", async () => {
    const a = await compte({ verifie: false });
    const b = await compte({ verifie: false });
    await marquerAdresseVerifiee(a.id);
    const lus = await db
      .select({ id: user.id, verifie: user.emailVerified })
      .from(user)
      .where(and(inArray(user.id, [a.id, b.id])));
    expect(Object.fromEntries(lus.map((l) => [l.id, l.verifie]))).toEqual({
      [a.id]: true,
      [b.id]: false,
    });
  });
});
