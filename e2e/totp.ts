import { createHmac } from "node:crypto";

// Codes de l'application d'authentification, calculés par les tests de bout
// en bout depuis la clé affichée à l'écran (base32, groupée par 4) : RFC 6238,
// HMAC-SHA-1, 6 chiffres, 30 secondes, comme Better Auth. Aucune dépendance,
// aucun accès au serveur. Fiche : docs/features/double-authentification.md,
// test 26.

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function secretDeCle(cle: string): Buffer {
  let bits = "";
  for (const caractere of cle.replaceAll(/\s/gu, "")) {
    const valeur = ALPHABET.indexOf(caractere);
    if (valeur < 0) throw new Error("clé hors base32");
    bits += valeur.toString(2).padStart(5, "0");
  }
  const octets: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8)
    octets.push(Number.parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(octets);
}

// Le code de la tranche courante, décalée de « ecart » tranches.
export function codeTotp(cle: string, ecart = 0, maintenant = Date.now()): string {
  const compteur = Math.floor(maintenant / 30_000) + ecart;
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(compteur));
  const hmac = createHmac("sha1", secretDeCle(cle)).update(message).digest();
  const decalage = (hmac[hmac.length - 1] ?? 0) & 15;
  const tronque = hmac.readUInt32BE(decalage) & 0x7fffffff;
  return String(tronque % 1_000_000).padStart(6, "0");
}
