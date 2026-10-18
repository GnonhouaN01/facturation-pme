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

// Fonctionnalité 1.3 : réinitialisation et notification. Fiche :
// docs/features/mot-de-passe.md, sections 6.1 et 6.4, test 14.
const JETON_REINITIALISATION = "aB3dE5fG7hJ9kL1mN2pQ4rS6";

describe("emailReinitialisation : rappel sendResetPassword", () => {
  test("rend la main sans rien envoyer ni compter : l'envoi est planifié", async () => {
    const { emails, taches, debits, envois } = banc();
    await emails.emailReinitialisation({
      user: utilisateur(),
      url: "http://localhost:3000/api/auth/reset-password/x?callbackURL=",
      token: JETON_REINITIALISATION,
    });
    expect(taches).toHaveLength(1);
    expect(debits).toEqual([]);
    expect(envois).toEqual([]);
  });

  test("après la réponse : modèle compte.reinitialisation, le jeton seul ; url ignorée, même vers un autre site", async () => {
    const { emails, envois, executer } = banc();
    await emails.emailReinitialisation({
      user: utilisateur(),
      url: "https://attaquant.exemple/reset-password/x?callbackURL=https://attaquant.exemple",
      token: JETON_REINITIALISATION,
    });
    await executer();
    expect(envois).toEqual([
      {
        modele: "compte.reinitialisation",
        destinataire: ADRESSE_NORMALISEE,
        parametres: { jeton: JETON_REINITIALISATION },
      },
    ]);
    expect(JSON.stringify(envois)).not.toContain("attaquant");
  });

  test("limites dans l'ordre : destinataire, destinataire_jour, reinitialisation, application", async () => {
    const { emails, debits, executer } = banc();
    await emails.emailReinitialisation({
      user: utilisateur(),
      url: "",
      token: JETON_REINITIALISATION,
    });
    await executer();
    expect(debits).toEqual([
      ["email.destinataire", "awa.kone@exemple.invalid"],
      ["email.destinataire_jour", "awa.kone@exemple.invalid"],
      ["email.reinitialisation", "gmail"],
      ["email.application", "gmail"],
    ]);
  });

  test("planification impossible ou transport en panne : rien n'est levé, ni l'adresse ni le jeton au journal", async () => {
    const lire = journal();
    const { emails, executer } = banc({
      envoi: async () => {
        throw new Error(`550 refusé pour ${ADRESSE} ${JETON_REINITIALISATION}`);
      },
    });
    await emails.emailReinitialisation({
      user: utilisateur(),
      url: "",
      token: JETON_REINITIALISATION,
    });
    await expect(executer()).resolves.toBeUndefined();
    const sansPlanification = creerEmailsCompte({
      planifier: () => {
        throw new Error("after() hors d'une requête");
      },
      verifierDebit: async () => true,
      envoyerEmail: async () => ({ envoye: true }),
    });
    await expect(
      sansPlanification.emailReinitialisation({
        user: utilisateur(),
        url: "",
        token: JETON_REINITIALISATION,
      }),
    ).resolves.toBeUndefined();
    expect(lire().toLowerCase()).not.toContain("exemple.invalid");
    expect(lire()).not.toContain(JETON_REINITIALISATION);
  });
});

describe("emailMotDePasseModifie : notification après réinitialisation", () => {
  test("planifie compte.mot_de_passe_modifie, sans paramètre", async () => {
    const { emails, taches, envois, executer } = banc();
    await emails.emailMotDePasseModifie({ user: utilisateur() });
    expect(taches).toHaveLength(1);
    expect(envois).toEqual([]);
    await executer();
    expect(envois).toEqual([
      { modele: "compte.mot_de_passe_modifie", destinataire: ADRESSE_NORMALISEE, parametres: {} },
    ]);
  });

  // Décision par défaut 8 : la notification ne suit que la consommation d'un
  // jeton, envoyé sous les limites par destinataire.
  test("sans limite par destinataire : reinitialisation, puis application", async () => {
    const { emails, debits, executer } = banc();
    await emails.emailMotDePasseModifie({ user: utilisateur() });
    await executer();
    expect(debits).toEqual([
      ["email.reinitialisation", "gmail"],
      ["email.application", "gmail"],
    ]);
  });

  test("partie même si les limites par destinataire sont atteintes", async () => {
    const { emails, envois, executer } = banc({
      limites: { "email.destinataire": false, "email.destinataire_jour": false },
    });
    await emails.emailMotDePasseModifie({ user: utilisateur() });
    await executer();
    expect(envois).toHaveLength(1);
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
    await expect(emails.emailMotDePasseModifie({ user: utilisateur() })).resolves.toBeUndefined();
  });
});

