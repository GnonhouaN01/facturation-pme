import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { organization, testUtils } from "better-auth/plugins";
import { describe, expect, test, vi } from "vitest";

import { LIMITES } from "../debit/limites";
import { reglesBetterAuth, stockageBetterAuth } from "../debit/better-auth";

import { auth, optionsAuth } from "./config";
import {
  planifierEmailCompteExistant,
  planifierEmailReinitialisation,
  planifierEmailVerification,
} from "./emails";
import { consignerAuth } from "./journal";
import { creerStockageCodesSecours, genererCodesSecours } from "./codes-secours";
import { empreinteAttenteDoubleAuth } from "./double-authentification";
import { apresReinitialisation, empreinteJetonReinitialisation } from "./reinitialisation";

// Le module testUtils de Better Auth crée des sessions sans mot de passe : il
// n'existe que dans l'instance de test (src/server/db/outils-test/), jamais
// dans la configuration de production. Fiche :
// docs/features/chaine-controles.md, section 10.

// config.ts charge env.ts et client.ts : valeurs factices, aucune connexion
// n'est ouverte.
vi.mock("../env", () => ({
  env: {
    DATABASE_URL: "postgresql://app_facturation:factice@localhost:5432/factice",
    BETTER_AUTH_SECRET: "secret-factice-de-trente-deux-caracteres",
    BETTER_AUTH_URL: "https://facturation.exemple.ci",
  },
}));

const ID_TEST_UTILS = testUtils().id;

const SRC = fileURLToPath(new URL("../../", import.meta.url));
const OUTILS_TEST = join("server", "db", "outils-test") + sep;

function identifiants(plugins: readonly { id: string }[] | undefined): string[] {
  return (plugins ?? []).map((plugin) => plugin.id);
}

function fichiers(dossier: string): string[] {
  return readdirSync(dossier, { recursive: true, withFileTypes: true })
    .filter((entree) => entree.isFile())
    .map((entree) => join(entree.parentPath, entree.name));
}

describe("testUtils absent de la configuration de production", () => {
  test("l'identifiant cherché est celui du module, et la recherche le trouve", () => {
    expect(ID_TEST_UTILS).toBe("test-utils");
    expect(identifiants([organization(), testUtils()])).toContain(ID_TEST_UTILS);
  });

  test("optionsAuth : modules attendus présents, testUtils absent", () => {
    const ids = identifiants(optionsAuth.plugins);

    expect(ids).toContain("organization");
    expect(ids).not.toContain(ID_TEST_UTILS);
  });

  test("instance auth : modules attendus présents, testUtils absent", () => {
    const ids = identifiants(auth.options.plugins);

    expect(ids).toContain("organization");
    expect(ids).not.toContain(ID_TEST_UTILS);
  });

  test("instance auth : aucune aide de test dans son contexte", async () => {
    const contexte = await auth.$context;

    expect(contexte).not.toHaveProperty("test");
  });

  // Attrape aussi un ajout conditionnel (selon une variable d'environnement),
  // que la configuration chargée sous Vitest ne montrerait pas.
  test("aucun fichier de src/ hors des tests et de outils-test/ ne mentionne testUtils", () => {
    const parcourus = fichiers(SRC).map((chemin) => relative(SRC, chemin));
    const fautifs = parcourus
      .filter((chemin) => !chemin.startsWith(OUTILS_TEST) && !/\.test\.tsx?$/.test(chemin))
      .filter((chemin) => /testUtils|test-utils/.test(readFileSync(join(SRC, chemin), "utf8")));

    expect(parcourus).toContain(join("server", "auth", "config.ts"));
    expect(fautifs).toEqual([]);
  });
});

