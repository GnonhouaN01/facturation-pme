import "server-only";

import { randomUUID } from "node:crypto";

import { betterAuth } from "better-auth";
import { testUtils } from "better-auth/plugins";
import { eq, inArray } from "drizzle-orm";

import { optionsAuth } from "../../auth/config";
import { env } from "../../env";
import { db } from "../client";
import { member, session, user } from "../schema/auth";

// Outillage des tests avec base : membres et sessions réelles, par l'instance
// Better Auth de test (optionsAuth + testUtils). Ne s'importe que depuis un
// fichier de test. Fiche : docs/features/chaine-controles.md, section 10.

// Mêmes options que la production (secret, adresse, noms de cookies) : une
// session créée ici est lue par l'instance de production, par le vrai
// getSession. testUtils n'existe que dans cette instance.
const authTest = betterAuth({
  ...optionsAuth,
  plugins: [...optionsAuth.plugins, testUtils()],
});

const ORIGINE = new URL(env.BETTER_AUTH_URL).origin;

export type Membre = {
  utilisateurId: string;
  membreId: string;
  // Cookie de session signé et Origin valide.
  entetes: Headers;
};

export type OptionsMembre = {
  organisationId: string;
  // N'importe quelle chaîne : owner, comptable,proprietaire, vide...
  role: string;
  // Par défaut organisationId ; null possible.
  organisationActive?: string | null;
};

// Utilisateurs créés par ce fichier de test (un module par fichier sous
// Vitest), supprimés par nettoyerMembres.
const crees: string[] = [];

export async function creerMembre(options: OptionsMembre): Promise<Membre> {
  const utilisateurId = randomUUID();
  // Enregistré avant toute écriture : un échec en cours de route est nettoyé.
  crees.push(utilisateurId);
  await db.insert(user).values({
    id: utilisateurId,
    name: "Membre de test",
    email: `test-${utilisateurId}@exemple.test`,
  });

  const [adhesion] = await db
    .insert(member)
    .values({
      organizationId: options.organisationId,
      userId: utilisateurId,
      role: options.role,
      createdAt: new Date(),
    })
    .returning({ id: member.id });
  if (!adhesion) throw new Error("adhésion de test non créée");

  const contexte = await authTest.$context;
  const connexion = await contexte.test.login({ userId: utilisateurId });

  // L'organisation active est écrite en base, comme le ferait set-active, sans
  // dépendre de ce que l'outil de Better Auth accepte à la création.
  const organisationActive =
    options.organisationActive === undefined ? options.organisationId : options.organisationActive;
  await db
    .update(session)
    .set({ activeOrganizationId: organisationActive })
    .where(eq(session.token, connexion.token));

  const entetes = new Headers(connexion.headers);
  entetes.set("origin", ORIGINE);
  return { utilisateurId, membreId: adhesion.id, entetes };
}

// Supprime les utilisateurs créés par ce fichier de test : sessions et
// adhésions suivent par ON DELETE CASCADE. Appelable deux fois.
export async function nettoyerMembres(): Promise<void> {
  const ids = crees.splice(0);
  if (ids.length > 0) await db.delete(user).where(inArray(user.id, ids));
}
