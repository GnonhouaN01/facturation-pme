import { randomBytes } from "node:crypto";
import { basename } from "node:path";
import { parseArgs } from "node:util";

// Contrôle après déploiement (0.8) : quelques requêtes GET publiques sur le
// site, sans cookie, sans secret, sans écriture. Lancé par
// .github/workflows/controle-deploiement.yml après chaque déploiement de
// production réussi, et par les tests (e2e/controle-deploiement.spec.ts)
// contre un serveur factice et le site construit en local.
// Fiche : docs/features/controle-deploiement.md, sections 1 et 2.
//
//   node scripts/controle-deploiement.mjs <origine> [--essais 3] [--pause 20]
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
    /\b(?:DATABASE_URL\w*|BETTER_AUTH_\w+|EMAIL_\w+|GMAIL_\w+|VERCEL_\w+|NODE_ENV)\b|process\.env/,
  ],
  ["adresse ou rôle de la base", /postgres(?:ql)?:\/\/|app_facturation|ECONNREFUSED/],
];

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

// GET seul, sans cookie ni authentification, redirection non suivie. Une
// requête échouée donne null : chaque contrôle de la page échoue alors.
async function lire(origine, chemin) {
  try {
    const reponse = await fetch(origine + chemin, {
      method: "GET",
      redirect: "manual",
      credentials: "omit",
      headers: { accept: "text/html" },
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
// chaque nonce remplacé. Toute page introuvable passe par notFound() : sans
// session ou inexistante, le même document (fiche, section 5). Même
// définition que documentServi d'e2e/outils.ts.
export function documentServi(html) {
  return html
    .replace(/(<script\b[^>]*>)[\s\S]*?<\/script\b[^>]*>/gi, "$1</script>")
    .replace(/nonce(="|-)[A-Za-z0-9+/=]+/g, "nonce$1N");
}

export async function controlerSite(adresse) {
  const origine = validerAdresse(adresse);
  const inexistante = `/adresse-inexistante-${randomBytes(8).toString("hex")}`;
  const [accueil, accueilBis, tableau, absente] = [
    await lire(origine, "/"),
    await lire(origine, "/"),
    await lire(origine, "/tableau-de-bord"),
    await lire(origine, inexistante),
  ];

  const resultats = [];
  const controler = (nom, reponses, verifier) => {
    if (reponses.some((r) => r === null)) {
      resultats.push({ nom, ok: false, detail: "aucune réponse" });
      return;
    }
    const probleme = verifier(...reponses);
    resultats.push({ nom, ok: probleme === null, detail: probleme ?? "conforme" });
  };
  const statut = (attendu) => (r) =>
    r.statut === attendu ? null : `statut ${r.statut}, ${attendu} attendu`;

  const pages = [
    ["accueil", accueil, 200],
    ["tableau-de-bord", tableau, 404],
    ["inexistante", absente, 404],
  ];
  for (const [nom, reponse, attendu] of pages) {
    controler(`${nom}:statut`, [reponse], statut(attendu));
    controler(`${nom}:politique`, [reponse], verifierPolitique);
    controler(`${nom}:nonce-scripts`, [reponse], verifierNonceScripts);
    controler(`${nom}:entetes`, [reponse], verifierEntetes);
    controler(`${nom}:fuite`, nom === "accueil" ? [accueil, accueilBis] : [reponse], (...r) =>
      verifierFuite(r),
    );
  }
  controler("accueil:nonce-neuf", [accueil, accueilBis], (a, b) => {
    const [n1, n2] = [nonceDe(a), nonceDe(b)];
    if (!n1 || !n2) return "nonce absent";
    return n1 === n2 ? "même nonce sur deux requêtes" : null;
  });
  for (const [nom, reponse] of pages.slice(1)) {
    controler(`${nom}:anglais`, [reponse], (r) =>
      ANGLAIS.test(documentServi(r.corps)) ? "texte anglais ou « 404 » dans le document" : null,
    );
  }
  controler("tableau-de-bord:identique", [tableau, absente], (t, a) =>
    t.statut === a.statut && documentServi(t.corps) === documentServi(a.corps)
      ? null
      : "statut ou document différent de ceux d'une adresse inexistante",
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
    const resultats = await controlerSite(origine);
    const echecs = resultats.filter((r) => !r.ok);
    console.log(`Contrôle de ${origine}, essai ${essai} sur ${essais} :`);
    for (const r of resultats) console.log(`${r.ok ? "ok    " : "ÉCHEC "} ${r.nom} : ${r.detail}`);
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
