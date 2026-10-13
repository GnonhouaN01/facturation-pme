import { createHash } from "node:crypto";

import { HOTE_HIBP, MOT_DE_PASSE_COMPROMIS_E2E } from "./hibp-simule.mjs";

// Module de préchargement des serveurs de bout en bout (NODE_OPTIONS
// --import, posé par playwright.config.ts) : remplace globalThis.fetch pour
// le seul hôte de Have I Been Pwned. Aucun appel ne part vers le vrai
// service ; les autres adresses passent par le fetch d'origine. L'extension
// de Better Auth prend globalThis.fetch à chaque appel (@better-fetch/fetch).
// Hors de src/ : rien dans l'application ne sait qu'il est simulé. Fiche :
// docs/features/inscription.md, section 5.2.

const empreinte = createHash("sha1").update(MOT_DE_PASSE_COMPROMIS_E2E).digest("hex").toUpperCase();
const PREFIXE = empreinte.slice(0, 5);
const SUFFIXE = empreinte.slice(5);

// Lignes de remplissage, comme la réponse réelle avec Add-Padding : des
// suffixes au compte nul.
function remplissage() {
  const lignes = [];
  for (let rang = 0; rang < 8; rang += 1) {
    const suffixe = createHash("sha1").update(`remplissage-${rang}`).digest("hex").toUpperCase();
    lignes.push(`${suffixe.slice(5)}:0`);
  }
  return lignes;
}

function adresseDe(entree) {
  try {
    if (typeof entree === "string") return new URL(entree);
    if (entree instanceof URL) return entree;
    if (entree && typeof entree.url === "string") return new URL(entree.url);
  } catch {
    // Adresse illisible : laissée au fetch d'origine, qui la refusera.
  }
  return null;
}

const fetchOrigine = globalThis.fetch;

globalThis.fetch = async function fetchSimule(entree, options) {
  const adresse = adresseDe(entree);
  if (adresse === null || adresse.hostname !== HOTE_HIBP) return fetchOrigine(entree, options);

  const trouve = /^\/range\/([0-9A-F]{5})$/.exec(adresse.pathname);
  // Toute autre demande vers cet hôte : refus, jamais d'appel réel.
  if (trouve === null) return new Response("", { status: 503 });
  const lignes = remplissage();
  if (trouve[1] === PREFIXE) lignes.push(`${SUFFIXE}:42`);
  return new Response(lignes.join("\r\n"), {
    status: 200,
    headers: { "content-type": "text/plain" },
  });
};
