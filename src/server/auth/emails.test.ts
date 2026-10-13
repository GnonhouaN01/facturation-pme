import { afterEach, describe, expect, test, vi } from "vitest";

import type { NomLimite } from "../debit/limites";
import { validerDemande, type DemandeEmail, type ResultatEnvoi } from "../email/envoi";

import { creerEmailsCompte } from "./emails";

// Les rappels d'envoi de Better Auth : ils planifient l'envoi après la
// réponse et rendent la main, ne lèvent jamais, construisent le lien depuis
// le jeton seul, vérifient les limites dans l'ordre. Fiche :
// docs/features/inscription.md, section 4.

vi.mock("../env", () => ({
  env: {
    BETTER_AUTH_SECRET: "secret-factice-de-trente-deux-caracteres",
    BETTER_AUTH_URL: "http://localhost:3000",
  },
  configurationEmail: {
    transport: "memoire",
    dossier: null,
    destinatairesAutorises: [],
    estProduction: false,
    gmail: null,
  },
}));
vi.mock("../db/debit", () => ({
  compteur: { consommer: async () => 1, purger: async () => 0 },
}));

const JETON =
  "eyJhbGciOiJIUzI1NiJ9.eyJlbWFpbCI6ImF3YUBleGVtcGxlLmludmFsaWQifQ.c2lnbmF0dXJlLWZhY3RpY2U";
const ADRESSE = "Awa.Kone+essai@Exemple.invalid";
// Domaine en minuscules, partie locale gardée telle quelle (porte, section 3.1).
const ADRESSE_NORMALISEE = "Awa.Kone+essai@exemple.invalid";

function banc(
  options: {
    limites?: Partial<Record<NomLimite, boolean>>;
    envoi?: () => Promise<ResultatEnvoi>;
  } = {},
) {
  const taches: (() => Promise<void>)[] = [];
  const debits: [NomLimite, string][] = [];
  const envois: DemandeEmail[] = [];
  const emails = creerEmailsCompte({
    planifier: (tache) => {
      taches.push(tache);
    },
    verifierDebit: async (nom, valeur) => {
      debits.push([nom, valeur]);
      return options.limites?.[nom] ?? true;
    },
    // Comme la porte : la demande est validée d'abord (modèle, adresse,
    // paramètres), et une demande invalide lève.
    envoyerEmail: async (demande) => {
      envois.push(validerDemande(demande));
      return options.envoi ? options.envoi() : { envoye: true };
    },
  });
  const executer = async () => {
    for (const tache of taches.splice(0)) await tache();
  };
  return { emails, taches, debits, envois, executer };
}

