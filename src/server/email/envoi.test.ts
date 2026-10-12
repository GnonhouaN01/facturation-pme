import { inspect } from "node:util";

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { TEXTES_EMAILS } from "@/textes/emails";

import { creerTransportMemoire } from "../modules/email/memoire";
import { EchecTransport, type MessageEmail, type Transport } from "../modules/email/transport";

import { creerPorteEmail, DemandeEmailInvalide, validerDemande } from "./envoi";

// La porte d'envoi, sans réseau : transport en mémoire. Fiche :
// docs/features/envoi-emails.md, sections 1, 2.1 et 6.3.

// Chargement de envoi.ts : l'instance liée à la configuration lit env.ts.
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

const EXPEDITEUR = "application@exemple.invalid";
const ORIGINE = "https://facturation.exemple.invalid";
const AUTORISEE = "autorisee@exemple.invalid";
const AUTRE = "inconnue-de-la-liste@exemple.invalid";
const MODELE = "essai.verification_envoi" as const;

function demande(destinataire = AUTORISEE) {
  return { modele: MODELE, destinataire, parametres: {} };
}

function porte(options: { estProduction?: boolean; transport?: Transport } = {}) {
  const memoire = creerTransportMemoire();
  const { envoyerEmail } = creerPorteEmail({
    transport: options.transport ?? memoire,
    expediteur: EXPEDITEUR,
    estProduction: options.estProduction ?? false,
    destinatairesAutorises: [AUTORISEE],
    origine: ORIGINE,
  });
  return { envoyerEmail, memoire };
}

let espionErreur: ReturnType<typeof vi.spyOn>;
let espionLog: ReturnType<typeof vi.spyOn>;
let espionAvertissement: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  espionErreur = vi.spyOn(console, "error").mockImplementation(() => undefined);
  espionLog = vi.spyOn(console, "log").mockImplementation(() => undefined);
  espionAvertissement = vi.spyOn(console, "warn").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

function journaux(): string {
  return inspect([espionErreur.mock.calls, espionLog.mock.calls, espionAvertissement.mock.calls], {
    depth: Infinity,
  });
}

describe("demande valide", () => {
  test("un message dans la boîte : expéditeur de la configuration, un seul destinataire", async () => {
    const { envoyerEmail, memoire } = porte();

    const resultat = await envoyerEmail(demande());

    expect(resultat).toStrictEqual({ envoye: true });
    expect(memoire.messages).toHaveLength(1);
    const [message] = memoire.messages as MessageEmail[];
    expect(message).toStrictEqual({
      de: EXPEDITEUR,
      nomExpediteur: TEXTES_EMAILS.expediteur,
      a: AUTORISEE,
      sujet: TEXTES_EMAILS.modeles[MODELE].sujet,
      corps: expect.any(String),
    });
  });

  test("l'adresse remise au transport est normalisée (domaine en minuscules)", async () => {
    const { envoyerEmail, memoire } = porte({ estProduction: true });

    await envoyerEmail(demande("  Client@Exemple.INVALID "));

    expect(memoire.messages[0]?.a).toBe("Client@exemple.invalid");
  });
});

describe("demande invalide : DemandeEmailInvalide, rien ne part", () => {
  test.each([
    ["clé cc", { ...demande(), cc: "x@exemple.invalid" }],
    ["clé bcc", { ...demande(), bcc: "x@exemple.invalid" }],
    ["clé replyTo", { ...demande(), replyTo: "x@exemple.invalid" }],
    ["clé from", { ...demande(), from: "x@exemple.invalid" }],
    ["clé headers", { ...demande(), headers: { Bcc: "x@exemple.invalid" } }],
    ["clé attachments", { ...demande(), attachments: [] }],
    ["clé sujet", { ...demande(), sujet: "Autre sujet" }],
    ["modèle inconnu", { ...demande(), modele: "inconnu.modele" }],
    ["modèle hérité", { ...demande(), modele: "constructor" }],
    ["adresse avec CRLF", demande(`${AUTORISEE}\r\nBcc: x@exemple.invalid`)],
    ["deux adresses", demande(`${AUTORISEE},${AUTRE}`)],
    ["paramètre inconnu", { ...demande(), parametres: { lien: "https://attaquant.invalid" } }],
    ["paramètres absents", { modele: MODELE, destinataire: AUTORISEE }],
  ])("%s", async (_nom, valeur) => {
    const { envoyerEmail, memoire } = porte({ estProduction: true });

    await expect(envoyerEmail(valeur as never)).rejects.toBeInstanceOf(DemandeEmailInvalide);
    expect(memoire.messages).toEqual([]);
  });

  test("message fixe, sans valeur reçue ni cause", () => {
    const piege = `piege-${"x".repeat(8)}@exemple.invalid\r\n`;
    let erreur: unknown;
    try {
      validerDemande(demande(piege));
    } catch (e) {
      erreur = e;
    }

    expect(erreur).toBeInstanceOf(DemandeEmailInvalide);
    expect((erreur as Error).cause).toBeUndefined();
    expect(inspect(erreur, { depth: Infinity })).not.toContain("piege-");
  });

  test("validerDemande renvoie la demande normalisée, sans clé ajoutée", () => {
    expect(validerDemande(demande(" Client@Exemple.INVALID"))).toStrictEqual({
      modele: MODELE,
      destinataire: "Client@exemple.invalid",
      parametres: {},
    });
  });
});

