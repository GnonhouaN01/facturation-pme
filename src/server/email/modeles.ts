import "server-only";

import { z } from "zod";

import { TEXTES_EMAILS } from "@/textes/emails";

// Les modèles d'email : liste fermée, sur le modèle de journal/actions.ts.
// Pour chacun, le schéma strict de ses paramètres et la construction du sujet
// et du corps, en texte brut, à partir de src/textes/emails.ts. L'appelant ne
// fournit jamais ni sujet, ni corps, ni adresse de lien. Fiche :
// docs/features/envoi-emails.md, sections 3.2, 3.3 et 4.

// Jeton d'un lien public : 32 octets en base64url, sans remplissage.
export const LONGUEUR_JETON = 43;
export const LONGUEUR_MAX_CORPS = 10_000;
const LONGUEUR_MAX_EN_TETE = 200;

const JETON = new RegExp(`^[A-Za-z0-9_-]{${LONGUEUR_JETON}}$`, "u");
// Caractères de contrôle C0, DEL et C1.
const SANS_CONTROLE = /^[^\u0000-\u001f\u007f-\u009f]*$/u;
const CONTROLES = /[\u0000-\u001f\u007f-\u009f]+/gu;
const TYPE_LIEN = /^[a-z]+(?:-[a-z]+)*$/u;

// Les seules formes admises pour un paramètre (section 4) : aucune chaîne
// libre, aucune adresse, aucun tableau, aucun objet imbriqué.
export const briques = {
  identifiant: () => z.uuid(),
  enumeree: <const V extends readonly [string, ...string[]]>(valeurs: V) => z.enum(valeurs),
  entier: () => z.int(),
  booleen: () => z.boolean(),
  jeton: () => z.string().regex(JETON),
  texteAffichable: (max: number) => z.string().max(max).regex(SANS_CONTROLE),
};

export type Construction = { sujet: string; corps: string };

// Forme commune d'un modèle, pour la porte d'envoi : paramètres déjà validés
// par leur schéma, origine de la configuration pour les liens.
export type DefinitionModele = {
  parametres: z.ZodObject;
  construire: (parametres: Record<string, unknown>, contexte: { origine: string }) => Construction;
};

function corpsAvecFin(corps: string): string {
  return `${corps}\n\n${TEXTES_EMAILS.neRepondezPas}\n`;
}

export const MODELES_EMAIL = {
  // Modèle de démonstration et de vérification (section 9, étape 8).
  "essai.verification_envoi": {
    parametres: z.strictObject({}),
    // Ni paramètre, ni lien : la construction n'utilise ni l'un ni l'autre.
    construire: (
      parametres: Record<string, unknown>,
      contexte: { origine: string },
    ): Construction => {
      void parametres;
      void contexte;
      const textes = TEXTES_EMAILS.modeles["essai.verification_envoi"];
      return { sujet: textes.sujet, corps: corpsAvecFin(textes.corps) };
    },
  },
} as const satisfies Record<string, DefinitionModele>;

export type ModeleEmail = keyof typeof MODELES_EMAIL;

// Une ligne d'en-tête sans caractère de contrôle, de longueur bornée. Sert à
// un sujet qui porterait un jour un contenu saisi (aucun en 0.7).
export function ligneEnTete(texte: string, max = LONGUEUR_MAX_EN_TETE): string {
  const nettoye = texte.replace(CONTROLES, " ").trim();
  let resultat = "";
  for (const caractere of nettoye) {
    if (resultat.length + caractere.length > max) break;
    resultat += caractere;
  }
  return resultat;
}

class LienInvalide extends Error {
  constructor() {
    super("Lien public invalide.");
    this.name = "LienInvalide";
  }
}

// L'adresse d'un lien public : l'origine de la configuration, le chemin fixe
// /lien/<type>/<jeton>. Un appelant ne fournit qu'un jeton : il ne peut
// produire ni un lien vers un autre site, ni un autre chemin (T-65).
export function lienPublic(origine: string, type: string, jeton: string): string {
  if (!TYPE_LIEN.test(type) || !JETON.test(jeton)) throw new LienInvalide();
  const url = new URL(origine);
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new LienInvalide();
  return `${url.origin}/lien/${type}/${jeton}`;
}
