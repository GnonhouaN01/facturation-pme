import { randomInt } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { expect, type TestInfo } from "@playwright/test";

import { adresseE2E } from "./comptes-e2e";

// Comptes de bout en bout de la connexion (1.2), créés par le parcours réel
// de la 1.1 : inscription par /api/auth/sign-up/email, lecture de l'email
// dans le dossier du transport fichier, vérification par
// /api/auth/verify-email, qui ouvre une session. Aucun accès à la base.
// Adresses de l'exécution (e2e/comptes-e2e.ts), rangs 8 à 15 réservés à la
// 1.2. Fiche : docs/features/connexion.md, section 8.1.

export const ADRESSE = "http://localhost:3000";
// Même dossier que playwright.config.ts (EMAILS_E2E).
const DOSSIER_EMAILS = join(tmpdir(), "facturation-pme-e2e-emails");
export const MOT_DE_PASSE = "Phrase de passe solide 2026";
export const NOM_COOKIE = "better-auth.session_token";

export const RANGS_CONNEXION = {
  parcours: 8,
  verifieT07: 9,
  nonVerifieT07: 10,
  rejeu: 11,
  gabarit: 12,
  session: 13,
  deconnexion: 14,
  // Correctif de la 1.2 (le rang 15, « limite », n'avait pas servi).
  redirection: 15,
  reconnexion: 16,
  redirectionServeur: 17,
} as const;

export function adresseConnexion(info: TestInfo, rang: keyof typeof RANGS_CONNEXION): string {
  return adresseE2E(info.project.name, RANGS_CONNEXION[rang], info.retry, info.repeatEachIndex);
}

// Adresse IP propre à une requête (10.0.0.0/8) : en local, l'en-tête est cru,
// et aucune limite par adresse IP n'est partagée entre deux tests.
export function ipAuHasard(): string {
  return `10.${randomInt(256)}.${randomInt(256)}.${randomInt(1, 255)}`;
}

type Message = { a: string; sujet: string; corps: string };

async function messagesPour(adresse: string): Promise<Message[]> {
  let noms: string[];
  try {
    noms = (await readdir(DOSSIER_EMAILS)).filter((nom) => nom.endsWith(".json")).sort();
  } catch {
    return [];
  }
  const messages = await Promise.all(
    noms.map(
      async (nom) => JSON.parse(await readFile(join(DOSSIER_EMAILS, nom), "utf8")) as Message,
    ),
  );
  return messages.filter((message) => message.a === adresse);
}

function poster(chemin: string, corps: unknown, entetes: Record<string, string> = {}) {
  return fetch(`${ADRESSE}/api/auth${chemin}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: ADRESSE,
      "x-forwarded-for": ipAuHasard(),
      ...entetes,
    },
    body: JSON.stringify(corps),
    redirect: "manual",
  });
}

// Inscription seule : le compte reste non vérifié.
export async function inscrire(email: string, motDePasse = MOT_DE_PASSE): Promise<void> {
  const reponse = await poster("/sign-up/email", { nom: "Awa Koné", email, motDePasse });
  expect(reponse.status, "inscription").toBe(200);
}

// Valeur du cookie de session posé par une réponse, ou undefined.
export function valeurCookieSession(reponse: Response): string | undefined {
  const brut = reponse.headers.getSetCookie().find((c) => c.startsWith(`${NOM_COOKIE}=`));
  const valeur = brut?.split(";")[0]?.slice(NOM_COOKIE.length + 1);
  return valeur ? valeur : undefined;
}

// Inscription puis vérification par le lien reçu : compte vérifié, et la
// valeur du cookie de la session ouverte par la vérification.
export async function creerCompteVerifie(
  email: string,
  motDePasse = MOT_DE_PASSE,
): Promise<string> {
  await inscrire(email, motDePasse);
  await expect
    .poll(async () => (await messagesPour(email)).length, { timeout: 15_000 })
    .toBeGreaterThanOrEqual(1);
  const [message] = await messagesPour(email);
  const jeton = /\/lien\/verification#(\S+)$/m.exec(message?.corps ?? "")?.[1];
  if (!jeton) throw new Error("lien de vérification introuvable dans l'email");
  const reponse = await poster("/verify-email", { jeton });
  expect(reponse.status, "vérification").toBe(200);
  const valeur = valeurCookieSession(reponse);
  if (!valeur) throw new Error("aucun cookie de session après la vérification");
  return valeur;
}

// Connexion par le point d'entrée, hors navigateur : la réponse brute.
export function connecter(
  email: string,
  motDePasse = MOT_DE_PASSE,
  entetes: Record<string, string> = {},
): Promise<Response> {
  return poster("/sign-in/email", { email, motDePasse }, entetes);
}
