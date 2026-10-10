import "server-only";

// Contrôle de l'origine de la requête, en plus de celui de Next.js (S-81,
// T-17). Fonction pure. Fiche : docs/features/chaine-controles.md,
// section 3.3.

function origineDe(adresse: string): string | null {
  try {
    return new URL(adresse).origin;
  } catch {
    return null;
  }
}

// Origin obligatoire, égale à l'origine (schéma, hôte, port) de l'adresse
// configurée : jamais comparée à un en-tête de la requête (Host,
// X-Forwarded-Host). Sec-Fetch-Site, s'il est présent, vaut same-origin.
export function verifierOrigine(entetes: Headers, origineAttendue: string): boolean {
  const attendue = origineDe(origineAttendue);
  if (attendue === null) return false;

  // Comparaison exacte de la chaîne reçue : null, une liste ou une adresse
  // avec chemin ou identifiants ne sont jamais égaux à une origine.
  if (entetes.get("origin") !== attendue) return false;

  const site = entetes.get("sec-fetch-site");
  return site === null || site === "same-origin";
}
