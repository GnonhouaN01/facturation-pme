import { createHmac, randomBytes } from "node:crypto";

// Second serveur de Playwright : le site construit, lancé avec une
// configuration VALIDE pour env-schema.ts (rôle app_facturation, secret de 32
// caractères au moins, adresse locale) et une base injoignable (port fermé
// sur 127.0.0.1). register passe, le proxy répond ; la panne n'apparaît qu'à
// la première lecture en base. Fiche : docs/features/socle-interface.md,
// section 4.3, décisions 17 et 28.
//
// TOUTES LES VALEURS DE CE FICHIER SONT FACTICES. Aucune ne vient de
// .env.local ni d'un service réel, et aucune n'en a la forme : hôte local,
// port fermé, base et mot de passe nommés « injoignable » et « factice »,
// secret lisible qui se déclare factice, adresse locale en http. Seul le nom
// du rôle, app_facturation, est celui du projet : env-schema.ts l'exige, et
// ce n'est pas un secret. Ne jamais y recopier une valeur réelle.

export const PORT_PANNE = 3101;
export const ADRESSE_PANNE = `http://localhost:${PORT_PANNE}`;

// Port 1 (tcpmux) : aucun service n'y écoute sur un poste ni en CI. Vérifié
// par un test avant les autres (e2e/erreurs.attaque.spec.ts).
export const PORT_BASE_FERME = 1;

export const CONFIGURATION_PANNE = {
  DATABASE_URL: `postgresql://app_facturation:mot-de-passe-factice@127.0.0.1:${PORT_BASE_FERME}/base_injoignable`,
  BETTER_AUTH_SECRET: "secret-factice-du-serveur-en-panne-0123456789",
  BETTER_AUTH_URL: ADRESSE_PANNE,
} as const;

// Valeurs factices, qui ne doivent apparaître dans aucune réponse.
export const VALEURS_FACTICES = [
  "mot-de-passe-factice",
  "base_injoignable",
  CONFIGURATION_PANNE.BETTER_AUTH_SECRET,
  `127.0.0.1:${PORT_BASE_FERME}`,
] as const;

// Nom du cookie de session de Better Auth sur http (sans préfixe __Secure-).
export const COOKIE_SESSION = "better-auth.session_token";

// Cookie de session au jeton aléatoire, SIGNÉ avec le secret factice du
// second serveur (HMAC-SHA256, base64, format de better-call). Sans
// signature valide, Better Auth renvoie « pas de session » sans lire la base
// (constaté dans better-call/dist/context.mjs, getSignedCookie) : la page
// répondrait « introuvable », et la panne ne serait jamais observée. Avec
// elle, Better Auth cherche le jeton en base, et la lecture échoue. Ce n'est
// pas une session : aucune ligne n'existe, et le secret n'est que celui de ce
// serveur de test.
export function cookieSessionSigne(): string {
  const jeton = randomBytes(24).toString("base64url");
  const signature = createHmac("sha256", CONFIGURATION_PANNE.BETTER_AUTH_SECRET)
    .update(jeton)
    .digest("base64");
  return encodeURIComponent(`${jeton}.${signature}`);
}
