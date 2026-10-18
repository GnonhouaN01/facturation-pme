import { betterAuth } from "better-auth";
import { memoryAdapter } from "better-auth/adapters/memory";
import { symmetricDecrypt } from "better-auth/crypto";
import { twoFactor } from "better-auth/plugins";
import { describe, expect, test, vi } from "vitest";

import { OPTIONS_DOUBLE_AUTH } from "./codes-secours";
import {
  empreinteAttenteDoubleAuth,
  nomCookieAttente,
  nomCookieSession,
} from "./double-authentification";
import { codeHotp, trancheCourante } from "./tranche-totp";

// L'extension twoFactor telle que la version installée de Better Auth
// (1.7.7) l'exécute, avec nos réglages, sur son adaptateur en mémoire, sans
// base : secret chiffré, codes de secours sous empreinte, connexion en
// attente sous empreinte, 5 essais par attente, verrou du compte, fenêtre de
// ±1 tranche, déchiffrement du secret par notre passerelle (anti-rejeu). Une
// mise à jour qui change l'un de ces points fait échouer la suite, comme le
// test du jeton de la 1.3. Fiche : docs/features/double-authentification.md,
// section 1, test 15.

vi.mock("../env", () => ({
  env: {
    DATABASE_URL: "postgresql://app_facturation:factice@127.0.0.1:1/factice",
    BETTER_AUTH_SECRET: "secret-factice-de-trente-deux-caracteres",
    BETTER_AUTH_URL: "http://localhost:3000",
  },
  configurationEmail: {
    transport: "memoire",
    dossier: null,
    destinatairesAutorises: [],
    estProduction: false,
    gmail: null,
  },
}));

type Ligne = Record<string, unknown>;
const ORIGINE = "http://localhost:3000";
const ADRESSE = "awa@exemple.invalid";
const MOT_DE_PASSE = "une-phrase-de-passe-solide";

function base32(texte: string): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const caractere of texte) {
    const valeur = alphabet.indexOf(caractere);
    if (valeur < 0) throw new Error("base32 invalide");
    bits += valeur.toString(2).padStart(5, "0");
  }
  const octets: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8)
    octets.push(Number.parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(octets).toString("utf8");
}

function cookiesDe(entetes: Headers): string {
  return entetes
    .getSetCookie()
    .map((cookie) => cookie.split(";")[0] ?? "")
    .filter((paire) => !paire.endsWith("="))
    .join("; ");
}

async function instance() {
  const base: Record<string, Ligne[]> = {
    user: [],
    session: [],
    account: [],
    verification: [],
    twoFactor: [],
  };
  const auth = betterAuth({
    secret: "secret-factice-de-trente-deux-caracteres",
    baseURL: ORIGINE,
    database: memoryAdapter(base),
    logger: { disabled: true },
    rateLimit: { enabled: false },
    emailAndPassword: { enabled: true },
    verification: {
      storeIdentifier: {
        default: "plain" as const,
        overrides: { "2fa-": { hash: empreinteAttenteDoubleAuth } },
      },
    },
    plugins: [twoFactor(OPTIONS_DOUBLE_AUTH)],
  });
  await auth.api.signUpEmail({ body: { name: "Awa", email: ADRESSE, password: MOT_DE_PASSE } });
  const connexion = await auth.api.signInEmail({
    body: { email: ADRESSE, password: MOT_DE_PASSE },
    returnHeaders: true,
  });
  const cookieSession = cookiesDe(connexion.headers);
  return { auth, base, cookieSession };
}

async function activer() {
  const outils = await instance();
  const { auth, cookieSession } = outils;
  const activation = await auth.api.enableTwoFactor({
    headers: new Headers({ cookie: cookieSession }),
    body: { password: MOT_DE_PASSE },
  });
  const uri = new URL(activation.totpURI ?? "");
  const secret = base32(uri.searchParams.get("secret") ?? "");
  const confirmation = await auth.api.verifyTOTP({
    headers: new Headers({ cookie: cookieSession }),
    body: { code: codeHotp(secret, trancheCourante(Date.now())) },
    returnHeaders: true,
  });
  return {
    ...outils,
    activation,
    secret,
    uri,
    cookieConfirme: cookiesDe(confirmation.headers),
  };
}

async function demanderCode(auth: Awaited<ReturnType<typeof instance>>["auth"]) {
  const connexion = await auth.api.signInEmail({
    body: { email: ADRESSE, password: MOT_DE_PASSE },
    returnHeaders: true,
  });
  return { corps: connexion.response as unknown, cookie: cookiesDe(connexion.headers) };
}

async function essayer(
  auth: Awaited<ReturnType<typeof instance>>["auth"],
  cookie: string,
  code: string,
): Promise<string> {
  try {
    await auth.api.verifyTOTP({ headers: new Headers({ cookie }), body: { code } });
    return "ok";
  } catch (erreur) {
    return String((erreur as { body?: { code?: string } }).body?.code ?? "inconnue");
  }
}

