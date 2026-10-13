import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createServer, type IncomingHttpHeaders } from "node:http";
import type { AddressInfo } from "node:net";
import { promisify } from "node:util";

import { expect, test } from "@playwright/test";

import {
  controlerSite,
  documentServi as documentDuScript,
  ENTETES_ATTENDUS,
  POLITIQUE_ATTENDUE,
} from "../scripts/controle-deploiement.mjs";

import { documentServi, ENTETES_SECTION_6, POLITIQUE_PRODUCTION } from "./outils";

// Script de contrôle après déploiement (0.8), éprouvé contre un serveur
// factice local, puis contre le site construit en local. Jamais contre la
// production ni une prévisualisation. Fiche :
// docs/features/controle-deploiement.md, sections 1, 2 et 5.

const SCRIPT = "scripts/controle-deploiement.mjs";
const executer = promisify(execFile);

type Requete = { methode: string | undefined; chemin: string; entetes: IncomingHttpHeaders };

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
  | "tableau-de-bord-vide"
  | "pile"
  | "chemin-de-fichier"
  | "variable-dans-le-corps"
  | "variable-dans-un-entete";

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
    requetes.push({ methode: requete.method, chemin, entetes: requete.headers });

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

    const accueil = chemin === "/";
    const tableau = chemin === "/tableau-de-bord";
    if (defaut === "variable-dans-un-entete" && tableau) entetes["X-Indice"] = "BETTER_AUTH_SECRET";

    let charge = `0:{"c":["",${JSON.stringify(chemin)}]}`;
    if (defaut === "pile" && !accueil && !tableau) {
      charge += "\nError: refus\n    at lire (src/server/x.ts:12:7)";
    }
    if (defaut === "chemin-de-fichier" && tableau) charge += " /var/task/node_modules/next/x.js";
    if (defaut === "variable-dans-le-corps" && accueil) charge += " DATABASE_URL absente";

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
    if (tableau && defaut === "tableau-de-bord-vide") corps = "";
    reponse.writeHead(tableau && defaut === "tableau-de-bord-200" ? 200 : 404, entetes);
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

const PAGES = ["accueil", "tableau-de-bord", "inexistante"] as const;
const surToutes = (controle: string) => PAGES.map((p) => `${p}:${controle}`);

test.describe("contrôle après déploiement, serveur factice", () => {
  test("serveur conforme : tout passe, et seulement des GET sans cookie ni authentification", async () => {
    const factice = await demarrerFactice();
    try {
      const premier = await controlerSite(factice.adresse);
      const second = await controlerSite(factice.adresse);

      expect(echecs(premier)).toEqual([]);
      expect(echecs(second)).toEqual([]);
      expect(premier.length).toBeGreaterThan(10);

      expect(factice.requetes).toHaveLength(8);
      for (const requete of factice.requetes) {
        expect(requete.methode).toBe("GET");
        expect(requete.entetes.cookie).toBeUndefined();
        expect(requete.entetes.authorization).toBeUndefined();
        expect(requete.entetes["content-length"]).toBeUndefined();
      }
      const chemins = factice.requetes.map((r) => r.chemin);
      const inexistantes = chemins.filter((c) => /^\/adresse-inexistante-[0-9a-f]{16}$/.test(c));
      expect(chemins.filter((c) => c === "/")).toHaveLength(4);
      expect(chemins.filter((c) => c === "/tableau-de-bord")).toHaveLength(2);
      expect(inexistantes).toHaveLength(2);
      expect(inexistantes[0]).not.toBe(inexistantes[1]);
    } finally {
      await factice.fermer();
    }
  });

  const CAS: readonly [Defaut, string[]][] = [
    ["x-powered-by", surToutes("entetes")],
    ["sans-hsts", surToutes("entetes")],
    ["hsts-sans-sous-domaines", surToutes("entetes")],
    ["unsafe-inline", surToutes("politique")],
    [
      "sans-nonce",
      [...surToutes("politique"), ...surToutes("nonce-scripts"), "accueil:nonce-neuf"],
    ],
    ["nonces-differents", surToutes("politique")],
    ["directive-manquante", surToutes("politique")],
    ["nonce-fixe", ["accueil:nonce-neuf"]],
    ["script-sans-nonce", surToutes("nonce-scripts")],
    ["accueil-500", ["accueil:statut"]],
    ["tableau-de-bord-200", ["tableau-de-bord:identique", "tableau-de-bord:statut"]],
    ["introuvable-en-anglais", ["inexistante:anglais", "tableau-de-bord:anglais"]],
    ["tableau-de-bord-vide", ["tableau-de-bord:identique"]],
    ["pile", ["inexistante:fuite"]],
    ["chemin-de-fichier", ["tableau-de-bord:fuite"]],
    ["variable-dans-le-corps", ["accueil:fuite"]],
    ["variable-dans-un-entete", ["tableau-de-bord:fuite"]],
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
    for (const page of PAGES) {
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
  });

  // Toute page introuvable passe par notFound() (fiche, section 5, décision 5).
  test("site construit en local : tous les contrôles passent", async ({ baseURL }) => {
    const resultats = await controlerSite(baseURL ?? "");

    expect(echecs(resultats)).toEqual([]);
  });
});
