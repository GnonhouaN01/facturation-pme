import "server-only";

// Code PostgreSQL d'une erreur, en suivant la chaîne des cause : Drizzle
// enveloppe l'erreur de pg. Seul un code de cinq caractères est retenu, pour
// qu'aucune autre valeur ne passe au journal technique. Utilisé par la chaîne
// de contrôles (actions/refus.ts) et par onRequestError (erreurs/consigner.ts).
// Sans dépendance : consigner.ts ne doit pas charger server/env.ts.
export function codePostgres(erreur: unknown): string | undefined {
  let courante: unknown = erreur;
  for (let profondeur = 0; profondeur < 10 && courante; profondeur += 1) {
    if (typeof courante === "object" && "code" in courante) {
      const { code } = courante as { code: unknown };
      if (typeof code === "string" && /^[0-9A-Z]{5}$/.test(code)) return code;
    }
    courante = typeof courante === "object" ? (courante as { cause?: unknown }).cause : undefined;
  }
  return undefined;
}
