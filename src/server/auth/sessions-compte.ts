import "server-only";

import { isIP } from "node:net";

import { decrireAppareil } from "@/lib/appareil";
import { formaterDateHeure } from "@/lib/format/dates";

import { lireProfil, type Profil } from "../db/profil";
import { sessionsDe } from "../db/sessions";

// Ce que les pages /compte/sessions et /compte/profil affichent (1.5), pour
// l'utilisateur de la session seulement, que lireComptePourPage fournit. Une
// session ne quitte le serveur que par son identifiant (qui ne permet aucune
// connexion), l'appareil décrit en liste fermée (jamais le texte déclaré par
// le navigateur), une adresse IP valide ou rien, et les dates déjà mises en
// forme. Fiche : docs/features/profil-sessions.md, sections 3.1, 3.4 et 9.

export type SessionAffichee = {
  id: string;
  courante: boolean;
  appareil: string;
  adresseIp: string | null;
  ouverteLe: string;
  expireLe: string;
};

export async function lireSessionsCompte(compte: {
  utilisateurId: string;
  sessionId: string;
}): Promise<SessionAffichee[]> {
  const lues = await sessionsDe(compte.utilisateurId);
  const affichees = lues.map((lue) => ({
    id: lue.id,
    courante: lue.id === compte.sessionId,
    appareil: decrireAppareil(lue.navigateur),
    adresseIp: lue.adresseIp !== null && isIP(lue.adresseIp) !== 0 ? lue.adresseIp : null,
    ouverteLe: formaterDateHeure(lue.ouverteLe),
    expireLe: formaterDateHeure(lue.expireLe),
  }));
  // La session courante d'abord ; les autres gardent l'ordre de la requête
  // (la plus récente d'abord).
  return [...affichees.filter((s) => s.courante), ...affichees.filter((s) => !s.courante)];
}

export type { Profil };

export async function lireProfilCompte(compte: { utilisateurId: string }): Promise<Profil> {
  const profil = await lireProfil(compte.utilisateurId);
  // Compte supprimé entre la lecture de la session et celle du profil.
  if (profil === null) throw new Error("profil introuvable");
  return profil;
}
