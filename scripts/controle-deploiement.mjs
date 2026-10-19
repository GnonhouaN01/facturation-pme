import { randomBytes, randomInt } from "node:crypto";
import { basename } from "node:path";
import { parseArgs } from "node:util";

// Contrôle après déploiement (0.8) : quelques requêtes GET publiques sur le
// site, sans secret, sans écriture. Aucun cookie, sauf un cookie de session
// forgé, tiré au hasard, sur une requête de /tableau-de-bord. Aucun
// Authorization, sauf un secret forgé, tiré au hasard, sur une requête de
// /api/taches/quotidienne (page « tache », 8.3,
// docs/features/tache-quotidienne.md, section 6). Seule exception au GET :
// six POST sans corps, sans Origin, sans cookie, vers les cinq points
// d'entrée des comptes (inscription 1.1, connexion et déconnexion 1.2) et un
// chemin inexistant de /api/auth (page « comptes »,
// docs/features/inscription.md, section 2.3 ; docs/features/connexion.md,
// section 10). En production, les comptes sont fermés : les six reçoivent la
// réponse d'un chemin fermé. Ouverts, ils les refuseraient avant Better Auth
// (origine absente) : rien n'est écrit, rien n'est envoyé. Le cookie forgé
// sert aussi à /compte (1.2). Lancé par
// .github/workflows/controle-deploiement.yml après chaque déploiement de
// production réussi, et par les tests (e2e/controle-deploiement.spec.ts)
// contre un serveur factice et le site construit en local.
// Fiche : docs/features/controle-deploiement.md, sections 1 et 2.
//
//   node scripts/controle-deploiement.mjs <origine> [--essais 3] [--pause 20] [--detail]
//
// --detail : pour les contrôles « identique » seulement, les deux statuts, la
// longueur des deux documents normalisés (documentServi), la position du
// premier caractère différent et 120 caractères autour dans chacun. Aucun
// en-tête, aucun cookie.
//
// Code de sortie : 0 tout passe, 1 un contrôle échoue, 2 adresse refusée.

// Références recopiées, et non importées de src/ : la production est
// comparée à la fiche, pas à l'implémentation. Un test vérifie qu'elles
// égalent celles des tests de bout en bout (e2e/outils.ts).
export const POLITIQUE_ATTENDUE = {
  "default-src": ["'none'"],
  "script-src": ["'self'", "'nonce-*'", "'strict-dynamic'"],
  "style-src": ["'self'", "'nonce-*'"],
  "img-src": ["'self'"],
  "font-src": ["'self'"],
  "connect-src": ["'self'"],
  "object-src": ["'none'"],
  "base-uri": ["'none'"],
  "form-action": ["'self'"],
  "frame-ancestors": ["'none'"],
};

export const ENTETES_ATTENDUS = {
  "strict-transport-security": "max-age=63072000; includeSubDomains",
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
  "referrer-policy": "same-origin",
  "permissions-policy":
    "camera=(), microphone=(), geolocation=(), payment=(), usb=(), browsing-topics=()",
  "cross-origin-opener-policy": "same-origin",
  "cross-origin-resource-policy": "same-origin",
};

