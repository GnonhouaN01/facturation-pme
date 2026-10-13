import { createHash, randomInt } from "node:crypto";

import { createEmailVerificationToken } from "better-auth/api";
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { env } from "../env";

import { db } from "./client";
import { bancInscription } from "./outils-test/inscription";
import { session, user } from "./schema/auth";

// UC-01 avec la vraie base, par notre gestionnaire et l'instance de Better
// Auth aux options de l'application : inscription, adresse prise (T-07),
// vérification par le jeton reçu dans le corps, second usage, jeton expiré.
// Transport en mémoire, Have I Been Pwned simulé. Fiche :
// docs/features/inscription.md, sections 2 à 4.

const banc = bancInscription({ adresses: 8 });
const ORIGINE = new URL(env.BETTER_AUTH_URL).origin;
const MOT_DE_PASSE = "une-phrase-de-passe-solide";

afterAll(() => banc.nettoyer());

// Adresse IP propre à chaque requête : la limite auth.inscription (5 par
// heure) ne doit pas être atteinte par ce fichier.
function ip(): string {
  return `198.51.100.${randomInt(1, 255)}`;
}

function post(chemin: string, corps: unknown): Request {
  return new Request(`${ORIGINE}/api/auth${chemin}`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: ORIGINE, "x-forwarded-for": ip() },
    body: JSON.stringify(corps),
  });
}

function inscrire(email: string, motDePasse = MOT_DE_PASSE) {
  return banc.traiter(post("/sign-up/email", { nom: "Awa Koné", email, motDePasse }));
}

