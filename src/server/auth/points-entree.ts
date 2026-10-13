import "server-only";

import type { z } from "zod";

import {
  LONGUEUR_MIN_MOT_DE_PASSE,
  schemaInscription,
  schemaRenvoiVerification,
  schemaVerification,
} from "@/schemas/compte";

import { verifierOrigine } from "../actions/origine";
import { schemaAdresse } from "../email/adresse";

import { consignerAuth } from "./journal";

// Le gestionnaire de /api/auth : une liste fermée de points d'entrée ouverts
// (T-55). Tout autre chemin, toute autre méthode, et les points ouverts en
// production tant que l'inscription y est fermée, reçoivent la même réponse
// qu'une adresse inexistante, sans que Better Auth soit appelé. Un point
// ouvert passe par : origine (S-81), taille et type du corps, schéma strict,
// appel à Better Auth avec les seuls champs validés, réponse traduite en une
// liste fermée (jamais le corps ni le message de Better Auth), durée
// plancher (T-07). Fiche : docs/features/inscription.md, section 2.

// Décision 1 : inscription fermée en production jusqu'à la 1.3. Une
// constante du code, jamais une variable d'environnement ; la PR de la 1.3 la
// retire.
export const INSCRIPTION_OUVERTE_EN_PRODUCTION = false;

export const DUREE_PLANCHER_MS = 800;
export const TAILLE_MAX_CORPS = 4096;

const BASE = "/api/auth";

export type Horloge = {
  maintenant: () => number;
  attendre: (ms: number) => Promise<void>;
};

const HORLOGE_REELLE: Horloge = {
  maintenant: () => performance.now(),
  attendre: (ms) => new Promise((resoudre) => setTimeout(resoudre, ms)),
};

export type DependancesPointsEntree = {
  // auth.handler de Better Auth.
  traiter: (requete: Request) => Promise<Response>;
  // BETTER_AUTH_URL : l'origine acceptée, et celle des appels internes.
  origine: string;
  estProduction: boolean;
  horloge?: Horloge;
};

type Raison =
  | "mot_de_passe_trop_court"
  | "mot_de_passe_compromis"
  | "invalide"
  | "trop_de_requetes"
  | "lien_invalide"
  | "refuse"
  | "erreur";

const STATUTS: Readonly<Record<Raison, number>> = {
  mot_de_passe_trop_court: 400,
  mot_de_passe_compromis: 400,
  invalide: 400,
  lien_invalide: 400,
  trop_de_requetes: 429,
  refuse: 403,
  erreur: 500,
};

// Ce que Better Auth a répondu, réduit à ce dont la traduction a besoin.
type ReponseLue = { statut: number; code: string | null; cookies: string[] };

type PointEntree = {
  methode: "POST";
  schema: z.ZodType;
  // Durée plancher : l'inscription et le renvoi diraient sinon, par leur
  // durée, si l'adresse a un compte.
  plancher: boolean;
  // La requête passée à Better Auth, construite en mémoire depuis les seules
  // données validées. null : données refusées après le schéma.
  versBetterAuth: (
    donnees: Record<string, unknown>,
    entetes: Headers,
    origine: string,
  ) => Request | Raison;
  traduire: (lue: ReponseLue) => { raison: Raison } | { ok: true; cookies: string[] };
};

// En-têtes repris de la requête reçue : l'adresse IP (limite de Better Auth,
// session) et le navigateur (session). Jamais le cookie : le renvoi sans
// session répond pareil pour toute adresse.
function entetesInternes(recus: Headers, json: boolean, origine: string): Headers {
  const entetes = new Headers();
  for (const nom of ["x-forwarded-for", "user-agent"]) {
    const valeur = recus.get(nom);
    if (valeur !== null) entetes.set(nom, valeur);
  }
  if (json) {
    entetes.set("content-type", "application/json");
    entetes.set("origin", origine);
  }
  return entetes;
}

function adresseValide(valeur: unknown): string | null {
  const lue = schemaAdresse.safeParse(valeur);
  return lue.success ? lue.data : null;
}

