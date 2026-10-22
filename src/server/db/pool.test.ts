import { Pool, type PoolClient } from "pg";
import { afterEach, describe, expect, test, vi, type Mock } from "vitest";

import { ConnexionsPerimees, creerPool, REGLAGES_POOL } from "./pool";

// Test sans base : la base n'est jamais jointe, Pool.prototype.connect est
// remplacé par des connexions factices. Fiche : docs/features/acces-donnees.md,
// section 6.

type ClientFactice = PoolClient & { release: Mock; query: Mock };

const CONFIG = {
  connectionString: "postgresql://app_facturation:factice@127.0.0.1:1/factice",
  max: 3,
  idleTimeoutMillis: 5_000,
};

function clientFactice(): ClientFactice {
  return { release: vi.fn(), query: vi.fn() } as unknown as ClientFactice;
}

// Horloge murale simulée, et connexions renvoyées par Pool dans l'ordre.
function banc(...clients: ClientFactice[]) {
  const horloge = { t: 1_000_000 };
  const pool = creerPool(CONFIG, () => horloge.t);
  const connect = vi.spyOn(Pool.prototype, "connect");
  for (const client of clients) connect.mockResolvedValueOnce(client as never);
  // Remise au Pool, telle que pg-pool l'annonce (événement release).
  const rendre = (client: ClientFactice) => pool.emit("release", undefined, client);
  return { pool, connect, horloge, rendre };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("réglages du Pool principal", () => {
  test("max 10, connexion inactive fermée au bout de 5 s", () => {
    expect(REGLAGES_POOL).toEqual({ max: 10, idleTimeoutMillis: 5_000 });
  });
});

describe("connexion périmée à la remise (suspension du processus)", () => {
  test("inactive depuis plus de deux délais : détruite, une autre est prise", async () => {
    const ancienne = clientFactice();
    const neuve = clientFactice();
    const { pool, connect, horloge, rendre } = banc(ancienne, neuve);
    rendre(ancienne);
    horloge.t += 2 * CONFIG.idleTimeoutMillis + 1;

    await expect(pool.connect()).resolves.toBe(neuve);
    expect(ancienne.release).toHaveBeenCalledExactlyOnceWith(true);
    expect(neuve.release).not.toHaveBeenCalled();
    expect(connect).toHaveBeenCalledTimes(2);
  });

  test("inactive depuis deux délais au plus : gardée", async () => {
    const recente = clientFactice();
    const { pool, horloge, rendre } = banc(recente);
    rendre(recente);
    horloge.t += 2 * CONFIG.idleTimeoutMillis;

    await expect(pool.connect()).resolves.toBe(recente);
    expect(recente.release).not.toHaveBeenCalled();
  });

  test("toutes les connexions inactives périmées : une nouvelle est ouverte", async () => {
    const inactives = [clientFactice(), clientFactice(), clientFactice()];
    const neuve = clientFactice();
    const { pool, connect, horloge, rendre } = banc(...inactives, neuve);
    for (const client of inactives) rendre(client);
    horloge.t += 6 * 60_000;

    await expect(pool.connect()).resolves.toBe(neuve);
    for (const client of inactives) expect(client.release).toHaveBeenCalledExactlyOnceWith(true);
    expect(connect).toHaveBeenCalledTimes(4);
  });

  test("borné : jamais plus de max + 1 essais, même si Pool ne rend que des périmées", async () => {
    const { pool, connect, horloge, rendre } = banc();
    connect.mockImplementation((() => {
      // Cas impossible avec pg-pool (une connexion neuve n'a pas d'heure de
      // remise) : il prouve que la boucle s'arrête quoi qu'il arrive.
      const client = clientFactice();
      horloge.t -= 60_000;
      rendre(client);
      horloge.t += 60_000;
      return Promise.resolve(client);
    }) as never);

    await expect(pool.connect()).rejects.toBeInstanceOf(ConnexionsPerimees);
    expect(connect).toHaveBeenCalledTimes(CONFIG.max + 1);
  });

  test("forme à rappel de connect : même contrôle", async () => {
    const ancienne = clientFactice();
    const neuve = clientFactice();
    const { pool, horloge, rendre } = banc(ancienne, neuve);
    rendre(ancienne);
    horloge.t += 60_000;

    const recu = await new Promise((resoudre, rejeter) =>
      pool.connect((erreur, client) => (erreur ? rejeter(erreur) : resoudre(client))),
    );
    expect(recu).toBe(neuve);
  });
});

describe("pool.query passe par le même contrôle", () => {
  test("requête sur la connexion prise par connect, rendue ensuite", async () => {
    const ancienne = clientFactice();
    const neuve = clientFactice();
    neuve.query.mockResolvedValue({ rows: [{ n: 1 }] });
    const { pool, horloge, rendre } = banc(ancienne, neuve);
    rendre(ancienne);
    horloge.t += 60_000;

    await expect(pool.query("SELECT 1 AS n")).resolves.toEqual({ rows: [{ n: 1 }] });
    expect(ancienne.query).not.toHaveBeenCalled();
    expect(ancienne.release).toHaveBeenCalledExactlyOnceWith(true);
    expect(neuve.query).toHaveBeenCalledExactlyOnceWith("SELECT 1 AS n");
    expect(neuve.release).toHaveBeenCalledExactlyOnceWith();
  });

  test("requête en échec : connexion détruite, erreur remontée telle quelle", async () => {
    const client = clientFactice();
    const erreur = new Error("refus");
    client.query.mockRejectedValue(erreur);
    const { pool } = banc(client);

    await expect(pool.query("SELECT 1")).rejects.toBe(erreur);
    expect(client.release).toHaveBeenCalledExactlyOnceWith(erreur);
  });

  test("forme à rappel de query", async () => {
    const client = clientFactice();
    client.query.mockResolvedValue({ rows: [] });
    const { pool } = banc(client);

    const recu = await new Promise((resoudre, rejeter) =>
      pool.query("SELECT 1", (erreur, resultat) => (erreur ? rejeter(erreur) : resoudre(resultat))),
    );
    expect(recu).toEqual({ rows: [] });
    expect(client.release).toHaveBeenCalledExactlyOnceWith();
  });
});

describe("connexion inactive perdue (événement error du Pool)", () => {
  test("une ligne fixe au journal : classe et code, jamais le message (T-39)", () => {
    const journal = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { pool } = banc();
    const erreur = Object.assign(
      new Error("SELECT * FROM session WHERE token = 'jeton-secret' -- params: jeton-secret"),
      { code: "ECONNRESET", detail: "jeton-secret" },
    );

    expect(() => pool.emit("error", erreur, clientFactice())).not.toThrow();
    expect(journal).toHaveBeenCalledExactlyOnceWith(
      "[base]",
      JSON.stringify({
        evenement: "connexion-inactive-perdue",
        classe: "Error",
        code: "ECONNRESET",
      }),
    );
  });

  test("code hors forme et name forgé : écartés", () => {
    const journal = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { pool } = banc();
    const erreur = Object.assign(new Error("x"), {
      name: "SELECT jeton-secret",
      code: "SELECT 'jeton-secret'",
    });

    pool.emit("error", erreur, clientFactice());
    expect(journal).toHaveBeenCalledExactlyOnceWith(
      "[base]",
      JSON.stringify({ evenement: "connexion-inactive-perdue", classe: "Error" }),
    );
  });

  test("SQLSTATE retenu", () => {
    const journal = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { pool } = banc();
    pool.emit("error", Object.assign(new Error("x"), { code: "57P01" }), clientFactice());
    expect(journal).toHaveBeenCalledExactlyOnceWith(
      "[base]",
      JSON.stringify({ evenement: "connexion-inactive-perdue", classe: "Error", code: "57P01" }),
    );
  });
});