describe("activation", () => {
  test("adresse otpauth://totp, émetteur Facturation PME, 6 chiffres, 30 secondes ; dix codes de notre forme", async () => {
    const { activation, uri } = await activer();
    expect(uri.protocol).toBe("otpauth:");
    expect(uri.host).toBe("totp");
    expect(uri.searchParams.get("issuer")).toBe("Facturation PME");
    expect(uri.searchParams.get("digits")).toBe("6");
    expect(uri.searchParams.get("period")).toBe("30");
    expect(uri.searchParams.get("secret")).toMatch(/^[A-Z2-7]+$/u);
    expect(activation.backupCodes).toHaveLength(10);
    for (const code of activation.backupCodes ?? [])
      expect(code).toMatch(/^[a-z2-9]{5}-[a-z2-9]{5}$/u);
  });

  test("en base : secret chiffré (ni lui ni sa forme base32), codes sous empreinte seulement", async () => {
    const { base, secret, uri, activation } = await activer();
    const lignes = JSON.stringify(base.twoFactor);
    expect(lignes).not.toContain(secret);
    expect(lignes).not.toContain(uri.searchParams.get("secret") ?? "");
    for (const code of activation.backupCodes ?? []) expect(lignes).not.toContain(code);
    const [ligne] = base.twoFactor ?? [];
    const stockes = JSON.parse(String(ligne?.backupCodes)) as string[];
    expect(stockes).toHaveLength(10);
    for (const empreinte of stockes) expect(empreinte).toMatch(/^cs1:[A-Za-z0-9_-]{43}$/u);
  });

  test("le secret se déchiffre avec le secretConfig de l'instance (anti-rejeu de la passerelle)", async () => {
    const { auth, base, secret } = await activer();
    const contexte = await auth.$context;
    const [ligne] = base.twoFactor ?? [];
    expect(
      await symmetricDecrypt({ key: contexte.secretConfig, data: String(ligne?.secret) }),
    ).toBe(secret);
  });

  test("avant le code : ligne non vérifiée, second facteur inactif ; après : actif, session remplacée (jeton neuf)", async () => {
    const outils = await instance();
    const { auth, base, cookieSession } = outils;
    const activation = await auth.api.enableTwoFactor({
      headers: new Headers({ cookie: cookieSession }),
      body: { password: MOT_DE_PASSE },
    });
    expect(base.twoFactor?.[0]?.verified).toBe(false);
    expect(base.user?.[0]?.twoFactorEnabled).toBe(false);
    const avant = (base.session ?? []).map((s) => s.token);
    const secret = base32(new URL(activation.totpURI ?? "").searchParams.get("secret") ?? "");
    await auth.api.verifyTOTP({
      headers: new Headers({ cookie: cookieSession }),
      body: { code: codeHotp(secret, trancheCourante(Date.now())) },
    });
    expect(base.twoFactor?.[0]?.verified).toBe(true);
    expect(base.user?.[0]?.twoFactorEnabled).toBe(true);
    const apres = (base.session ?? []).map((s) => s.token);
    expect(apres).toHaveLength(1);
    expect(avant).not.toContain(apres[0]);
    // Échéance neuve de 7 jours (section 8.2).
    const echeance = new Date(base.session?.[0]?.expiresAt as Date).getTime();
    expect(echeance - Date.now()).toBeGreaterThan(7 * 24 * 3600 * 1000 - 60_000);
  });

  test("TOTP_ALREADY_ENABLED sur une ligne vérifiée ; accepté sur une ligne marquée non vérifiée (remplacement)", async () => {
    const { auth, base, cookieConfirme } = await activer();
    await expect(
      auth.api.enableTwoFactor({
        headers: new Headers({ cookie: cookieConfirme }),
        body: { password: MOT_DE_PASSE },
      }),
    ).rejects.toMatchObject({ body: { code: "TOTP_ALREADY_ENABLED" } });
    const ligne = base.twoFactor?.[0];
    if (ligne) ligne.verified = false;
    const nouvelle = await auth.api.enableTwoFactor({
      headers: new Headers({ cookie: cookieConfirme }),
      body: { password: MOT_DE_PASSE },
    });
    expect(nouvelle.backupCodes).toHaveLength(10);
    expect(base.user?.[0]?.twoFactorEnabled).toBe(true);
  });
});