function traductionCommune(lue: ReponseLue): { raison: Raison } | null {
  if (lue.statut === 429) return { raison: "trop_de_requetes" };
  if (lue.statut >= 500 || lue.statut < 200) return { raison: "erreur" };
  return null;
}

export const POINTS_ENTREE_OUVERTS: Readonly<Record<string, PointEntree>> = Object.freeze({
  // UC-01, étapes 1 à 3.
  "/sign-up/email": {
    methode: "POST",
    schema: schemaInscription,
    plancher: true,
    versBetterAuth: (donnees, entetes, origine) => {
      const email = adresseValide(donnees.email);
      if (email === null) return "invalide";
      const motDePasse = String(donnees.motDePasse);
      if (motDePasse.length < LONGUEUR_MIN_MOT_DE_PASSE) return "mot_de_passe_trop_court";
      return new Request(`${origine}${BASE}/sign-up/email`, {
        method: "POST",
        headers: entetesInternes(entetes, true, origine),
        body: JSON.stringify({ name: String(donnees.nom).trim(), email, password: motDePasse }),
      });
    },
    traduire: (lue) => {
      const commune = traductionCommune(lue);
      if (commune) return commune;
      if (lue.statut >= 200 && lue.statut < 300) return { ok: true, cookies: [] };
      if (lue.code === "PASSWORD_TOO_SHORT") return { raison: "mot_de_passe_trop_court" };
      if (lue.code === "PASSWORD_COMPROMISED") return { raison: "mot_de_passe_compromis" };
      return { raison: "invalide" };
    },
  },
  // UC-01, erreur 4a : renvoyer le lien.
  "/send-verification-email": {
    methode: "POST",
    schema: schemaRenvoiVerification,
    plancher: true,
    versBetterAuth: (donnees, entetes, origine) => {
      const email = adresseValide(donnees.email);
      if (email === null) return "invalide";
      return new Request(`${origine}${BASE}/send-verification-email`, {
        method: "POST",
        headers: entetesInternes(entetes, true, origine),
        body: JSON.stringify({ email }),
      });
    },
    traduire: (lue) => {
      const commune = traductionCommune(lue);
      if (commune) return commune;
      if (lue.statut >= 200 && lue.statut < 300) return { ok: true, cookies: [] };
      return { raison: "invalide" };
    },
  },
  // UC-01, étapes 4 et 5. Le jeton arrive dans le corps (décision 3) ;
  // Better Auth n'accepte que GET, jeton dans la requête : l'appel interne
  // est construit en mémoire, sans callbackURL, et ne traverse aucun réseau.
  "/verify-email": {
    methode: "POST",
    schema: schemaVerification,
    plancher: false,
    versBetterAuth: (donnees, entetes, origine) => {
      const adresse = new URL(`${origine}${BASE}/verify-email`);
      adresse.searchParams.set("token", String(donnees.jeton));
      return new Request(adresse, {
        method: "GET",
        headers: entetesInternes(entetes, false, origine),
      });
    },
    traduire: (lue) => {
      const commune = traductionCommune(lue);
      if (commune) return commune;
      if (lue.statut >= 200 && lue.statut < 300) return { ok: true, cookies: lue.cookies };
      return { raison: "lien_invalide" };
    },
  },
} satisfies Record<string, PointEntree>);

// La réponse d'une adresse inexistante sous /api/auth, d'un point d'entrée
// fermé et d'un point ouvert fermé en production : une seule fonction, donc
// les mêmes octets.
export function reponseInexistante(): Response {
  return new Response(null, { status: 404 });
}

