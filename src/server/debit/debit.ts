import "server-only";

import { compteur, type Compteur } from "../db/debit";
import { env } from "../env";

import { cleCompteur, deriverSecret } from "./cle";
import { fenetreMaxSecondes, LIMITES, type Limite, type NomLimite } from "./limites";

// La fonction réutilisable : compte une tentative pour une limite et une
// valeur, et dit si la limite est atteinte. Ne s'appelle jamais pendant une
// transaction ouverte (section 2.1). Fiche : docs/features/limitation-debit.md,
// section 2.

export type Verificateur = {
  // Vrai : sous la limite, la tentative est permise.
  verifierDebit: (nom: NomLimite, valeur: string) => Promise<boolean>;
  // La clé du compteur, pour les tests qui nettoient leurs lignes.
  cle: (nom: NomLimite, valeur: string) => string;
};

// limites : toutes celles de LIMITES, ou une partie (tests). Un nom absent
// lève, comme un nom inconnu.
export function creerVerificateur(options: {
  limites: Readonly<Partial<Record<NomLimite, Limite>>>;
  compteur: Compteur;
  secret: Uint8Array;
}): Verificateur {
  const { limites, secret } = options;

  // Seules les clés propres comptent : un nom hérité (constructor) n'est pas
  // une limite.
  function limiteDe(nom: NomLimite): Limite {
    const limite = Object.hasOwn(limites, nom) ? limites[nom] : undefined;
    if (limite === undefined) throw new Error("Limite de débit inconnue.");
    return limite;
  }

  function cle(nom: NomLimite, valeur: string): string {
    limiteDe(nom);
    return cleCompteur(nom, valeur, secret);
  }

  async function verifierDebit(nom: NomLimite, valeur: string): Promise<boolean> {
    const { maximum, fenetreSecondes } = limiteDe(nom);
    const compte = await options.compteur.consommer(cleCompteur(nom, valeur, secret), {
      maximum,
      fenetreSecondes,
    });
    return compte <= maximum;
  }

  return { verifierDebit, cle };
}

const verificateur = creerVerificateur({
  limites: LIMITES,
  compteur,
  secret: deriverSecret(env.BETTER_AUTH_SECRET),
});

// Vérificateur lié aux vraies limites, au vrai compteur et à la clé dérivée.
export const verifierDebit: Verificateur["verifierDebit"] = verificateur.verifierDebit;

// Purge des compteurs expirés, appelée par la tâche quotidienne (jalon 1) :
// au-delà de la plus longue fenêtre, une ligne ne peut plus servir.
export function purgerCompteurs(): Promise<number> {
  return compteur.purger(fenetreMaxSecondes(LIMITES));
}
