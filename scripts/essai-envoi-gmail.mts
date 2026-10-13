// Essai réel d'envoi, depuis le poste du développeur : le modèle
// essai.verification_envoi, par la vraie porte d'envoi (envoyerEmail, liste
// autorisée comprise) et le transport smtp. Fiche :
// docs/features/envoi-emails.md, section 9, étape 5.
//
// - Variables lues dans l'environnement du processus seulement, jamais dans
//   un fichier : GMAIL_UTILISATEUR, GMAIL_MOT_DE_PASSE_APPLICATION,
//   EMAIL_DESTINATAIRES_AUTORISES. Aucun dotenv, aucun .env.local.
// - Refuse de tourner si VERCEL_ENV est défini.
// - N'envoie qu'à la première adresse de la liste.
// - N'affiche que le résultat fermé : ni adresse, ni mot de passe.

const REQUISES = [
  "GMAIL_UTILISATEUR",
  "GMAIL_MOT_DE_PASSE_APPLICATION",
  "EMAIL_DESTINATAIRES_AUTORISES",
] as const;

function arreter(message: string): never {
  console.error(message);
  process.exit(1);
}

if (process.env.VERCEL_ENV !== undefined) {
  arreter("Refusé : VERCEL_ENV est défini. Cet essai ne tourne que sur le poste.");
}

const absentes = REQUISES.filter((nom) => !process.env[nom]);
if (absentes.length > 0) {
  arreter(`Variable(s) absente(s) : ${absentes.join(", ")}. Aucun envoi.`);
}

// Configuration de l'application exigée par env.ts, que la porte importe.
// Valeurs factices, écrasant celles du terminal : l'essai n'ouvre aucune
// connexion à la base, et aucun secret de l'application n'est chargé.
process.env.DATABASE_URL = "postgresql://app_facturation:factice@localhost:5432/factice";
process.env.BETTER_AUTH_SECRET = "secret-factice-essai-envoi-gmail-0000";
process.env.BETTER_AUTH_URL = "http://localhost:3000";
// Transport réel, hors production : la liste autorisée s'applique.
process.env.EMAIL_TRANSPORT = "smtp";
// NODE_ENV est typé en lecture seule par Next.js : retiré par Reflect.
Reflect.deleteProperty(process.env, "NODE_ENV");
Reflect.deleteProperty(process.env, "VERCEL");

// Message d'erreur de la configuration : seulement les lignes « - NOM : raison »,
// qui ne contiennent jamais de valeur (env-schema.ts).
const LIGNE_CONFIGURATION = /^- [A-Z_]+ : /u;

let chargement;
try {
  chargement = {
    porte: await import("../src/server/email/envoi"),
    configuration: (await import("../src/server/env")).configurationEmail,
  };
} catch (erreur) {
  const lignes =
    erreur instanceof Error
      ? erreur.message.split("\n").filter((ligne) => LIGNE_CONFIGURATION.test(ligne))
      : [];
  arreter(["Configuration refusée. Aucun envoi.", ...lignes].join("\n"));
}

const { porte, configuration } = chargement;
const destinataire = configuration.destinatairesAutorises[0];
if (configuration.transport !== "smtp" || destinataire === undefined) {
  arreter("Configuration inattendue. Aucun envoi.");
}

const resultat = await porte.envoyerEmail({
  modele: "essai.verification_envoi",
  destinataire,
  parametres: {},
});

if (resultat.envoye) {
  console.log("Résultat : envoye");
  process.exit(0);
}
arreter(`Résultat : non envoyé (${resultat.raison})`);
