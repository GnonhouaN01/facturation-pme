import { ESLint } from "eslint";
import { describe, expect, test } from "vitest";

// Règle ESLint T de la 0.7, vérifiée par l'API d'ESLint sur du code fourni en
// texte : aucun fichier n'est écrit. Les chemins désignent des fichiers
// fictifs, auxquels eslint.config.mjs s'applique comme aux vrais. Les messages
// de la règle citent sa lettre (« règle T »), comme ceux des règles O à R.
// Fiche : docs/features/envoi-emails.md, section 1.2.

const eslint = new ESLint();

async function refusT(code: string, fichier: string): Promise<string[]> {
  const [resultat] = await eslint.lintText(code, { filePath: fichier });
  if (!resultat) throw new Error("ESLint n'a renvoyé aucun résultat.");
  const fatales = resultat.messages.filter((message) => message.fatal);
  expect(fatales, "code de test illisible par ESLint").toEqual([]);
  return resultat.messages
    .filter((message) => message.severity === 2 && message.message.includes("règle T"))
    .map((message) => message.message);
}

const PORTE = "src/server/email/envoi.ts";
const MODELES = "src/server/email/modeles.ts";
const SMTP = "src/server/modules/email/smtp.ts";
const MEMOIRE = "src/server/modules/email/memoire.ts";
const ACTION = "src/server/actions/action.ts";
const SERVICE = "src/server/services/essai.ts";
const CONFIG_AUTH = "src/server/auth/config.ts";
// 1.1 : les rappels d'envoi de Better Auth (docs/features/inscription.md,
// section 4.2).
const EMAILS_AUTH = "src/server/auth/emails.ts";
const PAGE = "src/app/essai/page.tsx";
const ENV_SCHEMA = "src/server/env-schema.ts";

describe("règle T : nodemailer seulement dans modules/email/smtp.ts", { timeout: 60_000 }, () => {
  const IMPORT = `import nodemailer from "nodemailer";\nexport const n = nodemailer;\n`;
  const NOMME = `import { createTransport } from "nodemailer";\nexport const c = createTransport;\n`;
  const SOUS_CHEMIN = `import Mailer from "nodemailer/lib/mailer";\nexport const m = Mailer;\n`;
  const DYNAMIQUE = `export const charger = () => import("nodemailer");\n`;
  const DYNAMIQUE_GABARIT = "export const charger = () => import(`nodemailer`);\n";
  const REQUIRE = `export const n = require("nodemailer");\n`;
  const REEXPORT = `export { createTransport } from "nodemailer";\n`;

  test.each([
    ["porte d'envoi", IMPORT, PORTE],
    ["autre transport", NOMME, MEMOIRE],
    ["service", IMPORT, SERVICE],
    ["page", IMPORT, PAGE],
    ["sous-chemin", SOUS_CHEMIN, PORTE],
    ["chargement dynamique", DYNAMIQUE, PORTE],
    ["chargement dynamique par gabarit", DYNAMIQUE_GABARIT, SERVICE],
    ["require", REQUIRE, SERVICE],
    ["réexportation", REEXPORT, MODELES],
  ])("%s : refusé", async (_nom, code, fichier) => {
    expect(await refusT(code, fichier)).not.toEqual([]);
  });

  test.each([
    ["modules/email/smtp.ts", IMPORT, SMTP],
    ["modules/email/smtp.ts, import nommé", NOMME, SMTP],
    ["test de smtp.ts", IMPORT, "src/server/modules/email/smtp.test.ts"],
  ])("%s : autorisé", async (_nom, code, fichier) => {
    expect(await refusT(code, fichier)).toEqual([]);
  });
});

