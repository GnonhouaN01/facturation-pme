import { randomInt } from "node:crypto";

import { expect, type TestInfo } from "@playwright/test";

import { messagesPour } from "./boite-emails";
import { adresseE2E } from "./comptes-e2e";

// Comptes de bout en bout de la connexion (1.2), créés par le parcours réel
// de la 1.1 : inscription par /api/auth/sign-up/email, lecture de l'email
// dans le dossier du transport fichier, vérification par
// /api/auth/verify-email, qui ouvre une session. Aucun accès à la base.
// Adresses de l'exécution (e2e/comptes-e2e.ts), rangs 8 à 15 réservés à la
// 1.2. Fiche : docs/features/connexion.md, section 8.1.

export const ADRESSE = "http://localhost:3000";
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

// Mot de passe oublié (1.3) : rangs 18 à 23 des adresses de l'exécution,
// lien de réinitialisation lu dans le dossier du transport fichier. Fiche :
// docs/features/mot-de-passe.md, « Tests de bout en bout ».
export const RANGS_MOT_DE_PASSE = {
  parcours: 18,
  verifieT07: 19,
  nonVerifieT07: 20,
  reutilise: 21,
  redirection: 22,
  limite: 23,
} as const;

export function adresseMotDePasse(info: TestInfo, rang: keyof typeof RANGS_MOT_DE_PASSE): string {
  return adresseE2E(info.project.name, RANGS_MOT_DE_PASSE[rang], info.retry, info.repeatEachIndex);
}

const LIEN_REINITIALISATION = /\/lien\/reinitialisation#([A-Za-z0-9]{24})$/m;

// Les emails de réinitialisation reçus par une adresse, dans l'ordre.
export async function liensReinitialisation(adresse: string): Promise<string[]> {
  return (await messagesPour(adresse))
    .map((message) => LIEN_REINITIALISATION.exec(message.corps)?.[0])
    .filter((lien): lien is string => lien !== undefined);
}

// Attend le n-ième lien de réinitialisation d'une adresse et le rend
// (chemin et fragment, à ouvrir sur le site).
export async function attendreLienReinitialisation(adresse: string, rang = 1): Promise<string> {
  await expect
    .poll(async () => (await liensReinitialisation(adresse)).length, { timeout: 15_000 })
    .toBeGreaterThanOrEqual(rang);
  const lien = (await liensReinitialisation(adresse))[rang - 1];
  if (!lien) throw new Error("lien de réinitialisation introuvable dans l'email");
  return lien;
}

// Sujets des emails reçus par une adresse.
export async function sujetsPour(adresse: string): Promise<string[]> {
  return (await messagesPour(adresse)).map((message) => message.sujet);
}

// Demande de réinitialisation par le point d'entrée, hors navigateur.
export function demanderReinitialisation(
  email: string,
  entetes: Record<string, string> = {},
): Promise<Response> {
  return poster("/request-password-reset", { email }, entetes);
}

// Double authentification (1.4) : rangs 24 à 30 des adresses de
// l'exécution. PR 2 : le rang 25, qui n'avait pas servi, porte le passage
// complet relu dans le journal ; le rang 30, le Propriétaire de la zone
// application. Fiche : docs/features/double-authentification.md, tests 26,
// 27, 31 et 32.
export const RANGS_DOUBLE_AUTH = {
  parcours: 24,
  journal: 25,
  essais: 26,
  rejeu: 27,
  affichage: 28,
  ferme: 29,
  proprietaire: 30,
} as const;

export function adresseDoubleAuth(info: TestInfo, rang: keyof typeof RANGS_DOUBLE_AUTH): string {
  return adresseE2E(info.project.name, RANGS_DOUBLE_AUTH[rang], info.retry, info.repeatEachIndex);
}

// Profil et sessions (1.5) : rangs 31 à 34 des adresses de l'exécution.
// Fiche : docs/features/profil-sessions.md, tests 15 et 16.
export const RANGS_PROFIL = {
  parcours: 31,
  ferme: 32,
  journal: 33,
  affichage: 34,
} as const;

export function adresseProfil(info: TestInfo, rang: keyof typeof RANGS_PROFIL): string {
  return adresseE2E(info.project.name, RANGS_PROFIL[rang], info.retry, info.repeatEachIndex);
}
