import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createServer, type IncomingHttpHeaders } from "node:http";
import type { AddressInfo } from "node:net";
import { promisify } from "node:util";

import { expect, test } from "@playwright/test";

import {
  comparerDocuments,
  controlerSite,
  documentServi as documentDuScript,
  ENTETES_ATTENDUS,
  optionsRequete,
  POLITIQUE_ATTENDUE,
  TEXTES_GABARIT,
} from "../scripts/controle-deploiement.mjs";
import { TEXTES_COMPTE } from "../src/textes/compte";
import { TEXTES_NAVIGATION } from "../src/textes/navigation";
import { TEXTES_SIMULATION } from "../src/textes/simulation";

import { documentServi, ENTETES_SECTION_6, POLITIQUE_PRODUCTION } from "./outils";

// Script de contrôle après déploiement (0.8), éprouvé contre un serveur
// factice local, puis contre le site construit en local. Jamais contre la
// production ni une prévisualisation. Fiche :
// docs/features/controle-deploiement.md, sections 1, 2 et 5. Page « tache »
// (8.3) : docs/features/tache-quotidienne.md, section 6, test 10. Pages
// « auth » et « inscription » (1.1) : docs/features/inscription.md,
// section 2.3, test 16. Connexion (1.2) : « inscription » devient « comptes »
// (cinq POST), « auth » gagne /api/auth/get-session, pages « connexion » et
// « compte » : docs/features/connexion.md, section 10, test 25.

const SCRIPT = "scripts/controle-deploiement.mjs";
const executer = promisify(execFile);

// corpsOctets : taille du corps reçu, lu en entier (requêtes de /api/auth).
type Requete = {
  methode: string | undefined;
  chemin: string;
  entetes: IncomingHttpHeaders;
  corpsOctets?: number;
};

// Un défaut par serveur factice ; sans défaut, le serveur est conforme.
type Defaut =
  | "x-powered-by"
  | "sans-hsts"
  | "hsts-sans-sous-domaines"
  | "unsafe-inline"
  | "sans-nonce"
  | "nonces-differents"
  | "directive-manquante"
  | "nonce-fixe"
  | "script-sans-nonce"
  | "accueil-500"
  | "accueil-redirige"
  | "tableau-de-bord-200"
  | "introuvable-en-anglais"
  | "cookie-distingue"
  | "lien-distingue"
  | "gabarit-dans-la-charge"
  | "pile"
  | "chemin-de-fichier"
  | "variable-dans-le-corps"
  | "variable-dans-un-entete"
  // Tâche quotidienne (8.3).
  | "tache-200-sans-secret"
  | "tache-401"
  | "tache-forge-distingue"
  | "tache-inconnue-distingue"
  | "tache-x-powered-by"
  | "tache-fuite-entete"
  | "tache-en-anglais"
  // /api/auth (1.1).
  | "auth-organisation-ouverte"
  | "auth-organisation-distingue"
  | "auth-x-powered-by"
  | "auth-en-anglais"
  | "inscription-ouverte"
  | "renvoi-ouvert"
  // Connexion (1.2).
  | "connexion-ouverte"
  | "deconnexion-ouverte"
  | "session-ouverte"
  | "connexion-500"
  | "compte-200"
  | "compte-distingue"
  | "gabarit-compte-dans-la-charge"
  // Mot de passe oublié (1.3).
  | "demande-ouverte"
  | "reinitialisation-ouverte"
  | "lien-reinitialisation-ouvert"
  | "mot-de-passe-oublie-500"
  | "lien-reinitialisation-500"
  // Double authentification (1.4).
  | "double-auth-ouverte"
  | "totp-uri-ouvert"
  | "double-authentification-200"
  | "double-authentification-distingue"
  // Profil et sessions (1.5).
  | "profil-ouvert"
  | "liste-sessions-ouverte"
  | "profil-200"
  | "sessions-distingue";

// Les dix-neuf points d'entrée ouverts hors production, en POST (1.1 à 1.6).
const POINTS_COMPTES = [
  "/api/auth/sign-up/email",
  "/api/auth/send-verification-email",
  "/api/auth/verify-email",
  "/api/auth/sign-in/email",
  "/api/auth/sign-out",
  "/api/auth/request-password-reset",
  "/api/auth/reset-password",
  // 1.4 (docs/features/double-authentification.md, section 13).
  "/api/auth/two-factor/verify-totp",
  "/api/auth/two-factor/verify-backup-code",
  "/api/auth/two-factor/enable",
  "/api/auth/two-factor/confirm-enable",
  "/api/auth/two-factor/replace",
  "/api/auth/two-factor/generate-backup-codes",
  "/api/auth/two-factor/disable",
  // 1.5 (docs/features/profil-sessions.md, section 11).
  "/api/auth/revoke-session",
  "/api/auth/revoke-other-sessions",
  "/api/auth/change-password",
  "/api/auth/update-user",
  // 1.6 (docs/features/nouvelle-authentification.md, section 10).
  "/api/auth/verify-password",
];

type Factice = { adresse: string; requetes: Requete[]; fermer: () => Promise<void> };

const ENTETES_CONFORMES: Record<string, string> = {
  "Strict-Transport-Security": "max-age=63072000; includeSubDomains",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "same-origin",
  "Permissions-Policy":
    "camera=(), microphone=(), geolocation=(), payment=(), usb=(), browsing-topics=()",
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Resource-Policy": "same-origin",
};

function politique(script: string, style: string, defaut: Defaut | undefined): string {
  const directives = [
    "default-src 'none'",
    `script-src 'self' ${script} 'strict-dynamic'`,
    `style-src 'self' ${style}${defaut === "unsafe-inline" ? " 'unsafe-inline'" : ""}`,
    "img-src 'self'",
    "font-src 'self'",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    ...(defaut === "directive-manquante" ? [] : ["frame-ancestors 'none'"]),
  ];
  return directives.join("; ");
}

function page(nonce: string, titre: string, corps: string, charge: string, defaut?: Defaut) {
  const attribut = defaut === "script-sans-nonce" ? "" : ` nonce="${nonce}"`;
  return (
    `<!DOCTYPE html><html lang="fr"><head><meta charSet="utf-8"/><title>${titre}</title>` +
    `<script src="/_next/static/chunks/a.js" async=""${attribut}></script></head>` +
    `<body>${corps}<script${attribut}>(self.__next_f=self.__next_f||[]).push([1,${JSON.stringify(charge)}])</script></body></html>`
  );
}