// Fonctionnalité 1.1 : journal, erreurs, débit, emails, mots de passe.
// Fiche : docs/features/inscription.md, sections 1 à 6.
describe("1.1 : configuration de Better Auth", () => {
  test("journal : notre fonction, qui ne lit ni le message ni les arguments (T-39)", () => {
    expect(optionsAuth.logger?.log).toBe(consignerAuth);
    expect(optionsAuth.logger?.level).toBe("warn");
    expect(consignerAuth.length).toBe(1);
  });

  test("erreurs relancées vers notre gestionnaire, jamais écrites par better-call", () => {
    expect(optionsAuth.onAPIError?.throw).toBe(true);
  });

  test("débit : activé explicitement, sur notre compteur, règles tirées de LIMITES", () => {
    const debit = optionsAuth.rateLimit;
    expect(debit?.enabled).toBe(true);
    expect(debit?.customStorage).toBe(stockageBetterAuth);
    expect(debit?.window).toBe(LIMITES["auth.defaut"].fenetreSecondes);
    expect(debit?.max).toBe(LIMITES["auth.defaut"].maximum);
    expect(debit?.customRules).toEqual(reglesBetterAuth());
  });

  test("adresse IP : un seul en-tête, fixé par la configuration", () => {
    expect(optionsAuth.advanced?.ipAddress?.ipAddressHeaders).toEqual(["x-forwarded-for"]);
    expect(optionsAuth.advanced?.ipAddress).not.toHaveProperty("trustedProxies");
    expect(optionsAuth.advanced?.ipAddress).not.toHaveProperty("disableIpTracking");
  });

  test("email et mot de passe : vérification exigée, 12 à 128 caractères (S-10)", () => {
    const options = optionsAuth.emailAndPassword;
    expect(options.enabled).toBe(true);
    expect(options.requireEmailVerification).toBe(true);
    expect(options.minPasswordLength).toBe(12);
    expect(options.maxPasswordLength).toBe(128);
    expect(options.onExistingUserSignUp).toBe(planifierEmailCompteExistant);
    expect(options).not.toHaveProperty("autoSignIn");
  });

  test("vérification de l'email : à l'inscription, session ouverte, jeton d'une heure", () => {
    const options = optionsAuth.emailVerification;
    expect(options?.sendOnSignUp).toBe(true);
    expect(options?.autoSignInAfterVerification).toBe(true);
    expect(options?.expiresIn).toBe(3600);
    expect(options?.sendVerificationEmail).toBe(planifierEmailVerification);
  });

  test("mots de passe compromis : extension Have I Been Pwned présente, sans interrupteur", () => {
    const extension = (optionsAuth.plugins as readonly { id: string; options?: unknown }[]).find(
      (plugin) => plugin.id === "have-i-been-pwned",
    );
    expect(extension).toBeDefined();
    expect((extension?.options as { enabled?: unknown } | undefined)?.enabled).toBeUndefined();
  });

  test("une seule origine de confiance : celle de baseURL", async () => {
    expect(optionsAuth).not.toHaveProperty("trustedOrigins");
    const contexte = await auth.$context;
    expect(contexte.trustedOrigins).toEqual([new URL(optionsAuth.baseURL).origin]);
  });

  test("adaptateur sans transaction : les rappels d'envoi ne tournent jamais dans une transaction (règle 15)", async () => {
    const contexte = await auth.$context;
    const configuration = (
      contexte.adapter as { options?: { adapterConfig?: { transaction?: unknown } } }
    ).options?.adapterConfig;
    expect(configuration).toBeDefined();
    expect(configuration?.transaction).toBe(false);
  });

  test("cookies : HttpOnly, SameSite=Lax, Secure dès que l'adresse est en https (S-82)", async () => {
    const contexte = await auth.$context;
    const attributs = contexte.authCookies.sessionToken.attributes;
    expect(attributs.httpOnly).toBe(true);
    expect(attributs.sameSite).toBe("lax");
    expect(attributs.secure).toBe(true);
  });
});

// Fonctionnalité 1.2 : session. Fiche : docs/features/connexion.md,
// sections 2.3 et 4, test 10.
describe("1.2 : session", () => {
  const SEPT_JOURS = 7 * 24 * 60 * 60;

  test("7 jours, jamais prolongée (décision 3)", () => {
    expect(optionsAuth.session?.expiresIn).toBe(SEPT_JOURS);
    expect(optionsAuth.session?.disableSessionRefresh).toBe(true);
  });

  test("aucun cache de session dans un cookie : relue en base à chaque requête", async () => {
    expect(optionsAuth.session).not.toHaveProperty("cookieCache");
    const contexte = await auth.$context;
    expect(contexte.sessionConfig.cookieRefreshCache).toBe(false);
  });

  test("le contexte de Better Auth applique la durée", async () => {
    const contexte = await auth.$context;
    expect(contexte.sessionConfig.expiresIn).toBe(SEPT_JOURS);
  });

  test("cookie de session : Max-Age de 7 jours, aligné sur la base", async () => {
    const contexte = await auth.$context;
    expect(contexte.authCookies.sessionToken.attributes.maxAge).toBe(SEPT_JOURS);
  });

  test("aucun email de vérification à la connexion d'un compte non vérifié (section 2.3)", () => {
    expect(optionsAuth.emailVerification).not.toHaveProperty("sendOnSignIn");
  });
});

