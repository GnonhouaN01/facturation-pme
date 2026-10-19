import "server-only";

import { encode } from "uqr";

// Matrice du code QR de l'activation (décision 1) : seul fichier qui importe
// uqr (règle ESLint V). Le navigateur ne reçoit que des lignes de 0 et de 1,
// sans marge (tracée par le composant). Fiche :
// docs/features/double-authentification.md, section 11.3.

const LONGUEUR_MAX = 512;

export function matriceQr(texte: string): string[] {
  if (!texte.startsWith("otpauth://totp/") || texte.length > LONGUEUR_MAX) {
    throw new Error("adresse de code QR refusée");
  }
  const { data } = encode(texte, { ecc: "M", border: 0, maxVersion: 15 });
  return data.map((ligne) => ligne.map((noir) => (noir ? "1" : "0")).join(""));
}
