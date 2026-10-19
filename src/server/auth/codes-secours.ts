import "server-only";

import { createHmac, hkdfSync, randomInt } from "node:crypto";

import { ALPHABET_CODES_SECOURS, CODE_SECOURS } from "@/schemas/regles-compte";

import { env } from "../env";

// Codes de secours de la double authentification (F-003) : générés ici,
// stockés par Better Auth sous la seule forme d'empreintes HMAC-SHA-256 à clé
// dérivée de BETTER_AUTH_SECRET (S-15, THREATS.md 7.2), jamais en clair ni
// sous une forme réversible. La passerelle envoie à Better Auth l'empreinte
// du code saisi, jamais le code. Fiche :
// docs/features/double-authentification.md, section 3.2.

export const NOMBRE_CODES_SECOURS = 10;
export const PREFIXE_EMPREINTE_CODE = "cs1:";
const LONGUEUR_CODE = 10;
const ETIQUETTE = "facturation-pme/codes-secours/v1";
const EMPREINTE = /^cs1:[A-Za-z0-9_-]{43}$/u;

export function genererCodesSecours(tirer: (max: number) => number = randomInt): string[] {
  const codes = new Set<string>();
  while (codes.size < NOMBRE_CODES_SECOURS) {
    let brut = "";
    for (let i = 0; i < LONGUEUR_CODE; i += 1) {
      brut += ALPHABET_CODES_SECOURS[tirer(ALPHABET_CODES_SECOURS.length)];
    }
    codes.add(`${brut.slice(0, 5)}-${brut.slice(5)}`);
  }
  return [...codes];
}

export function deriverSecretCodes(secretAuth: string): Uint8Array {
  return new Uint8Array(hkdfSync("sha256", secretAuth, "", ETIQUETTE, 32));
}

// L'empreinte d'un code normalisé (xxxxx-xxxxx) ; toute autre forme lève.
export function creerEmpreinteCodeSecours(secret: Uint8Array): (code: string) => string {
  return (code) => {
    if (!CODE_SECOURS.test(code)) throw new Error("code de secours hors forme");
    const empreinte = createHmac("sha256", secret).update(code).digest("base64url");
    return `${PREFIXE_EMPREINTE_CODE}${empreinte}`;
  };
}

// storeBackupCodes de Better Auth. encrypt reçoit la liste à stocker : des
// codes frais à la génération (hachés ici), ou la liste d'empreintes que
// Better Auth réécrit après un usage (gardée telle quelle). decrypt rend la
// liste stockée : aucun déchiffrement, rien n'est réversible.
export function creerStockageCodesSecours(empreinte: (code: string) => string): {
  encrypt: (donnees: string) => Promise<string>;
  decrypt: (donnees: string) => Promise<string>;
} {
  return {
    encrypt: async (donnees) => {
      const liste: unknown = JSON.parse(donnees);
      if (!Array.isArray(liste)) throw new Error("liste de codes de secours invalide");
      const stockee = liste.map((element: unknown) => {
        if (typeof element !== "string") throw new Error("code de secours invalide");
        if (EMPREINTE.test(element)) return element;
        return empreinte(element);
      });
      return JSON.stringify(stockee);
    },
    decrypt: async (donnees) => donnees,
  };
}

export const empreinteCodeSecours = creerEmpreinteCodeSecours(
  deriverSecretCodes(env.BETTER_AUTH_SECRET),
);
export const stockageCodesSecours = creerStockageCodesSecours(empreinteCodeSecours);

// Options de l'extension twoFactor (section 1) : émetteur, attente de 5
// minutes, nos codes. Ni code par email (otpOptions), ni activation sans
// vérification, ni mot de passe facultatif ; verrou du compte par défaut.
export const OPTIONS_DOUBLE_AUTH = {
  issuer: "Facturation PME",
  twoFactorCookieMaxAge: 5 * 60,
  backupCodeOptions: {
    amount: NOMBRE_CODES_SECOURS,
    customBackupCodesGenerate: genererCodesSecours,
    storeBackupCodes: stockageCodesSecours,
  },
};
