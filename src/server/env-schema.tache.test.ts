import { describe, expect, test } from "vitest";

import { validerSecretTache } from "@/server/env-schema";

// CRON_SECRET, secret de la tâche quotidienne : obligatoire en production
// (une absence fait échouer la construction, voulu), facultative ailleurs
// (absente : tout appel refusé). 43 à 256 caractères base64url : 43 est la
// longueur de 32 octets aléatoires. Fonction pure, à côté de
// validerConfigurationEmail. Fiche : docs/features/tache-quotidienne.md,
// section 2.3, décision 1, test 3.

type Source = Record<string, string | undefined>;

// Valeurs factices, distinctives pour qu'une fuite dans le message se voie.
const VALIDE_43 = "Fact1ce_Secret-De-Tache-Quotidienne-43carac";
const VALIDE_256 = `Fact1ce_${"x".repeat(248)}`;

const PRODUCTION = { NODE_ENV: "production", VERCEL: "1", VERCEL_ENV: "production" } as const;
const PREVISUALISATION = { NODE_ENV: "production", VERCEL: "1", VERCEL_ENV: "preview" } as const;

function messageErreur(source: Source): string {
  try {
    validerSecretTache(source);
  } catch (erreur) {
    return (erreur as Error).message;
  }
  throw new Error("validerSecretTache aurait dû lever une erreur");
}

describe("les longueurs de référence", () => {
  test("43 et 256 caractères", () => {
    expect(VALIDE_43).toHaveLength(43);
    expect(VALIDE_256).toHaveLength(256);
  });
});

describe("en production", () => {
  test("absente : refusée, variable nommée", () => {
    expect(messageErreur({ ...PRODUCTION })).toMatch(/^- CRON_SECRET : absente$/mu);
  });

  test("vide : refusée", () => {
    expect(messageErreur({ ...PRODUCTION, CRON_SECRET: "" })).toMatch(/^- CRON_SECRET : /mu);
  });

  test.each([
    ["42 caractères (trop court)", VALIDE_43.slice(0, 42)],
    ["257 caractères (trop long)", `${VALIDE_256}x`],
    ["une espace", `${VALIDE_43.slice(0, 20)} ${VALIDE_43.slice(20)}`],
    ["un retour à la ligne final", `${VALIDE_43}\n`],
    ["un guillemet", `"${VALIDE_43}"`],
    ["remplissage base64 (=)", `${VALIDE_43}=`],
    ["caractère base64 standard (+)", `${VALIDE_43.slice(0, -1)}+`],
    ["caractère base64 standard (/)", `${VALIDE_43.slice(0, -1)}/`],
    ["lettre accentuée", `${VALIDE_43.slice(0, -1)}é`],
  ])("%s : refusée, message sans la valeur", (_nom, valeur) => {
    const message = messageErreur({ ...PRODUCTION, CRON_SECRET: valeur });

    expect(message).toMatch(/^- CRON_SECRET : /mu);
    expect(message).not.toContain(valeur.trim());
    expect(message).not.toContain("Fact1ce");
  });

  test.each([
    ["43 caractères", VALIDE_43],
    ["256 caractères", VALIDE_256],
    ["32 octets aléatoires en base64url", Buffer.alloc(32, 0xfb).toString("base64url")],
  ])("%s : acceptée, valeur gardée telle quelle", (_nom, valeur) => {
    const lue = validerSecretTache({ ...PRODUCTION, CRON_SECRET: valeur });

    expect(lue).toEqual({ secret: valeur });
    expect(Object.isFrozen(lue)).toBe(true);
  });
});

describe("hors production", () => {
  test.each([
    ["prévisualisation", PREVISUALISATION],
    ["local, next start", { NODE_ENV: "production" }],
    ["local, next dev", { NODE_ENV: "development" }],
    ["tests", { NODE_ENV: "test" }],
  ])("%s, absente : secret nul (tout appel refusé)", (_nom, source) => {
    expect(validerSecretTache({ ...source })).toEqual({ secret: null });
  });

  test("prévisualisation, présente et valide : acceptée", () => {
    expect(validerSecretTache({ ...PREVISUALISATION, CRON_SECRET: VALIDE_43 })).toEqual({
      secret: VALIDE_43,
    });
  });

  test.each([
    ["prévisualisation", PREVISUALISATION],
    ["local", { NODE_ENV: "development" }],
  ])("%s, trop courte : refusée aussi, message sans la valeur", (_nom, source) => {
    const valeur = VALIDE_43.slice(0, 42);
    const message = messageErreur({ ...source, CRON_SECRET: valeur });

    expect(message).toMatch(/^- CRON_SECRET : /mu);
    expect(message).not.toContain(valeur);
  });

  test("présente mais vide : refusée, comme EMAIL_*", () => {
    expect(messageErreur({ ...PREVISUALISATION, CRON_SECRET: "" })).toMatch(/^- CRON_SECRET : /mu);
  });
});
