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

  // Variables Gmail factices : obligatoires en production depuis la PR 2.
  test.each([
    ["preview", "memoire"],
    ["production", "smtp"],
  ])("sur Vercel (VERCEL_ENV=%s) : %s", (vercelEnv, attendu) => {
    const configuration = validerConfigurationEmail({
      NODE_ENV: "production",
      VERCEL_ENV: vercelEnv,
      GMAIL_UTILISATEUR: "facturation.factice@gmail.com",
      GMAIL_MOT_DE_PASSE_APPLICATION: "abcdefghijklmnop",
    });
    expect(configuration.transport).toBe(attendu);
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

// Vercel tel que les variables y sont posées (section 9). Production : la
// PR 2 refuse l'absence des variables Gmail (décision 4, corrigée).
// Prévisualisation sans variable : memoire, comme en PR 1. Valeurs factices.
describe("après la PR 2 : Vercel", () => {
  test("production sans aucune variable d'envoi : refusée, variables Gmail nommées", () => {
    const message = messageErreur({
      NODE_ENV: "production",
      VERCEL: "1",
      VERCEL_ENV: "production",
      VERCEL_URL: "facturation-abc123.vercel.app",
    });
    expect(message).toMatch(/^- GMAIL_UTILISATEUR : /mu);
    expect(message).toMatch(/^- GMAIL_MOT_DE_PASSE_APPLICATION : /mu);
  });

  // Configuration de Vercel au 2026-10-13 : GMAIL_UTILISATEUR et
  // GMAIL_MOT_DE_PASSE_APPLICATION posées en production, EMAIL_TRANSPORT
  // absente : smtp.
  test("production avec les variables Gmail, sans EMAIL_TRANSPORT : smtp, aucun refus", () => {
    expect(
      validerConfigurationEmail({
        NODE_ENV: "production",
        VERCEL: "1",
        VERCEL_ENV: "production",
        VERCEL_URL: "facturation-abc123.vercel.app",
        GMAIL_UTILISATEUR: "facturation.factice@gmail.com",
        GMAIL_MOT_DE_PASSE_APPLICATION: "abcdefghijklmnop",
      }),
    ).toStrictEqual({
      transport: "smtp",
      dossier: null,
      destinatairesAutorises: [],
      estProduction: true,
      gmail: { utilisateur: "facturation.factice@gmail.com", motDePasse: "abcdefghijklmnop" },
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
      gmail: null,
    });
  });
});

describe("estProduction", () => {
  test.each([
    [
      "VERCEL_ENV=production",
      {
        VERCEL_ENV: "production",
        GMAIL_UTILISATEUR: "facturation.factice@gmail.com",
        GMAIL_MOT_DE_PASSE_APPLICATION: "abcdefghijklmnop",
      },
      true,
    ],
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
  test("objet figé, cinq propriétés exactement", () => {
    const configuration = validerConfigurationEmail({
      NODE_ENV: "test",
      AUTRE_VARIABLE: "ignoree",
    });
    expect(configuration).toStrictEqual({
      transport: "memoire",
      dossier: null,
      destinatairesAutorises: [],
      estProduction: false,
      gmail: null,
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

// PR 2 : transport smtp et variables Gmail. Règle corrigée par le relecteur
// (section 2.2) : en production, EMAIL_TRANSPORT est facultatif et vaut smtp
// s'il est absent ; toute autre valeur est refusée ; les deux variables Gmail
// sont obligatoires. En prévisualisation sans variable : memoire, inchangé.
// Interface attendue : transport « smtp » de plus, et une cinquième
// propriété, gmail ({ utilisateur, motDePasse } ou null). Valeurs factices.
describe("PR 2 : smtp et variables Gmail", () => {
  const UTILISATEUR = "facturation.factice@gmail.com";
  const MOT_DE_PASSE = "abcdefghijklmnop";
  const GMAIL = {
    GMAIL_UTILISATEUR: UTILISATEUR,
    GMAIL_MOT_DE_PASSE_APPLICATION: MOT_DE_PASSE,
  } as const;
  const PRODUCTION = {
    NODE_ENV: "production",
    VERCEL: "1",
    VERCEL_ENV: "production",
    VERCEL_URL: "facturation-abc123.vercel.app",
  } as const;
  const PREVISUALISATION = {
    NODE_ENV: "production",
    VERCEL: "1",
    VERCEL_ENV: "preview",
    VERCEL_URL: "facturation-git-feat-envoi-emails-2.vercel.app",
  } as const;
  const LISTE = "moi@exemple.invalid";

  function sansValeur(message: string): void {
    expect(message).not.toContain(MOT_DE_PASSE);
    expect(message).not.toContain(UTILISATEUR);
  }

  describe("production", () => {
    test("variables Gmail, EMAIL_TRANSPORT absente : smtp (configuration de Vercel)", () => {
      const configuration = validerConfigurationEmail({ ...PRODUCTION, ...GMAIL });
      expect(configuration.transport).toBe("smtp");
      expect(configuration.estProduction).toBe(true);
      expect(configuration.dossier).toBeNull();
      expect(configuration.gmail).toStrictEqual({
        utilisateur: UTILISATEUR,
        motDePasse: MOT_DE_PASSE,
      });
      expect(Object.isFrozen(configuration.gmail)).toBe(true);
    });

    test("EMAIL_TRANSPORT=smtp : smtp", () => {
      expect(
        validerConfigurationEmail({ ...PRODUCTION, ...GMAIL, EMAIL_TRANSPORT: "smtp" }).transport,
      ).toBe("smtp");
    });

    test.each(["memoire", "fichier", "", "SMTP", " smtp"])(
      "EMAIL_TRANSPORT=%j : refusée",
      (valeur) => {
        // Témoin dans le même test : les mêmes variables, sans EMAIL_TRANSPORT,
        // sont acceptées. Sans lui, le refus de tout smtp par la PR 1 suffirait.
        expect(validerConfigurationEmail({ ...PRODUCTION, ...GMAIL }).transport).toBe("smtp");
        const message = messageErreur({ ...PRODUCTION, ...GMAIL, EMAIL_TRANSPORT: valeur });
        expect(message).toMatch(/^- EMAIL_TRANSPORT : /mu);
        sansValeur(message);
      },
    );

    test("aucune variable d'envoi : refusée, les deux variables Gmail nommées", () => {
      const message = messageErreur({ ...PRODUCTION });
      expect(message).toMatch(/^- GMAIL_UTILISATEUR : /mu);
      expect(message).toMatch(/^- GMAIL_MOT_DE_PASSE_APPLICATION : /mu);
    });

    test.each([
      ["GMAIL_UTILISATEUR absente", { GMAIL_UTILISATEUR: undefined }, "GMAIL_UTILISATEUR"],
      ["GMAIL_UTILISATEUR vide", { GMAIL_UTILISATEUR: "" }, "GMAIL_UTILISATEUR"],
      [
        "GMAIL_MOT_DE_PASSE_APPLICATION absente",
        { GMAIL_MOT_DE_PASSE_APPLICATION: undefined },
        "GMAIL_MOT_DE_PASSE_APPLICATION",
      ],
      [
        "GMAIL_MOT_DE_PASSE_APPLICATION vide",
        { GMAIL_MOT_DE_PASSE_APPLICATION: "" },
        "GMAIL_MOT_DE_PASSE_APPLICATION",
      ],
    ] as const)("%s : refusée", (_nom, variables, variable) => {
      const message = messageErreur({ ...PRODUCTION, ...GMAIL, ...variables });
      expect(message).toMatch(new RegExp(`^- ${variable} : `, "mu"));
      sansValeur(message);
    });

    test.each([
      ["pas une adresse", "valeur-piege-42"],
      ["autre domaine que gmail.com", "valeur-piege-42@exemple.invalid"],
      ["retour à la ligne", "valeur-piege-42@gmail.com\r\nBcc: x@gmail.com"],
      ["nom affiché", "Facturation <valeur-piege-42@gmail.com>"],
    ])("GMAIL_UTILISATEUR, %s : refusée, sans la valeur", (_nom, valeur) => {
      const message = messageErreur({ ...PRODUCTION, ...GMAIL, GMAIL_UTILISATEUR: valeur });
      expect(message).toMatch(/^- GMAIL_UTILISATEUR : /mu);
      expect(message).not.toContain("valeur-piege-42");
      sansValeur(message);
    });

    test.each([
      ["15 lettres", "abcdefghijklmno"],
      ["17 lettres", "abcdefghijklmnopq"],
      ["majuscules", "ABCDEFGHIJKLMNOP"],
      ["chiffres", "abcdefgh12345678"],
      ["retour à la ligne", "abcdefgh\r\nijklmnop"],
    ])("GMAIL_MOT_DE_PASSE_APPLICATION, %s : refusée, sans la valeur", (_nom, valeur) => {
      const message = messageErreur({
        ...PRODUCTION,
        ...GMAIL,
        GMAIL_MOT_DE_PASSE_APPLICATION: valeur,
      });
      expect(message).toMatch(/^- GMAIL_MOT_DE_PASSE_APPLICATION : /mu);
      expect(message).not.toContain(valeur.slice(0, 8));
      sansValeur(message);
    });

    test("EMAIL_DESTINATAIRES_AUTORISES présente : ignorée, aucun refus", () => {
      expect(
        validerConfigurationEmail({
          ...PRODUCTION,
          ...GMAIL,
          EMAIL_DESTINATAIRES_AUTORISES: LISTE,
        }).transport,
      ).toBe("smtp");
    });
  });

  describe("mot de passe d'application (décision 2 du relecteur)", () => {
    function production(motDePasse: string) {
      return { ...PRODUCTION, ...GMAIL, GMAIL_MOT_DE_PASSE_APPLICATION: motDePasse };
    }

    test.each([
      ["groupes de quatre, comme Google l'affiche", "abcd efgh ijkl mnop"],
      ["espaces de bord et doubles", "  abcd  efgh ijklmnop "],
    ])("avec espaces (%s) : accepté, espaces retirés", (_nom, valeur) => {
      expect(validerConfigurationEmail(production(valeur)).gmail?.motDePasse).toBe(MOT_DE_PASSE);
    });

    test.each([
      ["tabulation", "abcd\tefgh ijkl mnop"],
      ["retour à la ligne", "abcd efgh\nijkl mnop"],
      ["retour chariot", "abcd efgh\rijkl mnop"],
      ["espace insécable", "abcd\u00a0efgh ijkl mnop"],
      ["15 lettres avec espaces", "abcd efgh ijkl mno"],
      ["17 lettres avec espaces", "abcd efgh ijkl mnopq"],
      ["une majuscule", "abcd efgh ijkl mnoP"],
      ["seulement des espaces", "                "],
    ])("%s : refusé, sans la valeur", (_nom, valeur) => {
      const message = messageErreur(production(valeur));
      expect(message).toMatch(/^- GMAIL_MOT_DE_PASSE_APPLICATION : /mu);
      for (const morceau of valeur.split(/\s+/u).filter((m) => m.length >= 3)) {
        expect(message).not.toContain(morceau);
      }
      sansValeur(message);
    });
  });

  describe("prévisualisation", () => {
    test("sans aucune variable : memoire, gmail null (inchangé)", () => {
      const configuration = validerConfigurationEmail({ ...PREVISUALISATION });
      expect(configuration.transport).toBe("memoire");
      expect(configuration.gmail).toBeNull();
    });

    test("smtp, variables Gmail et liste autorisée (branche feat/envoi-emails-2) : smtp", () => {
      const configuration = validerConfigurationEmail({
        ...PREVISUALISATION,
        ...GMAIL,
        EMAIL_TRANSPORT: "smtp",
        EMAIL_DESTINATAIRES_AUTORISES: LISTE,
      });
      expect(configuration.transport).toBe("smtp");
      expect(configuration.estProduction).toBe(false);
      expect(configuration.destinatairesAutorises).toStrictEqual([LISTE]);
      expect(configuration.gmail).toStrictEqual({
        utilisateur: UTILISATEUR,
        motDePasse: MOT_DE_PASSE,
      });
    });

    test("smtp sans liste autorisée : refusée", () => {
      const message = messageErreur({ ...PREVISUALISATION, ...GMAIL, EMAIL_TRANSPORT: "smtp" });
      expect(message).toMatch(/^- EMAIL_DESTINATAIRES_AUTORISES : /mu);
      sansValeur(message);
    });

    test("smtp sans variable Gmail : refusée", () => {
      const message = messageErreur({
        ...PREVISUALISATION,
        EMAIL_TRANSPORT: "smtp",
        EMAIL_DESTINATAIRES_AUTORISES: LISTE,
      });
      expect(message).toMatch(/^- GMAIL_UTILISATEUR : /mu);
      expect(message).toMatch(/^- GMAIL_MOT_DE_PASSE_APPLICATION : /mu);
    });
  });

  describe("sous NODE_ENV=test", () => {
    test("smtp refusé, même complet", () => {
      // Témoin : la même configuration hors NODE_ENV=test est acceptée.
      expect(
        validerConfigurationEmail({
          NODE_ENV: "development",
          ...GMAIL,
          EMAIL_TRANSPORT: "smtp",
          EMAIL_DESTINATAIRES_AUTORISES: LISTE,
        }).transport,
      ).toBe("smtp");
      const message = messageErreur({
        NODE_ENV: "test",
        ...GMAIL,
        EMAIL_TRANSPORT: "smtp",
        EMAIL_DESTINATAIRES_AUTORISES: LISTE,
      });
      expect(message).toMatch(/^- EMAIL_TRANSPORT : /mu);
      sansValeur(message);
    });
  });

  describe("poste local (essai réel par le terminal, section 9)", () => {
    test("smtp, variables Gmail et liste : smtp, estProduction faux", () => {
      const configuration = validerConfigurationEmail({
        NODE_ENV: "development",
        ...GMAIL,
        EMAIL_TRANSPORT: "smtp",
        EMAIL_DESTINATAIRES_AUTORISES: LISTE,
      });
      expect(configuration.transport).toBe("smtp");
      expect(configuration.estProduction).toBe(false);
    });

    test("smtp sans liste autorisée : refusée", () => {
      const message = messageErreur({
        NODE_ENV: "development",
        ...GMAIL,
        EMAIL_TRANSPORT: "smtp",
      });
      expect(message).toMatch(/^- EMAIL_DESTINATAIRES_AUTORISES : /mu);
    });
  });

  describe("transports memoire et fichier", () => {
    test.each([
      ["memoire", { NODE_ENV: "test" }],
      ["fichier", { NODE_ENV: "development" }],
    ] as const)("%s : gmail null", (_nom, source) => {
      expect(validerConfigurationEmail(source).gmail).toBeNull();
    });
  });
});