// Fonctionnalité 1.3 : réinitialisation. Fiche :
// docs/features/mot-de-passe.md, sections 3 et 4, test 12.
describe("1.3 : réinitialisation du mot de passe", () => {
  test("lien envoyé par notre rappel, valable 30 minutes ; toutes les sessions fermées ; rappel d'après réinitialisation", () => {
    const options = optionsAuth.emailAndPassword;
    expect(options.sendResetPassword).toBe(planifierEmailReinitialisation);
    expect(options.resetPasswordTokenExpiresIn).toBe(30 * 60);
    expect(options.revokeSessionsOnPasswordReset).toBe(true);
    expect(options.onPasswordReset).toBe(apresReinitialisation);
  });

  // Modifié en 1.4 : une seconde surcharge, pour les lignes de la connexion
  // en attente du code (docs/features/double-authentification.md,
  // section 3.3) ; celle de reset-password: est inchangée.
  test("jeton stocké haché (S-15) : deux surcharges, reset-password: et 2fa-, chacune par notre empreinte", () => {
    const stockage = optionsAuth.verification?.storeIdentifier;
    expect(stockage).toEqual({
      default: "plain",
      overrides: {
        "reset-password:": { hash: empreinteJetonReinitialisation },
        "2fa-": { hash: empreinteAttenteDoubleAuth },
      },
    });
  });

  test("Have I Been Pwned couvre /reset-password (chemins par défaut de l'extension)", () => {
    const extension = (optionsAuth.plugins as readonly { id: string; options?: unknown }[]).find(
      (plugin) => plugin.id === "have-i-been-pwned",
    );
    expect((extension?.options as { paths?: unknown } | undefined)?.paths).toBeUndefined();
  });

  test("le contexte de Better Auth applique la révocation et la durée", async () => {
    const contexte = await auth.$context;
    expect(contexte.options.emailAndPassword?.revokeSessionsOnPasswordReset).toBe(true);
    expect(contexte.options.emailAndPassword?.resetPasswordTokenExpiresIn).toBe(1800);
  });
});

// Fonctionnalité 1.4 : double authentification. Fiche :
// docs/features/double-authentification.md, sections 1, 3 et 4, test 14.
describe("1.4 : double authentification", () => {
  type OptionsDoubleAuth = {
    issuer?: unknown;
    twoFactorCookieMaxAge?: unknown;
    backupCodeOptions?: {
      amount?: unknown;
      length?: unknown;
      customBackupCodesGenerate?: unknown;
      storeBackupCodes?: unknown;
    };
    otpOptions?: unknown;
    skipVerificationOnEnable?: unknown;
    allowPasswordless?: unknown;
    accountLockout?: unknown;
    totpOptions?: unknown;
    trustDeviceMaxAge?: unknown;
  };

  function options(): OptionsDoubleAuth {
    const extension = (optionsAuth.plugins as readonly { id: string; options?: unknown }[]).find(
      (plugin) => plugin.id === "two-factor",
    );
    expect(extension).toBeDefined();
    return (extension?.options ?? {}) as OptionsDoubleAuth;
  }

  test("émetteur « Facturation PME » ; attente du code de 5 minutes", () => {
    expect(options().issuer).toBe("Facturation PME");
    expect(options().twoFactorCookieMaxAge).toBe(300);
  });

  test("codes de secours : les nôtres, 10, sous empreinte (storeBackupCodes à nos deux fonctions)", async () => {
    const codes = options().backupCodeOptions;
    expect(codes?.amount).toBe(10);
    expect(codes?.customBackupCodesGenerate).toBe(genererCodesSecours);
    const stockage = codes?.storeBackupCodes as { encrypt: (s: string) => Promise<string> };
    expect(Object.keys(stockage).sort()).toEqual(["decrypt", "encrypt"]);
    // Même comportement que notre stockage : une liste de codes devient des
    // empreintes cs1:.
    const stocke = JSON.parse(await stockage.encrypt(JSON.stringify(["abcde-fghjk"]))) as string[];
    expect(stocke[0]).toMatch(/^cs1:/u);
    expect(typeof creerStockageCodesSecours).toBe("function");
  });

  test("ni code par email, ni activation sans vérification, ni mot de passe facultatif, ni réglage du TOTP", () => {
    const lues = options();
    expect(lues.otpOptions).toBeUndefined();
    expect(lues.skipVerificationOnEnable).toBeUndefined();
    expect(lues.allowPasswordless).toBeUndefined();
    expect(lues.totpOptions).toBeUndefined();
    expect(lues.trustDeviceMaxAge).toBeUndefined();
  });

  test("verrou du compte de Better Auth : réglages par défaut gardés (actif, 10 échecs, 15 minutes)", () => {
    expect(options().accountLockout).toBeUndefined();
  });
});
