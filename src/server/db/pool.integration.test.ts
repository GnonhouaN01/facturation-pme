import { Socket } from "node:net";

import { Pool, type PoolConfig } from "pg";
import { describe, expect, onTestFinished, test } from "vitest";

import { env } from "../env";

import { creerPool } from "./pool";

// Connexion coupée pendant une suspension du processus (fonction Vercel
// suspendue, calcul de Neon mis en veille). Pendant la suspension, ni minuteur
// ni événement réseau ne s'exécute : au réveil, la connexion inactive est
// morte, mais le Pool l'ignore encore. Simulation : le socket est détruit, et
// la requête suivante part dans le même tour de boucle, avant que l'événement
// de fermeture ne soit traité. Fiche : docs/features/acces-donnees.md, section 6.

const SUSPENSION = 6 * 60_000;

// Sockets fournis à pg par l'option publique stream, pour pouvoir les couper.
function config(sockets: Socket[]): PoolConfig & { max: number; idleTimeoutMillis: number } {
  return {
    connectionString: env.DATABASE_URL,
    max: 1,
    idleTimeoutMillis: 5_000,
    stream: () => {
      const socket = new Socket();
      sockets.push(socket);
      return socket;
    },
  };
}

describe("connexion inactive coupée pendant une suspension", () => {
  test("témoin : un Pool nu envoie la requête sur la connexion morte", async () => {
    const sockets: Socket[] = [];
    const pool = new Pool(config(sockets));
    onTestFinished(() => pool.end());
    await pool.query("SELECT 1");

    sockets[0]?.destroy();
    await expect(pool.query("SELECT 2")).rejects.toThrow();
  });

  test("Pool de l'application : connexion écartée avant tout envoi, une autre ouverte", async () => {
    const sockets: Socket[] = [];
    let maintenant = Date.now();
    const pool = creerPool(config(sockets), () => maintenant);
    onTestFinished(() => pool.end());
    await pool.query("SELECT 1");
    expect(sockets).toHaveLength(1);

    maintenant += SUSPENSION;
    sockets[0]?.destroy();
    const resultat = await pool.query<{ n: number }>("SELECT 2 AS n");

    expect(resultat.rows).toEqual([{ n: 2 }]);
    expect(sockets).toHaveLength(2);
  });

  test("sans suspension : la connexion inactive est réutilisée", async () => {
    const sockets: Socket[] = [];
    const pool = creerPool(config(sockets));
    onTestFinished(() => pool.end());
    await pool.query("SELECT 1");
    await pool.query("SELECT 2");

    expect(sockets).toHaveLength(1);
  });
});