describe("connexion d'un compte à second facteur", () => {
  test("aucune session gardée ; cookie d'attente posé ; lignes d'attente sous empreinte double-auth:", async () => {
    const { auth, base } = await activer();
    const sessionsAvant = (base.session ?? []).length;
    const { corps, cookie } = await demanderCode(auth);
    expect(corps).toMatchObject({ twoFactorRedirect: true, twoFactorMethods: ["totp"] });
    expect((base.session ?? []).length).toBe(sessionsAvant);
    expect(cookie.startsWith(`${nomCookieAttente(ORIGINE)}=`)).toBe(true);
    const identifiants = (base.verification ?? []).map((v) => String(v.identifier));
    expect(identifiants.length).toBeGreaterThanOrEqual(2);
    for (const identifiant of identifiants) expect(identifiant).toMatch(/^double-auth:/u);
    expect(JSON.stringify(base.verification)).not.toContain("2fa-");
  });

  test("code juste : session et cookie de session ; l'attente est consommée", async () => {
    const { auth, secret } = await activer();
    const { cookie } = await demanderCode(auth);
    const code = codeHotp(secret, trancheCourante(Date.now()));
    const reponse = await auth.api.verifyTOTP({
      headers: new Headers({ cookie }),
      body: { code },
      returnHeaders: true,
    });
    expect(cookiesDe(reponse.headers)).toContain(`${nomCookieSession(ORIGINE)}=`);
    expect(await essayer(auth, cookie, code)).toBe("INVALID_TWO_FACTOR_COOKIE");
  });

  test("fenêtre de ±1 tranche, rien au-delà", async () => {
    const { auth, secret } = await activer();
    const t = trancheCourante(Date.now());
    for (const ecart of [-1, 1]) {
      const { cookie } = await demanderCode(auth);
      expect(await essayer(auth, cookie, codeHotp(secret, t + ecart))).toBe("ok");
    }
    const { cookie } = await demanderCode(auth);
    expect(await essayer(auth, cookie, codeHotp(secret, t + 3))).toBe("INVALID_CODE");
  });

  test("5 essais par attente, puis TOO_MANY_ATTEMPTS_REQUEST_NEW_CODE même avec le bon code", async () => {
    const { auth, secret } = await activer();
    const { cookie } = await demanderCode(auth);
    const juste = codeHotp(secret, trancheCourante(Date.now()));
    const faux = juste === "000000" ? "000001" : "000000";
    for (let i = 0; i < 5; i++) expect(await essayer(auth, cookie, faux)).toBe("INVALID_CODE");
    expect(await essayer(auth, cookie, juste)).toBe("TOO_MANY_ATTEMPTS_REQUEST_NEW_CODE");
  });

  test("verrou du compte après 10 échecs consécutifs : ACCOUNT_TEMPORARILY_LOCKED, même avec le bon code", async () => {
    const { auth, secret } = await activer();
    const juste = () => codeHotp(secret, trancheCourante(Date.now()));
    const faux = () => (juste() === "000000" ? "000001" : "000000");
    for (let i = 0; i < 2; i++) {
      const { cookie } = await demanderCode(auth);
      for (let j = 0; j < 5; j++) await essayer(auth, cookie, faux());
    }
    const { cookie } = await demanderCode(auth);
    expect(await essayer(auth, cookie, juste())).toBe("ACCOUNT_TEMPORARILY_LOCKED");
  });

  test("aucun rejeu empêché par Better Auth : le même code ouvre deux connexions (d'où la décision 4)", async () => {
    const { auth, secret } = await activer();
    const code = codeHotp(secret, trancheCourante(Date.now()));
    const a = await demanderCode(auth);
    const b = await demanderCode(auth);
    expect(await essayer(auth, a.cookie, code)).toBe("ok");
    expect(await essayer(auth, b.cookie, code)).toBe("ok");
  });

  test("code de secours : accepté une fois par son empreinte, retiré de la liste, refusé ensuite", async () => {
    const { auth, base, activation } = await activer();
    const contexte = await auth.$context;
    void contexte;
    const [premier] = activation.backupCodes ?? [];
    const { creerEmpreinteCodeSecours, deriverSecretCodes } = await import("./codes-secours");
    const empreinte = creerEmpreinteCodeSecours(
      deriverSecretCodes("secret-factice-de-trente-deux-caracteres"),
    )(premier ?? "");
    const a = await demanderCode(auth);
    await auth.api.verifyBackupCode({
      headers: new Headers({ cookie: a.cookie }),
      body: { code: empreinte },
    });
    const stockes = JSON.parse(String(base.twoFactor?.[0]?.backupCodes)) as string[];
    expect(stockes).toHaveLength(9);
    expect(stockes).not.toContain(empreinte);
    const b = await demanderCode(auth);
    await expect(
      auth.api.verifyBackupCode({
        headers: new Headers({ cookie: b.cookie }),
        body: { code: empreinte },
      }),
    ).rejects.toMatchObject({ body: { code: "INVALID_BACKUP_CODE" } });
    // Le code en clair ne sert à rien : seule l'empreinte est comparée.
    const c = await demanderCode(auth);
    await expect(
      auth.api.verifyBackupCode({
        headers: new Headers({ cookie: c.cookie }),
        body: { code: activation.backupCodes?.[1] ?? "" },
      }),
    ).rejects.toMatchObject({ body: { code: "INVALID_BACKUP_CODE" } });
  });
});
