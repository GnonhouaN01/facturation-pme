import "server-only";

import { z } from "zod";

import { schemaAdresse } from "./email/adresse";

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

// Configuration de l'envoi d'emails, PR 1 : transport, liste autorisée,
// dossier, production. Fonction pure, comme validerEnvironnement ; les
// messages nomment la variable et la raison, jamais la valeur. Fiche :
// docs/features/envoi-emails.md, sections 2.1 et 2.2.
//
// Cohérence de main à la fusion de la PR 1 (« Découpage en PR ») : sur
// Vercel, aucune variable d'envoi n'existe encore. Absente, EMAIL_TRANSPORT y
// vaut memoire, en production comme en prévisualisation : un refus ferait
// échouer chaque requête du site. La règle « smtp obligatoire en
// production » (décision 4) n'entre en vigueur qu'avec la PR 2.

export type TransportEmail = "memoire" | "fichier";

export type ConfigurationEmail = Readonly<{
  transport: TransportEmail;
  // Dossier du transport fichier, null sinon.
  dossier: string | null;
  destinatairesAutorises: readonly string[];
  estProduction: boolean;
}>;

const MESSAGES_EMAIL = {
  transportInconnu: "doit valoir memoire ou fichier",
  fichierSurVercel: "fichier est impossible sur Vercel (système de fichiers en lecture seule)",
  adresses: "doit être une liste d'adresses valides séparées par des virgules",
  dossierVide: "ne doit pas être vide",
} as const;

const TRANSPORTS: readonly TransportEmail[] = ["memoire", "fichier"];
const DOSSIER_PAR_DEFAUT = ".emails";

function surVercel(source: Source): boolean {
  return (source.VERCEL_ENV !== undefined && source.VERCEL_ENV !== "") || source.VERCEL === "1";
}

function estTransport(valeur: string): valeur is TransportEmail {
  return (TRANSPORTS as readonly string[]).includes(valeur);
}

export function validerConfigurationEmail(source: Source): ConfigurationEmail {
  const erreurs: string[] = [];
  const vercel = surVercel(source);

  // Transport : absent, valeur selon l'environnement ; présent, exactement
  // memoire ou fichier (ni vide, ni espace, ni autre casse).
  let transport: TransportEmail;
  const brut = source.EMAIL_TRANSPORT;
  if (brut === undefined) {
    transport = source.NODE_ENV === "test" || vercel ? "memoire" : "fichier";
  } else if (!estTransport(brut)) {
    erreurs.push(`- EMAIL_TRANSPORT : ${MESSAGES_EMAIL.transportInconnu}`);
    transport = "memoire";
  } else if (brut === "fichier" && vercel) {
    erreurs.push(`- EMAIL_TRANSPORT : ${MESSAGES_EMAIL.fichierSurVercel}`);
    transport = "memoire";
  } else {
    transport = brut;
  }

  // Liste autorisée : adresses séparées par des virgules, chacune validée et
  // normalisée. Un élément vide est une faute.
  let destinatairesAutorises: string[] = [];
  const liste = source.EMAIL_DESTINATAIRES_AUTORISES;
  if (liste !== undefined) {
    const lues = liste.split(",").map((element) => schemaAdresse.safeParse(element));
    if (lues.every((lue) => lue.success)) {
      destinatairesAutorises = lues.map((lue) => lue.data as string);
    } else {
      erreurs.push(`- EMAIL_DESTINATAIRES_AUTORISES : ${MESSAGES_EMAIL.adresses}`);
    }
  }

  let dossier: string | null = null;
  if (transport === "fichier") {
    const choisi = source.EMAIL_DOSSIER;
    if (choisi === "") erreurs.push(`- EMAIL_DOSSIER : ${MESSAGES_EMAIL.dossierVide}`);
    dossier = choisi === undefined || choisi === "" ? DOSSIER_PAR_DEFAUT : choisi;
  }

  if (erreurs.length > 0) throw new Error([ENTETE, ...erreurs].join("\n"));

  return Object.freeze({
    transport,
    dossier,
    destinatairesAutorises: Object.freeze(destinatairesAutorises),
    estProduction: source.VERCEL_ENV === "production",
  });
}
