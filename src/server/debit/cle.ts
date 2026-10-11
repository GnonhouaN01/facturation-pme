import "server-only";

import { createHmac, hkdfSync } from "node:crypto";

// Clé d'un compteur : le nom de la limite en clair, suivi d'une empreinte
// HMAC-SHA-256 du nom et de la valeur comptée. Jamais la valeur en clair
// (S-54). Fiche : docs/features/limitation-debit.md, section 3.

// Étiquette de la dérivation : la changer change toutes les clés, sans
// toucher au secret.
const ETIQUETTE = "facturation-pme/compteur-debit/v1";
const LONGUEUR_SECRET = 32;

// Clé secrète des empreintes, dérivée de BETTER_AUTH_SECRET par HKDF
// (décision 1) : connaître la clé dérivée ne révèle rien du secret.
export function deriverSecret(secretAuth: string): Uint8Array {
  return new Uint8Array(hkdfSync("sha256", secretAuth, "", ETIQUETTE, LONGUEUR_SECRET));
}

// Le nom entre dans l'empreinte, séparé de la valeur par un octet nul : une
// même valeur donne des clés sans rapport d'une limite à l'autre, et aucune
// découpe de « nom + valeur » n'en imite une autre.
export function cleCompteur(nom: string, valeur: string, secret: Uint8Array): string {
  const empreinte = createHmac("sha256", secret).update(`${nom}\0${valeur}`).digest("hex");
  return `${nom}:${empreinte}`;
}