function utilisateur(email = ADRESSE) {
  return {
    id: "u1",
    email,
    name: "Awa",
    emailVerified: false,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

function journal(): () => string {
  const lignes: string[] = [];
  for (const methode of ["error", "warn", "log", "info"] as const) {
    vi.spyOn(console, methode).mockImplementation((...valeurs: unknown[]) => {
      lignes.push(
        valeurs
          .map((valeur) => (typeof valeur === "string" ? valeur : JSON.stringify(valeur)))
          .join(" "),
      );
    });
  }
  return () => lignes.join("\n");
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("emailVerification : rappel de vérification", () => {
  test("rend la main sans rien envoyer ni compter : l'envoi est planifié", async () => {
    const { emails, taches, debits, envois } = banc();
    await emails.emailVerification({
      user: utilisateur(),
      url: "http://localhost:3000/x",
      token: JETON,
    });
    expect(taches).toHaveLength(1);
    expect(debits).toEqual([]);
    expect(envois).toEqual([]);
  });

  test("après la réponse : modèle compte.verification, paramètre le jeton seul, l'adresse saisie", async () => {
    const { emails, envois, executer } = banc();
    await emails.emailVerification({
      user: utilisateur(),
      url: "http://localhost:3000/x",
      token: JETON,
    });
    await executer();
    expect(envois).toEqual([
      {
        modele: "compte.verification",
        destinataire: ADRESSE_NORMALISEE,
        parametres: { jeton: JETON },
      },
    ]);
  });

  test("l'adresse fournie par Better Auth est ignorée, même vers un autre site", async () => {
    const { emails, envois, executer } = banc();
    await emails.emailVerification({
      user: utilisateur(),
      url: "https://attaquant.exemple/verify-email?token=x&callbackURL=https://attaquant.exemple",
      token: JETON,
    });
    await executer();
    expect(JSON.stringify(envois)).not.toContain("attaquant");
  });

  test("limites dans l'ordre : destinataire, destinataire_jour, compte, application", async () => {
    const { emails, debits, executer } = banc();
    await emails.emailVerification({ user: utilisateur(), url: "", token: JETON });
    await executer();
    expect(debits).toEqual([
      ["email.destinataire", "awa.kone@exemple.invalid"],
      ["email.destinataire_jour", "awa.kone@exemple.invalid"],
      ["email.compte", "gmail"],
      ["email.application", "gmail"],
    ]);
  });

  test.each([
    "email.destinataire",
    "email.destinataire_jour",
    "email.compte",
    "email.application",
  ] as const)(
    "limite %s atteinte : rien n'est envoyé, rien n'est levé, une ligne sans l'adresse",
    async (nom) => {
      const lire = journal();
      const { emails, envois, executer } = banc({ limites: { [nom]: false } });
      await emails.emailVerification({ user: utilisateur(), url: "", token: JETON });
      await expect(executer()).resolves.toBeUndefined();
      expect(envois).toEqual([]);
      expect(lire()).toMatch(/\[email\]/u);
      expect(lire().toLowerCase()).not.toContain("exemple.invalid");
      expect(lire()).not.toContain(JETON);
    },
  );

  test("transport en panne ou exception de la porte : rien n'est levé, ni l'adresse ni le jeton au journal", async () => {
    const lire = journal();
    const { emails, executer } = banc({
      envoi: async () => {
        throw new Error(`550 refusé pour ${ADRESSE} ${JETON}`);
      },
    });
    await emails.emailVerification({ user: utilisateur(), url: "", token: JETON });
    await expect(executer()).resolves.toBeUndefined();
    expect(lire().toLowerCase()).not.toContain("exemple.invalid");
    expect(lire()).not.toContain(JETON);
  });

  test("compteur en panne : rien n'est levé", async () => {
    journal();
    const taches: (() => Promise<void>)[] = [];
    const emails = creerEmailsCompte({
      planifier: (tache) => {
        taches.push(tache);
      },
      verifierDebit: async () => {
        throw new Error("base injoignable");
      },
      envoyerEmail: async () => ({ envoye: true }),
    });
    await emails.emailVerification({ user: utilisateur(), url: "", token: JETON });
    for (const tache of taches) await expect(tache()).resolves.toBeUndefined();
  });

  test("planification impossible : le rappel ne lève pas (T-07 : Better Auth relancerait l'erreur)", async () => {
    journal();
    const emails = creerEmailsCompte({
      planifier: () => {
        throw new Error("after() hors d'une requête");
      },
      verifierDebit: async () => true,
      envoyerEmail: async () => ({ envoye: true }),
    });
    await expect(
      emails.emailVerification({ user: utilisateur(), url: "", token: JETON }),
    ).resolves.toBeUndefined();
  });

  test("jeton hors format : la porte refuse la demande, rien n'est envoyé, rien n'est levé", async () => {
    journal();
    const { emails, envois, executer } = banc();
    await emails.emailVerification({ user: utilisateur(), url: "", token: "pas\nun jeton" });
    await expect(executer()).resolves.toBeUndefined();
    expect(envois).toEqual([]);
  });
});

describe("emailCompteExistant : inscription avec une adresse déjà prise (UC-01, 3a)", () => {
  test("planifie compte.existant, sans paramètre, avec les mêmes limites", async () => {
    const { emails, taches, envois, debits, executer } = banc();
    await emails.emailCompteExistant({ user: utilisateur() });
    expect(taches).toHaveLength(1);
    expect(envois).toEqual([]);
    await executer();
    expect(envois).toEqual([
      { modele: "compte.existant", destinataire: ADRESSE_NORMALISEE, parametres: {} },
    ]);
    expect(debits.map(([nom]) => nom)).toEqual([
      "email.destinataire",
      "email.destinataire_jour",
      "email.compte",
      "email.application",
    ]);
  });

  test("planification impossible : ne lève pas", async () => {
    journal();
    const emails = creerEmailsCompte({
      planifier: () => {
        throw new Error("after() hors d'une requête");
      },
      verifierDebit: async () => true,
      envoyerEmail: async () => ({ envoye: true }),
    });
    await expect(emails.emailCompteExistant({ user: utilisateur() })).resolves.toBeUndefined();
  });
});
