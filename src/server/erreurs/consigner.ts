import "server-only";

import type { Instrumentation } from "next";

import { codePostgres } from "./code-postgres";

// Consignation d'une erreur de requête, pour onRequestError : une ligne
// console.error("[requete]", JSON) avec seulement digest, classe, code,
// routePath et routeType. Jamais le message, la pile, la cause, l'adresse
// demandée, les en-têtes ni les paramètres (S-20, S-54, S-85). Provisoire
// jusqu'à la 8.1. Fiche : docs/features/socle-interface.md, section 4.2.

type Parametres = Parameters<Instrumentation.onRequestError>;

// Un digest de Next.js est numérique, un incident de la chaîne est un UUID :
// toute autre valeur est écartée, pour qu'aucun texte ne passe au journal.
const DIGEST = /^[A-Za-z0-9-]{1,64}$/;
const CLASSE = /^[A-Za-z_$][A-Za-z0-9_$]{0,63}$/;

function digestDe(erreur: unknown): string | undefined {
  if (typeof erreur !== "object" || erreur === null || !("digest" in erreur)) return undefined;
  const { digest } = erreur as { digest: unknown };
  return typeof digest === "string" && DIGEST.test(digest) ? digest : undefined;
}

// Le nom du constructeur, jamais name, que le code qui lève peut fixer.
function classeDe(erreur: unknown): string {
  if (erreur === null) return "null";
  if (typeof erreur !== "object") return typeof erreur;
  const nom: unknown = (erreur as { constructor?: { name?: unknown } }).constructor?.name;
  return typeof nom === "string" && CLASSE.test(nom) ? nom : "inconnue";
}

// Ligne consignée quand le calcul échoue : sans aucune donnée de la valeur
// levée.
const LIGNE_FIXE = JSON.stringify({ echec: "consignation" });

// La requête n'est pas lue : son chemin réel contiendrait le jeton d'un lien
// public. routePath est le motif de la route (/lien/devis/[jeton]).
// Ne lève jamais : une valeur levée hostile (accesseur ou Proxy qui lève) ou
// une console défaillante ne doivent ni faire échouer onRequestError, ni
// faire passer au journal le message de leur propre erreur.
export async function consignerErreurRequete(
  erreur: unknown,
  _requete: Parametres[1],
  contexte: Parametres[2],
): Promise<void> {
  try {
    const digest = digestDe(erreur);
    const code = codePostgres(erreur);
    const ligne = {
      ...(digest === undefined ? {} : { digest }),
      classe: classeDe(erreur),
      ...(code === undefined ? {} : { code }),
      routePath: contexte.routePath,
      routeType: contexte.routeType,
    };
    console.error("[requete]", JSON.stringify(ligne));
  } catch {
    try {
      console.error("[requete]", LIGNE_FIXE);
    } catch {
      // Console défaillante : rien de plus à faire sans risquer de lever.
    }
  }
}
