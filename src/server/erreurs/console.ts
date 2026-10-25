import "server-only";

import { codePostgres } from "./code-postgres";
import { classeDe } from "./consigner";

// Filtre de la console du serveur (T-39), installé au démarrage par register
// (src/instrumentation.ts). Une dépendance peut écrire une erreur entière à
// la console : @better-auth/core (db/adapter/factory.mjs, handleFallbackJoin)
// fait console.error(error), et le message d'une erreur de Drizzle contient
// la requête et ses paramètres, dont un jeton de session. Seul console.error
// est filtré (décision du 2026-10-22) : chaque argument passe par
// argumentSur avant la méthode d'origine ; un objet n'est jamais formaté (ni
// message, ni pile, ni cause, ni propriétés), seuls sa classe et son code
// passent ; un texte qui ressemble à une requête SQL est retiré. Nos propres
// lignes (préfixe et JSON de valeurs en forme stricte) passent inchangées.
// log, info, warn et debug restent intacts. Fiche :
// docs/features/socle-interface.md, section 4.4.

// Message d'une erreur de Drizzle, ou instruction SQL : retiré en entier.
// Motifs sans partie extensible entre deux mots : coût linéaire.
const TEXTE_REQUETE = /failed query|\bparams:|\binsert\s+into\b|\bdelete\s+from\b/iu;

// « select ... from » et « update ... set » : le second mot cherché après la
// première occurrence du premier, en un seul parcours chacun. Une expression
// « select[\s\S]*from » repartait de chaque « select » jusqu'à la fin du
// texte : coût quadratique (1,7 s pour 99 000 caractères).
const PAIRES: readonly (readonly [RegExp, RegExp])[] = [
  [/\bselect\b/iu, /\bfrom\b/giu],
  [/\bupdate\b/iu, /\bset\b/giu],
];

function ressembleRequete(texte: string): boolean {
  if (TEXTE_REQUETE.test(texte)) return true;
  for (const [premier, second] of PAIRES) {
    const trouve = premier.exec(texte);
    if (trouve === null) continue;
    second.lastIndex = trouve.index + trouve[0].length;
    if (second.test(texte)) return true;
  }
  return false;
}

// Code système d'une erreur réseau (ECONNRESET), en plus d'un SQLSTATE.
const CODE_SYSTEME = /^E[A-Z0-9_]{1,31}$/u;

const TEXTE_RETIRE = "[texte retiré]";
const VALEUR_RETIREE = "[valeur retirée]";

function codeDe(valeur: object): string | undefined {
  const sqlstate = codePostgres(valeur);
  if (sqlstate !== undefined) return sqlstate;
  const { code } = valeur as { code?: unknown };
  return typeof code === "string" && CODE_SYSTEME.test(code) ? code : undefined;
}

// Ce qu'un argument devient avant d'atteindre la console. Ne lève jamais :
// une valeur hostile (accesseur ou Proxy qui lève) donne une ligne fixe.
export function argumentSur(valeur: unknown): unknown {
  try {
    if (typeof valeur === "string") return ressembleRequete(valeur) ? TEXTE_RETIRE : valeur;
    if (
      valeur === null ||
      valeur === undefined ||
      typeof valeur === "number" ||
      typeof valeur === "boolean" ||
      typeof valeur === "bigint"
    ) {
      return valeur;
    }
    if (typeof valeur !== "object" && typeof valeur !== "function") return VALEUR_RETIREE;
    const classe = classeDe(valeur);
    const code = codeDe(valeur);
    return code === undefined ? `[${classe}]` : `[${classe} ${code}]`;
  } catch {
    return VALEUR_RETIREE;
  }
}

// Les filtres posés, pour ne jamais en empiler deux.
const filtres = new WeakSet<object>();

// Remplace console.error par le filtre, et rend la fonction qui remet la
// méthode d'origine. Sans effet si console.error est déjà filtré.
export function installerFiltreConsole(cible: Console = console): () => void {
  const origine = cible.error;
  if (typeof origine !== "function" || filtres.has(origine)) return () => undefined;
  const filtre = function (this: unknown, ...args: unknown[]): void {
    Reflect.apply(origine, cible, args.map(argumentSur));
  };
  filtres.add(filtre);
  cible.error = filtre;
  return () => {
    cible.error = origine;
  };
}
