import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import type { MessageEmail, Transport } from "../modules/email/transport";

import { schemaAdresse } from "./adresse";
import { creerPorteEmail, DemandeEmailInvalide } from "./envoi";

// Les trois formes des avis de nodemailer ≤ 10.1.3 sur addressparser
// (GHSA-8c8m-p3m8-cjg8, GHSA-m943-m63m-w62w, GHSA-85x2-q946-cp5h) : un
// destinataire ajouté ou un domaine détourné par une adresse habilement
// formée. Notre validation (schemaAdresse, dans envoyerEmail) les refuse
// avant tout transport : nodemailer ne les voit jamais. nodemailer 10.2.1
// corrige les avis ; ce test garde la défense de notre côté.
// Fiche : docs/features/envoi-emails.md, section 3.1.

vi.mock("../env", () => ({
  env: {
    DATABASE_URL: "postgresql://app_facturation:factice@localhost:5432/factice",
    BETTER_AUTH_SECRET: "secret-factice-de-trente-deux-caracteres",
    BETTER_AUTH_URL: "https://facturation.exemple.invalid",
  },
  configurationEmail: {
    transport: "memoire",
    dossier: null,
    destinatairesAutorises: [],
    estProduction: false,
  },
}));

const ATTAQUES: readonly [string, string][] = [
  // Un commentaire imbriqué fermé trop tôt : la suite du commentaire
  // devenait un destinataire (GHSA-8c8m-p3m8-cjg8).
  ["commentaire imbriqué", "victime@exemple.invalid (a (b) attaquant@pirate.invalid)"],
  ["commentaire imbriqué, adresse seule", "victime(x(y)attaquant@pirate.invalid)@exemple.invalid"],
  // Un « ; » dans une chaîne entre guillemets fermait le groupe : le texte
  // affiché devenait un destinataire (GHSA-m943-m63m-w62w).
  ["« ; » entre guillemets", '"Nom; attaquant@pirate.invalid" <victime@exemple.invalid>'],
  ["« ; » dans un groupe", 'equipe: "a;attaquant@pirate.invalid" victime@exemple.invalid;'],
  ["« ; » dans une partie locale entre guillemets", '"a;attaquant@pirate.invalid"@exemple.invalid'],
  // Un « > » dans une partie locale entre guillemets fermait l'angle-addr :
  // remise à un domaine que l'en-tête ne nomme pas (GHSA-85x2-q946-cp5h).
  ["« > » dans une partie locale entre guillemets", '<"victime>"@pirate.invalid>'],
  ["« > » entre guillemets, puis domaine attendu", '"a>b@pirate.invalid"@exemple.invalid'],
];

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("adresses des avis de nodemailer : refusées avant tout envoi", () => {
  test.each(ATTAQUES)("%s : schemaAdresse refuse", (_nom, adresse) => {
    expect(schemaAdresse.safeParse(adresse).success).toBe(false);
  });

  test.each(ATTAQUES)(
    "%s : envoyerEmail lève DemandeEmailInvalide, le transport n'est jamais appelé",
    async (_nom, adresse) => {
      const envois: MessageEmail[] = [];
      const transport: Transport = {
        remettre: vi.fn(async (message: MessageEmail) => {
          envois.push(message);
        }),
      };
      // Production : aucune liste de destinataires autorisés, seule la
      // validation de l'adresse peut refuser.
      const { envoyerEmail } = creerPorteEmail({
        transport,
        expediteur: "application@exemple.invalid",
        estProduction: true,
        destinatairesAutorises: [],
        origine: "https://facturation.exemple.invalid",
      });

      await expect(
        envoyerEmail({ modele: "essai.verification_envoi", destinataire: adresse, parametres: {} }),
      ).rejects.toBeInstanceOf(DemandeEmailInvalide);
      expect(transport.remettre).not.toHaveBeenCalled();
      expect(envois).toEqual([]);
    },
  );

  test("témoin : une adresse simple passe la validation et atteint le transport", async () => {
    expect(schemaAdresse.safeParse("victime@exemple.invalid").success).toBe(true);
    const transport: Transport = { remettre: vi.fn(async () => undefined) };
    const { envoyerEmail } = creerPorteEmail({
      transport,
      expediteur: "application@exemple.invalid",
      estProduction: true,
      destinatairesAutorises: [],
      origine: "https://facturation.exemple.invalid",
    });
    expect(
      await envoyerEmail({
        modele: "essai.verification_envoi",
        destinataire: "victime@exemple.invalid",
        parametres: {},
      }),
    ).toStrictEqual({ envoye: true });
    expect(transport.remettre).toHaveBeenCalledTimes(1);
  });
});
