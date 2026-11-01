import "server-only";

import { randomUUID } from "node:crypto";

import { z } from "zod";

import { ROLES } from "../autorisation/matrice";
import { adhesionsPourSession } from "../db/sessions";

// Décision 1 du développeur (2026-10-28) : un membre d'une seule
// organisation l'a pour organisation active dès la création de sa session.
// Rappel databaseHooks.session.create.before de Better Auth, appelé par
// createSession pour toute session (mot de passe, code, code de secours,
// vérification de l'adresse) : un seul point au lieu des quatre points de
// connexion. Une session recréée qui recopie l'organisation de l'ancienne
// (double authentification, 1.4) garde la sienne. La connexion n'échoue
// jamais pour cette raison : une lecture en panne laisse la session sans
// organisation, avec une ligne fixe au journal technique. Fiche :
// docs/features/parametres-organisation.md, section 9.

export type AdhesionLue = { organisationId: string; role: string };

type SessionCreee = { userId: string; activeOrganizationId?: string | null };

const identifiant = z.uuid();

export function creerRappelSessionCreee(
  lire: (utilisateurId: string) => Promise<AdhesionLue[]>,
): (session: SessionCreee) => Promise<{ data: { activeOrganizationId: string } } | undefined> {
  return async (session) => {
    if (session.activeOrganizationId || !session.userId) return undefined;
    let adhesions: AdhesionLue[];
    try {
      adhesions = await lire(session.userId);
    } catch (erreur) {
      // Ni identifiant, ni message de l'erreur (S-54, T-39).
      console.error(
        "[auth]",
        JSON.stringify({
          etape: "organisation_unique",
          classe:
            erreur instanceof Error && /^\w{1,64}$/u.test(erreur.name) ? erreur.name : "inconnue",
          incident: randomUUID(),
        }),
      );
      return undefined;
    }
    const [seule] = adhesions;
    if (adhesions.length !== 1 || seule === undefined) return undefined;
    if (!(ROLES as readonly string[]).includes(seule.role)) return undefined;
    if (!identifiant.safeParse(seule.organisationId).success) return undefined;
    return { data: { activeOrganizationId: seule.organisationId } };
  };
}

export const rappelSessionCreee = creerRappelSessionCreee(adhesionsPourSession);