// Détails techniques qu'aucune page ni aucun en-tête ne doit porter (S-85).
const FUITES = [
  ["ligne de pile", /\bat [\w$.<>[\] ]+ \([^)\s]*:\d+:\d+\)/],
  ["chemin de fichier", /node_modules|\.next\/|webpack-internal|file:\/\//],
  ["chemin de fichier", /\/(?:home|root|tmp|Users|var\/task|vercel\/path\d*)\//],
  ["chemin de fichier", /\b[A-Za-z]:\\{1,2}(?:Users|Windows|Program)/],
  [
    "nom de variable d'environnement",
    /\b(?:DATABASE_URL\w*|BETTER_AUTH_\w+|EMAIL_\w+|GMAIL_\w+|VERCEL_\w+|NODE_ENV|CRON_SECRET)\b|process\.env/,
  ],
  ["adresse ou rôle de la base", /postgres(?:ql)?:\/\/|app_facturation|ECONNREFUSED/],
];

// Textes du gabarit de l'application (src/textes/navigation.ts et
// simulation.ts) : aucun ne doit atteindre un visiteur sans session, ni dans
// le HTML ni dans la charge utile RSC. Recopiés, comme les références
// ci-dessus ; un test vérifie qu'ils égalent ceux de src/textes/.
export const TEXTES_GABARIT = [
  "Simulation : les documents ne sont pas certifiés par la DGI et n'ont pas de valeur fiscale.",
  "Navigation principale",
  "Organisation active",
  "Tableau de bord",
  "Propriétaire",
  "Comptable",
  "Commercial",
  "Lecteur",
  // 1.2 : bouton de déconnexion des gabarits de l'application et du compte
  // (src/textes/compte.ts).
  "Se déconnecter",
];

// Noms du cookie de session de Better Auth, sur http et sur https.
const COOKIES_SESSION = ["better-auth.session_token", "__Secure-better-auth.session_token"];

const ANGLAIS = /\b404\b|not found|could not be found/i;
const DELAI_REQUETE = 15_000;
const HOTES_LOCAUX = new Set(["localhost", "127.0.0.1"]);

export class AdresseRefusee extends Error {}

// Une origine seule : https, ou http pour localhost et 127.0.0.1 (tests).
// Ni chemin, ni paramètre, ni fragment, ni identifiants.
export function validerAdresse(adresse) {
  let url;
  try {
    url = new URL(adresse ?? "");
  } catch {
    throw new AdresseRefusee("adresse invalide");
  }
  const locale = HOTES_LOCAUX.has(url.hostname);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && locale)) {
    throw new AdresseRefusee("https exigé (http seulement pour localhost et 127.0.0.1)");
  }
  if (url.username || url.password) throw new AdresseRefusee("identifiants interdits");
  if (url.pathname !== "/" || url.search || url.hash || /[?#]/.test(adresse)) {
    throw new AdresseRefusee("une origine seule, sans chemin, paramètre ni fragment");
  }
  return url.origin;
}

// Options d'une requête du contrôle : redirection non suivie, sans cookie ni
// Authorization sauf les valeurs forgées des GET. Un POST (page
// « comptes » seulement) part sans corps, sans cookie, sans
// Authorization ; fetch n'y ajoute ni Origin ni Content-Type. Toute autre
// demande lève : la règle ne dépend pas de l'appelant.
/**
 * @param {{ methode: string, cookie?: string, autorisation?: string, corps?: string }} demande
 * @returns {{ method: string, redirect: "manual", credentials: "omit", headers: Record<string, string>, body?: undefined }}
 */
export function optionsRequete({ methode, cookie, autorisation, corps }) {
  if (methode !== "GET" && methode !== "POST") throw new Error("méthode refusée");
  if (methode === "POST" && (cookie || autorisation || corps !== undefined)) {
    throw new Error("POST refusé : ni corps, ni cookie, ni Authorization");
  }
  if (corps !== undefined) throw new Error("corps refusé");
  return {
    method: methode,
    redirect: "manual",
    credentials: "omit",
    headers: {
      accept: "text/html",
      ...(cookie ? { cookie } : {}),
      ...(autorisation ? { authorization: autorisation } : {}),
    },
  };
}

// Une requête échouée donne null : chaque contrôle de la page échoue alors.
async function lire(origine, chemin, cookie, autorisation, methode = "GET") {
  try {
    const reponse = await fetch(origine + chemin, {
      ...optionsRequete({ methode, cookie, autorisation }),
      signal: AbortSignal.timeout(DELAI_REQUETE),
    });
    return { statut: reponse.status, entetes: reponse.headers, corps: await reponse.text() };
  } catch {
    return null;
  }
}

function directives(politique) {
  const resultat = {};
  for (const morceau of politique.split(";")) {
    const [nom, ...valeurs] = morceau.trim().split(/\s+/);
    if (nom) resultat[nom] = valeurs;
  }
  return resultat;
}

// Nonce de script-src, ou null.
function nonceDe(reponse) {
  const politique = reponse?.entetes.get("content-security-policy") ?? "";
  const script = directives(politique)["script-src"] ?? [];
  const trouve = script.map((v) => /^'nonce-([^']*)'$/.exec(v)).find(Boolean);
  return trouve ? trouve[1] : null;
}

