import { randomUUID } from "node:crypto";
import { inspect } from "node:util";

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { z } from "zod";

import type { TransactionOrganisation } from "../db/client";
import type { NomLimite } from "../debit/limites";
import type { DemandeEmail, ResultatEnvoi } from "../email/envoi";
import type { ModeleEmail } from "../email/modeles";

import {
  creerChaine,
  declarerAction,
  type AdhesionLue,
  type DependancesChaine,
  type SessionLue,
} from "./action";

// Les emails d'une action : demandés par ctx.preparerEmail dans la
// transaction, envoyés après sa validation, limites vérifiées à ce moment-là.
// Sans base ni réseau. Fiche : docs/features/envoi-emails.md, sections 5.2,
// 5.3 et 6.2 (décision 2, option A).

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

const ORIGINE = "https://facturation.exemple.invalid";
const MODELE = "essai.verification_envoi" as const;
const DESTINATAIRE = "Jean.Dupont+factures@Gmail.com";
const DESTINATAIRE_COMPTE = "jeandupont@gmail.com";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;

const tx = { transactionFactice: true } as unknown as TransactionOrganisation;
const SCHEMA_VIDE = z.strictObject({});

type Etat = {
  session: SessionLue;
  adhesion: AdhesionLue;
  // Réponse de verifierDebit par limite : vrai sous la limite, ou une erreur.
  debit: Partial<Record<NomLimite, boolean | Error>>;
  envoi: ResultatEnvoi | Error;
};

let etat: Etat;
let etapes: string[];
let espionErreur: ReturnType<typeof vi.spyOn>;

function dependances() {
  const verifierDebit = vi.fn<DependancesChaine["verifierDebit"]>(async (nom, valeur) => {
    etapes.push(`debit:${nom}:${valeur}`);
    const reponse = etat.debit[nom] ?? true;
    if (reponse instanceof Error) throw reponse;
    return reponse;
  });
  const envoyerEmail = vi.fn<DependancesChaine["envoyerEmail"]>(async (demande) => {
    etapes.push(`envoi:${demande.destinataire}`);
    if (etat.envoi instanceof Error) throw etat.envoi;
    return etat.envoi;
  });
  const deps: DependancesChaine = {
    origineAttendue: ORIGINE,
    lireSession: async () => etat.session,
    executerDansOrganisation: (async <T>(
      _organisationId: string,
      travail: (t: TransactionOrganisation) => Promise<T>,
    ) => {
      etapes.push("transaction");
      try {
        const resultat = await travail(tx);
        etapes.push("validation");
        return resultat;
      } catch (erreur) {
        etapes.push("annulation");
        throw erreur;
      }
    }) as DependancesChaine["executerDansOrganisation"],
    lireAdhesion: async () => etat.adhesion,
    journaliser: async () => {
      etapes.push("journal");
    },
    verifierDebit,
    envoyerEmail,
  };
  return { deps, verifierDebit, envoyerEmail };
}

function requete() {
  return { entetes: new Headers({ origin: ORIGINE }) };
}

// Action qui demande un email par destinataire donné, puis éventuellement
// échoue. Le destinataire vient de la fermeture, jamais de l'entrée.
function action(
  destinataires: string[],
  options: { emails?: readonly ModeleEmail[]; echouer?: boolean; modele?: string } = {},
) {
  return declarerAction({
    nom: "demo.email",
    droit: "organisation.membres.voir",
    entree: SCHEMA_VIDE,
    journal: null,
    nouvelleAuthentification: false,
    debit: null,
    emails: options.emails ?? [MODELE],
    executer: async (ctx) => {
      for (const destinataire of destinataires) {
        ctx.preparerEmail({
          modele: (options.modele ?? MODELE) as typeof MODELE,
          destinataire,
          parametres: {},
        });
        etapes.push("preparation");
      }
      etapes.push("service");
      if (options.echouer) throw new Error(`échec du service pour ${DESTINATAIRE}`);
      return "fait";
    },
  });
}

