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

// Configuration de l'envoi d'emails : transport, compte Gmail, liste
// autorisée, dossier, production. Fonction pure, comme validerEnvironnement ;
// les messages nomment la variable et la raison, jamais la valeur. Fiche :
// docs/features/envoi-emails.md, sections 2.1, 2.2 et 9.
//
// Une variable de Vercel ne s'applique qu'au déploiement suivant (section 9) :
// en production, EMAIL_TRANSPORT absente vaut smtp, pour que les variables
// Gmail, posées avant la fusion, suffisent. En prévisualisation sans
// variable : memoire, pour qu'aucun déploiement de branche ne tombe faute de
// configuration d'envoi.

export type TransportEmail = "memoire" | "fichier" | "smtp";

export type CompteGmail = Readonly<{
  utilisateur: string;
  motDePasse: string;
}>;

export type ConfigurationEmail = Readonly<{
  transport: TransportEmail;
  // Dossier du transport fichier, null sinon.
  dossier: string | null;
  destinatairesAutorises: readonly string[];
  estProduction: boolean;
  // Compte d'envoi du transport smtp, null sinon.
  gmail: CompteGmail | null;
}>;

const MESSAGES_EMAIL = {
  transportInconnu: "doit valoir memoire, fichier ou smtp",
  transportProduction: "doit valoir smtp en production",
  smtpEnTest: "smtp est interdit sous NODE_ENV=test",
  fichierSurVercel: "fichier est impossible sur Vercel (système de fichiers en lecture seule)",
  adresses: "doit être une liste d'adresses valides séparées par des virgules",
  listeObligatoire: "obligatoire avec smtp hors production",
  dossierVide: "ne doit pas être vide",
  adresseGmail: "doit être une adresse gmail.com",
  motDePasse: "doit faire 16 lettres minuscules, espaces retirés",
} as const;

const TRANSPORTS: readonly TransportEmail[] = ["memoire", "fichier", "smtp"];
const DOSSIER_PAR_DEFAUT = ".emails";
const DOMAINE_GMAIL = "@gmail.com";
// Mot de passe d'application de Google : 16 lettres, affichées par groupes de
// quatre séparés d'espaces. Seuls les espaces sont retirés : une tabulation
// ou un retour à la ligne reste une faute.
const MOT_DE_PASSE_APPLICATION = /^[a-z]{16}$/u;

function surVercel(source: Source): boolean {
  return (source.VERCEL_ENV !== undefined && source.VERCEL_ENV !== "") || source.VERCEL === "1";
}

function estTransport(valeur: string): valeur is TransportEmail {
  return (TRANSPORTS as readonly string[]).includes(valeur);
}

function lireCompteGmail(source: Source, erreurs: string[]): CompteGmail | null {
  let utilisateur: string | null = null;
  const brut = source.GMAIL_UTILISATEUR;
  if (brut === undefined || brut === "") {
    erreurs.push(`- GMAIL_UTILISATEUR : ${MESSAGES.absente}`);
  } else {
    const lue = schemaAdresse.safeParse(brut);
    if (lue.success && lue.data.endsWith(DOMAINE_GMAIL)) {
      utilisateur = lue.data;
    } else {
      erreurs.push(`- GMAIL_UTILISATEUR : ${MESSAGES_EMAIL.adresseGmail}`);
    }
  }

  let motDePasse: string | null = null;
  const secret = source.GMAIL_MOT_DE_PASSE_APPLICATION;
  if (secret === undefined || secret === "") {
    erreurs.push(`- GMAIL_MOT_DE_PASSE_APPLICATION : ${MESSAGES.absente}`);
  } else {
    const sansEspaces = secret.replaceAll(" ", "");
    if (MOT_DE_PASSE_APPLICATION.test(sansEspaces)) {
      motDePasse = sansEspaces;
    } else {
      erreurs.push(`- GMAIL_MOT_DE_PASSE_APPLICATION : ${MESSAGES_EMAIL.motDePasse}`);
    }
  }

  return utilisateur !== null && motDePasse !== null
    ? Object.freeze({ utilisateur, motDePasse })
    : null;
}