describe("liste autorisée : invariant central (section 2.1)", () => {
  test("hors production, destinataire hors liste : non_autorise, boîte vide", async () => {
    const { envoyerEmail, memoire } = porte({ estProduction: false });

    const resultat = await envoyerEmail(demande(AUTRE));

    expect(resultat).toStrictEqual({ envoye: false, raison: "non_autorise" });
    expect(memoire.messages).toEqual([]);
  });

  test("hors production, la comparaison ignore la casse du domaine seulement", async () => {
    const { envoyerEmail, memoire } = porte({ estProduction: false });

    expect(await envoyerEmail(demande("autorisee@EXEMPLE.invalid"))).toStrictEqual({
      envoye: true,
    });
    expect(await envoyerEmail(demande("autorisee+x@exemple.invalid"))).toStrictEqual({
      envoye: false,
      raison: "non_autorise",
    });
    expect(memoire.messages).toHaveLength(1);
  });

  test("en production, la liste est ignorée", async () => {
    const { envoyerEmail, memoire } = porte({ estProduction: true });

    expect(await envoyerEmail(demande(AUTRE))).toStrictEqual({ envoye: true });
    expect(memoire.messages).toHaveLength(1);
  });

  test("hors production, liste vide : tout est refusé", async () => {
    const memoire = creerTransportMemoire();
    const { envoyerEmail } = creerPorteEmail({
      transport: memoire,
      expediteur: EXPEDITEUR,
      estProduction: false,
      destinatairesAutorises: [],
      origine: ORIGINE,
    });

    expect(await envoyerEmail(demande())).toStrictEqual({ envoye: false, raison: "non_autorise" });
    expect(memoire.messages).toEqual([]);
  });
});

describe("échecs du transport : raison fermée, rien de l'erreur au journal (section 6.3)", () => {
  function transportQuiLeve(erreur: unknown): Transport {
    return {
      remettre: async () => {
        throw erreur;
      },
    };
  }

  test("erreur quelconque dont le message cite l'adresse : indisponible", async () => {
    const erreur = new Error(`550 5.1.1 <${AUTORISEE}> mot-de-passe-factice`);
    const { envoyerEmail } = porte({ transport: transportQuiLeve(erreur) });

    const resultat = await envoyerEmail(demande());

    expect(resultat).toStrictEqual({ envoye: false, raison: "indisponible" });
    const texte = journaux();
    expect(texte).not.toContain(AUTORISEE);
    expect(texte).not.toContain("550 5.1.1");
    expect(texte).not.toContain("mot-de-passe-factice");
  });

  test.each([
    ["indisponible", 421, "ETIMEDOUT"],
    ["refuse_par_serveur", 550, "EENVELOPE"],
  ] as const)("EchecTransport %s : raison reprise", async (raison, responseCode, code) => {
    const erreur = new EchecTransport({ raison, code, responseCode });
    const { envoyerEmail } = porte({ transport: transportQuiLeve(erreur) });

    expect(await envoyerEmail(demande())).toStrictEqual({ envoye: false, raison });
  });

  test("le journal technique reçoit le modèle, la raison, le code et un incident, rien d'autre", async () => {
    const erreur = new EchecTransport({ raison: "indisponible", code: "EAUTH", responseCode: 535 });
    const { envoyerEmail } = porte({ transport: transportQuiLeve(erreur) });

    await envoyerEmail(demande());

    expect(espionErreur).toHaveBeenCalledTimes(1);
    const texte = journaux();
    expect(texte).toContain(MODELE);
    expect(texte).toContain("EAUTH");
    expect(texte).toContain("535");
    expect(texte).toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/u);
    expect(texte).not.toContain(AUTORISEE);
    expect(texte).not.toContain(TEXTES_EMAILS.modeles[MODELE].sujet);
  });

  test("une valeur levée qui n'est pas une erreur : indisponible, journal sans elle", async () => {
    const { envoyerEmail } = porte({ transport: transportQuiLeve(`texte-${AUTORISEE}`) });

    expect(await envoyerEmail(demande())).toStrictEqual({ envoye: false, raison: "indisponible" });
    expect(journaux()).not.toContain(AUTORISEE);
  });

  test("un envoi réussi n'écrit rien au journal technique", async () => {
    const { envoyerEmail } = porte();

    await envoyerEmail(demande());

    expect(espionErreur).not.toHaveBeenCalled();
    expect(espionLog).not.toHaveBeenCalled();
    expect(espionAvertissement).not.toHaveBeenCalled();
  });
});