// Le jeton du dernier email de vérification envoyé à cette adresse.
function jetonRecu(email: string): string {
  const message = [...banc.transport.messages].reverse().find((m) => m.a === email);
  const trouve = message?.corps.match(/\/lien\/verification#([A-Za-z0-9_.-]+)/u);
  if (!trouve?.[1]) throw new Error("aucun lien de vérification reçu");
  return trouve[1];
}

async function lireUtilisateur(email: string) {
  const [ligne] = await db.select().from(user).where(eq(user.email, email));
  return ligne;
}

async function sessionsDe(utilisateurId: string): Promise<number> {
  return (await db.select().from(session).where(eq(session.userId, utilisateurId))).length;
}

beforeEach(() => {
  // Have I Been Pwned simulé : aucun mot de passe compromis, aucun appel réel.
  vi.stubGlobal("fetch", async (entree: string | URL | Request) => {
    const url = new URL(entree instanceof Request ? entree.url : entree);
    if (url.hostname !== "api.pwnedpasswords.com") throw new Error("appel inattendu");
    return new Response("0000000000000000000000000000000000A:1\r\n");
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("inscription (UC-01, étapes 1 à 3)", () => {
  test("adresse nouvelle : { ok: true }, compte non vérifié, un email compte.verification au lien en fragment", async () => {
    const email = banc.adresse();
    const reponse = await inscrire(email);
    expect(reponse.status).toBe(200);
    expect(await reponse.json()).toEqual({ ok: true });
    expect(reponse.headers.get("set-cookie")).toBeNull();

    const cree = await lireUtilisateur(email);
    expect(cree?.emailVerified).toBe(false);
    expect(cree?.name).toBe("Awa Koné");

    await banc.envoyer();
    const recus = banc.transport.messages.filter((m) => m.a === email);
    expect(recus).toHaveLength(1);
    expect(recus[0]?.corps).toContain(`${ORIGINE}/lien/verification#`);
    expect(recus[0]?.corps).not.toContain("/api/auth");
  });

  test("adresse prise (T-07) : même statut, même corps ; email compte.existant", async () => {
    const email = banc.adresse();
    const premiere = await inscrire(email);
    await banc.envoyer();
    const nombre = banc.transport.messages.length;

    const seconde = await inscrire(email, "une-autre-phrase-de-passe");
    expect(seconde.status).toBe(premiere.status);
    expect(await seconde.text()).toBe(JSON.stringify({ ok: true }));

    await banc.envoyer();
    const nouveaux = banc.transport.messages.slice(nombre);
    expect(nouveaux.map((m) => m.a)).toEqual([email]);
    expect(nouveaux[0]?.corps).not.toContain("/lien/");
    // Le mot de passe du compte n'a pas changé : une seule ligne, non vérifiée.
    expect((await lireUtilisateur(email))?.emailVerified).toBe(false);
  });

  test("durée plancher : au moins 800 ms, adresse nouvelle comme adresse prise", async () => {
    const email = banc.adresse();
    let debut = performance.now();
    await inscrire(email);
    expect(performance.now() - debut).toBeGreaterThanOrEqual(790);
    debut = performance.now();
    await inscrire(email);
    expect(performance.now() - debut).toBeGreaterThanOrEqual(790);
  });

  test("renvoi : { ok: true } pour une adresse inconnue comme pour un compte non vérifié", async () => {
    const email = banc.adresse();
    await inscrire(email);
    await banc.envoyer();
    const nombre = banc.transport.messages.length;

    const connue = await banc.traiter(post("/send-verification-email", { email }));
    const inconnue = await banc.traiter(
      post("/send-verification-email", { email: "personne-x@exemple.test" }),
    );
    expect(await connue.text()).toBe(await inconnue.text());
    expect(connue.status).toBe(inconnue.status);

    await banc.envoyer();
    expect(banc.transport.messages.slice(nombre).map((m) => m.a)).toEqual([email]);
  });
});

describe("vérification (UC-01, étapes 4 et 5)", () => {
  test("jeton reçu, envoyé dans le corps : adresse vérifiée, session ouverte, cookie HttpOnly et SameSite=Lax", async () => {
    const email = banc.adresse();
    await inscrire(email);
    await banc.envoyer();

    const reponse = await banc.traiter(post("/verify-email", { jeton: jetonRecu(email) }));
    expect(reponse.status).toBe(200);
    expect(await reponse.json()).toEqual({ ok: true });
    const cookies = reponse.headers.getSetCookie();
    const sessionCookie = cookies.find((c) => c.includes("session_token="));
    expect(sessionCookie).toBeDefined();
    expect(sessionCookie).toMatch(/HttpOnly/iu);
    expect(sessionCookie).toMatch(/SameSite=Lax/iu);

    const verifie = await lireUtilisateur(email);
    expect(verifie?.emailVerified).toBe(true);
    expect(await sessionsDe(verifie?.id ?? "")).toBe(1);
  });

  test("second usage du même jeton : aucune nouvelle session", async () => {
    const email = banc.adresse();
    await inscrire(email);
    await banc.envoyer();
    const jeton = jetonRecu(email);
    await banc.traiter(post("/verify-email", { jeton }));

    const seconde = await banc.traiter(post("/verify-email", { jeton }));
    expect(seconde.headers.getSetCookie().filter((c) => c.includes("session_token="))).toEqual([]);
    const verifie = await lireUtilisateur(email);
    expect(await sessionsDe(verifie?.id ?? "")).toBe(1);
  });

  test("jeton expiré : lien_invalide, adresse non vérifiée", async () => {
    const email = banc.adresse();
    await inscrire(email);
    const expire = await createEmailVerificationToken(
      env.BETTER_AUTH_SECRET,
      email,
      undefined,
      -60,
    );

    const reponse = await banc.traiter(post("/verify-email", { jeton: expire }));
    expect(reponse.status).toBe(400);
    expect(await reponse.json()).toEqual({ ok: false, raison: "lien_invalide" });
    expect((await lireUtilisateur(email))?.emailVerified).toBe(false);
  });

  test("jeton signé d'un autre secret : lien_invalide", async () => {
    const email = banc.adresse();
    await inscrire(email);
    const autre = await createEmailVerificationToken(
      createHash("sha256").update("un-autre-secret").digest("hex"),
      email,
    );
    const reponse = await banc.traiter(post("/verify-email", { jeton: autre }));
    expect(await reponse.json()).toEqual({ ok: false, raison: "lien_invalide" });
    expect((await lireUtilisateur(email))?.emailVerified).toBe(false);
  });
});
