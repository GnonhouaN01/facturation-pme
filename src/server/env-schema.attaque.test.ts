import { describe, expect, test } from "vitest";

import { validerEnvironnement } from "@/server/env-schema";

// Valeurs factices, sans rapport avec un secret réel. Elles sont distinctives
// pour qu'une fuite dans le message soit détectable.
const MOT_DE_PASSE = "MotDePasseFactice9f3k";
const HOTE_BASE = "hote-cache.exemple.test";
const HOTE_AUTH = "auth-cache.exemple.test";
const SECRET_32 = "SecretFacticeTrenteDeuxCaract32x";
const SECRET_COURT = "SecretFacticeCourt7Qz";

function sourceValide(): Record<string, string | undefined> {
  return {
    DATABASE_URL: `postgresql://app_facturation:${MOT_DE_PASSE}@${HOTE_BASE}/facturation?sslmode=verify-full`,
    BETTER_AUTH_SECRET: SECRET_32,
    BETTER_AUTH_URL: `https://${HOTE_AUTH}`,
  };
}

function capturerErreur(source: Record<string, string | undefined>): Error {
  try {
    validerEnvironnement(source);
  } catch (erreur) {
    return erreur as Error;
  }
  throw new Error("validerEnvironnement aurait dû lever une erreur");
}

type Cas = {
  nom: string;
  source: Record<string, string | undefined>;
  ligne: string;
  interdits: string[];
  // Valeurs courtes ou numériques : la pile d'appels contient des numéros de ligne qui les imiteraient.
  interditsDansMessage?: string[];
};

function casBase(nom: string, url: string, ligne: string, identifiant?: string): Cas {
  return {
    nom,
    source: { ...sourceValide(), DATABASE_URL: url },
    ligne,
    interdits: [url, MOT_DE_PASSE, HOTE_BASE, ...(identifiant ? [identifiant] : [])],
  };
}

function casAuth(nom: string, url: string, ligne: string, hote: string): Cas {
  return {
    nom,
    source: { ...sourceValide(), BETTER_AUTH_URL: url },
    ligne,
    interdits: [url, hote],
  };
}

const ROLE = "- DATABASE_URL : doit utiliser le rôle app_facturation";
const SSL = "- DATABASE_URL : doit exiger sslmode=verify-full";
const PG = "- DATABASE_URL : n'est pas une adresse PostgreSQL valide";
const HTTPS = "- BETTER_AUTH_URL : doit utiliser https";
const URL_INVALIDE = "- BETTER_AUTH_URL : n'est pas une adresse valide";

const CAS: Cas[] = [
  casBase(
    "T-53 : neondb_owner refusé même avec sslmode=verify-full",
    `postgresql://neondb_owner:${MOT_DE_PASSE}@${HOTE_BASE}/facturation?sslmode=verify-full`,
    ROLE,
    "neondb_owner",
  ),
  casBase(
    "T-53 : neondb%5Fowner (nom encodé) refusé",
    `postgresql://neondb%5Fowner:${MOT_DE_PASSE}@${HOTE_BASE}/facturation?sslmode=verify-full`,
    ROLE,
    "neondb",
  ),
  casBase(
    "T-53 : nom d'utilisateur à l'encodage invalide refusé",
    `postgresql://app%E0facturation:${MOT_DE_PASSE}@${HOTE_BASE}/facturation?sslmode=verify-full`,
    ROLE,
    "app%E0facturation",
  ),
  casBase(
    "rôle quelconque refusé",
    `postgresql://role_inconnu:${MOT_DE_PASSE}@${HOTE_BASE}/facturation?sslmode=verify-full`,
    ROLE,
    "role_inconnu",
  ),
  casBase(
    "hôte distant sans sslmode",
    `postgresql://app_facturation:${MOT_DE_PASSE}@${HOTE_BASE}/facturation`,
    SSL,
  ),
  casBase(
    "hôte distant avec sslmode=require",
    `postgresql://app_facturation:${MOT_DE_PASSE}@${HOTE_BASE}/facturation?sslmode=require`,
    SSL,
  ),
  casBase(
    "hôte localhost.exemple.com sans sslmode",
    `postgresql://app_facturation:${MOT_DE_PASSE}@localhost.exemple.com/facturation`,
    SSL,
    "localhost.exemple.com",
  ),
  casBase(
    "sslmode=disable&sslmode=verify-full sur un hôte distant",
    `postgresql://app_facturation:${MOT_DE_PASSE}@${HOTE_BASE}/facturation?sslmode=disable&sslmode=verify-full`,
    SSL,
  ),
  casBase(
    "sslmode=verify-full répété sur un hôte distant",
    `postgresql://app_facturation:${MOT_DE_PASSE}@${HOTE_BASE}/facturation?sslmode=verify-full&sslmode=verify-full`,
    SSL,
  ),
  casBase(
    "protocole autre que PostgreSQL",
    `https://app_facturation:${MOT_DE_PASSE}@${HOTE_BASE}/facturation?sslmode=verify-full`,
    PG,
  ),
  casBase("adresse illisible", `${MOT_DE_PASSE} ${HOTE_BASE}`, PG),
  {
    nom: "secret trop court",
    source: { ...sourceValide(), BETTER_AUTH_SECRET: SECRET_COURT },
    ligne: "- BETTER_AUTH_SECRET : doit faire au moins 32 caractères",
    interdits: [SECRET_COURT],
    interditsDansMessage: [String(SECRET_COURT.length)],
  },
  casAuth("BETTER_AUTH_URL en http: sur un hôte distant", `http://${HOTE_AUTH}`, HTTPS, HOTE_AUTH),
  casAuth(
    "BETTER_AUTH_URL en http: sur localhost.exemple.com",
    "http://localhost.exemple.com:3000",
    HTTPS,
    "localhost.exemple.com",
  ),
  casAuth(
    "BETTER_AUTH_URL avec un protocole interdit",
    `ftp://${HOTE_AUTH}`,
    URL_INVALIDE,
    HOTE_AUTH,
  ),
];

describe("T-35, S-54 : le message ne révèle aucune valeur reçue", () => {
  test.each(CAS)("$nom", ({ source, ligne, interdits, interditsDansMessage = [] }) => {
    const message = capturerErreur(source).message;
    expect(message).toContain(ligne);
    for (const valeur of [...interdits, ...interditsDansMessage]) {
      expect(message).not.toContain(valeur);
    }
  });

  test("le secret valide n'apparaît pas quand une autre variable est fautive", () => {
    const message = capturerErreur({ ...sourceValide(), BETTER_AUTH_URL: undefined }).message;
    expect(message).toContain("- BETTER_AUTH_URL : absente");
    expect(message).not.toContain(SECRET_32);
    expect(message).not.toContain(MOT_DE_PASSE);
    expect(message).not.toContain(HOTE_BASE);
  });
});

describe("T-35 : l'erreur est ordinaire et ne transporte aucune valeur", () => {
  test.each(CAS)("$nom", ({ source, ligne, interdits }) => {
    const erreur = capturerErreur(source);

    expect(Object.getPrototypeOf(erreur)).toBe(Error.prototype);
    expect(erreur.name).toBe("Error");
    expect("cause" in erreur).toBe(false);
    expect(erreur.message).toContain(ligne);

    const serialisations = [
      JSON.stringify(erreur),
      String(erreur),
      ...Object.getOwnPropertyNames(erreur).map((cle) =>
        String((erreur as unknown as Record<string, unknown>)[cle]),
      ),
    ];
    for (const texte of serialisations) {
      for (const valeur of interdits) {
        expect(texte).not.toContain(valeur);
      }
    }
  });
});
