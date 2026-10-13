import { randomBytes } from "node:crypto";

import { inArray, like } from "drizzle-orm";
import { afterAll, describe, expect, test } from "vitest";

import { creerStockageBetterAuth } from "../debit/better-auth";
import { LIMITES } from "../debit/limites";

import { db } from "./client";
import { creerCompteur, type Compteur } from "./debit";
import { compteurDebit } from "./schema/technique";

// Le stockage de la limitation de Better Auth sur le vrai compteur : la
// sixième inscription d'une même adresse IP est refusée, et aucune adresse
// IP n'est écrite en clair. Secret aléatoire : clés propres à ce fichier,
// supprimées à la fin. Fiche : docs/features/inscription.md, section 3.

const cles = new Set<string>();
const reel = creerCompteur(db);
const compteur: Compteur = {
  consommer: (cle, regle) => {
    cles.add(cle);
    return reel.consommer(cle, regle);
  },
  purger: reel.purger,
};

afterAll(async () => {
  if (cles.size > 0) await db.delete(compteurDebit).where(inArray(compteurDebit.cle, [...cles]));
});

const REGLE = {
  window: LIMITES["auth.inscription"].fenetreSecondes,
  max: LIMITES["auth.inscription"].maximum,
};

describe("stockage de Better Auth sur compteur_debit", () => {
  test("auth.inscription : cinq permises, la sixième refusée ; une autre adresse reste permise", async () => {
    const stockage = creerStockageBetterAuth({
      limites: LIMITES,
      compteur,
      secret: randomBytes(32),
    });
    const permis: boolean[] = [];
    for (let i = 0; i < 6; i++) {
      permis.push((await stockage.consume("203.0.113.77|/sign-up/email", REGLE)).allowed);
    }
    expect(permis).toEqual([true, true, true, true, true, false]);
    expect((await stockage.consume("203.0.113.78|/sign-up/email", REGLE)).allowed).toBe(true);
  });

  test("les lignes écrites ne contiennent pas l'adresse IP en clair", async () => {
    const stockage = creerStockageBetterAuth({
      limites: LIMITES,
      compteur,
      secret: randomBytes(32),
    });
    await stockage.consume("203.0.113.79|/sign-up/email", REGLE);

    expect([...cles].every((cle) => cle.startsWith("auth.inscription:"))).toBe(true);
    const avecAdresse = await db
      .select()
      .from(compteurDebit)
      .where(like(compteurDebit.cle, "%203.0.113%"));
    expect(avecAdresse).toEqual([]);
  });
});
