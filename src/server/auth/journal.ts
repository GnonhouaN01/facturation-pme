import "server-only";

import { randomUUID } from "node:crypto";

import { codePostgres } from "../erreurs/code-postgres";

// Le journal de Better Auth (options.logger.log). Better Auth lui passe le
// niveau, le message et des arguments ; ceux-ci peuvent contenir l'erreur
// complète d'une base en panne, dont la requête SQL et ses paramètres (le
// jeton de session, T-39), ou une adresse email interpolée dans le message.
// Cette fonction n'a qu'un paramètre : le message et les arguments ne sont
// jamais lus, donc jamais transmis. Une ligne fixe garde le signal. Fiche :
// docs/features/inscription.md, section 1.2.

const NIVEAUX_GARDES = new Set(["warn", "error"]);

// La cause d'une réponse « erreur », décrite par le gestionnaire : le point
// de /api/auth, ses appels internes à Better Auth, et l'erreur levée, s'il y
// en a une.
export type CauseIncident = {
  point: string;
  appels: readonly { chemin: string; statut: number; code: string | null }[];
  erreur?: unknown;
};

// Chaque valeur passe par une forme stricte ; hors forme, elle est remplacée,
// jamais recopiée.
const CHEMIN = /^\/[a-z0-9-]{1,40}(?:\/[a-z0-9-]{1,40}){0,3}$/u;
const CODE = /^[A-Z][A-Z0-9_]{0,63}$/u;
const CLASSE = /^[A-Za-z_$][A-Za-z0-9_$]{0,63}$/u;
const CONTRAINTE = /^[a-z_][a-z0-9_]{0,62}$/u;
const CADRE = /\(?((?:[A-Za-z]:)?[^\s()]+):(\d+):(\d+)\)?$/u;
const CADRE_COURT = /^[A-Za-z0-9_@.\-/]+:\d+:\d+$/u;
const CADRES_MAX = 8;

function chemin(valeur: string): string {
  return CHEMIN.test(valeur) ? valeur : "autre";
}

// Les emplacements de la pile (fichier:ligne:colonne), raccourcis à partir de
// node_modules/ ou src/. La première ligne de la pile, qui porte le message,
// n'est jamais lue ; les noms de fonction non plus.
function pile(erreur: unknown): string[] {
  if (!(erreur instanceof Error) || typeof erreur.stack !== "string") return [];
  const cadres: string[] = [];
  for (const ligne of erreur.stack.split("\n").slice(1)) {
    if (!ligne.trimStart().startsWith("at ")) continue;
    const trouve = CADRE.exec(ligne.trim());
    if (!trouve) continue;
    const fichier = (trouve[1] ?? "").replaceAll("\\", "/").replace(/^file:\/\/\/?/u, "");
    const reperes = ["node_modules/", "src/"].map((r) => fichier.lastIndexOf(r));
    const debut = Math.max(...reperes);
    const court = `${debut >= 0 ? fichier.slice(debut) : (fichier.split("/").pop() ?? "")}:${trouve[2]}:${trouve[3]}`;
    if (CADRE_COURT.test(court)) cadres.push(court);
    if (cadres.length === CADRES_MAX) break;
  }
  return cadres;
}

// L'erreur décrite sans son message : la classe de chaque maillon de la
// chaîne des causes, le code SQL, la contrainte et la pile.
function decrire(erreur: unknown) {
  const classes: string[] = [];
  let contrainte: string | null = null;
  let courante: unknown = erreur;
  for (let i = 0; i < 4 && courante !== undefined && courante !== null; i += 1) {
    const nom =
      courante instanceof Error || (typeof courante === "object" && "name" in courante)
        ? String((courante as { name: unknown }).name)
        : typeof courante;
    classes.push(CLASSE.test(nom) ? nom : typeof courante);
    const lue = (courante as { constraint?: unknown }).constraint;
    if (contrainte === null && typeof lue === "string" && CONTRAINTE.test(lue)) contrainte = lue;
    courante = typeof courante === "object" ? (courante as { cause?: unknown }).cause : undefined;
  }
  return { classes, code: codePostgres(erreur) ?? null, contrainte, pile: pile(erreur) };
}

// Identifiant d'incident d'une réponse « erreur » de /api/auth (1.2, dette de
// PLAN.md) : une ligne au niveau error, dont l'identifiant est rendu au
// gestionnaire, qui le renvoie au navigateur (S-85). Modifié le 2026-10-21
// (fix(1.2)) : une 500 sans cause était inexploitable ; la ligne porte la
// cause décrite (point, appels internes, classes, code SQL, contrainte,
// emplacements de la pile), jamais le message d'une erreur, une requête, ses
// paramètres, un jeton ni une adresse (T-39). Fiche :
// docs/features/connexion.md, section 6.
export function consignerIncidentAuth(cause?: CauseIncident): string {
  const incident = randomUUID();
  try {
    const decrite =
      cause === undefined
        ? {}
        : {
            point: chemin(cause.point),
            appels: cause.appels.map((appel) => ({
              chemin: chemin(appel.chemin),
              statut: Number.isInteger(appel.statut) ? appel.statut : 0,
              code: appel.code !== null && CODE.test(appel.code) ? appel.code : null,
            })),
            ...(cause.erreur === undefined ? {} : { erreur: decrire(cause.erreur) }),
          };
    console.error("[auth]", JSON.stringify({ niveau: "error", incident, ...decrite }));
  } catch {
    // Console défaillante : l'identifiant est rendu quand même.
  }
  return incident;
}

export function consignerAuth(niveau: string): void {
  if (!NIVEAUX_GARDES.has(niveau)) return;
  try {
    console.error("[auth]", JSON.stringify({ niveau, incident: randomUUID() }));
  } catch {
    // Console défaillante : rien de plus à faire sans risquer de lever.
  }
}
