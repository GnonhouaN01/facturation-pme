import "server-only";

import { purgerCompteurs } from "../debit/debit";
import { purgerComptesNonVerifies, purgerSessionsExpirees } from "../db/comptes";
import { codePostgres } from "../erreurs/code-postgres";
import { classeDe } from "../erreurs/consigner";

// Les étapes de la tâche quotidienne, dans l'ordre, chacune lancée quelle
// que soit l'issue de l'autre. Chacune est un seul DELETE sur l'âge des
// lignes : idempotente, rejouable, sûre si deux appels se croisent. Une
// ligne de journal par étape, champs choisis : jamais le message d'une
// erreur, sa pile, sa cause, ni une donnée (S-54, T-35). Fiche :
// docs/features/tache-quotidienne.md, sections 3.1 à 3.3.

export type NomEtape = "compteurs_debit" | "comptes_non_verifies" | "sessions_expirees";

export type Etape = Readonly<{
  nom: NomEtape;
  // Renvoie le nombre de lignes supprimées.
  executer: () => Promise<number>;
}>;

export const ETAPES: readonly Etape[] = Object.freeze([
  Object.freeze({ nom: "compteurs_debit", executer: purgerCompteurs }),
  Object.freeze({ nom: "comptes_non_verifies", executer: purgerComptesNonVerifies }),
  // 1.2 : sessions expirées (docs/features/connexion.md, section 4.4).
  Object.freeze({ nom: "sessions_expirees", executer: purgerSessionsExpirees }),
] satisfies Etape[]);

const PREFIXE = "[tache]";
// Ligne écrite quand le calcul de la ligne échoue : sans aucune donnée de la
// valeur levée.
const LIGNE_FIXE = JSON.stringify({ echec: "consignation" });

function duree(debut: number): number {
  return Math.max(0, Math.round(performance.now() - debut));
}

// Ne lève jamais : une valeur levée hostile (accesseur ou Proxy qui lève) ou
// une console défaillante ne font ni échouer la tâche, ni passer au journal
// le message de leur propre erreur.
function consignerReussite(nom: NomEtape, lignes: number, dureeMs: number): void {
  try {
    console.info(PREFIXE, JSON.stringify({ etape: nom, resultat: "ok", lignes, dureeMs }));
  } catch {
    // Console défaillante : rien de plus à faire sans risquer de lever.
  }
}

function consignerEchec(nom: NomEtape, erreur: unknown, dureeMs: number): void {
  try {
    const code = codePostgres(erreur);
    const ligne = {
      etape: nom,
      resultat: "erreur",
      classe: classeDe(erreur),
      ...(code === undefined ? {} : { code }),
      dureeMs,
    };
    console.error(PREFIXE, JSON.stringify(ligne));
  } catch {
    try {
      console.error(PREFIXE, LIGNE_FIXE);
    } catch {
      // Console défaillante : rien de plus à faire sans risquer de lever.
    }
  }
}

// Lance chaque étape, dans l'ordre ; renvoie vrai si toutes ont réussi.
export async function executerEtapes(etapes: readonly Etape[]): Promise<boolean> {
  let toutes = true;
  for (const { nom, executer } of etapes) {
    const debut = performance.now();
    try {
      const lignes = await executer();
      consignerReussite(nom, lignes, duree(debut));
    } catch (erreur) {
      toutes = false;
      consignerEchec(nom, erreur, duree(debut));
    }
  }
  return toutes;
}