const INTROUVABLE_FR = `<main><h1>${"Cette page est introuvable"}</h1><a href="/">Revenir à l&#x27;accueil</a></main>`;
const INTROUVABLE_EN = "<main><h1>404</h1><h2>This page could not be found.</h2></main>";

async function ecouter(serveur: ReturnType<typeof createServer>): Promise<string> {
  await new Promise<void>((resoudre) => serveur.listen(0, "127.0.0.1", resoudre));
  return `http://127.0.0.1:${(serveur.address() as AddressInfo).port}`;
}

async function demarrerFactice(defaut?: Defaut, redirection?: string): Promise<Factice> {
  const requetes: Requete[] = [];
  const serveur = createServer((requete, reponse) => {
    const chemin = requete.url ?? "";
    const recue: Requete = { methode: requete.method, chemin, entetes: requete.headers };
    requetes.push(recue);

    const nonce =
      defaut === "nonce-fixe" ? "AAAAAAAAAAAAAAAAAAAAAA==" : randomBytes(16).toString("base64");
    const autre = randomBytes(16).toString("base64");
    const script = defaut === "sans-nonce" ? "" : `'nonce-${nonce}'`;
    const style =
      defaut === "sans-nonce" ? "" : `'nonce-${defaut === "nonces-differents" ? autre : nonce}'`;

    const entetes: Record<string, string> = {
      ...ENTETES_CONFORMES,
      "Content-Type": "text/html; charset=utf-8",
      "Content-Security-Policy": politique(script, style, defaut),
    };
    if (defaut === "sans-hsts") delete entetes["Strict-Transport-Security"];
    if (defaut === "hsts-sans-sous-domaines") {
      entetes["Strict-Transport-Security"] = "max-age=63072000";
    }
    if (defaut === "x-powered-by") entetes["X-Powered-By"] = "Next.js";

    // Tâche quotidienne : comme src/server/taches/quotidienne.ts, un refus et
    // une tâche inconnue reçoivent 404, corps vide, sans Content-Type ; la
    // politique et les en-têtes de la section 6 sont posés comme partout.
    if (chemin.startsWith("/api/taches/")) {
      const quotidienne = chemin === "/api/taches/quotidienne";
      const avecSecret = requete.headers.authorization !== undefined;
      const tache: Record<string, string> = { ...entetes, "Cache-Control": "no-store" };
      delete tache["Content-Type"];
      if (defaut === "tache-x-powered-by") tache["X-Powered-By"] = "Next.js";
      if (defaut === "tache-fuite-entete") tache["X-Indice"] = "/var/task/node_modules/x.js";
      let statut = 404;
      let corps = "";
      if (defaut === "tache-200-sans-secret" && quotidienne && !avecSecret) {
        statut = 200;
        corps = '{"ok":true}';
      }
      if (defaut === "tache-401" && quotidienne) statut = 401;
      if (defaut === "tache-forge-distingue" && quotidienne && avecSecret) corps = "x";
      if (defaut === "tache-inconnue-distingue" && !quotidienne) {
        tache["Content-Type"] = "text/html; charset=utf-8";
        corps = page(nonce, "Facturation PME", INTROUVABLE_FR, "0:{}");
      }
      if (defaut === "tache-en-anglais") corps = "Not Found";
      reponse.writeHead(statut, tache);
      reponse.end(corps);
      return;
    }

    // /api/auth : comme src/server/auth/points-entree.ts, un chemin fermé,
    // une méthode non admise et un chemin inexistant reçoivent 404, corps
    // vide, sans Content-Type. En production, les trois POST ouverts aussi
    // (inscription fermée jusqu'à la 1.3) ; ouverts, ils refusent une
    // requête sans Origin par 403 et un corps JSON.
    if (chemin.startsWith("/api/auth/")) {
      // Le corps est lu en entier avant la réponse : sa taille est notée.
      recue.corpsOctets = 0;
      requete.on("data", (morceau: Buffer) => {
        recue.corpsOctets = (recue.corpsOctets ?? 0) + morceau.length;
      });
      const auth: Record<string, string> = { ...entetes };
      delete auth["Content-Type"];
      if (defaut === "auth-x-powered-by") auth["X-Powered-By"] = "Next.js";
      let statut = 404;
      let corps = "";
      const json = (valeur: string) => {
        auth["Content-Type"] = "application/json; charset=utf-8";
        corps = valeur;
      };
      if (
        requete.method === "POST" &&
        POINTS_COMPTES.includes(chemin) &&
        (defaut === "inscription-ouverte" ||
          (defaut === "renvoi-ouvert" && chemin === "/api/auth/send-verification-email") ||
          (defaut === "connexion-ouverte" && chemin === "/api/auth/sign-in/email") ||
          (defaut === "deconnexion-ouverte" && chemin === "/api/auth/sign-out") ||
          (defaut === "demande-ouverte" && chemin === "/api/auth/request-password-reset") ||
          (defaut === "reinitialisation-ouverte" && chemin === "/api/auth/reset-password") ||
          (defaut === "double-auth-ouverte" && chemin === "/api/auth/two-factor/verify-totp") ||
          (defaut === "profil-ouvert" && chemin === "/api/auth/change-password"))
      ) {
        statut = 403;
        json('{"ok":false,"raison":"refuse"}');
      }
      // 1.3 : le lien de Better Auth (jeton dans le chemin), s'il était
      // ouvert, redirigerait vers la callbackURL.
      if (
        defaut === "lien-reinitialisation-ouvert" &&
        chemin.startsWith("/api/auth/reset-password/")
      ) {
        statut = 302;
        auth.Location = "/?token=x";
      }
      // 1.4 : le secret TOTP, s'il se relisait.
      if (defaut === "totp-uri-ouvert" && chemin === "/api/auth/two-factor/get-totp-uri") {
        statut = 200;
        json('{"totpURI":"otpauth://totp/x"}');
      }
      // 1.5 : la liste des sessions, si elle s'ouvrait (son corps porte les
      // jetons).
      if (defaut === "liste-sessions-ouverte" && chemin === "/api/auth/list-sessions") {
        statut = 200;
        json("[]");
      }
      if (defaut === "session-ouverte" && chemin === "/api/auth/get-session") {
        statut = 200;
        json("null");
      }
      if (defaut === "auth-organisation-ouverte" && chemin === "/api/auth/organization/list") {
        statut = 200;
        json("[]");
      }
      if (
        defaut === "auth-organisation-distingue" &&
        chemin === "/api/auth/organization/get-full-organization"
      ) {
        corps = " ";
      }
      if (defaut === "auth-en-anglais") corps = "Not Found";
      requete.on("end", () => {
        reponse.writeHead(statut, auth);
        reponse.end(corps);
      });
      return;
    }

    const accueil = chemin === "/";
    const connexion = chemin === "/connexion";
    // 1.3 : pages publiques du mot de passe oublié.
    const oubli = chemin === "/mot-de-passe-oublie";
    const lienReinitialisation = chemin === "/lien/reinitialisation";
    // 1.4 : la page de la double authentification, servie comme /compte.
    const doubleAuth = chemin === "/compte/double-authentification";
    // 1.5 : le profil et les sessions, servis comme /compte.
    const profil = chemin === "/compte/profil";
    const sessions = chemin === "/compte/sessions";
    const compte = chemin === "/compte" || doubleAuth || profil || sessions;
    const tableau = chemin === "/tableau-de-bord";
    const lien = chemin.startsWith("/lien/devis/");
    const inexistante = chemin.startsWith("/adresse-inexistante-");
    if (defaut === "variable-dans-un-entete" && tableau) entetes["X-Indice"] = "BETTER_AUTH_SECRET";

    // Aucune valeur de la requête n'est recopiée dans la réponse (pas de
    // contenu réfléchi) : la charge utile, qui varie d'une requête à l'autre
    // comme celle de Next.js, est tirée au hasard.
    let charge = `0:{"c":["","${randomBytes(8).toString("hex")}"]}`;
    if (defaut === "pile" && inexistante) {
      charge += "\nError: refus\n    at lire (src/server/x.ts:12:7)";
    }
    if (defaut === "chemin-de-fichier" && tableau) charge += " /var/task/node_modules/next/x.js";
    if (defaut === "variable-dans-le-corps" && accueil) charge += " DATABASE_URL absente";
    if (defaut === "gabarit-dans-la-charge" && tableau) charge += " Organisation active";
    if (defaut === "gabarit-compte-dans-la-charge" && compte) charge += " Se déconnecter";

    // 1.3 : demande et choix du mot de passe, 200 comme la connexion.
    if (oubli || lienReinitialisation) {
      const enPanne =
        (oubli && defaut === "mot-de-passe-oublie-500") ||
        (lienReinitialisation && defaut === "lien-reinitialisation-500");
      reponse.writeHead(enPanne ? 500 : 200, entetes);
      reponse.end(
        page(
          nonce,
          "Facturation PME",
          oubli ? "<h1>Mot de passe oublié</h1>" : "<h1>Choisir un nouveau mot de passe</h1>",
          charge,
          defaut,
        ),
      );
      return;
    }

    // Page publique de connexion (1.2) : 200, comme l'accueil.
    if (connexion) {
      reponse.writeHead(defaut === "connexion-500" ? 500 : 200, entetes);
      reponse.end(page(nonce, "Facturation PME", "<h1>Se connecter</h1>", charge, defaut));
      return;
    }

    if (accueil) {
      if (defaut === "accueil-redirige" && redirection) {
        reponse.writeHead(307, { ...entetes, Location: `${redirection}/` });
        reponse.end();
        return;
      }
      reponse.writeHead(defaut === "accueil-500" ? 500 : 200, entetes);
      reponse.end(page(nonce, "Facturation PME", "<h1>Facturation PME</h1>", charge, defaut));
      return;
    }

    const anglais = defaut === "introuvable-en-anglais";
    let corps = anglais ? INTROUVABLE_EN : INTROUVABLE_FR;
    const titre = anglais ? "404: This page could not be found." : "Facturation PME";
    // Comme Next.js : le notFound() d'une page donne un corps vide, une
    // adresse sans page la page « introuvable » rendue sur le serveur.
    if (tableau) {
      corps = defaut === "cookie-distingue" && requete.headers.cookie ? INTROUVABLE_FR : "";
    }
    // Zone (compte), 1.2 : comme le tableau de bord, notFound() sans session.
    if (compte) {
      corps =
        requete.headers.cookie &&
        ((defaut === "compte-distingue" && chemin === "/compte") ||
          (defaut === "double-authentification-distingue" && doubleAuth) ||
          (defaut === "sessions-distingue" && sessions))
          ? INTROUVABLE_FR
          : "";
    }
    if (lien && defaut === "lien-distingue") corps += `<p>${randomBytes(4).toString("hex")}</p>`;
    const statutPage =
      (tableau && defaut === "tableau-de-bord-200") ||
      (chemin === "/compte" && defaut === "compte-200") ||
      (doubleAuth && defaut === "double-authentification-200") ||
      (profil && defaut === "profil-200")
        ? 200
        : 404;
    reponse.writeHead(statutPage, entetes);
    reponse.end(page(nonce, titre, corps, charge, defaut));
  });
  const adresse = await ecouter(serveur);
  return {
    adresse,
    requetes,
    fermer: () => new Promise<void>((resoudre) => serveur.close(() => resoudre())),
  };
}