function verifierPolitique(reponse) {
  const politique = reponse.entetes.get("content-security-policy");
  if (!politique) return "en-tête absent";
  if (politique.includes("unsafe-")) return "mot-clé unsafe- présent";
  const nonces = new Set([...politique.matchAll(/'nonce-([^']*)'/g)].map((t) => t[1]));
  if (nonces.size !== 1) return `${nonces.size} nonce(s) distinct(s), 1 attendu`;
  const [nonce] = nonces;
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(nonce) || Buffer.from(nonce, "base64").length !== 16) {
    return "nonce autre que 16 octets en base64";
  }
  const recues = directives(politique.replace(/'nonce-[^']*'/g, "'nonce-*'"));
  const noms = new Set([...Object.keys(recues), ...Object.keys(POLITIQUE_ATTENDUE)]);
  const differentes = [...noms].filter(
    (nom) => (recues[nom] ?? []).join(" ") !== (POLITIQUE_ATTENDUE[nom] ?? []).join(" "),
  );
  return differentes.length ? `directive(s) différente(s) : ${differentes.join(", ")}` : null;
}

function verifierNonceScripts(reponse) {
  const nonce = nonceDe(reponse);
  if (!nonce) return "aucun nonce dans script-src";
  const scripts = reponse.corps.match(/<script\b[^>]*>/gi) ?? [];
  if (scripts.length === 0) return "aucune balise <script>";
  const sans = scripts.filter((balise) => !balise.includes(`nonce="${nonce}"`)).length;
  return sans ? `${sans} balise(s) <script> sans le nonce de l'en-tête` : null;
}

function verifierEntetes(reponse) {
  const problemes = Object.entries(ENTETES_ATTENDUS)
    .filter(([nom, valeur]) => reponse.entetes.get(nom) !== valeur)
    .map(([nom]) => nom);
  if (reponse.entetes.has("x-powered-by")) problemes.push("x-powered-by présent");
  return problemes.length ? `en-tête(s) : ${problemes.join(", ")}` : null;
}

// Nomme le motif trouvé, jamais la valeur reçue.
function verifierFuite(reponses) {
  const trouves = new Set();
  for (const reponse of reponses) {
    const entetes = [...reponse.entetes].map(([nom, valeur]) => `${nom}: ${valeur}`).join("\n");
    for (const [nom, motif] of FUITES) {
      if (motif.test(reponse.corps) || motif.test(entetes)) trouves.add(nom);
    }
  }
  return trouves.size ? `trouvé : ${[...trouves].join(", ")}` : null;
}

// Document HTML au nonce près : contenu des scripts en ligne vidé (charge
// utile RSC, qui nomme l'adresse et le segment de route), attributs gardés,
// chaque nonce remplacé. Deux réponses à la même route, l'une refusée et
// l'autre absente, reçoivent le même document (S-02, fiche, section 5). Même
// définition que documentServi d'e2e/outils.ts.
export function documentServi(html) {
  return html
    .replace(/(<script\b[^>]*>)[\s\S]*?<\/script\b[^>]*>/gi, "$1</script>")
    .replace(/nonce(="|-)[A-Za-z0-9+/=]+/g, "nonce$1N");
}

const AUTOUR = 120;

// Lignes de --detail pour un contrôle « identique ». Documents normalisés
// seulement (scripts en ligne vidés, nonces remplacés) : ni en-tête ni cookie.
export function comparerDocuments(premiere, seconde, [nom1, nom2] = ["premier", "second"]) {
  if (!premiere || !seconde) return ["aucune réponse"];
  const [d1, d2] = [documentServi(premiere.corps), documentServi(seconde.corps)];
  const largeur = Math.max(nom1.length, nom2.length);
  const lignes = [
    `statuts : ${nom1} ${premiere.statut}, ${nom2} ${seconde.statut}`,
    `longueurs normalisées : ${nom1} ${d1.length}, ${nom2} ${d2.length}`,
  ];
  let position = 0;
  while (position < d1.length && position < d2.length && d1[position] === d2[position]) {
    position += 1;
  }
  if (position === d1.length && position === d2.length) {
    lignes.push("documents normalisés identiques");
    return lignes;
  }
  const debut = Math.max(0, position - AUTOUR / 2);
  const extrait = (nom, texte) =>
    `${nom.padEnd(largeur)} [${debut}, ${debut + AUTOUR}[ : ${JSON.stringify(texte.slice(debut, debut + AUTOUR))}`;
  lignes.push(
    `premier caractère différent : position ${position}`,
    extrait(nom1, d1),
    extrait(nom2, d2),
  );
  return lignes;
}

// Secret de la tâche quotidienne au format attendu (32 octets en base64url),
// tiré au hasard : aucun serveur ne peut l'avoir. Jamais affiché.
function autorisationForgee() {
  return `Bearer ${randomBytes(32).toString("base64url")}`;
}

// Valeur de session au format de Better Auth (jeton, point, signature), tirée
// au hasard : aucun serveur ne peut l'avoir émise.
function cookieForge() {
  const valeur = `${randomBytes(24).toString("base64url")}.${randomBytes(32).toString("base64")}`;
  return COOKIES_SESSION.map((nom) => `${nom}=${encodeURIComponent(valeur)}`).join("; ");
}

export async function controlerSite(adresse, { detail = false } = {}) {
  const origine = validerAdresse(adresse);
  const inexistante = `/adresse-inexistante-${randomBytes(8).toString("hex")}`;
  const lien = () => `/lien/devis/${randomBytes(32).toString("base64url")}`;
  const tacheInconnue = `/api/taches/${randomBytes(8).toString("hex")}`;
  const authInconnu = () => `/api/auth/${randomBytes(8).toString("hex")}`;
  // 1.3 : jeton forgé de la forme de generateId(24) de Better Auth. Tirage
  // uniforme par randomInt (un octet modulo 62 favoriserait les premiers
  // caractères de l'alphabet).
  const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  const jetonReinitialisation = () =>
    Array.from({ length: 24 }, () => ALPHABET[randomInt(ALPHABET.length)]).join("");
  const [accueil, accueilBis, tableau, tableauForge, absente, lien1, lien2] = [
    await lire(origine, "/"),
    await lire(origine, "/"),
    await lire(origine, "/tableau-de-bord"),
    await lire(origine, "/tableau-de-bord", cookieForge()),
    await lire(origine, inexistante),
    await lire(origine, lien()),
    await lire(origine, lien()),
  ];
  // 1.2 : la page publique de connexion, et la page de compte sans session et
  // avec un cookie forgé.
  const [connexion, compte, compteForge] = [
    await lire(origine, "/connexion"),
    await lire(origine, "/compte"),
    await lire(origine, "/compte", cookieForge()),
  ];
  // 1.4 : la page de la double authentification, sans session et avec un
  // cookie forgé, comme /compte.
  const [doubleAuth, doubleAuthForge] = [
    await lire(origine, "/compte/double-authentification"),
    await lire(origine, "/compte/double-authentification", cookieForge()),
  ];
  // 1.3 : les pages publiques du mot de passe oublié.
  const [oubli, lienReinitialisation] = [
    await lire(origine, "/mot-de-passe-oublie"),
    await lire(origine, "/lien/reinitialisation"),
  ];
  const [tacheSans, tacheForgee, tacheAbsente] = [
    await lire(origine, "/api/taches/quotidienne"),
    await lire(origine, "/api/taches/quotidienne", undefined, autorisationForgee()),
    await lire(origine, tacheInconnue),
  ];
  // T-55 : deux points d'entrée de /organization/*, toujours fermés, et un
  // chemin inexistant, en GET.
  const auths = [
    await lire(origine, "/api/auth/organization/list"),
    await lire(origine, "/api/auth/organization/get-full-organization"),
    // 1.2 : la lecture de session reste fermée (S-82).
    await lire(origine, "/api/auth/get-session"),
    // 1.3 : le lien de Better Auth, jeton dans le chemin, reste fermé.
    await lire(origine, `/api/auth/reset-password/${jetonReinitialisation()}?callbackURL=%2F`),
    // 1.4 : le secret TOTP ne se relit jamais ; aucun code par email.
    await lire(origine, "/api/auth/two-factor/get-totp-uri"),
    await lire(origine, "/api/auth/two-factor/send-otp"),
    await lire(origine, "/api/auth/two-factor/verify-otp"),
    await lire(origine, authInconnu()),
  ];
  // Décision 1 de la 1.1, étendue par la 1.2, la 1.3 et la 1.4 : en
  // production, les quatorze POST des comptes répondent comme un chemin
  // inexistant de /api/auth.
  const comptes = [];
  for (const chemin of [
    "/api/auth/sign-up/email",
    "/api/auth/send-verification-email",
    "/api/auth/verify-email",
    "/api/auth/sign-in/email",
    "/api/auth/sign-out",
    "/api/auth/request-password-reset",
    "/api/auth/reset-password",
    "/api/auth/two-factor/verify-totp",
    "/api/auth/two-factor/verify-backup-code",
    "/api/auth/two-factor/enable",
    "/api/auth/two-factor/confirm-enable",
    "/api/auth/two-factor/replace",
    "/api/auth/two-factor/generate-backup-codes",
    "/api/auth/two-factor/disable",
    authInconnu(),
  ]) {
    comptes.push(await lire(origine, chemin, undefined, undefined, "POST"));
  }

  const resultats = [];
  const controler = (nom, reponses, verifier) => {
    const probleme = reponses.some((r) => r === null) ? "aucune réponse" : verifier(...reponses);
    const resultat = { nom, ok: probleme === null, detail: probleme ?? "conforme" };
    resultats.push(resultat);
    return resultat;
  };
  const statut = (attendu) => (r) =>
    r.statut === attendu ? null : `statut ${r.statut}, ${attendu} attendu`;

  // [nom, réponse contrôlée, statut attendu, réponses lues pour la fuite]
  const pages = [
    ["accueil", accueil, 200, [accueil, accueilBis]],
    ["tableau-de-bord", tableau, 404, [tableau, tableauForge]],
    ["inexistante", absente, 404, [absente]],
    ["lien", lien1, 404, [lien1, lien2]],
    ["connexion", connexion, 200, [connexion]],
    ["compte", compte, 404, [compte, compteForge]],
    ["double-authentification", doubleAuth, 404, [doubleAuth, doubleAuthForge]],
    ["mot-de-passe-oublie", oubli, 200, [oubli]],
    ["lien-reinitialisation", lienReinitialisation, 200, [lienReinitialisation]],
  ];
  for (const [nom, reponse, attendu, lues] of pages) {
    controler(`${nom}:statut`, [reponse], statut(attendu));
    controler(`${nom}:politique`, [reponse], verifierPolitique);
    controler(`${nom}:nonce-scripts`, [reponse], verifierNonceScripts);
    controler(`${nom}:entetes`, [reponse], verifierEntetes);
    controler(`${nom}:fuite`, lues, (...r) => verifierFuite(r));
  }
  controler("accueil:nonce-neuf", [accueil, accueilBis], (a, b) => {
    const [n1, n2] = [nonceDe(a), nonceDe(b)];
    if (!n1 || !n2) return "nonce absent";
    return n1 === n2 ? "même nonce sur deux requêtes" : null;
  });
  for (const [nom, reponse] of pages.filter(([, , attendu]) => attendu === 404)) {
    controler(`${nom}:anglais`, [reponse], (r) =>
      ANGLAIS.test(documentServi(r.corps)) ? "texte anglais ou « 404 » dans le document" : null,
    );
  }
  // Le corps entier, charge utile RSC comprise. Nomme le texte attendu
  // (public), jamais le corps reçu.
  for (const [nom, lues] of [
    ["tableau-de-bord", [tableau, tableauForge]],
    ["inexistante", [absente]],
    ["compte", [compte, compteForge]],
    ["double-authentification", [doubleAuth, doubleAuthForge]],
  ]) {
    controler(`${nom}:gabarit`, lues, (...r) => {
      const trouves = TEXTES_GABARIT.filter((texte) => r.some((x) => x.corps.includes(texte)));
      return trouves.length ? `texte du gabarit : ${trouves.join(", ")}` : null;
    });
  }

  // S-02 porte sur les ressources : une même route, refusée ou absente, donne
  // la même réponse. Le nom d'une page est public (fiche, section 5).
  const identique = (nom, a, b, noms, difference) => {
    const resultat = controler(nom, [a, b], (x, y) =>
      x.statut === y.statut && documentServi(x.corps) === documentServi(y.corps)
        ? null
        : difference,
    );
    if (detail) resultat.lignes = comparerDocuments(a, b, noms);
  };
  identique(
    "tableau-de-bord:identique",
    tableau,
    tableauForge,
    ["sans cookie", "cookie forgé"],
    "statut ou document différent avec un cookie de session forgé",
  );
  identique(
    "compte:identique",
    compte,
    compteForge,
    ["sans cookie", "cookie forgé"],
    "statut ou document différent avec un cookie de session forgé",
  );
  identique(
    "double-authentification:identique",
    doubleAuth,
    doubleAuthForge,
    ["sans cookie", "cookie forgé"],
    "statut ou document différent avec un cookie de session forgé",
  );
  identique(
    "lien:identique",
    lien1,
    lien2,
    ["premier jeton", "second jeton"],
    "statut ou document différent entre deux jetons aléatoires",
  );

  // Tâche quotidienne (8.3) : sans secret, avec un secret forgé et vers une
  // tâche inconnue, la même réponse (statut, corps, Content-Type), 404 au
  // corps vide. Aucune ligne de détail : rien de ces réponses n'est affiché.
  const taches = [tacheSans, tacheForgee, tacheAbsente];
  const premierProbleme =
    (verifier) =>
    (...r) =>
      r.map(verifier).find((p) => p !== null) ?? null;
  controler("tache:statut", taches, premierProbleme(statut(404)));
  controler("tache:politique", taches, premierProbleme(verifierPolitique));
  controler("tache:entetes", taches, premierProbleme(verifierEntetes));
  controler("tache:fuite", taches, (...r) => verifierFuite(r));
  controler("tache:anglais", taches, (...r) =>
    r.some((x) => ANGLAIS.test(x.corps)) ? "texte anglais ou « 404 » dans le corps" : null,
  );
  const forme = (x) => JSON.stringify([x.statut, x.entetes.get("content-type"), x.corps]);
  controler("tache:identique", taches, (...r) =>
    r.every((x) => forme(x) === forme(r[0]))
      ? null
      : "réponse différente sans secret, avec un secret forgé ou pour une tâche inconnue",
  );

  // /api/auth (1.1) : les points fermés de /organization/* et un chemin
  // inexistant, la même réponse (statut, corps, Content-Type), 404 au corps
  // vide. Puis l'inscription, fermée en production : les trois POST comme le
  // POST d'un chemin inexistant. Rien de ces réponses n'est affiché.
  controler("auth:statut", auths, premierProbleme(statut(404)));
  controler("auth:politique", auths, premierProbleme(verifierPolitique));
  controler("auth:entetes", auths, premierProbleme(verifierEntetes));
  controler("auth:fuite", auths, (...r) => verifierFuite(r));
  controler("auth:anglais", auths, (...r) =>
    r.some((x) => ANGLAIS.test(x.corps)) ? "texte anglais ou « 404 » dans le corps" : null,
  );
  controler("auth:identique", auths, (...r) =>
    r.every((x) => forme(x) === forme(r[0]))
      ? null
      : "réponse différente pour un point d'entrée fermé (/organization/*, /get-session, /two-factor/get-totp-uri) et un chemin inexistant",
  );
  controler("comptes:statut", comptes, premierProbleme(statut(404)));
  controler("comptes:identique", comptes, (...r) =>
    r.every((x) => forme(x) === forme(r.at(-1)))
      ? null
      : "un point d'entrée des comptes répond autrement qu'un chemin inexistant : comptes ouverts",
  );
  return resultats;
}

async function principal(argv) {
  let options;
  try {
    options = parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        essais: { type: "string", default: "1" },
        pause: { type: "string", default: "20" },
        detail: { type: "boolean", default: false },
      },
    });
  } catch {
    console.error("Options invalides.");
    return 2;
  }
  const essais = Number(options.values.essais);
  const pause = Number(options.values.pause);
  let origine;
  try {
    if (options.positionals.length !== 1) throw new AdresseRefusee("une adresse attendue");
    if (!(Number.isInteger(essais) && essais >= 1 && essais <= 10)) {
      throw new AdresseRefusee("--essais entre 1 et 10");
    }
    if (!(Number.isInteger(pause) && pause >= 0 && pause <= 120)) {
      throw new AdresseRefusee("--pause entre 0 et 120 secondes");
    }
    origine = validerAdresse(options.positionals[0]);
  } catch (erreur) {
    // Le message nomme la règle, jamais l'adresse reçue (identifiants possibles).
    console.error(
      `Adresse refusée : ${erreur instanceof AdresseRefusee ? erreur.message : "invalide"}.`,
    );
    return 2;
  }

  for (let essai = 1; essai <= essais; essai += 1) {
    const resultats = await controlerSite(origine, { detail: options.values.detail });
    const echecs = resultats.filter((r) => !r.ok);
    console.log(`Contrôle de ${origine}, essai ${essai} sur ${essais} :`);
    for (const r of resultats) {
      console.log(`${r.ok ? "ok    " : "ÉCHEC "} ${r.nom} : ${r.detail}`);
      for (const ligne of r.lignes ?? []) console.log(`         ${ligne}`);
    }
    if (echecs.length === 0) {
      console.log(`Bilan : ${resultats.length} contrôles passés.`);
      return 0;
    }
    console.log(`Bilan : ${echecs.length} échec(s) sur ${resultats.length}.`);
    if (essai < essais) await new Promise((resoudre) => setTimeout(resoudre, pause * 1000));
  }
  return 1;
}

// Exécuté seulement en ligne de commande, pas à l'import par les tests.
// Playwright charge ce module en CommonJS : ni import.meta ni await de
// premier niveau. Le lancement direct se reconnaît au nom du script.
if (basename(process.argv[1] ?? "") === "controle-deploiement.mjs") {
  principal(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}
