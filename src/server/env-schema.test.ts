import { describe, expect, test } from "vitest";

import { validerEnvironnement } from "@/server/env-schema";

// Valeurs factices, sans rapport avec un secret réel.
const SECRET_32 = "s".repeat(32);
const URL_BASE_DISTANTE =
  "postgresql://app_facturation:mdp-factice@base.exemple.test/facturation?sslmode=verify-full";
const URL_AUTH = "https://facturation.exemple.test";

function sourceValide(): Record<string, string | undefined> {
  return {
    DATABASE_URL: URL_BASE_DISTANTE,
    BETTER_AUTH_SECRET: SECRET_32,
    BETTER_AUTH_URL: URL_AUTH,
  };
}

function messageErreur(source: Record<string, string | undefined>): string {
  try {
    validerEnvironnement(source);
  } catch (erreur) {
    return (erreur as Error).message;
  }
  throw new Error("validerEnvironnement aurait dû lever une erreur");
}

function attendreErreur(
  source: Record<string, string | undefined>,
  variable: string,
  raison: string,
): void {
  expect(messageErreur(source)).toContain(`- ${variable} : ${raison}`);
}

describe("validerEnvironnement : cas valides", () => {
  test("renvoie les trois valeurs, et seulement elles, dans un objet figé", () => {
    const resultat = validerEnvironnement({
      ...sourceValide(),
      AUTRE_VARIABLE: "ignoree",
      NODE_ENV: "production",
    });
    expect(resultat).toStrictEqual({
      DATABASE_URL: URL_BASE_DISTANTE,
      BETTER_AUTH_SECRET: SECRET_32,
      BETTER_AUTH_URL: URL_AUTH,
    });
    expect(Object.isFrozen(resultat)).toBe(true);
  });

  test("accepte le protocole postgres:", () => {
    const url = "postgres://app_facturation:mdp@base.exemple.test/facturation?sslmode=verify-full";
    const resultat = validerEnvironnement({ ...sourceValide(), DATABASE_URL: url });
    expect(resultat.DATABASE_URL).toBe(url);
  });

  test("accepte localhost sans sslmode", () => {
    const url = "postgresql://app_facturation:mdp@localhost:5432/facturation";
    expect(validerEnvironnement({ ...sourceValide(), DATABASE_URL: url }).DATABASE_URL).toBe(url);
  });

  test("accepte 127.0.0.1 sans sslmode", () => {
    const url = "postgresql://app_facturation:mdp@127.0.0.1:5432/facturation";
    expect(validerEnvironnement({ ...sourceValide(), DATABASE_URL: url }).DATABASE_URL).toBe(url);
  });

  test("accepte le nom d'utilisateur encodé app%5Ffacturation", () => {
    const url =
      "postgresql://app%5Ffacturation:mdp@base.exemple.test/facturation?sslmode=verify-full";
    expect(validerEnvironnement({ ...sourceValide(), DATABASE_URL: url }).DATABASE_URL).toBe(url);
  });

  test("accepte un secret de 32 caractères exactement", () => {
    expect(validerEnvironnement(sourceValide()).BETTER_AUTH_SECRET).toBe(SECRET_32);
  });

  test("accepte BETTER_AUTH_URL en http: sur localhost", () => {
    const url = "http://localhost:3000";
    expect(validerEnvironnement({ ...sourceValide(), BETTER_AUTH_URL: url }).BETTER_AUTH_URL).toBe(
      url,
    );
  });

  test("accepte BETTER_AUTH_URL en http: sur 127.0.0.1", () => {
    const url = "http://127.0.0.1:3000";
    expect(validerEnvironnement({ ...sourceValide(), BETTER_AUTH_URL: url }).BETTER_AUTH_URL).toBe(
      url,
    );
  });
});

describe("validerEnvironnement : prévisualisation Vercel", () => {
  test("déduit BETTER_AUTH_URL de VERCEL_URL quand elle est absente", () => {
    const resultat = validerEnvironnement({
      ...sourceValide(),
      BETTER_AUTH_URL: undefined,
      VERCEL_ENV: "preview",
      VERCEL_URL: "facturation-git-branche.vercel.app",
    });
    expect(resultat).toStrictEqual({
      DATABASE_URL: URL_BASE_DISTANTE,
      BETTER_AUTH_SECRET: SECRET_32,
      BETTER_AUTH_URL: "https://facturation-git-branche.vercel.app",
    });
  });

  test("déduit BETTER_AUTH_URL de VERCEL_URL quand elle est vide", () => {
    const resultat = validerEnvironnement({
      ...sourceValide(),
      BETTER_AUTH_URL: "",
      VERCEL_ENV: "preview",
      VERCEL_URL: "facturation-git-branche.vercel.app",
    });
    expect(resultat.BETTER_AUTH_URL).toBe("https://facturation-git-branche.vercel.app");
  });

  test("garde BETTER_AUTH_URL telle quelle quand elle est présente", () => {
    const resultat = validerEnvironnement({
      ...sourceValide(),
      VERCEL_ENV: "preview",
      VERCEL_URL: "facturation-git-branche.vercel.app",
    });
    expect(resultat.BETTER_AUTH_URL).toBe(URL_AUTH);
  });
});

