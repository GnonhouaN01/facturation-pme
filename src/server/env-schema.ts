import "server-only";

import { z } from "zod";

// Messages destinés au développeur : ils nomment la raison, jamais la valeur (S-54).
const MESSAGES = {
  absente: "absente",
  postgresInvalide: "n'est pas une adresse PostgreSQL valide",
  role: "doit utiliser le rôle app_facturation",
  sslmode: "doit exiger sslmode=verify-full",
  secretCourt: "doit faire au moins 32 caractères",
  adresseInvalide: "n'est pas une adresse valide",
  https: "doit utiliser https",
} as const;

const ENTETE = "Variables d'environnement invalides :";
const ROLE_APPLICATION = "app_facturation";
const HOTES_LOCAUX = new Set(["localhost", "127.0.0.1"]);
const LONGUEUR_MIN_SECRET = 32;

function lireUrl(valeur: string): URL | null {
  try {
    return new URL(valeur);
  } catch {
    return null;
  }
}

function decoder(valeur: string): string | null {
  try {
    return decodeURIComponent(valeur);
  } catch {
    return null;
  }
}

function chainePresente() {
  return z.string({ error: MESSAGES.absente }).min(1, { error: MESSAGES.absente });
}

const schemaDatabaseUrl = chainePresente().superRefine((valeur, ctx) => {
  if (valeur === "") return;
  const url = lireUrl(valeur);
  if (!url || (url.protocol !== "postgres:" && url.protocol !== "postgresql:")) {
    ctx.addIssue({ code: "custom", message: MESSAGES.postgresInvalide });
    return;
  }
  if (decoder(url.username) !== ROLE_APPLICATION) {
    ctx.addIssue({ code: "custom", message: MESSAGES.role });
    return;
  }
  if (!HOTES_LOCAUX.has(url.hostname)) {
    const sslmodes = url.searchParams.getAll("sslmode");
    if (sslmodes.length !== 1 || sslmodes[0] !== "verify-full") {
      ctx.addIssue({ code: "custom", message: MESSAGES.sslmode });
    }
  }
});

const schemaSecret = chainePresente().superRefine((valeur, ctx) => {
  if (valeur !== "" && valeur.length < LONGUEUR_MIN_SECRET) {
    ctx.addIssue({ code: "custom", message: MESSAGES.secretCourt });
  }
});

const schemaAuthUrl = chainePresente().superRefine((valeur, ctx) => {
  if (valeur === "") return;
  const url = lireUrl(valeur);
  if (!url || (url.protocol !== "http:" && url.protocol !== "https:")) {
    ctx.addIssue({ code: "custom", message: MESSAGES.adresseInvalide });
    return;
  }
  if (url.protocol !== "https:" && !HOTES_LOCAUX.has(url.hostname)) {
    ctx.addIssue({ code: "custom", message: MESSAGES.https });
  }
});

const schemaEnvironnement = z.object({
  DATABASE_URL: schemaDatabaseUrl,
  BETTER_AUTH_SECRET: schemaSecret,
  BETTER_AUTH_URL: schemaAuthUrl,
});

const VARIABLES = ["DATABASE_URL", "BETTER_AUTH_SECRET", "BETTER_AUTH_URL"] as const;

export type Environnement = Readonly<z.infer<typeof schemaEnvironnement>>;

type Source = Readonly<Record<string, string | undefined>>;

// En prévisualisation Vercel, BETTER_AUTH_URL absente se déduit de VERCEL_URL.
function adresseAuth(source: Source): string | undefined {
  if (source.BETTER_AUTH_URL) return source.BETTER_AUTH_URL;
  if (source.VERCEL_ENV === "preview" && source.VERCEL_URL) {
    return `https://${source.VERCEL_URL}`;
  }
  return undefined;
}

export function validerEnvironnement(source: Source): Environnement {
  const resultat = schemaEnvironnement.safeParse({
    DATABASE_URL: source.DATABASE_URL,
    BETTER_AUTH_SECRET: source.BETTER_AUTH_SECRET,
    BETTER_AUTH_URL: adresseAuth(source),
  });

  if (resultat.success) {
    return Object.freeze({ ...resultat.data });
  }

  // L'erreur est reconstruite à partir du chemin et du message de chaque
  // problème : ni l'erreur Zod, ni de cause, pour qu'aucune valeur ne fuie (T-35).
  const lignes = VARIABLES.flatMap((variable) => {
    const probleme = resultat.error.issues.find((issue) => issue.path[0] === variable);
    return probleme ? [`- ${variable} : ${probleme.message}`] : [];
  });
  throw new Error([ENTETE, ...lignes].join("\n"));
}
