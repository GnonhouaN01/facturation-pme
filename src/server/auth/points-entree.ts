import "server-only";

import type { z } from "zod";

import {
  LONGUEUR_MIN_MOT_DE_PASSE,
  schemaConnexion,
  schemaDeconnexion,
  schemaDemandeReinitialisation,
  schemaInscription,
  schemaReinitialisation,
  schemaRenvoiVerification,
  schemaVerification,
} from "@/schemas/compte";

import { verifierOrigine } from "../actions/origine";
import { schemaAdresse } from "../email/adresse";

import { consignerIncidentAuth } from "./journal";

// Le gestionnaire de /api/auth : une liste fermée de points d'entrée ouverts
// (T-55). Tout autre chemin et toute autre méthode reçoivent la même réponse
// qu'une adresse inexistante, sans que Better Auth soit appelé. Un point
// ouvert passe par : origine (S-81), taille et type du corps, schéma strict,
// appel à Better Auth avec les seuls champs validés, réponse traduite en une
// liste fermée (jamais le corps ni le message de Better Auth), durée
// plancher (T-07). Toute réponse « erreur » porte l'identifiant d'incident
// de sa ligne de journal (S-85). Fiches : docs/features/inscription.md,
// section 2 ; docs/features/connexion.md, sections 1 à 4 et 6 ;
// docs/features/mot-de-passe.md, sections 2, 3.3 et 8 (mot de passe oublié).
// Les points ouverts répondent en production comme ailleurs depuis la PR 2
// de la 1.3 (docs/features/mot-de-passe.md, section 11) : aucune dépendance
// ne dit l'environnement.

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
  // Limite auth.connexion_compte, pour l'adresse validée : vrai si la
  // tentative est admise. Comptée pour toute adresse (T-07).
  limiterCompte: (adresse: string) => Promise<boolean>;
  // Relecture de la session après la déconnexion, avec les en-têtes reçus :
  // vrai si une session est encore lisible (suppression avalée par Better
  // Auth, docs/features/connexion.md, section 4.2).
  sessionEncoreLisible: (entetes: Headers) => Promise<boolean>;
  // Révocation en base de la session du cookie reçu, après une connexion
  // réussie : Better Auth 1.7.7 crée la nouvelle session sans toucher à
  // l'ancienne (signInEmail), qui resterait valide jusqu'à son terme.
  // Correctif de la 1.2, docs/features/connexion.md, section 4.3.
  revoquerSession: (entetes: Headers) => Promise<void>;
  // 1.3 (docs/features/mot-de-passe.md, sections 3.3 et 5). Limite
  // auth.reinitialisation_compte de la demande, pour l'adresse validée : vrai
  // si la demande est admise. Comptée pour toute adresse (T-07).
  limiterReinitialisation: (adresse: string) => Promise<boolean>;
  // Jeton de réinitialisation connu et non expiré, lu sans être consommé :
  // Better Auth consomme le jeton avant de vérifier le mot de passe
  // compromis, qui brûlerait sinon le lien.
  jetonReinitialisationValide: (jeton: string) => Promise<boolean>;
  // Mot de passe présent dans Have I Been Pwned ; lève si le service ne
  // répond pas (refus fermé par défaut, décision 2 de la 1.1).
  motDePasseCompromis: (motDePasse: string) => Promise<boolean>;
  horloge?: Horloge;
};

type Raison =
  | "mot_de_passe_trop_court"
  | "mot_de_passe_compromis"
  | "invalide"
  | "identifiants_incorrects"
  | "trop_de_requetes"
  | "lien_invalide"
  | "refuse"
  | "erreur";

const STATUTS: Readonly<Record<Raison, number>> = {
  mot_de_passe_trop_court: 400,
  mot_de_passe_compromis: 400,
  invalide: 400,
  lien_invalide: 400,
  identifiants_incorrects: 401,
  trop_de_requetes: 429,
  refuse: 403,
  erreur: 500,
};

// Ce que Better Auth a répondu, réduit à ce dont la traduction a besoin.
type ReponseLue = {
  statut: number;
  code: string | null;
  cookies: string[];
  // Extension twoFactor : session remplacée par une demande de code (1.4).
  doubleAuthentification: boolean;
};

type Traduction = { raison: Raison } | { ok: true; cookies: string[] };

type PointEntree = {
  methode: "POST";
  schema: z.ZodType;
  // Durée plancher : l'inscription, le renvoi et la connexion diraient sinon,
  // par leur durée, si l'adresse a un compte.
  plancher: boolean;
  // La requête passée à Better Auth, construite en mémoire depuis les seules
  // données validées, ou la raison d'un refus.
  versBetterAuth: (
    donnees: Record<string, unknown>,
    entetes: Headers,
    origine: string,
    dependances: DependancesPointsEntree,
  ) => Promise<Request | Raison>;
  traduire: (lue: ReponseLue) => Traduction;
  // Contrôle après un succès de Better Auth (déconnexion, connexion,
  // vérification), avec les cookies que la réponse va poser : faux ou une
  // exception donnent « erreur », sans cookie.
  verifier?: (
    entetes: Headers,
    dependances: DependancesPointsEntree,
    cookies: readonly string[],
  ) => Promise<boolean>;
};

