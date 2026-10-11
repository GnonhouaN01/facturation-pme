import "server-only";

import { sql } from "drizzle-orm";

import { db, type BaseDeDonnees } from "./client";
import { compteurDebit } from "./schema/technique";

// Le compteur de débit : une instruction atomique par tentative, hors de
// toute transaction d'organisation, et la purge des lignes expirées. Seul
// fichier qui touche compteur_debit (règle N). Fiche :
// docs/features/limitation-debit.md, sections 2, 4 et 7.

export type RegleDebit = {
  maximum: number;
  fenetreSecondes: number;
};

export type Compteur = {
  // Compte une tentative et renvoie le compte après l'incrément, plafonné à
  // maximum + 1.
  consommer: (cle: string, regle: RegleDebit) => Promise<number>;
  // Supprime les lignes dont la fenêtre a commencé il y a plus de
  // fenetreSecondes ; renvoie le nombre de lignes supprimées.
  purger: (fenetreSecondes: number) => Promise<number>;
};

function entierPositif(valeur: number, nom: string): number {
  if (!Number.isSafeInteger(valeur) || valeur <= 0) {
    throw new Error(`Règle de débit invalide : ${nom}.`);
  }
  return valeur;
}

// Fabrique liée à une base : les tests de concurrence s'en servent avec un
// Pool de plusieurs dizaines de connexions.
export function creerCompteur(base: BaseDeDonnees): Compteur {
  // Une seule instruction, en validation automatique : acquise avant que
  // l'action commence, même si celle-ci est annulée ensuite (section 2.1).
  // INSERT ... ON CONFLICT DO UPDATE est atomique : la ligne existante est
  // verrouillée, les requêtes simultanées attendent et lisent le compte déjà
  // incrémenté. Dans SET, les colonnes de compteur_debit désignent l'ancienne
  // ligne : la remise à zéro et le nouveau début sont décidés sur la même
  // valeur. Tout le temps vient de la base (now()).
  async function consommer(cle: string, regle: RegleDebit): Promise<number> {
    const maximum = entierPositif(regle.maximum, "maximum");
    const fenetre = entierPositif(regle.fenetreSecondes, "fenêtre");
    const expiree = sql`${compteurDebit.fenetreDebut} <= now() - make_interval(secs => ${fenetre}::double precision)`;

    const [ligne] = await base
      .insert(compteurDebit)
      .values({ cle, compte: 1, fenetreDebut: sql`now()` })
      .onConflictDoUpdate({
        target: compteurDebit.cle,
        set: {
          compte: sql`CASE WHEN ${expiree} THEN 1 ELSE LEAST(${compteurDebit.compte} + 1, ${maximum}::integer + 1) END`,
          fenetreDebut: sql`CASE WHEN ${expiree} THEN now() ELSE ${compteurDebit.fenetreDebut} END`,
        },
      })
      .returning({ compte: compteurDebit.compte });
    if (!ligne) throw new Error("Compteur de débit sans ligne renvoyée.");
    return ligne.compte;
  }

  async function purger(fenetreSecondes: number): Promise<number> {
    const fenetre = entierPositif(fenetreSecondes, "fenêtre");
    const resultat = await base
      .delete(compteurDebit)
      .where(
        sql`${compteurDebit.fenetreDebut} < now() - make_interval(secs => ${fenetre}::double precision)`,
      );
    return resultat.rowCount ?? 0;
  }

  return { consommer, purger };
}

export const compteur = creerCompteur(db);
