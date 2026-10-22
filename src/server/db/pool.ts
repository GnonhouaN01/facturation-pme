import "server-only";

import { Pool, type PoolClient, type PoolConfig } from "pg";

// Pool de pg qui écarte, avant tout envoi, une connexion périmée par une
// suspension du processus. Fiche : docs/features/acces-donnees.md, section 6.
//
// Une fonction Vercel est suspendue entre deux requêtes : aucun minuteur ne
// s'exécute, donc idleTimeoutMillis ne ferme pas les connexions inactives.
// Si le calcul de Neon se met en veille entre-temps (5 min sans activité),
// toutes ses connexions sont coupées. Au réveil, pg-pool remettrait une
// connexion morte, et la requête échouerait. L'heure de remise au Pool est lue
// sur l'horloge murale, qui avance pendant une suspension : une connexion
// inactive depuis plus de deux délais n'a pu survivre au minuteur que si le
// processus était suspendu. Elle est détruite sans avoir servi, et une autre
// est prise. Aucune requête n'est relancée.
//
// Seule l'API publique de pg est employée : connect(), query() et release()
// du client, événements release et error du Pool.

export const REGLAGES_POOL = { max: 10, idleTimeoutMillis: 5_000 } as const;

export type Horloge = () => number;

export type ConfigPool = PoolConfig & { max: number; idleTimeoutMillis: number };

export class ConnexionsPerimees extends Error {
  constructor() {
    super("Aucune connexion valide obtenue du Pool.");
    this.name = "ConnexionsPerimees";
  }
}

// Formes strictes : rien d'autre ne passe au journal (T-39). Le nom du
// constructeur, jamais name ; un SQLSTATE ou un code système (ECONNRESET).
const CLASSE = /^[A-Za-z_$][A-Za-z0-9_$]{0,63}$/;
const CODE = /^(?:[0-9A-Z]{5}|E[A-Z0-9_]{1,31})$/;

function ligneConnexionPerdue(erreur: unknown): string {
  const objet = typeof erreur === "object" && erreur !== null ? erreur : undefined;
  const nom: unknown = (objet as { constructor?: { name?: unknown } } | undefined)?.constructor
    ?.name;
  const code: unknown = (objet as { code?: unknown } | undefined)?.code;
  return JSON.stringify({
    evenement: "connexion-inactive-perdue",
    classe: typeof nom === "string" && CLASSE.test(nom) ? nom : "inconnue",
    ...(typeof code === "string" && CODE.test(code) ? { code } : {}),
  });
}

type RappelConnect = (
  erreur: Error | undefined,
  client: PoolClient | undefined,
  rendre: (erreur?: Error | boolean) => void,
) => void;

type RappelQuery = (erreur: unknown, resultat?: unknown) => void;

class PoolHorodate extends Pool {
  readonly #remises = new WeakMap<PoolClient, number>();
  readonly #horloge: Horloge;
  readonly #seuil: number;
  readonly #essais: number;

  constructor(config: ConfigPool, horloge: Horloge) {
    super(config);
    this.#horloge = horloge;
    this.#seuil = 2 * config.idleTimeoutMillis;
    // Au plus max connexions inactives à écarter, puis une neuve.
    this.#essais = config.max + 1;
    this.on("release", (erreur, client) => {
      if (!erreur) this.#remises.set(client, this.#horloge());
    });
    // Connexion inactive coupée dans un processus actif : pg-pool l'a déjà
    // retirée. Sans écouteur, l'événement error lèverait hors de toute requête.
    this.on("error", (erreur) => {
      try {
        console.error("[base]", ligneConnexionPerdue(erreur));
      } catch {
        // Console défaillante : rien de plus à faire sans risquer de lever.
      }
    });
  }

  async #prendre(): Promise<PoolClient> {
    for (let essai = 0; essai < this.#essais; essai += 1) {
      const client = await super.connect();
      const remise = this.#remises.get(client);
      this.#remises.delete(client);
      // Sans heure de remise : connexion neuve.
      if (remise === undefined || this.#horloge() - remise <= this.#seuil) return client;
      client.release(true);
    }
    throw new ConnexionsPerimees();
  }

  override connect(): Promise<PoolClient>;
  override connect(rappel: RappelConnect): void;
  override connect(rappel?: RappelConnect): Promise<PoolClient> | void {
    const promesse = this.#prendre();
    if (rappel === undefined) return promesse;
    promesse.then(
      (client) => rappel(undefined, client, (erreur) => client.release(erreur)),
      (erreur: Error) => rappel(erreur, undefined, () => undefined),
    );
  }

  // pg-pool fait passer query() par this.connect(), mais ce n'est pas
  // documenté : query() est redéfini sur connect() ci-dessus. Toutes les
  // formes de Pool.query, sauf Submittable (inutilisé).
  override query(...args: unknown[]): never {
    const dernier = args.at(-1);
    const rappel = typeof dernier === "function" ? (args.pop() as RappelQuery) : undefined;
    const promesse = this.#interroger(args);
    if (rappel === undefined) return promesse as never;
    promesse.then(
      (resultat) => rappel(undefined, resultat),
      (erreur: unknown) => rappel(erreur),
    );
    return undefined as never;
  }

  async #interroger(args: unknown[]): Promise<unknown> {
    const client = await this.connect();
    let resultat: unknown;
    try {
      resultat = await Reflect.apply(client.query, client, args);
    } catch (erreur) {
      // Comme pg-pool : la connexion d'une requête en échec est détruite.
      client.release(erreur instanceof Error ? erreur : true);
      throw erreur;
    }
    client.release();
    return resultat;
  }
}

export function creerPool(config: ConfigPool, horloge: Horloge = Date.now): Pool {
  return new PoolHorodate(config, horloge);
}
