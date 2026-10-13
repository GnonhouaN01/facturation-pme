import "server-only";

import { createHash, timingSafeEqual } from "node:crypto";

// Comparaison de l'en-tête Authorization reçu avec « Bearer <CRON_SECRET> »,
// en temps constant : les deux valeurs passent par SHA-256, et
// timingSafeEqual compare deux empreintes de 32 octets. La durée ne dépend ni
// de la longueur de l'en-tête, ni de la position du premier caractère
// différent. Secret non configuré : le même calcul, puis refus, quel que soit
// l'en-tête. Fiche : docs/features/tache-quotidienne.md, section 2.2.

function empreinte(valeur: string): Buffer {
  return createHash("sha256").update(valeur, "utf8").digest();
}

export function secretValide(entete: string | null, secret: string | null): boolean {
  const egales = timingSafeEqual(empreinte(entete ?? ""), empreinte(`Bearer ${secret ?? ""}`));
  return egales && secret !== null;
}
