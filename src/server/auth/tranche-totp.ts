import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";

import { CODE_TOTP } from "@/schemas/regles-compte";

// Anti-rejeu des codes de l'application (décision 4) : la tranche de 30
// secondes qui correspond à un code, calculée comme Better Auth (RFC 6238,
// HMAC-SHA-1, 6 chiffres, fenêtre de ±1 tranche ; la clé est la chaîne du
// secret, en UTF-8), pour refuser un code déjà accepté pour un compte. Le
// secret n'est ni écrit ni rendu. Fiche :
// docs/features/double-authentification.md, section 6.1.

export const PERIODE_TOTP = 30;
const FENETRE = 1;

export function trancheCourante(maintenantMs: number): number {
  return Math.floor(maintenantMs / (PERIODE_TOTP * 1000));
}

// RFC 4226, réduit à 6 chiffres.
export function codeHotp(secret: string, compteur: number): string {
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(compteur));
  const hmac = createHmac("sha1", Buffer.from(secret, "utf8")).update(message).digest();
  const decalage = (hmac[hmac.length - 1] ?? 0) & 15;
  const tronque = hmac.readUInt32BE(decalage) & 0x7fffffff;
  return String(tronque % 1_000_000).padStart(6, "0");
}

// La tranche du code dans la fenêtre de ±1 autour de maintenant, ou null.
// Toutes les tranches sont comparées, en temps constant.
export function trancheDuCode(secret: string, code: string, maintenantMs: number): number | null {
  if (!CODE_TOTP.test(code)) return null;
  const t = trancheCourante(maintenantMs);
  const recu = Buffer.from(code, "utf8");
  let trouvee: number | null = null;
  for (let ecart = -FENETRE; ecart <= FENETRE; ecart += 1) {
    const attendu = Buffer.from(codeHotp(secret, t + ecart), "utf8");
    if (timingSafeEqual(recu, attendu)) trouvee = t + ecart;
  }
  return trouvee;
}