// Surveillance de RR-13 (décision C) : la ligne d'une limite atteinte nomme
// la limite, valeur d'une liste fermée. Fiche : docs/features/mot-de-passe.md,
// sections 6.4 et 12.3.
describe("ligne [email] d'une limite atteinte", () => {
  test.each([
    ["email.destinataire", "compte.verification"],
    ["email.compte", "compte.verification"],
    ["email.reinitialisation", "compte.reinitialisation"],
    ["email.application", "compte.reinitialisation"],
  ] as const)(
    "%s atteinte (%s) : la ligne nomme la limite, sans adresse ni jeton",
    async (limite, modele) => {
      const lignes: unknown[][] = [];
      vi.spyOn(console, "error").mockImplementation((...valeurs: unknown[]) => {
        lignes.push(valeurs);
      });
      const { emails, executer } = banc({ limites: { [limite]: false } });
      if (modele === "compte.verification") {
        await emails.emailVerification({ user: utilisateur(), url: "", token: JETON });
      } else {
        await emails.emailReinitialisation({
          user: utilisateur(),
          url: "",
          token: JETON_REINITIALISATION,
        });
      }
      await executer();
      expect(lignes).toHaveLength(1);
      const [prefixe, json] = lignes[0] ?? [];
      expect(prefixe).toBe("[email]");
      const lu = JSON.parse(String(json)) as Record<string, unknown>;
      expect(Object.keys(lu).sort()).toEqual(["incident", "limite", "modele", "raison"]);
      expect(lu).toMatchObject({ modele, raison: "limite", limite });
      expect(String(json).toLowerCase()).not.toContain("exemple.invalid");
    },
  );

  test("une erreur ne nomme aucune limite", async () => {
    const lignes: unknown[][] = [];
    vi.spyOn(console, "error").mockImplementation((...valeurs: unknown[]) => {
      lignes.push(valeurs);
    });
    const { emails, executer } = banc({
      envoi: async () => {
        throw new Error("panne");
      },
    });
    await emails.emailVerification({ user: utilisateur(), url: "", token: JETON });
    await executer();
    const lu = JSON.parse(String(lignes[0]?.[1])) as Record<string, unknown>;
    expect(Object.keys(lu).sort()).toEqual(["incident", "modele", "raison"]);
    expect(lu.raison).toBe("erreur");
  });
});

// Fonctionnalité 1.4 : les six notifications de la double authentification,
// sur le budget email.double_auth ; l'adresse est lue dans la tâche planifiée,
// après la réponse, jamais reçue de la requête. Seule l'alerte des codes
// refusés est bornée par destinataire. Fiche :
// docs/features/double-authentification.md, section 10, test 16.
describe("emailDoubleAuth : notifications de la double authentification (1.4)", () => {
  const NOTIFICATIONS = [
    "compte.double_auth_activee",
    "compte.double_auth_desactivee",
    "compte.double_auth_remplacee",
    "compte.codes_secours_regeneres",
    "compte.code_secours_utilise",
  ] as const;

  test.each([...NOTIFICATIONS, "compte.double_auth_tentatives"] as const)(
    "%s : planifiée, l'adresse lue dans la tâche, aucun paramètre",
    async (modele) => {
      const { emails, taches, envois, executer } = banc();
      const lireAdresse = vi.fn(async () => ADRESSE);
      emails.emailDoubleAuth(modele, lireAdresse);
      expect(taches).toHaveLength(1);
      expect(lireAdresse).not.toHaveBeenCalled();
      expect(envois).toEqual([]);
      await executer();
      expect(lireAdresse).toHaveBeenCalledTimes(1);
      expect(envois).toEqual([{ modele, destinataire: ADRESSE_NORMALISEE, parametres: {} }]);
    },
  );

  test.each(NOTIFICATIONS)(
    "%s : sans limite par destinataire, double_auth puis application",
    async (modele) => {
      const { emails, debits, envois, executer } = banc({
        limites: { "email.destinataire": false, "email.destinataire_jour": false },
      });
      emails.emailDoubleAuth(modele, async () => ADRESSE);
      await executer();
      expect(debits.map(([nom]) => nom)).toEqual(["email.double_auth", "email.application"]);
      expect(envois).toHaveLength(1);
    },
  );

  test("compte.double_auth_tentatives : destinataire, destinataire_jour, double_auth, application", async () => {
    const { emails, debits, executer } = banc();
    emails.emailDoubleAuth("compte.double_auth_tentatives", async () => ADRESSE);
    await executer();
    expect(debits).toEqual([
      ["email.destinataire", ADRESSE_NORMALISEE],
      ["email.destinataire_jour", ADRESSE_NORMALISEE],
      ["email.double_auth", "gmail"],
      ["email.application", "gmail"],
    ]);
  });

  test("budget email.double_auth atteint : rien n'est envoyé, la ligne [email] nomme la limite", async () => {
    const lignes: unknown[][] = [];
    vi.spyOn(console, "error").mockImplementation((...valeurs: unknown[]) => {
      lignes.push(valeurs);
    });
    const { emails, envois, executer } = banc({ limites: { "email.double_auth": false } });
    emails.emailDoubleAuth("compte.double_auth_activee", async () => ADRESSE);
    await executer();
    expect(envois).toEqual([]);
    expect(JSON.parse(String(lignes[0]?.[1]))).toMatchObject({
      modele: "compte.double_auth_activee",
      raison: "limite",
      limite: "email.double_auth",
    });
  });

  test("adresse introuvable (compte supprimé entre-temps) : rien n'est compté ni envoyé, rien n'est levé", async () => {
    const { emails, debits, envois, executer } = banc();
    emails.emailDoubleAuth("compte.double_auth_activee", async () => null);
    await executer();
    expect(debits).toEqual([]);
    expect(envois).toEqual([]);
  });

  test("lecture de l'adresse ou planification en échec : rien n'est levé, ni adresse ni identifiant au journal", async () => {
    const lire = journal();
    const { emails, executer } = banc();
    emails.emailDoubleAuth("compte.double_auth_activee", async () => {
      throw new Error("panne pour awa@exemple.invalid u-123");
    });
    await expect(executer()).resolves.toBeUndefined();
    const avecPlanification = creerEmailsCompte({
      planifier: () => {
        throw new Error("after() hors d'une requête");
      },
      verifierDebit: async () => true,
      envoyerEmail: async () => ({ envoye: true }),
    });
    expect(() =>
      avecPlanification.emailDoubleAuth("compte.double_auth_activee", async () => ADRESSE),
    ).not.toThrow();
    expect(lire()).not.toMatch(/exemple\.invalid|u-123/u);
  });
});