beforeEach(() => {
  etapes = [];
  etat = {
    session: {
      utilisateurId: randomUUID(),
      sessionId: "5a1d2c3b-4e5f-4a6b-8c7d-9e0f1a2b3c4d",
      organisationActiveId: randomUUID(),
      doubleAuthentification: true,
    },
    adhesion: { membreId: randomUUID(), role: "proprietaire" },
    debit: {},
    envoi: { envoye: true },
  };
  espionErreur = vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("ordre : envoi après la validation, jamais avant", () => {
  test("préparation dans la transaction, limites puis envoi après la validation", async () => {
    const { deps } = dependances();
    const organisationId = etat.session.organisationActiveId as string;

    const resultat = await creerChaine(deps).executerChaine(action([DESTINATAIRE]), requete(), {});

    expect(resultat).toStrictEqual({
      ok: true,
      donnees: "fait",
      emails: { envoyes: 1, nonEnvoyes: 0 },
    });
    expect(etapes).toEqual([
      "transaction",
      "preparation",
      "service",
      "validation",
      `debit:email.destinataire:${DESTINATAIRE_COMPTE}`,
      `debit:email.destinataire_jour:${DESTINATAIRE_COMPTE}`,
      `debit:email.organisation:${organisationId}`,
      "debit:email.application:gmail",
      "envoi:Jean.Dupont+factures@gmail.com",
    ]);
  });

  test("l'adresse envoyée est celle saisie, normalisée ; seul le compteur la réduit", async () => {
    const { deps, envoyerEmail } = dependances();

    await creerChaine(deps).executerChaine(action([DESTINATAIRE]), requete(), {});

    expect(envoyerEmail).toHaveBeenCalledWith({
      modele: MODELE,
      destinataire: "Jean.Dupont+factures@gmail.com",
      parametres: {},
    } satisfies DemandeEmail);
  });

  test("transaction annulée : rien d'envoyé, verifierDebit non appelée", async () => {
    const { deps, verifierDebit, envoyerEmail } = dependances();

    const resultat = await creerChaine(deps).executerChaine(
      action([DESTINATAIRE], { echouer: true }),
      requete(),
      {},
    );

    expect(resultat).toMatchObject({ ok: false, raison: "erreur" });
    // Le service a bien préparé l'email avant d'échouer : c'est son échec,
    // pas une préparation impossible, qui annule.
    expect(etapes).toEqual(["transaction", "preparation", "service", "annulation"]);
    expect(verifierDebit).not.toHaveBeenCalled();
    expect(envoyerEmail).not.toHaveBeenCalled();
  });

  test("refus à l'étape 6 : rien d'envoyé", async () => {
    etat.adhesion = { membreId: randomUUID(), role: "lecteur" };
    const { deps, envoyerEmail, verifierDebit } = dependances();

    const resultat = await creerChaine(deps).executerChaine(
      declarerAction({
        nom: "demo.email_reserve",
        droit: "organisation.supprimer",
        entree: SCHEMA_VIDE,
        journal: null,
        nouvelleAuthentification: false,
        debit: null,
        emails: [MODELE],
        executer: async (ctx) => {
          ctx.preparerEmail({ modele: MODELE, destinataire: DESTINATAIRE, parametres: {} });
          return "fait";
        },
      }),
      requete(),
      {},
    );

    expect(resultat).toStrictEqual({ ok: false, raison: "refuse" });
    expect(envoyerEmail).not.toHaveBeenCalled();
    expect(verifierDebit).not.toHaveBeenCalled();
  });

  test("plusieurs emails : chacun ses limites, dans l'ordre de préparation", async () => {
    const { deps, envoyerEmail } = dependances();

    const resultat = await creerChaine(deps).executerChaine(
      action(["a@exemple.invalid", "b@exemple.invalid"]),
      requete(),
      {},
    );

    expect(resultat).toMatchObject({ ok: true, emails: { envoyes: 2, nonEnvoyes: 0 } });
    expect(envoyerEmail.mock.calls.map(([d]) => d.destinataire)).toEqual([
      "a@exemple.invalid",
      "b@exemple.invalid",
    ]);
  });
});

describe("limites (T-40) : un refus arrête la vérification et l'envoi de cet email", () => {
  test.each([
    ["email.destinataire", 1],
    ["email.destinataire_jour", 2],
    ["email.organisation", 3],
    ["email.application", 4],
  ] as const)("%s refuse : les suivantes non appelées, email non envoyé", async (nom, appels) => {
    etat.debit = { [nom]: false };
    const { deps, verifierDebit, envoyerEmail } = dependances();

    const resultat = await creerChaine(deps).executerChaine(action([DESTINATAIRE]), requete(), {});

    expect(resultat).toStrictEqual({
      ok: true,
      donnees: "fait",
      emails: { envoyes: 0, nonEnvoyes: 1 },
    });
    expect(verifierDebit).toHaveBeenCalledTimes(appels);
    expect(envoyerEmail).not.toHaveBeenCalled();
  });

  test("compteur indisponible après la validation : fermé par défaut, action faite, journal sans adresse", async () => {
    etat.debit = { "email.organisation": new Error(`base perdue ${DESTINATAIRE}`) };
    const { deps, envoyerEmail } = dependances();

    const resultat = await creerChaine(deps).executerChaine(action([DESTINATAIRE]), requete(), {});

    expect(resultat).toStrictEqual({
      ok: true,
      donnees: "fait",
      emails: { envoyes: 0, nonEnvoyes: 1 },
    });
    expect(envoyerEmail).not.toHaveBeenCalled();
    const journal = inspect(espionErreur.mock.calls, { depth: Infinity });
    expect(espionErreur).toHaveBeenCalled();
    expect(journal).not.toContain("Dupont");
    expect(journal).not.toContain("base perdue");
  });

  test("la valeur comptée vient de la session et de la demande, jamais de l'entrée", async () => {
    const { deps, verifierDebit } = dependances();
    const autre = randomUUID();

    const resultat = await creerChaine(deps).executerChaine(action([DESTINATAIRE]), requete(), {
      organisationId: autre,
    });

    expect(resultat).toMatchObject({ ok: false, raison: "invalide" });
    expect(verifierDebit).not.toHaveBeenCalled();
    expect(inspect(verifierDebit.mock.calls)).not.toContain(autre);
  });
});

describe("échec de l'envoi : l'action reste faite, l'échec est compté (option A)", () => {
  test("envoye: false : nonEnvoyes", async () => {
    etat.envoi = { envoye: false, raison: "indisponible" };
    const { deps } = dependances();

    const resultat = await creerChaine(deps).executerChaine(
      action([DESTINATAIRE, "b@exemple.invalid"]),
      requete(),
      {},
    );

    expect(resultat).toStrictEqual({
      ok: true,
      donnees: "fait",
      emails: { envoyes: 0, nonEnvoyes: 2 },
    });
  });

  test("envoyerEmail lève : nonEnvoyes, incident au journal, sans adresse ni message", async () => {
    etat.envoi = new Error(`connexion refusée pour ${DESTINATAIRE}`);
    const { deps } = dependances();

    const resultat = await creerChaine(deps).executerChaine(action([DESTINATAIRE]), requete(), {});

    expect(resultat).toStrictEqual({
      ok: true,
      donnees: "fait",
      emails: { envoyes: 0, nonEnvoyes: 1 },
    });
    const journal = inspect(espionErreur.mock.calls, { depth: Infinity });
    expect(journal).toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-/u);
    expect(journal).not.toContain("Dupont");
    expect(journal).not.toContain("connexion refusée");
  });
});

describe("ctx.preparerEmail : validée tout de suite, dans la transaction", () => {
  test("adresse invalide : l'action est annulée (erreur avec incident), rien d'envoyé", async () => {
    const { deps, envoyerEmail } = dependances();

    const resultat = await creerChaine(deps).executerChaine(
      action(["a@exemple.invalid\r\nBcc: x@exemple.invalid"]),
      requete(),
      {},
    );

    expect(resultat).toStrictEqual({
      ok: false,
      raison: "erreur",
      incident: expect.stringMatching(UUID),
    });
    expect(etapes).toContain("annulation");
    expect(etapes).not.toContain("service");
    expect(envoyerEmail).not.toHaveBeenCalled();
    // Refus de la porte (classe consignée par la chaîne), pas une fonction absente.
    const journal = inspect(espionErreur.mock.calls, { depth: Infinity });
    expect(journal).toContain("DemandeEmailInvalide");
    expect(journal).not.toContain("TypeError");
  });

  test("modèle hors de la liste déclarée : annulée, rien d'envoyé", async () => {
    const { deps, envoyerEmail } = dependances();

    const resultat = await creerChaine(deps).executerChaine(
      action([DESTINATAIRE], { modele: "autre.modele" }),
      requete(),
      {},
    );

    expect(resultat).toMatchObject({ ok: false, raison: "erreur" });
    expect(envoyerEmail).not.toHaveBeenCalled();
    expect(inspect(espionErreur.mock.calls, { depth: Infinity })).not.toContain("TypeError");
  });

  test("emails: [] : ctx.preparerEmail absent, résultat sans clé emails", async () => {
    const { deps } = dependances();
    let present: boolean | undefined;

    const resultat = await creerChaine(deps).executerChaine(
      declarerAction({
        nom: "demo.sans_email",
        droit: "organisation.membres.voir",
        entree: SCHEMA_VIDE,
        journal: null,
        nouvelleAuthentification: false,
        debit: null,
        emails: [],
        executer: async (ctx) => {
          present = "preparerEmail" in ctx;
          return "fait";
        },
      }),
      requete(),
      {},
    );

    expect(present).toBe(false);
    expect(resultat).toStrictEqual({ ok: true, donnees: "fait" });
  });

  test("emails non vide, aucun email préparé : emails à zéro, aucune limite vérifiée", async () => {
    const { deps, verifierDebit } = dependances();

    const resultat = await creerChaine(deps).executerChaine(action([]), requete(), {});

    expect(resultat).toStrictEqual({
      ok: true,
      donnees: "fait",
      emails: { envoyes: 0, nonEnvoyes: 0 },
    });
    expect(verifierDebit).not.toHaveBeenCalled();
  });

  test("etablirContexte (lecture d'une page) : pas de preparerEmail", async () => {
    const { deps } = dependances();
    let present: boolean | undefined;

    await creerChaine(deps).etablirContexte(requete(), "organisation.membres.voir", async (ctx) => {
      present = "preparerEmail" in ctx;
      return "lu";
    });

    expect(present).toBe(false);
  });
});

describe("declarerAction : champ emails", () => {
  function declarer(emails: unknown, debit: unknown = null) {
    return () =>
      declarerAction({
        nom: "demo.email",
        droit: "organisation.membres.voir",
        entree: SCHEMA_VIDE,
        journal: null,
        nouvelleAuthentification: false,
        debit: debit as NomLimite | null,
        emails: emails as readonly ModeleEmail[],
        executer: async () => "fait",
      });
  }

  test("liste de modèles connus, ou [] : accepté", () => {
    expect(declarer([MODELE])).not.toThrow();
    expect(declarer([])).not.toThrow();
  });

  test.each([
    ["absent", undefined],
    ["null", null],
    ["chaîne au lieu d'une liste", MODELE],
    ["modèle inconnu", ["inconnu.modele"]],
    ["modèle hérité", ["constructor"]],
    ["doublon", [MODELE, MODELE]],
  ])("%s : refusé à l'exécution", (_nom, emails) => {
    expect(declarer(emails)).toThrow();
  });

  test.each([
    "email.destinataire",
    "email.destinataire_jour",
    "email.organisation",
    "email.application",
  ])("debit à l'étape 4 : %s refusée (limite qui ne compte pas l'utilisateur)", (nom) => {
    expect(declarer([], nom)).toThrow();
  });
});

// Vérifié par npm run typecheck : chaque @ts-expect-error doit couvrir une
// erreur réelle. Les fonctions ne sont jamais appelées.
describe("declarerAction : emails absent ne compile pas, preparerEmail typé", () => {
  test("les cas ci-dessous ne compilent pas", () => {
    const cas = [
      () =>
        // @ts-expect-error emails absent
        declarerAction({
          nom: "demo.sans_emails",
          droit: "organisation.membres.voir",
          entree: SCHEMA_VIDE,
          journal: null,
          nouvelleAuthentification: false,
          debit: null,
          executer: async () => "fait",
        }),
      () =>
        declarerAction({
          nom: "demo.modele_inconnu",
          droit: "organisation.membres.voir",
          entree: SCHEMA_VIDE,
          journal: null,
          nouvelleAuthentification: false,
          debit: null,
          // @ts-expect-error modèle hors de la liste fermée
          emails: ["inconnu.modele"],
          executer: async () => "fait",
        }),
      () =>
        declarerAction({
          nom: "demo.sans_preparer",
          droit: "organisation.membres.voir",
          entree: SCHEMA_VIDE,
          journal: null,
          nouvelleAuthentification: false,
          debit: null,
          emails: [],
          executer: async (ctx) => {
            // @ts-expect-error preparerEmail absent quand emails est vide
            ctx.preparerEmail({ modele: MODELE, destinataire: DESTINATAIRE, parametres: {} });
            return "fait";
          },
        }),
    ];

    expect(cas).toHaveLength(3);
  });
});
