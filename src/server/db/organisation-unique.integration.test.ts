import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, test } from "vitest";

import { auth } from "../auth/config";

import { db } from "./client";
import { creerMembre, nettoyerMembres, type Membre } from "./outils-test/membres";
import { creerDeuxOrganisations, type Organisations } from "./outils-test/organisations";
import { member, session } from "./schema/auth";

// Décision 1 du développeur (2026-10-28) avec la vraie base : toute session
// créée par Better Auth (instance de l'application, rappel
// session.create.before) reçoit l'organisation de l'utilisateur s'il n'en a
// qu'une ; RR-8 : l'adhésion lue est celle de l'utilisateur de la session.
// Fiche : docs/features/parametres-organisation.md, section 9, test 13.

let orgs: Organisations;
let unique: Membre;
let double: Membre;
let sans: Membre;

beforeAll(async () => {
  orgs = await creerDeuxOrganisations({ tables: [] });
  [unique, double, sans] = await Promise.all([
    creerMembre({ organisationId: orgs.a, role: "comptable" }),
    creerMembre({ organisationId: orgs.a, role: "lecteur" }),
    creerMembre({ organisationId: orgs.b, role: "lecteur" }),
  ]);
  await db.insert(member).values({
    organizationId: orgs.b,
    userId: double.utilisateurId,
    role: "commercial",
    createdAt: new Date(),
  });
  await db
    .delete(member)
    .where(and(eq(member.userId, sans.utilisateurId), eq(member.organizationId, orgs.b)));
});

afterAll(async () => {
  try {
    await orgs?.nettoyer();
  } finally {
    await nettoyerMembres();
  }
});

async function nouvelleSession(membre: Membre): Promise<string | null> {
  const contexte = await auth.$context;
  const creee = await contexte.internalAdapter.createSession(membre.utilisateurId);
  const [ligne] = await db
    .select({ active: session.activeOrganizationId })
    .from(session)
    .where(eq(session.token, creee.token));
  return ligne?.active ?? null;
}

describe("organisation unique active à la création de la session", () => {
  test("une seule adhésion : l'organisation devient active", async () => {
    expect(await nouvelleSession(unique)).toBe(orgs.a);
  });

  test("deux adhésions : aucune organisation active", async () => {
    expect(await nouvelleSession(double)).toBeNull();
  });

  test("aucune adhésion (B retirée) : aucune, jamais celle d'un autre membre de B", async () => {
    expect(await nouvelleSession(sans)).toBeNull();
  });
});