describe(
  "règle T : modules/email seulement depuis email/envoi.ts, le dossier lui-même et les tests",
  { timeout: 60_000 },
  () => {
    const ALIAS = `import { creerTransportMemoire } from "@/server/modules/email/memoire";\nexport const t = creerTransportMemoire;\n`;
    const SMTP_ALIAS = `import { creerTransportSmtp } from "@/server/modules/email/smtp";\nexport const t = creerTransportSmtp;\n`;
    const RELATIF_PORTE = `import { creerTransportFichier } from "../modules/email/fichier";\nexport const t = creerTransportFichier;\n`;
    const RELATIF_SERVICES = `import { creerTransportMemoire } from "../modules/email/memoire";\nexport const t = creerTransportMemoire;\n`;
    const INTERNE = `import type { Transport } from "./transport";\nexport type T = Transport;\n`;
    const DYNAMIQUE = `export const charger = () => import("@/server/modules/email/smtp");\n`;

    test.each([
      ["service, par l'alias", ALIAS, SERVICE],
      ["service, par un chemin relatif", RELATIF_SERVICES, SERVICE],
      ["chaîne de contrôles", SMTP_ALIAS, ACTION],
      ["configuration de Better Auth", ALIAS, CONFIG_AUTH],
      ["modèles", RELATIF_PORTE, MODELES],
      ["page", ALIAS, PAGE],
      ["chargement dynamique depuis un service", DYNAMIQUE, SERVICE],
    ])("%s : refusé", async (_nom, code, fichier) => {
      expect(await refusT(code, fichier)).not.toEqual([]);
    });

    test.each([
      ["email/envoi.ts, par un chemin relatif", RELATIF_PORTE, PORTE],
      ["email/envoi.ts, par l'alias", SMTP_ALIAS, PORTE],
      ["fichier du dossier, import interne", INTERNE, SMTP],
      ["test de la porte", ALIAS, "src/server/email/envoi.test.ts"],
      ["test d'intégration de db/", ALIAS, "src/server/db/essai.integration.test.ts"],
      ["outillage de test de db/", ALIAS, "src/server/db/outils-test/email.ts"],
    ])("%s : autorisé", async (_nom, code, fichier) => {
      expect(await refusT(code, fichier)).toEqual([]);
    });
  },
);

describe(
  "règle T : envoyerEmail seulement dans actions/action.ts et les tests",
  { timeout: 60_000 },
  () => {
    const ALIAS = `import { envoyerEmail } from "@/server/email/envoi";\nexport const e = envoyerEmail;\n`;
    const RELATIF_ACTION = `import { envoyerEmail, validerDemande } from "../email/envoi";\nexport const e = [envoyerEmail, validerDemande];\n`;
    const RENOMME = `import { envoyerEmail as envoyer } from "../email/envoi";\nexport const e = envoyer;\n`;
    const ESPACE = `import * as envoi from "@/server/email/envoi";\nexport const e = envoi;\n`;
    const REEXPORT = `export { envoyerEmail } from "@/server/email/envoi";\n`;
    const TYPES = `import type { DemandeEmail, ResultatEnvoi } from "@/server/email/envoi";\nexport type D = [DemandeEmail, ResultatEnvoi];\n`;

    test.each([
      ["service", ALIAS, SERVICE],
      ["service, renommé", RENOMME, SERVICE],
      ["service, espace de noms", ESPACE, SERVICE],
      ["réexportation depuis un service", REEXPORT, SERVICE],
      ["page", ALIAS, PAGE],
      ["configuration de Better Auth, avant la 1.1", ALIAS, CONFIG_AUTH],
      ["autre fichier de actions/", RELATIF_ACTION, "src/server/actions/exposer.ts"],
      ["autre fichier de auth/ (session)", ALIAS, "src/server/auth/session.ts"],
      ["autre fichier de auth/ (points d'entrée)", ALIAS, "src/server/auth/points-entree.ts"],
      ["page de l'inscription", ALIAS, "src/app/(public)/inscription/page.tsx"],
    ])("%s : refusé", async (_nom, code, fichier) => {
      expect(await refusT(code, fichier)).not.toEqual([]);
    });

    test.each([
      ["actions/action.ts", RELATIF_ACTION, ACTION],
      ["auth/emails.ts, rappels de Better Auth (1.1)", ALIAS, EMAILS_AUTH],
      ["auth/emails.ts, chemin relatif (1.1)", RELATIF_ACTION, EMAILS_AUTH],
      ["test de actions/", RELATIF_ACTION, "src/server/actions/action-email.test.ts"],
      ["test d'intégration de db/", ALIAS, "src/server/db/chaine-email.integration.test.ts"],
      ["types seulement, depuis un service", TYPES, SERVICE],
    ])("%s : autorisé", async (_nom, code, fichier) => {
      expect(await refusT(code, fichier)).toEqual([]);
    });
  },
);

describe(
  "règle T : « smtp.gmail.com » seulement dans smtp.ts et les tests",
  { timeout: 60_000 },
  () => {
    const LITTERAL = `export const hote = "smtp.gmail.com";\n`;
    const GABARIT = "export const hote = `smtp.gmail.com`;\n";

    test.each([
      ["porte d'envoi", LITTERAL, PORTE],
      ["schéma de configuration", LITTERAL, ENV_SCHEMA],
      ["service, gabarit", GABARIT, SERVICE],
    ])("%s : refusé", async (_nom, code, fichier) => {
      expect(await refusT(code, fichier)).not.toEqual([]);
    });

    test.each([
      ["modules/email/smtp.ts", LITTERAL, SMTP],
      ["test de smtp.ts", LITTERAL, "src/server/modules/email/smtp.test.ts"],
    ])("%s : autorisé", async (_nom, code, fichier) => {
      expect(await refusT(code, fichier)).toEqual([]);
    });
  },
);