function json(statut: number, corps: unknown, cookies: readonly string[] = []): Response {
  const entetes = new Headers({
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  for (const cookie of cookies) entetes.append("set-cookie", cookie);
  return new Response(JSON.stringify(corps), { status: statut, headers: entetes });
}

function refus(raison: Raison): Response {
  return json(STATUTS[raison], { ok: false, raison });
}

function estJson(entetes: Headers): boolean {
  const type = (entetes.get("content-type") ?? "").split(";")[0]?.trim().toLowerCase();
  return type === "application/json";
}

// Le corps, lu une fois, borné : au-delà de TAILLE_MAX_CORPS octets, ou en
// UTF-8 invalide, null.
async function lireCorps(requete: Request): Promise<string | null> {
  const annoncee = requete.headers.get("content-length");
  if (annoncee !== null && Number(annoncee) > TAILLE_MAX_CORPS) return null;
  if (requete.body === null) return "";
  const lecteur = requete.body.getReader();
  const morceaux: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await lecteur.read();
    if (done) break;
    total += value.byteLength;
    if (total > TAILLE_MAX_CORPS) {
      await lecteur.cancel();
      return null;
    }
    morceaux.push(value);
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(morceaux));
  } catch {
    return null;
  }
}

async function lireReponse(reponse: Response): Promise<ReponseLue> {
  let code: string | null = null;
  try {
    const corps: unknown = await reponse.json();
    if (typeof corps === "object" && corps !== null && "code" in corps) {
      const valeur = (corps as { code: unknown }).code;
      if (typeof valeur === "string") code = valeur;
    }
  } catch {
    // Corps absent ou non JSON : seul le statut compte.
  }
  return { statut: reponse.status, code, cookies: reponse.headers.getSetCookie() };
}

export function creerTraitementAuth(
  dependances: DependancesPointsEntree,
): (requete: Request) => Promise<Response> {
  const horloge = dependances.horloge ?? HORLOGE_REELLE;
  const origine = new URL(dependances.origine).origin;

  async function traiterOuvert(point: PointEntree, requete: Request, url: URL): Promise<Response> {
    if (!verifierOrigine(requete.headers, origine)) return refus("refuse");
    // Aucune donnée dans l'adresse d'un POST : le jeton de vérification, en
    // particulier, n'arrive que dans le corps (décision 3).
    if (url.search !== "" || !estJson(requete.headers)) return refus("invalide");

    const texte = await lireCorps(requete);
    if (texte === null) return refus("invalide");
    let brut: unknown;
    try {
      brut = JSON.parse(texte);
    } catch {
      return refus("invalide");
    }
    const lu = point.schema.safeParse(brut);
    if (!lu.success) return refus("invalide");

    const interne = point.versBetterAuth(
      lu.data as Record<string, unknown>,
      requete.headers,
      origine,
    );
    if (!(interne instanceof Request)) return refus(interne);

    let lue: ReponseLue;
    try {
      lue = await lireReponse(await dependances.traiter(interne));
    } catch {
      // Panne de base ou autre erreur relancée par Better Auth
      // (onAPIError.throw) : une ligne fixe, jamais l'erreur.
      consignerAuth("error");
      return refus("erreur");
    }
    const traduite = point.traduire(lue);
    return "raison" in traduite
      ? refus(traduite.raison)
      : json(200, { ok: true }, traduite.cookies);
  }

  return async function traiterRequeteAuth(requete: Request): Promise<Response> {
    const url = new URL(requete.url);
    if (url.pathname !== BASE && !url.pathname.startsWith(`${BASE}/`)) return reponseInexistante();
    const chemin = url.pathname.slice(BASE.length);
    const point = Object.hasOwn(POINTS_ENTREE_OUVERTS, chemin)
      ? POINTS_ENTREE_OUVERTS[chemin]
      : undefined;
    if (point === undefined || requete.method !== point.methode) return reponseInexistante();
    if (dependances.estProduction && !INSCRIPTION_OUVERTE_EN_PRODUCTION) {
      return reponseInexistante();
    }

    if (!point.plancher) return traiterOuvert(point, requete, url);
    const debut = horloge.maintenant();
    const reponse = await traiterOuvert(point, requete, url);
    const ecoule = horloge.maintenant() - debut;
    if (ecoule < DUREE_PLANCHER_MS) await horloge.attendre(DUREE_PLANCHER_MS - ecoule);
    return reponse;
  };
}
