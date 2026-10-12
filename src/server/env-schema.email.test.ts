import { describe, expect, test } from "vitest";

import { validerConfigurationEmail } from "@/server/env-schema";

// Configuration de l'envoi d'emails, PR 1 : transport, liste autorisée,
// dossier, production. Fonction pure, à côté de validerEnvironnement, qui
// reçoit les variables en paramètre. Les variables Gmail et le transport smtp
// sont la PR 2. Fiche : docs/features/envoi-emails.md, sections 2.1 et 2.2.

type Source = Record<string, string | undefined>;

function messageErreur(source: Source): string {
  try {
    validerConfigurationEmail(source);
  } catch (erreur) {
    return (erreur as Error).message;
  }
  throw new Error("validerConfigurationEmail aurait dû lever une erreur");
}

describe("EMAIL_TRANSPORT absente : valeur selon l'environnement", () => {
  test("sous NODE_ENV=test : memoire", () => {
    expect(validerConfigurationEmail({ NODE_ENV: "test" }).transport).toBe("memoire");
  });

  test.each(["development", "production", undefined])(
    "hors Vercel, NODE_ENV=%s : fichier, dossier .emails par défaut",
    (nodeEnv) => {
      const configuration = validerConfigurationEmail({ NODE_ENV: nodeEnv });
      expect(configuration.transport).toBe("fichier");
      expect(configuration.dossier).toBe(".emails");
    },
  );

  test.each(["preview", "production"])("sur Vercel (VERCEL_ENV=%s) : memoire", (vercelEnv) => {
    const configuration = validerConfigurationEmail({
      NODE_ENV: "production",
      VERCEL_ENV: vercelEnv,
    });
    expect(configuration.transport).toBe("memoire");
    expect(configuration.dossier).toBeNull();
  });
});

describe("EMAIL_TRANSPORT explicite", () => {
  test("memoire et fichier acceptés hors Vercel", () => {
    expect(
      validerConfigurationEmail({ NODE_ENV: "development", EMAIL_TRANSPORT: "memoire" }).transport,
    ).toBe("memoire");
    expect(
      validerConfigurationEmail({ NODE_ENV: "test", EMAIL_TRANSPORT: "fichier" }).transport,
    ).toBe("fichier");
  });

  test("EMAIL_DOSSIER est repris pour fichier (tests de bout en bout)", () => {
    const configuration = validerConfigurationEmail({
      NODE_ENV: "production",
      EMAIL_TRANSPORT: "fichier",
      EMAIL_DOSSIER: "/tmp/emails-e2e",
    });
    expect(configuration.dossier).toBe("/tmp/emails-e2e");
  });

  test("fichier refusé sur Vercel : système de fichiers en lecture seule", () => {
    expect(
      messageErreur({ NODE_ENV: "production", VERCEL_ENV: "preview", EMAIL_TRANSPORT: "fichier" }),
    ).toMatch(/^- EMAIL_TRANSPORT : /mu);
  });

  test.each(["smtp-factice", "Memoire", "", " fichier"])(
    "valeur inconnue %j : refusée",
    (valeur) => {
      expect(messageErreur({ NODE_ENV: "development", EMAIL_TRANSPORT: valeur })).toMatch(
        /^- EMAIL_TRANSPORT : /mu,
      );
    },
  );

  test("le message ne contient pas la valeur reçue", () => {
    const message = messageErreur({ NODE_ENV: "development", EMAIL_TRANSPORT: "valeur-piege-42" });
    expect(message).toMatch(/^- EMAIL_TRANSPORT : /mu);
    expect(message).not.toContain("valeur-piege-42");
  });
});