type Resultat = { nom: string; ok: boolean; detail: string };

function echecs(resultats: readonly Resultat[]): string[] {
  return resultats
    .filter((r) => !r.ok)
    .map((r) => r.nom)
    .sort();
}

// 1.3 (modifié) : les deux pages du mot de passe oublié.
const PAGES = [
  "accueil",
  "tableau-de-bord",
  "inexistante",
  "lien",
  "connexion",
  "compte",
  // 1.4 : servie par le serveur factice comme /compte.
  "double-authentification",
  // 1.5 : servies par le serveur factice comme /compte.
  "profil",
  "sessions",
  "mot-de-passe-oublie",
  "lien-reinitialisation",
] as const;
const surToutes = (controle: string) => PAGES.map((p) => `${p}:${controle}`);
// Politique et en-têtes : vérifiés aussi sur les pages « tache » (8.3) et
// « auth » (1.1).
const avecTache = (controle: string) => [
  ...surToutes(controle),
  `tache:${controle}`,
  `auth:${controle}`,
];

test.describe("contrôle après déploiement, serveur factice", () => {
  // 8.3 (modifié, signalé) : 10 requêtes par passage au lieu de 7, et un
  // en-tête Authorization forgé, seconde exception après le cookie forgé, sur
  // /api/taches/quotidienne seulement (docs/features/tache-quotidienne.md,
  // section 6).
  // 1.1 (modifié, signalé) : 17 requêtes par passage. Trois GET de /api/auth
  // (T-55), et quatre POST sans corps, sans Origin, sans cookie, vers les
  // trois points d'entrée de l'inscription et un chemin inexistant : seule
  // preuve, sur la production, que l'inscription y est fermée (décision 1).
  // Ouverte, elle refuserait ces POST avant Better Auth (origine absente) :
  // rien n'est écrit, rien n'est envoyé (docs/features/inscription.md,
  // section 2.3).
  // 1.2 (modifié, signalé) : 23 requêtes par passage. GET de
  // /api/auth/get-session, de /connexion, de /compte sans cookie et avec le
  // cookie forgé ; deux POST de plus, vers la connexion et la déconnexion
  // (docs/features/connexion.md, section 10).
  // 1.3 (modifié, signalé) : 28 requêtes par passage. GET de
  // /mot-de-passe-oublie, de /lien/reinitialisation et du lien de Better
  // Auth (/api/auth/reset-password/<jeton forgé>) ; deux POST de plus, vers la
  // demande et la réinitialisation (docs/features/mot-de-passe.md, section 2).
  test("serveur conforme : tout passe, des GET et six POST vides vers /api/auth, sans cookie ni Authorization sauf les valeurs forgées", async () => {
    const factice = await demarrerFactice();
    try {
      const premier = await controlerSite(factice.adresse);
      const second = await controlerSite(factice.adresse);

      expect(echecs(premier)).toEqual([]);
      expect(echecs(second)).toEqual([]);
      expect(premier.length).toBeGreaterThan(10);

      // 1.4 (modifié, signalé) : 40 requêtes par passage. Sept POST de plus
      // (double authentification) ; GET de /compte/double-authentification
      // sans cookie et avec le cookie forgé, et des trois chemins fermés
      // /two-factor/get-totp-uri, /send-otp, /verify-otp.
      // 1.5 (modifié, signalé) : 49 requêtes par passage. Quatre POST de plus
      // (profil et sessions) ; GET de /compte/profil et de /compte/sessions
      // sans cookie et avec le cookie forgé, et du chemin fermé
      // /list-sessions.
      // 1.6 (modifié, signalé) : 50 requêtes par passage, un POST de plus
      // (nouvelle authentification).
      expect(factice.requetes).toHaveLength(100);
      const posts = factice.requetes.filter((r) => r.methode !== "GET");
      expect(posts).toHaveLength(40);
      for (const requete of posts) {
        expect(requete.methode).toBe("POST");
        expect(requete.chemin).toMatch(/^\/api\/auth\//);
        expect(requete.entetes["content-length"] ?? "0").toBe("0");
        expect(requete.entetes.origin).toBeUndefined();
        expect(requete.entetes.cookie).toBeUndefined();
        expect(requete.entetes.authorization).toBeUndefined();
      }
      for (const point of POINTS_COMPTES) {
        expect(
          posts.filter((r) => r.chemin === point),
          point,
        ).toHaveLength(2);
      }
      const postsInexistants = posts.filter((r) => /^\/api\/auth\/[0-9a-f]{16}$/.test(r.chemin));
      expect(postsInexistants).toHaveLength(2);
      expect(postsInexistants[0]?.chemin).not.toBe(postsInexistants[1]?.chemin);
      for (const requete of factice.requetes.filter((r) => r.methode === "GET")) {
        expect(requete.entetes["content-length"]).toBeUndefined();
      }
      // Un seul Authorization par passage : un secret forgé, tiré au hasard à
      // chaque passage, sur /api/taches/quotidienne.
      const autorises = factice.requetes.filter((r) => r.entetes.authorization !== undefined);
      expect(autorises.map((r) => r.chemin)).toEqual([
        "/api/taches/quotidienne",
        "/api/taches/quotidienne",
      ]);
      for (const r of autorises) {
        expect(r.entetes.authorization).toMatch(/^Bearer [A-Za-z0-9_-]{43}$/);
      }
      expect(autorises[0]?.entetes.authorization).not.toBe(autorises[1]?.entetes.authorization);
      // Un cookie forgé par passage, sous ses deux noms, tiré au hasard à
      // chaque passage : sur /tableau-de-bord, et sur /compte (1.2).
      const avecCookie = factice.requetes.filter((r) => r.entetes.cookie !== undefined);
      expect(avecCookie.map((r) => r.chemin)).toEqual([
        "/tableau-de-bord",
        "/compte",
        "/compte/double-authentification",
        "/compte/profil",
        "/compte/sessions",
        "/tableau-de-bord",
        "/compte",
        "/compte/double-authentification",
        "/compte/profil",
        "/compte/sessions",
      ]);
      const valeurs = avecCookie.map((r) => {
        const trouve =
          /^better-auth\.session_token=([^;]+); __Secure-better-auth\.session_token=\1$/.exec(
            r.entetes.cookie ?? "",
          );
        expect(trouve, r.entetes.cookie).not.toBeNull();
        return trouve?.[1];
      });
      expect(valeurs[0]).not.toBe(valeurs[5]);

      const chemins = factice.requetes.map((r) => r.chemin);
      const inexistantes = chemins.filter((c) => /^\/adresse-inexistante-[0-9a-f]{16}$/.test(c));
      const liens = chemins.filter((c) => /^\/lien\/devis\/[A-Za-z0-9_-]{43}$/.test(c));
      expect(chemins.filter((c) => c === "/")).toHaveLength(4);
      expect(chemins.filter((c) => c === "/tableau-de-bord")).toHaveLength(4);
      expect(chemins.filter((c) => c === "/connexion")).toHaveLength(2);
      expect(chemins.filter((c) => c === "/mot-de-passe-oublie")).toHaveLength(2);
      expect(chemins.filter((c) => c === "/lien/reinitialisation")).toHaveLength(2);
      expect(chemins.filter((c) => c === "/compte")).toHaveLength(4);
      expect(chemins.filter((c) => c === "/compte/double-authentification")).toHaveLength(4);
      expect(chemins.filter((c) => c === "/compte/profil")).toHaveLength(4);
      expect(chemins.filter((c) => c === "/compte/sessions")).toHaveLength(4);
      expect(inexistantes).toHaveLength(2);
      expect(inexistantes[0]).not.toBe(inexistantes[1]);
      expect(new Set(liens).size).toBe(4);
      const taches = chemins.filter((c) => c.startsWith("/api/taches/"));
      const tachesInconnues = taches.filter((c) => /^\/api\/taches\/[0-9a-f]{16}$/.test(c));
      expect(taches.filter((c) => c === "/api/taches/quotidienne")).toHaveLength(4);
      expect(tachesInconnues).toHaveLength(2);
      expect(tachesInconnues[0]).not.toBe(tachesInconnues[1]);
      expect(premier.map((r) => r.nom).filter((n) => n.startsWith("tache:"))).toEqual([
        "tache:statut",
        "tache:politique",
        "tache:entetes",
        "tache:fuite",
        "tache:anglais",
        "tache:identique",
      ]);
      // /api/auth en GET : deux points fermés de /organization/*, un chemin
      // inexistant.
      const auth = factice.requetes
        .filter((r) => r.methode === "GET" && r.chemin.startsWith("/api/auth/"))
        .map((r) => r.chemin);
      expect(auth.filter((c) => c === "/api/auth/organization/list")).toHaveLength(2);
      expect(auth.filter((c) => c === "/api/auth/organization/get-full-organization")).toHaveLength(
        2,
      );
      expect(auth.filter((c) => c === "/api/auth/get-session")).toHaveLength(2);
      // 1.4 : les trois chemins de la double authentification qui restent fermés.
      for (const ferme of ["get-totp-uri", "send-otp", "verify-otp"]) {
        expect(auth.filter((c) => c === `/api/auth/two-factor/${ferme}`)).toHaveLength(2);
      }
      // 1.5 : la liste des sessions reste fermée.
      expect(auth.filter((c) => c === "/api/auth/list-sessions")).toHaveLength(2);
      // 1.3 : le lien de Better Auth, jeton forgé de la forme de generateId(24),
      // tiré à chaque passage.
      const liensBetterAuth = auth.filter((c) =>
        /^\/api\/auth\/reset-password\/[A-Za-z0-9]{24}\?callbackURL=%2F$/.test(c),
      );
      expect(liensBetterAuth).toHaveLength(2);
      expect(liensBetterAuth[0]).not.toBe(liensBetterAuth[1]);
      expect(auth.filter((c) => /^\/api\/auth\/[0-9a-f]{16}$/.test(c))).toHaveLength(2);
      expect(
        premier.map((r) => r.nom).filter((n) => /^(auth|inscription|comptes):/.test(n)),
      ).toEqual([
        "auth:statut",
        "auth:politique",
        "auth:entetes",
        "auth:fuite",
        "auth:anglais",
        "auth:identique",
        "comptes:statut",
        "comptes:identique",
      ]);
      expect(
        premier.map((r) => r.nom).filter((n) => /^compte:(identique|gabarit|anglais)$/.test(n)),
      ).toEqual(["compte:anglais", "compte:gabarit", "compte:identique"]);
      expect(
        premier
          .map((r) => r.nom)
          .filter((n) => /^double-authentification:(identique|gabarit|anglais|statut)$/.test(n)),
      ).toEqual([
        "double-authentification:statut",
        "double-authentification:anglais",
        "double-authentification:gabarit",
        "double-authentification:identique",
      ]);
      // 1.5 : les deux pages du profil et des sessions, comme /compte.
      for (const nom of ["profil", "sessions"]) {
        expect(
          premier
            .map((r) => r.nom)
            .filter((n) => new RegExp(`^${nom}:(identique|gabarit|anglais|statut)$`).test(n)),
        ).toEqual([`${nom}:statut`, `${nom}:anglais`, `${nom}:gabarit`, `${nom}:identique`]);
      }
    } finally {
      await factice.fermer();
    }
  });

  const CAS: readonly [Defaut, string[]][] = [
    ["x-powered-by", avecTache("entetes")],
    ["sans-hsts", avecTache("entetes")],
    ["hsts-sans-sous-domaines", avecTache("entetes")],
    ["unsafe-inline", avecTache("politique")],
    [
      "sans-nonce",
      [...avecTache("politique"), ...surToutes("nonce-scripts"), "accueil:nonce-neuf"],
    ],
    ["nonces-differents", avecTache("politique")],
    ["directive-manquante", avecTache("politique")],
    ["nonce-fixe", ["accueil:nonce-neuf"]],
    ["script-sans-nonce", surToutes("nonce-scripts")],
    ["accueil-500", ["accueil:statut"]],
    ["tableau-de-bord-200", ["tableau-de-bord:statut"]],
    [
      "introuvable-en-anglais",
      [
        "compte:anglais",
        "double-authentification:anglais",
        "inexistante:anglais",
        "lien:anglais",
        "profil:anglais",
        "sessions:anglais",
        "tableau-de-bord:anglais",
      ],
    ],
    ["cookie-distingue", ["tableau-de-bord:identique"]],
    ["lien-distingue", ["lien:identique"]],
    ["gabarit-dans-la-charge", ["tableau-de-bord:gabarit"]],
    ["pile", ["inexistante:fuite"]],
    ["chemin-de-fichier", ["tableau-de-bord:fuite"]],
    ["variable-dans-le-corps", ["accueil:fuite"]],
    ["variable-dans-un-entete", ["tableau-de-bord:fuite"]],
    ["tache-200-sans-secret", ["tache:identique", "tache:statut"]],
    ["tache-401", ["tache:identique", "tache:statut"]],
    ["tache-forge-distingue", ["tache:identique"]],
    ["tache-inconnue-distingue", ["tache:identique"]],
    ["tache-x-powered-by", ["tache:entetes"]],
    ["tache-fuite-entete", ["tache:fuite"]],
    ["tache-en-anglais", ["tache:anglais"]],
    ["auth-organisation-ouverte", ["auth:identique", "auth:statut"]],
    ["auth-organisation-distingue", ["auth:identique"]],
    ["auth-x-powered-by", ["auth:entetes"]],
    ["auth-en-anglais", ["auth:anglais"]],
    ["inscription-ouverte", ["comptes:identique", "comptes:statut"]],
    ["renvoi-ouvert", ["comptes:identique", "comptes:statut"]],
    ["connexion-ouverte", ["comptes:identique", "comptes:statut"]],
    ["deconnexion-ouverte", ["comptes:identique", "comptes:statut"]],
    ["session-ouverte", ["auth:identique", "auth:statut"]],
    ["connexion-500", ["connexion:statut"]],
    ["compte-200", ["compte:statut"]],
    ["compte-distingue", ["compte:identique"]],
    // 1.4 (modifié) : la page de la double authentification est servie comme
    // /compte par le serveur factice, son gabarit fuit avec lui.
    // 1.5 (modifié) : le profil et les sessions aussi.
    [
      "gabarit-compte-dans-la-charge",
      ["compte:gabarit", "double-authentification:gabarit", "profil:gabarit", "sessions:gabarit"],
    ],
    // 1.3.
    ["demande-ouverte", ["comptes:identique", "comptes:statut"]],
    ["reinitialisation-ouverte", ["comptes:identique", "comptes:statut"]],
    ["lien-reinitialisation-ouvert", ["auth:identique", "auth:statut"]],
    ["mot-de-passe-oublie-500", ["mot-de-passe-oublie:statut"]],
    ["lien-reinitialisation-500", ["lien-reinitialisation:statut"]],
    // 1.4.
    ["double-auth-ouverte", ["comptes:identique", "comptes:statut"]],
    ["totp-uri-ouvert", ["auth:identique", "auth:statut"]],
    ["double-authentification-200", ["double-authentification:statut"]],
    ["double-authentification-distingue", ["double-authentification:identique"]],
    // 1.5.
    ["profil-ouvert", ["comptes:identique", "comptes:statut"]],
    ["liste-sessions-ouverte", ["auth:identique", "auth:statut"]],
    ["profil-200", ["profil:statut"]],
    ["sessions-distingue", ["sessions:identique"]],
  ];

  for (const [defaut, attendus] of CAS) {
    test(`défaut « ${defaut} » : seul le contrôle attendu échoue`, async () => {
      const factice = await demarrerFactice(defaut);
      try {
        expect(echecs(await controlerSite(factice.adresse))).toEqual([...attendus].sort());
      } finally {
        await factice.fermer();
      }
    });
  }

  test("redirection vers un autre hôte : non suivie, le statut échoue", async () => {
    const destination = await demarrerFactice();
    const factice = await demarrerFactice("accueil-redirige", destination.adresse);
    try {
      const resultats = await controlerSite(factice.adresse);

      expect(echecs(resultats)).toEqual(["accueil:nonce-scripts", "accueil:statut"]);
      expect(destination.requetes).toEqual([]);
    } finally {
      await factice.fermer();
      await destination.fermer();
    }
  });

  test("serveur injoignable : chaque contrôle échoue, sans exception", async () => {
    const factice = await demarrerFactice();
    await factice.fermer();

    const resultats = await controlerSite(factice.adresse);

    expect(resultats.length).toBeGreaterThan(10);
    expect(resultats.every((r) => !r.ok)).toBe(true);
    for (const page of [...PAGES, "tache", "auth", "comptes"]) {
      expect(echecs(resultats)).toContain(`${page}:statut`);
    }
  });

  test("les détails ne recopient aucune valeur reçue", async () => {
    const factice = await demarrerFactice("variable-dans-un-entete");
    try {
      const resultats = await controlerSite(factice.adresse);
      for (const r of resultats) expect(r.detail).not.toContain("BETTER_AUTH_SECRET");
    } finally {
      await factice.fermer();
    }
  });
});

// Décision du développeur sur la PR 2 de la 1.1 : les quatre POST de la page
// « inscription » sont acceptés s'ils partent sans corps, sans Origin, sans
// cookie et sans Authorization. Prouvé deux fois : sur ce que le serveur
// reçoit (corps lu en entier, en-têtes reçus), et sur la construction de la
// requête, qui refuse un POST porteur d'un cookie, d'un Authorization ou d'un
// corps (docs/features/inscription.md, section 2.3).
// 1.2 : cinq points d'entrée des comptes au lieu de trois (connexion et
// déconnexion), mêmes conditions (docs/features/connexion.md, section 10).
// 1.3 : sept, avec la demande et la réinitialisation, mêmes conditions
// (docs/features/mot-de-passe.md, section 2.2).
// 1.4 : quatorze, avec la double authentification, mêmes conditions
// (docs/features/double-authentification.md, section 13).
// 1.5 : dix-huit, avec le profil et les sessions, mêmes conditions
// (docs/features/profil-sessions.md, section 11).
// 1.6 : dix-neuf, avec la nouvelle authentification, mêmes conditions
// (docs/features/nouvelle-authentification.md, section 10) ; vingt POST avec
// le chemin inexistant.
test.describe("contrôle après déploiement, les vingt POST des comptes", () => {
  test("reçus par le serveur : aucun octet de corps, ni Origin, ni Cookie, ni Authorization, ni Content-Type", async () => {
    const factice = await demarrerFactice();
    try {
      await controlerSite(factice.adresse);
      const posts = factice.requetes.filter((r) => r.methode === "POST");

      expect(posts.map((r) => r.chemin.replace(/[0-9a-f]{16}$/, "<inexistant>"))).toEqual([
        ...POINTS_COMPTES,
        "/api/auth/<inexistant>",
      ]);
      for (const requete of posts) {
        expect(requete.corpsOctets, requete.chemin).toBe(0);
        expect(requete.entetes["content-length"] ?? "0", requete.chemin).toBe("0");
        expect(requete.entetes["transfer-encoding"], requete.chemin).toBeUndefined();
        for (const interdit of ["origin", "cookie", "authorization", "content-type", "referer"]) {
          expect(requete.entetes[interdit], `${requete.chemin} : ${interdit}`).toBeUndefined();
        }
      }
    } finally {
      await factice.fermer();
    }
  });

  test("construction : un POST sans corps ni en-tête d'authentification, et refusé autrement", () => {
    const post = optionsRequete({ methode: "POST" });

    expect(post.method).toBe("POST");
    expect(post.body).toBeUndefined();
    expect(post.credentials).toBe("omit");
    expect(post.redirect).toBe("manual");
    expect(Object.keys(post.headers).map((nom) => nom.toLowerCase())).toEqual(["accept"]);

    expect(() => optionsRequete({ methode: "POST", cookie: "a=b" })).toThrow();
    expect(() => optionsRequete({ methode: "POST", autorisation: "Bearer x" })).toThrow();
    expect(() => optionsRequete({ methode: "POST", corps: "{}" })).toThrow();
    expect(() => optionsRequete({ methode: "PUT" })).toThrow();
    // Témoin : le GET garde ses deux exceptions forgées.
    expect(optionsRequete({ methode: "GET", cookie: "a=b" }).headers).toMatchObject({
      cookie: "a=b",
    });
  });
});

test.describe("contrôle après déploiement, ligne de commande", () => {
  async function lancer(...args: string[]): Promise<{ code: number; sortie: string }> {
    try {
      const { stdout, stderr } = await executer(process.execPath, [SCRIPT, ...args]);
      return { code: 0, sortie: stdout + stderr };
    } catch (erreur) {
      const e = erreur as { code?: number; stdout?: string; stderr?: string };
      return { code: e.code ?? -1, sortie: (e.stdout ?? "") + (e.stderr ?? "") };
    }
  }

  test("code 0 sur un serveur conforme, 1 sur un défaut", async () => {
    const conforme = await demarrerFactice();
    const defaillant = await demarrerFactice("x-powered-by");
    try {
      const ok = await lancer(conforme.adresse);
      const ko = await lancer(defaillant.adresse);

      expect(ok.code, ok.sortie).toBe(0);
      expect(ko.code, ko.sortie).toBe(1);
      expect(ko.sortie).toContain("accueil:entetes");
    } finally {
      await conforme.fermer();
      await defaillant.fermer();
    }
  });

  test("sans --detail : aucune ligne de détail", async () => {
    const factice = await demarrerFactice("cookie-distingue");
    try {
      const { code, sortie } = await lancer(factice.adresse);
      const lignes = sortie.trimEnd().split("\n");

      expect(code, sortie).toBe(1);
      expect(lignes).toHaveLength(2 + (await controlerSite(factice.adresse)).length);
      expect(lignes[0]).toMatch(/^Contrôle de /);
      expect(lignes.at(-1)).toMatch(/^Bilan : /);
      for (const ligne of lignes.slice(1, -1)) expect(ligne).toMatch(/^(ok {5}|ÉCHEC {2})\S+ : /);
      expect(sortie).not.toContain("statuts :");
    } finally {
      await factice.fermer();
    }
  });

  test("--detail : statuts, longueurs, position et extraits, pour les seules comparaisons", async () => {
    const cookie = await demarrerFactice("cookie-distingue");
    const lien = await demarrerFactice("lien-distingue");
    const conforme = await demarrerFactice();
    try {
      const v = await lancer(cookie.adresse, "--detail");
      expect(v.code, v.sortie).toBe(1);
      const lignes = v.sortie.split("\n");
      const debut = lignes.findIndex((l) => l.startsWith("ÉCHEC  tableau-de-bord:identique"));
      const detail = lignes.slice(debut + 1, debut + 6).map((l) => l.trim());
      expect(detail[0]).toBe("statuts : sans cookie 404, cookie forgé 404");
      expect(detail[1]).toMatch(/^longueurs normalisées : sans cookie \d+, cookie forgé \d+$/);
      expect(detail[2]).toMatch(/^premier caractère différent : position \d+$/);
      expect(detail[3]).toMatch(/^sans cookie {2}\[\d+, \d+\[ : "/);
      expect(detail[3]).toContain("<body><script");
      expect(detail[4]).toMatch(/^cookie forgé \[\d+, \d+\[ : "/);
      expect(detail[4]).toContain("<body><main><h1>Cette page");
      // Trois comparaisons détaillées : 5 lignes, puis 3 pour les liens
      // identiques et 3 pour /compte (1.2, modifié) ; aucune autre ligne en
      // retrait.
      // 1.4 (modifié) : 14 lignes, la comparaison de la page de la double
      // authentification s'ajoute aux trois autres.
      // 1.5 (modifié) : 20 lignes, avec les comparaisons du profil et des
      // sessions.
      expect(lignes.filter((l) => /^ {9}\S/.test(l))).toHaveLength(20);

      const l = await lancer(lien.adresse, "--detail");
      expect(l.code, l.sortie).toBe(1);
      expect(l.sortie).toContain("statuts : premier jeton 404, second jeton 404");
      expect(l.sortie).toMatch(/^ {9}second jeton {2}\[\d+, \d+\[ : "/m);

      const c = await lancer(conforme.adresse, "--detail");
      expect(c.code, c.sortie).toBe(0);
      // 1.4 (modifié) : quatre comparaisons de documents, avec la page de la
      // double authentification.
      // 1.5 (modifié) : six, avec le profil et les sessions.
      expect(c.sortie.match(/documents normalisés identiques/g)).toHaveLength(6);
    } finally {
      await cookie.fermer();
      await lien.fermer();
      await conforme.fermer();
    }
  });

  test("--detail : aucun en-tête, aucun nonce, aucun contenu de script", async () => {
    const factice = await demarrerFactice("variable-dans-un-entete");
    try {
      const { sortie } = await lancer(factice.adresse, "--detail");

      expect(sortie).toContain("statuts :");
      for (const interdit of [
        "better_auth_secret",
        "x-indice",
        "content-security-policy",
        "nosniff",
        "max-age",
        "__next_f",
        "session_token",
      ]) {
        expect(sortie.toLowerCase()).not.toContain(interdit);
      }
      expect(sortie).not.toMatch(/nonce="(?!N")/);
    } finally {
      await factice.fermer();
    }
  });

  // Le secret forgé n'est jamais affiché, même avec --detail ; la page
  // « tache » n'a pas de lignes de détail.
  test("--detail : ni Authorization, ni Bearer, ni secret forgé dans la sortie", async () => {
    const factice = await demarrerFactice("tache-forge-distingue");
    try {
      const { code, sortie } = await lancer(factice.adresse, "--detail");
      const forges = factice.requetes
        .map((r) => r.entetes.authorization)
        .filter((v): v is string => v !== undefined)
        .map((v) => v.replace(/^Bearer /, ""));

      expect(code, sortie).toBe(1);
      expect(sortie).toContain("ÉCHEC  tache:identique");
      expect(sortie.toLowerCase()).not.toContain("bearer");
      expect(sortie.toLowerCase()).not.toContain("authorization");
      expect(forges).toHaveLength(1);
      for (const forge of forges) expect(sortie).not.toContain(forge);
      const lignes = sortie.split("\n");
      const indice = lignes.findIndex((l) => l.startsWith("ÉCHEC  tache:identique"));
      expect(lignes[indice + 1] ?? "").not.toMatch(/^ {9}\S/);
    } finally {
      await factice.fermer();
    }
  });

  test("adresse refusée : code 2, aucune requête", async () => {
    const factice = await demarrerFactice();
    const { host } = new URL(factice.adresse);
    try {
      for (const args of [
        [],
        ["http://exemple.test"],
        ["ftp://127.0.0.1"],
        [`${factice.adresse}/tableau-de-bord`],
        [`${factice.adresse}/?a=1`],
        [`http://moi:secret@${host}`],
        ["pas une adresse"],
      ]) {
        const { code, sortie } = await lancer(...args);
        expect(code, `${args.join(" ")} : ${sortie}`).toBe(2);
        expect(sortie).not.toContain("secret");
      }
      expect(factice.requetes).toEqual([]);
    } finally {
      await factice.fermer();
    }
  });
});

test.describe("contrôle après déploiement, cohérence et site construit", () => {
  test("valeurs attendues et document égaux à ceux des tests de bout en bout", () => {
    expect(POLITIQUE_ATTENDUE).toEqual(POLITIQUE_PRODUCTION);
    expect(ENTETES_ATTENDUS).toEqual(ENTETES_SECTION_6);
    for (const html of [
      '<html><head><script src="/a.js" nonce="QUJD+/=="></script></head><body></body></html>',
      '<body><script nonce="QUJD">self.__next_f.push([1,"/chemin"])</script><p>x</p></body>',
      ["<script>", "</script><SCRIPT type=x>y</SCRIPT>"].join("\n"),
    ]) {
      expect(documentDuScript(html)).toBe(documentServi(html));
    }
    expect(TEXTES_GABARIT).toEqual([
      TEXTES_SIMULATION.bandeauApplication,
      TEXTES_NAVIGATION.nom,
      TEXTES_NAVIGATION.organisationActive,
      TEXTES_NAVIGATION.entrees.tableauDeBord,
      ...Object.values(TEXTES_NAVIGATION.roles),
      TEXTES_COMPTE.deconnexion.bouton,
    ]);
  });

  test("comparerDocuments : position et 120 caractères autour, documents normalisés", () => {
    const commun = "x".repeat(200);
    const lignes = comparerDocuments(
      { statut: 404, corps: `${commun}A<script nonce="QUJD">charge</script>${"y".repeat(200)}` },
      { statut: 404, corps: `${commun}B${"y".repeat(200)}` },
      ["tableau-de-bord", "inexistante"],
    );

    expect(lignes).toEqual([
      "statuts : tableau-de-bord 404, inexistante 404",
      "longueurs normalisées : tableau-de-bord 428, inexistante 401",
      "premier caractère différent : position 200",
      `tableau-de-bord [140, 260[ : ${JSON.stringify(`${"x".repeat(60)}A<script nonce="N"></script>${"y".repeat(32)}`)}`,
      `inexistante     [140, 260[ : ${JSON.stringify(`${"x".repeat(60)}B${"y".repeat(59)}`)}`,
    ]);
    expect(
      comparerDocuments({ statut: 404, corps: "<p>" }, { statut: 404, corps: "<p>" }, [
        "tableau-de-bord",
        "inexistante",
      ]),
    ).toEqual([
      "statuts : tableau-de-bord 404, inexistante 404",
      "longueurs normalisées : tableau-de-bord 3, inexistante 3",
      "documents normalisés identiques",
    ]);
    expect(comparerDocuments(null, { statut: 404, corps: "" })).toEqual(["aucune réponse"]);
  });

  // Fin de balise reconnue sous toutes ses formes (alerte CodeQL « Bad HTML
  // filtering regexp ») : espace avant « > », majuscules, attribut. Sinon le
  // contenu du script, et ce qui le suit, échapperait au découpage.
  for (const [nom, decouper] of [
    ["script", documentDuScript],
    ["e2e/outils.ts", documentServi],
  ] as const) {
    test(`découpage (${nom}) : </script >, </SCRIPT> et </script foo="x"> reconnus`, () => {
      for (const fin of ["</script >", "</SCRIPT>", '</script foo="x">', "</script\n>"]) {
        const html = `<p>a</p><script nonce="QUJD">secret ${fin}<p>b</p><SCRIPT>autre</script>`;

        expect(decouper(html), fin).toBe(
          '<p>a</p><script nonce="N"></script><p>b</p><SCRIPT></script>',
        );
      }
    });
  }

  // next start répond comme Vercel : une adresse sans page reçoit la page
  // « introuvable » rendue sur le serveur (fiche, section 5, décision 10).
  // 1.2 (modifié, signalé) : les contrôles « inscription » deviennent
  // « comptes » ; en local, connexion et inscription sont ouvertes.
  // 1.1 (modifié, signalé) : en local, l'inscription est ouverte (elle n'est
  // fermée qu'en production, décision 1 de docs/features/inscription.md) ;
  // les deux contrôles « inscription » y échouent, et eux seuls. C'est le
  // témoin qu'ils voient une inscription ouverte ; la preuve qu'elle est
  // fermée en production vient du contrôle lancé après chaque déploiement.
  test("site construit en local : tous les contrôles passent, sauf l'inscription, ouverte hors production", async ({
    baseURL,
  }) => {
    const resultats = await controlerSite(baseURL ?? "");

    expect(echecs(resultats)).toEqual(["comptes:identique", "comptes:statut"]);
  });
});
