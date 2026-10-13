import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { organization, testUtils } from "better-auth/plugins";
import { describe, expect, test, vi } from "vitest";

import { LIMITES } from "../debit/limites";
import { reglesBetterAuth, stockageBetterAuth } from "../debit/better-auth";

import { auth, optionsAuth } from "./config";
import { planifierEmailCompteExistant, planifierEmailVerification } from "./emails";
import { consignerAuth } from "./journal";

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
