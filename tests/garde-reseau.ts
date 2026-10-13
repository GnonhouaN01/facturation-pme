import { createRequire, syncBuiltinESMExports } from "node:module";

// Garde réseau des tests (Vitest, projets unitaires et integration) : aucune
// connexion vers un port de messagerie, quel que soit l'hôte. Troisième des
// quatre barrières qui empêchent un test d'envoyer un vrai email. Les autres
// connexions passent : PostgreSQL (5432), serveurs locaux des tests. Fiche :
// docs/features/envoi-emails.md, section 2.3.

const require = createRequire(import.meta.url);
const net = require("node:net") as typeof import("node:net");
const tls = require("node:tls") as typeof import("node:tls");

const PORTS_MESSAGERIE = new Set([25, 465, 587, 2525]);

class ConnexionMessagerieRefusee extends Error {
  constructor() {
    super("Garde réseau : connexion vers un port de messagerie refusée pendant les tests.");
    this.name = "ConnexionMessagerieRefusee";
  }
}

// Le port d'un appel connect(options), connect(port, hôte) ou
// connect(chemin) : objet, nombre, ou chaîne numérique.
function portDemande(premier: unknown): number | undefined {
  const brut =
    typeof premier === "object" && premier !== null
      ? (premier as { port?: unknown }).port
      : premier;
  if (typeof brut === "number") return brut;
  if (typeof brut === "string" && /^\d+$/u.test(brut)) return Number(brut);
  return undefined;
}

function verifier(premier: unknown): void {
  const port = portDemande(premier);
  if (port !== undefined && PORTS_MESSAGERIE.has(port)) throw new ConnexionMessagerieRefusee();
}

function garder<F extends (...args: never[]) => unknown>(origine: F): F {
  return function (this: unknown, ...args: Parameters<F>) {
    verifier(args[0]);
    return origine.apply(this, args);
  } as F;
}

net.connect = garder(net.connect);
net.createConnection = garder(net.createConnection);
tls.connect = garder(tls.connect);
// Un socket créé puis connecté (new Socket().connect(465, hôte)).
net.Socket.prototype.connect = garder(net.Socket.prototype.connect);

// Les imports « import * as net from "node:net" » voient les fonctions gardées.
syncBuiltinESMExports();

// Have I Been Pwned (S-10, fonctionnalité 1.1) : aucun test n'appelle le vrai
// service. L'extension de Better Auth prend globalThis.fetch à chaque appel
// (@better-fetch/fetch) : un appel non simulé vers cet hôte lève ici, et
// l'inscription est refusée, jamais acceptée par un appel réel. Un test qui a
// besoin du service le simule par vi.stubGlobal("fetch", ...). Fiche :
// docs/features/inscription.md, section 5.2.
const HOTES_REFUSES = new Set(["api.pwnedpasswords.com"]);

class ServiceExterneRefuse extends Error {
  constructor() {
    super("Garde réseau : appel vers un service externe refusé pendant les tests.");
    this.name = "ServiceExterneRefuse";
  }
}

function hoteDemande(entree: unknown): string | null {
  try {
    if (entree instanceof Request) return new URL(entree.url).hostname;
    if (entree instanceof URL) return entree.hostname;
    if (typeof entree === "string") return new URL(entree).hostname;
  } catch {
    return null;
  }
  return null;
}

const fetchOrigine = globalThis.fetch;
const fetchGarde = Object.assign(
  function (...args: Parameters<typeof fetch>): ReturnType<typeof fetch> {
    const hote = hoteDemande(args[0]);
    if (hote !== null && HOTES_REFUSES.has(hote)) {
      return Promise.reject(new ServiceExterneRefuse());
    }
    return fetchOrigine(...args);
  },
  { gardeReseau: true },
);
globalThis.fetch = fetchGarde as typeof fetch;