describe("validerEnvironnement : DATABASE_URL invalide", () => {
  test("absente", () => {
    attendreErreur({ ...sourceValide(), DATABASE_URL: undefined }, "DATABASE_URL", "absente");
  });

  test("vide", () => {
    attendreErreur({ ...sourceValide(), DATABASE_URL: "" }, "DATABASE_URL", "absente");
  });

  test("pas une URL", () => {
    attendreErreur(
      { ...sourceValide(), DATABASE_URL: "pas une adresse" },
      "DATABASE_URL",
      "n'est pas une adresse PostgreSQL valide",
    );
  });

  test("protocole autre que PostgreSQL", () => {
    attendreErreur(
      {
        ...sourceValide(),
        DATABASE_URL:
          "https://app_facturation:mdp@base.exemple.test/facturation?sslmode=verify-full",
      },
      "DATABASE_URL",
      "n'est pas une adresse PostgreSQL valide",
    );
  });

  test("rôle neondb_owner", () => {
    attendreErreur(
      {
        ...sourceValide(),
        DATABASE_URL:
          "postgresql://neondb_owner:mdp@base.exemple.test/facturation?sslmode=verify-full",
      },
      "DATABASE_URL",
      "doit utiliser le rôle app_facturation",
    );
  });

  test.each([
    ["autre_role", "autre_role:mdp@"],
    ["APP_FACTURATION", "APP_FACTURATION:mdp@"],
    ["app_facturation2", "app_facturation2:mdp@"],
    ["sans nom d'utilisateur", ""],
  ])("rôle refusé : %s", (_cas, identifiants) => {
    attendreErreur(
      {
        ...sourceValide(),
        DATABASE_URL: `postgresql://${identifiants}base.exemple.test/facturation?sslmode=verify-full`,
      },
      "DATABASE_URL",
      "doit utiliser le rôle app_facturation",
    );
  });

  test("hôte distant sans sslmode", () => {
    attendreErreur(
      {
        ...sourceValide(),
        DATABASE_URL: "postgresql://app_facturation:mdp@base.exemple.test/facturation",
      },
      "DATABASE_URL",
      "doit exiger sslmode=verify-full",
    );
  });

  test("hôte distant avec sslmode=require", () => {
    attendreErreur(
      {
        ...sourceValide(),
        DATABASE_URL:
          "postgresql://app_facturation:mdp@base.exemple.test/facturation?sslmode=require",
      },
      "DATABASE_URL",
      "doit exiger sslmode=verify-full",
    );
  });
});

describe("validerEnvironnement : BETTER_AUTH_SECRET invalide", () => {
  test("absente", () => {
    attendreErreur(
      { ...sourceValide(), BETTER_AUTH_SECRET: undefined },
      "BETTER_AUTH_SECRET",
      "absente",
    );
  });

  test("vide", () => {
    attendreErreur({ ...sourceValide(), BETTER_AUTH_SECRET: "" }, "BETTER_AUTH_SECRET", "absente");
  });

  test("31 caractères", () => {
    attendreErreur(
      { ...sourceValide(), BETTER_AUTH_SECRET: "s".repeat(31) },
      "BETTER_AUTH_SECRET",
      "doit faire au moins 32 caractères",
    );
  });
});

describe("validerEnvironnement : BETTER_AUTH_URL invalide", () => {
  test("absente hors de Vercel", () => {
    attendreErreur({ ...sourceValide(), BETTER_AUTH_URL: undefined }, "BETTER_AUTH_URL", "absente");
  });

  test("absente en production Vercel, même avec VERCEL_URL", () => {
    attendreErreur(
      {
        ...sourceValide(),
        BETTER_AUTH_URL: undefined,
        VERCEL_ENV: "production",
        VERCEL_URL: "facturation.vercel.app",
      },
      "BETTER_AUTH_URL",
      "absente",
    );
  });

  test("absente avec VERCEL_URL mais sans VERCEL_ENV", () => {
    attendreErreur(
      { ...sourceValide(), BETTER_AUTH_URL: undefined, VERCEL_URL: "facturation.vercel.app" },
      "BETTER_AUTH_URL",
      "absente",
    );
  });

  test("absente avec VERCEL_ENV=Preview (casse différente)", () => {
    attendreErreur(
      {
        ...sourceValide(),
        BETTER_AUTH_URL: undefined,
        VERCEL_ENV: "Preview",
        VERCEL_URL: "facturation.vercel.app",
      },
      "BETTER_AUTH_URL",
      "absente",
    );
  });

  test("absente en prévisualisation sans VERCEL_URL", () => {
    attendreErreur(
      { ...sourceValide(), BETTER_AUTH_URL: undefined, VERCEL_ENV: "preview" },
      "BETTER_AUTH_URL",
      "absente",
    );
  });

  test("pas une URL", () => {
    attendreErreur(
      { ...sourceValide(), BETTER_AUTH_URL: "pas une adresse" },
      "BETTER_AUTH_URL",
      "n'est pas une adresse valide",
    );
  });

  test("protocole autre que http: ou https:", () => {
    attendreErreur(
      { ...sourceValide(), BETTER_AUTH_URL: "ftp://facturation.exemple.test" },
      "BETTER_AUTH_URL",
      "n'est pas une adresse valide",
    );
  });

  test("http: sur un hôte distant", () => {
    attendreErreur(
      { ...sourceValide(), BETTER_AUTH_URL: "http://facturation.exemple.test" },
      "BETTER_AUTH_URL",
      "doit utiliser https",
    );
  });
});

describe("validerEnvironnement : plusieurs erreurs", () => {
  test("cite les trois variables, dans l'ordre, au format attendu", () => {
    const message = messageErreur({
      DATABASE_URL:
        "postgresql://neondb_owner:mdp@base.exemple.test/facturation?sslmode=verify-full",
      BETTER_AUTH_SECRET: "court",
      BETTER_AUTH_URL: "http://facturation.exemple.test",
    });
    expect(message).toBe(
      [
        "Variables d'environnement invalides :",
        "- DATABASE_URL : doit utiliser le rôle app_facturation",
        "- BETTER_AUTH_SECRET : doit faire au moins 32 caractères",
        "- BETTER_AUTH_URL : doit utiliser https",
      ].join("\n"),
    );
  });
});
