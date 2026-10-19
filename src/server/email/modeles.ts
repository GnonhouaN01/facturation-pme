import "server-only";

import { z } from "zod";

import { JETON_REINITIALISATION } from "@/schemas/regles-compte";
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

// Jeton de vérification de Better Auth : un JWT signé, trois segments
// base64url non vides séparés par des points, longueur bornée. Il contient
// l'adresse email (encodée) : il ne voyage que dans le fragment d'un lien
// (docs/features/inscription.md, section 4.3, décision 3).
export const LONGUEUR_MAX_JETON_VERIFICATION = 1024;
export const MOTIF_JETON_VERIFICATION = "^[A-Za-z0-9_-]+\\.[A-Za-z0-9_-]+\\.[A-Za-z0-9_-]+$";
const JETON_VERIFICATION = new RegExp(MOTIF_JETON_VERIFICATION, "u");
// Jeton de réinitialisation de Better Auth (generateId(24)) : 24 caractères
// [A-Za-z0-9], sans état lisible (docs/features/mot-de-passe.md, section 3).
export const MOTIF_JETON_REINITIALISATION = JETON_REINITIALISATION.source;
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
  jetonVerification: () =>
    z.string().max(LONGUEUR_MAX_JETON_VERIFICATION).regex(JETON_VERIFICATION),
  jetonReinitialisation: () => z.string().regex(JETON_REINITIALISATION),
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
  // Vérification de l'adresse à l'inscription (UC-01, étape 3). Le lien porte
  // le jeton dans son fragment : jamais dans une adresse reçue par le
  // serveur. Fiche : docs/features/inscription.md, sections 4.3 et 4.5.
  "compte.verification": {
    parametres: z.strictObject({ jeton: briques.jetonVerification() }),
    construire: (
      parametres: Record<string, unknown>,
      contexte: { origine: string },
    ): Construction => {
      const textes = TEXTES_EMAILS.modeles["compte.verification"];
      const lien = lienFragment(contexte.origine, "verification", String(parametres.jeton));
      return {
        sujet: textes.sujet,
        corps: corpsAvecFin(`${textes.corps}\n\n${lien}\n\n${textes.validite}`),
      };
    },
  },
  // Inscription avec une adresse qui a déjà un compte (UC-01, 3a) : aucun
  // paramètre ; deux liens de pages fixes, écrits ici (décision A de la 1.3,
  // docs/features/mot-de-passe.md, section 6.3).
  "compte.existant": {
    parametres: z.strictObject({}),
    construire: (
      parametres: Record<string, unknown>,
      contexte: { origine: string },
    ): Construction => {
      void parametres;
      const textes = TEXTES_EMAILS.modeles["compte.existant"];
      const corps = [
        textes.corps,
        `${textes.connexion}\n${lienPage(contexte.origine, "connexion")}`,
        `${textes.oubli}\n${lienPage(contexte.origine, "mot-de-passe-oublie")}`,
        textes.fin,
      ].join("\n\n");
      return { sujet: textes.sujet, corps: corpsAvecFin(corps) };
    },
  },
  // Réinitialisation du mot de passe (UC-03, étape 2) : le lien porte le jeton
  // dans son fragment, comme la vérification. Fiche :
  // docs/features/mot-de-passe.md, sections 3.4 et 6.2.
  "compte.reinitialisation": {
    parametres: z.strictObject({ jeton: briques.jetonReinitialisation() }),
    construire: (
      parametres: Record<string, unknown>,
      contexte: { origine: string },
    ): Construction => {
      const textes = TEXTES_EMAILS.modeles["compte.reinitialisation"];
      const lien = lienFragment(contexte.origine, "reinitialisation", String(parametres.jeton));
      return {
        sujet: textes.sujet,
        corps: corpsAvecFin(`${textes.corps}\n\n${lien}\n\n${textes.validite}`),
      };
    },
  },
  // Notification après une réinitialisation (UC-03, étape 4) : aucun
  // paramètre ; lien fixe vers « mot de passe oublié ».
  "compte.mot_de_passe_modifie": {
    parametres: z.strictObject({}),
    construire: (
      parametres: Record<string, unknown>,
      contexte: { origine: string },
    ): Construction => {
      void parametres;
      const textes = TEXTES_EMAILS.modeles["compte.mot_de_passe_modifie"];
      const lien = lienPage(contexte.origine, "mot-de-passe-oublie");
      return {
        sujet: textes.sujet,
        corps: corpsAvecFin(`${textes.corps}\n\n${textes.oubli}\n${lien}`),
      };
    },
  },
  // Double authentification (1.4) : six notifications, aucun paramètre ; un
  // seul lien, la page fixe « mot de passe oublié ». Ni code, ni clé, ni
  // date, ni adresse IP. Fiche : docs/features/double-authentification.md,
  // section 10.
  "compte.double_auth_activee": {
    parametres: z.strictObject({}),
    construire: (
      parametres: Record<string, unknown>,
      contexte: { origine: string },
    ): Construction => {
      void parametres;
      const textes = TEXTES_EMAILS.modeles["compte.double_auth_activee"];
      const lien = lienPage(contexte.origine, "mot-de-passe-oublie");
      return {
        sujet: textes.sujet,
        corps: corpsAvecFin(`${textes.corps}\n\n${textes.oubli}\n${lien}`),
      };
    },
  },
  "compte.double_auth_desactivee": {
    parametres: z.strictObject({}),
    construire: (
      parametres: Record<string, unknown>,
      contexte: { origine: string },
    ): Construction => {
      void parametres;
      const textes = TEXTES_EMAILS.modeles["compte.double_auth_desactivee"];
      const lien = lienPage(contexte.origine, "mot-de-passe-oublie");
      return {
        sujet: textes.sujet,
        corps: corpsAvecFin(`${textes.corps}\n\n${textes.oubli}\n${lien}`),
      };
    },
  },
  "compte.double_auth_remplacee": {
    parametres: z.strictObject({}),
    construire: (
      parametres: Record<string, unknown>,
      contexte: { origine: string },
    ): Construction => {
      void parametres;
      const textes = TEXTES_EMAILS.modeles["compte.double_auth_remplacee"];
      const lien = lienPage(contexte.origine, "mot-de-passe-oublie");
      return {
        sujet: textes.sujet,
        corps: corpsAvecFin(`${textes.corps}\n\n${textes.oubli}\n${lien}`),
      };
    },
  },
  "compte.codes_secours_regeneres": {
    parametres: z.strictObject({}),
    construire: (
      parametres: Record<string, unknown>,
      contexte: { origine: string },
    ): Construction => {
      void parametres;
      const textes = TEXTES_EMAILS.modeles["compte.codes_secours_regeneres"];
      const lien = lienPage(contexte.origine, "mot-de-passe-oublie");
      return {
        sujet: textes.sujet,
        corps: corpsAvecFin(`${textes.corps}\n\n${textes.oubli}\n${lien}`),
      };
    },
  },
  "compte.code_secours_utilise": {
    parametres: z.strictObject({}),
    construire: (
      parametres: Record<string, unknown>,
      contexte: { origine: string },
    ): Construction => {
      void parametres;
      const textes = TEXTES_EMAILS.modeles["compte.code_secours_utilise"];
      const lien = lienPage(contexte.origine, "mot-de-passe-oublie");
      return {
        sujet: textes.sujet,
        corps: corpsAvecFin(`${textes.corps}\n\n${textes.oubli}\n${lien}`),
      };
    },
  },
  "compte.double_auth_tentatives": {
    parametres: z.strictObject({}),
    construire: (
      parametres: Record<string, unknown>,
      contexte: { origine: string },
    ): Construction => {
      void parametres;
      const textes = TEXTES_EMAILS.modeles["compte.double_auth_tentatives"];
      const lien = lienPage(contexte.origine, "mot-de-passe-oublie");
      return {
        sujet: textes.sujet,
        corps: corpsAvecFin(`${textes.corps}\n\n${textes.oubli}\n${lien}\n\n${textes.suspension}`),
      };
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

// L'adresse d'un lien dont le jeton voyage dans le fragment : l'origine de la
// configuration, le chemin fixe /lien/<type>, puis #<jeton>. Un navigateur
// n'envoie jamais le fragment au serveur, ni dans la requête ni dans Referer
// (décision 3 de docs/features/inscription.md). Même contrôle que lienPublic
// (T-65) : l'appelant ne fournit qu'un jeton.
// 1.3 : chaque type a sa brique de jeton, dans une table fermée ; un type
// absent de la table, ou un jeton d'une autre forme, est refusé.
const JETONS_FRAGMENT: Readonly<Record<string, () => z.ZodType>> = Object.freeze({
  verification: briques.jetonVerification,
  reinitialisation: briques.jetonReinitialisation,
});

export function lienFragment(origine: string, type: string, jeton: string): string {
  const brique = Object.hasOwn(JETONS_FRAGMENT, type) ? JETONS_FRAGMENT[type] : undefined;
  if (!TYPE_LIEN.test(type) || brique === undefined || !brique().safeParse(jeton).success) {
    throw new LienInvalide();
  }
  return `${origineWeb(origine)}/lien/${type}#${jeton}`;
}

// Les pages fixes qu'un email peut viser (décision A de la 1.3) : liste
// fermée, écrite dans la construction d'un modèle, jamais fournie par
// l'appelant. Toujours sur l'origine de la configuration, sans requête ni
// fragment (T-65, règle 17). Fiche : docs/features/mot-de-passe.md,
// section 6.3.
export const PAGES_LIEN = Object.freeze({
  connexion: "/connexion",
  "mot-de-passe-oublie": "/mot-de-passe-oublie",
} as const);

export type PageLien = keyof typeof PAGES_LIEN;

export function lienPage(origine: string, page: PageLien): string {
  // Contrôle à l'exécution aussi : le type ne protège pas d'une valeur venue
  // d'ailleurs, ni des clés héritées (toString, __proto__).
  if (typeof page !== "string" || !Object.hasOwn(PAGES_LIEN, page)) throw new LienInvalide();
  return `${origineWeb(origine)}${PAGES_LIEN[page]}`;
}

// L'origine d'une adresse de configuration en http ou https, sinon refus.
function origineWeb(origine: string): string {
  const url = new URL(origine);
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new LienInvalide();
  return url.origin;
}