// En-têtes repris de la requête reçue : l'adresse IP (limite de Better Auth,
// session) et le navigateur (session). Le cookie seulement pour la
// déconnexion : le renvoi sans session répond pareil pour toute adresse, et
// la connexion crée toujours une nouvelle session (T-03).
function entetesInternes(
  recus: Headers,
  json: boolean,
  origine: string,
  avecCookie = false,
): Headers {
  const entetes = new Headers();
  for (const nom of ["x-forwarded-for", "user-agent", ...(avecCookie ? ["cookie"] : [])]) {
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

// Un cookie de session posé, à valeur non vide (sur http ou https).
const COOKIE_SESSION = /^(?:__Secure-)?[^=;]*session_token=[^;]/u;

export const POINTS_ENTREE_OUVERTS: Readonly<Record<string, PointEntree>> = Object.freeze({
  // UC-01, étapes 1 à 3.
  "/sign-up/email": {
    methode: "POST",
    schema: schemaInscription,
    plancher: true,
    versBetterAuth: async (donnees, entetes, origine) => {
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
    versBetterAuth: async (donnees, entetes, origine) => {
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
    versBetterAuth: async (donnees, entetes, origine) => {
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
    // Report de la 1.2 (docs/features/mot-de-passe.md, section 8) : quand la
    // vérification ouvre une session, celle du cookie reçu est révoquée avant
    // que le nouveau cookie parte. Lien déjà utilisé, sans nouveau cookie :
    // rien n'est révoqué.
    verifier: async (entetes, dependances, cookies) => {
      if (cookies.some((cookie) => COOKIE_SESSION.test(cookie))) {
        await dependances.revoquerSession(entetes);
      }
      return true;
    },
  },
  // UC-02, étapes 1, 2 et 4 (1.2). Limite par compte avant Better Auth ;
  // adresse inconnue, mauvais mot de passe et compte non vérifié reçoivent la
  // même réponse (T-07) ; seul le cookie de session est transmis, jamais le
  // corps, qui porte le jeton (S-82). Fiche : docs/features/connexion.md,
  // sections 1.1, 2 et 3.
  "/sign-in/email": {
    methode: "POST",
    schema: schemaConnexion,
    plancher: true,
    versBetterAuth: async (donnees, entetes, origine, dependances) => {
      const email = adresseValide(donnees.email);
      if (email === null) return "invalide";
      if (!(await dependances.limiterCompte(email))) return "trop_de_requetes";
      return new Request(`${origine}${BASE}/sign-in/email`, {
        method: "POST",
        headers: entetesInternes(entetes, true, origine),
        body: JSON.stringify({ email, password: String(donnees.motDePasse) }),
      });
    },
    traduire: (lue) => {
      const commune = traductionCommune(lue);
      if (commune) return commune;
      if (lue.statut >= 200 && lue.statut < 300) {
        const cookies = lue.cookies.filter((cookie) => COOKIE_SESSION.test(cookie));
        // Sans cookie de session, ou session remplacée par une demande de
        // code (1.4) : fermé par défaut.
        if (cookies.length === 0 || lue.doubleAuthentification) return { raison: "erreur" };
        return { ok: true, cookies };
      }
      return { raison: "identifiants_incorrects" };
    },
    // Après une connexion réussie seulement : l'ancienne session du
    // navigateur est révoquée avant que le nouveau cookie parte. En échec :
    // « erreur », aucun cookie ; la nouvelle session, dont le jeton n'a pas
    // quitté le serveur, reste inutilisable et sera purgée à son terme.
    verifier: async (entetes, dependances) => {
      await dependances.revoquerSession(entetes);
      return true;
    },
  },
  // F-002, déconnexion (1.2) : Better Auth supprime la session et efface le
  // cookie ; la session est relue ensuite, car Better Auth avale une panne de
  // la base pendant la suppression (T-03). Fiche : docs/features/connexion.md,
  // section 4.2.
  "/sign-out": {
    methode: "POST",
    schema: schemaDeconnexion,
    plancher: false,
    versBetterAuth: async (_donnees, entetes, origine) =>
      new Request(`${origine}${BASE}/sign-out`, {
        method: "POST",
        headers: entetesInternes(entetes, true, origine, true),
        body: "{}",
      }),
    traduire: (lue) => {
      const commune = traductionCommune(lue);
      if (commune) return commune;
      if (lue.statut >= 200 && lue.statut < 300) return { ok: true, cookies: lue.cookies };
      return { raison: "invalide" };
    },
    verifier: async (entetes, dependances) => !(await dependances.sessionEncoreLisible(entetes)),
  },
  // UC-03, étapes 1 et 2 (1.3). Limite par adresse email avant Better Auth ;
  // la même réponse pour toute adresse, avec ou sans compte (T-07), en 800 ms
  // au moins ; ni redirectTo ni callbackURL. Fiche :
  // docs/features/mot-de-passe.md, sections 2 et 5.
  "/request-password-reset": {
    methode: "POST",
    schema: schemaDemandeReinitialisation,
    plancher: true,
    versBetterAuth: async (donnees, entetes, origine, dependances) => {
      const email = adresseValide(donnees.email);
      if (email === null) return "invalide";
      if (!(await dependances.limiterReinitialisation(email))) return "trop_de_requetes";
      return new Request(`${origine}${BASE}/request-password-reset`, {
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
  // UC-03, étapes 3 et 4 (1.3). Le jeton arrive dans le corps (fragment du
  // lien) ; avant Better Auth, qui le consommerait : longueur, jeton connu,
  // mot de passe compromis. Aucune session ouverte, aucun cookie. Fiche :
  // docs/features/mot-de-passe.md, sections 2.3 et 3.3.
  "/reset-password": {
    methode: "POST",
    schema: schemaReinitialisation,
    plancher: false,
    versBetterAuth: async (donnees, entetes, origine, dependances) => {
      const motDePasse = String(donnees.motDePasse);
      if (motDePasse.length < LONGUEUR_MIN_MOT_DE_PASSE) return "mot_de_passe_trop_court";
      const jeton = String(donnees.jeton);
      if (!(await dependances.jetonReinitialisationValide(jeton))) return "lien_invalide";
      if (await dependances.motDePasseCompromis(motDePasse)) return "mot_de_passe_compromis";
      return new Request(`${origine}${BASE}/reset-password`, {
        method: "POST",
        headers: entetesInternes(entetes, true, origine),
        body: JSON.stringify({ newPassword: motDePasse, token: jeton }),
      });
    },
    traduire: (lue) => {
      const commune = traductionCommune(lue);
      if (commune) return commune;
      if (lue.statut >= 200 && lue.statut < 300) return { ok: true, cookies: [] };
      if (lue.code === "INVALID_TOKEN" || lue.code === "USER_NOT_FOUND") {
        return { raison: "lien_invalide" };
      }
      if (lue.code === "PASSWORD_TOO_SHORT") return { raison: "mot_de_passe_trop_court" };
      if (lue.code === "PASSWORD_COMPROMISED") return { raison: "mot_de_passe_compromis" };
      return { raison: "invalide" };
    },
  },
} satisfies Record<string, PointEntree>);

// Le jeton de session porté par un en-tête Cookie (valeur signée
// « jeton.signature », encodée), sans vérifier la signature : sert à relire
// la session après la déconnexion (section 4.2). Absent ou mal formé : null.
export function jetonDeSession(cookie: string | null, nom: string): string | null {
  if (cookie === null) return null;
  for (const morceau of cookie.split(";")) {
    const egal = morceau.indexOf("=");
    if (egal < 0 || morceau.slice(0, egal).trim() !== nom) continue;
    let valeur: string;
    try {
      valeur = decodeURIComponent(morceau.slice(egal + 1).trim());
    } catch {
      return null;
    }
    const point = valeur.lastIndexOf(".");
    return point > 0 ? valeur.slice(0, point) : null;
  }
  return null;
}

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

// Un refus ; « erreur » porte l'identifiant de l'incident, écrit au journal
// technique au même moment (une ligne par réponse).
function refus(raison: Raison): Response {
  if (raison === "erreur") {
    return json(STATUTS.erreur, { ok: false, raison, incident: consignerIncidentAuth() });
  }
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
  let doubleAuthentification = false;
  try {
    const corps: unknown = await reponse.json();
    if (typeof corps === "object" && corps !== null) {
      if ("code" in corps) {
        const valeur = (corps as { code: unknown }).code;
        if (typeof valeur === "string") code = valeur;
      }
      doubleAuthentification =
        "twoFactorRedirect" in corps &&
        (corps as { twoFactorRedirect: unknown }).twoFactorRedirect === true;
    }
  } catch {
    // Corps absent ou non JSON : seul le statut compte.
  }
  return {
    statut: reponse.status,
    code,
    cookies: reponse.headers.getSetCookie(),
    doubleAuthentification,
  };
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

    let traduite: Traduction;
    try {
      const interne = await point.versBetterAuth(
        lu.data as Record<string, unknown>,
        requete.headers,
        origine,
        dependances,
      );
      if (!(interne instanceof Request)) return refus(interne);
      traduite = point.traduire(await lireReponse(await dependances.traiter(interne)));
      if (!("raison" in traduite) && point.verifier) {
        if (!(await point.verifier(requete.headers, dependances, traduite.cookies))) {
          return refus("erreur");
        }
      }
    } catch {
      // Panne de base, compteur en échec, ou autre erreur relancée par Better
      // Auth (onAPIError.throw) : une ligne fixe, jamais l'erreur.
      return refus("erreur");
    }
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

    if (!point.plancher) return traiterOuvert(point, requete, url);
    const debut = horloge.maintenant();
    const reponse = await traiterOuvert(point, requete, url);
    const ecoule = horloge.maintenant() - debut;
    if (ecoule < DUREE_PLANCHER_MS) await horloge.attendre(DUREE_PLANCHER_MS - ecoule);
    return reponse;
  };
}
