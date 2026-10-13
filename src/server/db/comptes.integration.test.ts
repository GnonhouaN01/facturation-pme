import { randomUUID } from "node:crypto";

import { eq, inArray } from "drizzle-orm";
import { afterAll, describe, expect, test } from "vitest";

import { db } from "./client";
import { purgerComptesNonVerifies } from "./comptes";
import { account, session, user } from "./schema/auth";

// Purge des comptes non vérifiés de plus de 7 jours (THREATS.md 7.2) : leurs
// comptes et sessions suivent par ON DELETE CASCADE ; un compte vérifié, ou
// récent, reste. Fiche : docs/features/inscription.md, section 4.6.

const crees: string[] = [];

afterAll(async () => {
  if (crees.length > 0) await db.delete(user).where(inArray(user.id, crees));
});

const JOUR = 24 * 60 * 60 * 1000;

async function creer(options: { verifie: boolean; ageJours: number }): Promise<string> {
  const id = randomUUID();
  crees.push(id);
  const date = new Date(Date.now() - options.ageJours * JOUR);
  await db.insert(user).values({
    id,
    name: "Compte de test",
    email: `test-${id}@exemple.test`,
    emailVerified: options.verifie,
    createdAt: date,
    updatedAt: date,
  });
  await db.insert(account).values({
    id: randomUUID(),
    accountId: id,
    providerId: "credential",
    userId: id,
    createdAt: date,
    updatedAt: date,
  });
  await db.insert(session).values({
    id: randomUUID(),
    token: randomUUID(),
    userId: id,
    expiresAt: new Date(Date.now() + JOUR),
    createdAt: date,
    updatedAt: date,
  });
  return id;
}

async function existe(id: string): Promise<boolean> {
  return (await db.select().from(user).where(eq(user.id, id))).length === 1;
}

describe("purgerComptesNonVerifies", () => {
  test("supprime un non vérifié de 8 jours, avec ses comptes et sessions ; garde les autres", async () => {
    const ancien = await creer({ verifie: false, ageJours: 8 });
    const recent = await creer({ verifie: false, ageJours: 6 });
    const verifie = await creer({ verifie: true, ageJours: 8 });

    const supprimes = await purgerComptesNonVerifies();

    expect(supprimes).toBeGreaterThanOrEqual(1);
    expect(await existe(ancien)).toBe(false);
    expect(await db.select().from(account).where(eq(account.userId, ancien))).toEqual([]);
    expect(await db.select().from(session).where(eq(session.userId, ancien))).toEqual([]);
    expect(await existe(recent)).toBe(true);
    expect(await existe(verifie)).toBe(true);
  });
});
