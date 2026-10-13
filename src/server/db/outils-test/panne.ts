import "server-only";

import { createHmac, randomBytes } from "node:crypto";

import { drizzleAdapter } from "@better-auth/drizzle-adapter/relations-v2";
import { Pool } from "pg";

import { creerAcces, type BaseDeDonnees } from "../client";
import * as schema from "../schema/auth";

// Outillage des tests sans base réelle : une base injoignable, pour
// provoquer une panne pendant une lecture de Better Auth, et un cookie de
// session signé (sans signature valide, Better Auth ne lirait pas la base).
// Ne s'importe que depuis un fichier de test. Fiche :
// docs/features/inscription.md, section 1.3.
//
// TOUTES LES VALEURS DE CE FICHIER SONT FACTICES : port fermé sur
// 127.0.0.1 (aucun service n'écoute sur le port 1), base et mot de passe
// nommés « injoignable » et « factice ».

const ADRESSE_BASE_PANNE =
  "postgresql://app_facturation:mot-de-passe-factice@127.0.0.1:1/base_injoignable";

export type BasePanne = {
  db: BaseDeDonnees;
  fermer: () => Promise<void>;
};

// Une connexion au plus, abandonnée au bout de 2 s si le système ne refuse
// pas tout de suite.
export function basePanne(): BasePanne {
  const pool = new Pool({
    connectionString: ADRESSE_BASE_PANNE,
    max: 1,
    connectionTimeoutMillis: 2_000,
  });
  return { db: creerAcces(pool).db, fermer: () => pool.end() };
}

// L'adaptateur de Better Auth sur une base donnée, avec le schéma généré.
export function adaptateurSur(base: BaseDeDonnees) {
  return drizzleAdapter(base, { provider: "pg", schema });
}

// Cookie de session au jeton aléatoire, signé avec le secret donné
// (HMAC-SHA256, base64, format de better-call), comme e2e/serveur-panne.ts.
// Ce n'est pas une session : aucune ligne n'existe.
export function cookieSessionSigne(secret: string): { jeton: string; valeur: string } {
  const jeton = randomBytes(24).toString("base64url");
  const signature = createHmac("sha256", secret).update(jeton).digest("base64");
  return { jeton, valeur: encodeURIComponent(`${jeton}.${signature}`) };
}