export function validerConfigurationEmail(source: Source): ConfigurationEmail {
  const erreurs: string[] = [];
  const vercel = surVercel(source);
  const estProduction = source.VERCEL_ENV === "production";

  // Transport : absent, valeur selon l'environnement ; présent, exactement
  // memoire, fichier ou smtp (ni vide, ni espace, ni autre casse), et smtp
  // seulement en production.
  let transport: TransportEmail;
  const brut = source.EMAIL_TRANSPORT;
  if (brut === undefined) {
    if (estProduction) transport = "smtp";
    else transport = source.NODE_ENV === "test" || vercel ? "memoire" : "fichier";
  } else if (!estTransport(brut)) {
    erreurs.push(`- EMAIL_TRANSPORT : ${MESSAGES_EMAIL.transportInconnu}`);
    transport = "memoire";
  } else if (estProduction && brut !== "smtp") {
    erreurs.push(`- EMAIL_TRANSPORT : ${MESSAGES_EMAIL.transportProduction}`);
    transport = "memoire";
  } else if (brut === "smtp" && source.NODE_ENV === "test") {
    erreurs.push(`- EMAIL_TRANSPORT : ${MESSAGES_EMAIL.smtpEnTest}`);
    transport = "memoire";
  } else if (brut === "fichier" && vercel) {
    erreurs.push(`- EMAIL_TRANSPORT : ${MESSAGES_EMAIL.fichierSurVercel}`);
    transport = "memoire";
  } else {
    transport = brut;
  }

  // Liste autorisée : adresses séparées par des virgules, chacune validée et
  // normalisée. Un élément vide est une faute. Lue partout, appliquée hors
  // production seulement (la porte l'ignore en production).
  let destinatairesAutorises: string[] = [];
  const liste = source.EMAIL_DESTINATAIRES_AUTORISES;
  if (liste !== undefined) {
    const lues = liste.split(",").map((element) => schemaAdresse.safeParse(element));
    if (lues.every((lue) => lue.success)) {
      destinatairesAutorises = lues.map((lue) => lue.data as string);
    } else {
      erreurs.push(`- EMAIL_DESTINATAIRES_AUTORISES : ${MESSAGES_EMAIL.adresses}`);
    }
  } else if (transport === "smtp" && !estProduction) {
    // Hors production, smtp envoie réellement : sans liste, la porte
    // refuserait tout, et l'oubli passerait inaperçu.
    erreurs.push(`- EMAIL_DESTINATAIRES_AUTORISES : ${MESSAGES_EMAIL.listeObligatoire}`);
  }

  const gmail = transport === "smtp" ? lireCompteGmail(source, erreurs) : null;

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
    estProduction,
    gmail,
  });
}
// Secret de la tâche quotidienne (CRON_SECRET), que Vercel envoie dans
// Authorization: Bearer <secret>. Fonction pure, comme les précédentes ; le
// message nomme la variable et la raison, jamais la valeur. Obligatoire en
// production : absente, le chargement de env.ts échoue, donc la construction
// (« Collecting page data » charge env.ts) ; voulu, l'ancien déploiement
// reste en service. Ailleurs, absente : secret nul, la tâche refuse tout
// appel. Présente, la même règle partout : 43 à 256 caractères base64url
// (43 = 32 octets aléatoires). Fiche : docs/features/tache-quotidienne.md,
// section 2.3, décision 1.

export type SecretTache = Readonly<{ secret: string | null }>;

const MESSAGES_TACHE = {
  court: "doit faire au moins 43 caractères (32 octets aléatoires en base64url)",
  long: "doit faire au plus 256 caractères",
  alphabet: "doit être en base64url (A-Z, a-z, 0-9, - et _), sans espace ni remplissage",
} as const;

const LONGUEUR_MIN_SECRET_TACHE = 43;
const LONGUEUR_MAX_SECRET_TACHE = 256;
const BASE64URL = /^[A-Za-z0-9_-]+$/u;

export function validerSecretTache(source: Source): SecretTache {
  const valeur = source.CRON_SECRET;
  let raison: string | null = null;
  if (valeur === undefined) {
    if (source.VERCEL_ENV === "production") raison = MESSAGES.absente;
  } else if (valeur === "") {
    raison = MESSAGES.absente;
  } else if (!BASE64URL.test(valeur)) {
    raison = MESSAGES_TACHE.alphabet;
  } else if (valeur.length < LONGUEUR_MIN_SECRET_TACHE) {
    raison = MESSAGES_TACHE.court;
  } else if (valeur.length > LONGUEUR_MAX_SECRET_TACHE) {
    raison = MESSAGES_TACHE.long;
  }

  if (raison !== null) throw new Error([ENTETE, `- CRON_SECRET : ${raison}`].join("\n"));
  return Object.freeze({ secret: valeur ?? null });
}