describe("EMAIL_DESTINATAIRES_AUTORISES", () => {
  test("absente : liste vide", () => {
    expect(validerConfigurationEmail({ NODE_ENV: "test" }).destinatairesAutorises).toEqual([]);
  });

  test("liste séparée par des virgules, espaces retirés, domaines en minuscules", () => {
    const configuration = validerConfigurationEmail({
      NODE_ENV: "development",
      EMAIL_DESTINATAIRES_AUTORISES: " Moi@Exemple.INVALID , autre@exemple.invalid",
    });
    expect(configuration.destinatairesAutorises).toEqual([
      "Moi@exemple.invalid",
      "autre@exemple.invalid",
    ]);
  });

  test.each([
    ["adresse invalide", "pas-une-adresse"],
    ["élément vide", "moi@exemple.invalid,,autre@exemple.invalid"],
    ["retour à la ligne", "moi@exemple.invalid\r\nBcc: x@exemple.invalid"],
  ])("%s : refusée, sans la valeur dans le message", (_nom, valeur) => {
    const message = messageErreur({
      NODE_ENV: "development",
      EMAIL_DESTINATAIRES_AUTORISES: valeur,
    });
    expect(message).toMatch(/^- EMAIL_DESTINATAIRES_AUTORISES : /mu);
    expect(message).not.toContain("exemple.invalid");
    expect(message).not.toContain("pas-une-adresse");
  });
});

// Cohérence de main à la fusion de la PR 1 (« Découpage en PR ») : Vercel
// n'a encore aucune variable d'envoi. Un refus ici ferait échouer chaque
// requête du site. Variables telles que Vercel les pose, sans EMAIL_* ni
// GMAIL_*. La PR 2 remplace le cas de la production (décision 4).
describe("après la PR 1 : Vercel sans aucune variable d'envoi", () => {
  test("production : memoire, estProduction vrai, aucun refus", () => {
    expect(
      validerConfigurationEmail({
        NODE_ENV: "production",
        VERCEL: "1",
        VERCEL_ENV: "production",
        VERCEL_URL: "facturation-abc123.vercel.app",
      }),
    ).toStrictEqual({
      transport: "memoire",
      dossier: null,
      destinatairesAutorises: [],
      estProduction: true,
    });
  });

  test("prévisualisation : memoire, estProduction faux, aucun refus", () => {
    expect(
      validerConfigurationEmail({
        NODE_ENV: "production",
        VERCEL: "1",
        VERCEL_ENV: "preview",
        VERCEL_URL: "facturation-git-branche.vercel.app",
      }),
    ).toStrictEqual({
      transport: "memoire",
      dossier: null,
      destinatairesAutorises: [],
      estProduction: false,
    });
  });
});

describe("estProduction", () => {
  test.each([
    ["VERCEL_ENV=production", { VERCEL_ENV: "production" }, true],
    ["VERCEL_ENV=preview", { VERCEL_ENV: "preview" }, false],
    ["VERCEL_ENV=Production (casse différente)", { VERCEL_ENV: "Production" }, false],
    ["NODE_ENV=production hors Vercel (next start local, tests de bout en bout)", {}, false],
  ])("%s : %s", (_nom, source: Source, attendu) => {
    expect(validerConfigurationEmail({ NODE_ENV: "production", ...source }).estProduction).toBe(
      attendu,
    );
  });
});

describe("forme du résultat", () => {
  test("objet figé, quatre propriétés exactement", () => {
    const configuration = validerConfigurationEmail({
      NODE_ENV: "test",
      AUTRE_VARIABLE: "ignoree",
    });
    expect(configuration).toStrictEqual({
      transport: "memoire",
      dossier: null,
      destinatairesAutorises: [],
      estProduction: false,
    });
    expect(Object.isFrozen(configuration)).toBe(true);
    expect(Object.isFrozen(configuration.destinatairesAutorises)).toBe(true);
  });

  test("message d'erreur : même en-tête que validerEnvironnement", () => {
    expect(messageErreur({ NODE_ENV: "development", EMAIL_TRANSPORT: "x" })).toMatch(
      /^Variables d'environnement invalides :\n/u,
    );
  });
});
