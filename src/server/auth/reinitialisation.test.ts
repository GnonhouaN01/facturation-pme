import { createHash } from "node:crypto";

import { afterEach, describe, expect, test, vi } from "vitest";

import {
  creerApresReinitialisation,
  empreinteJetonReinitialisation,
  PREFIXE_EMPREINTE,
} from "./reinitialisation";

// Le jeton de réinitialisation stocké haché (S-15), et le rappel appelé par
// Better Auth après un changement de mot de passe : notification planifiée,
// autres jetons du compte supprimés, adresse marquée vérifiée. Le rappel ne
// lève jamais : Better Auth ne révoquerait pas les sessions. Fiche :
// docs/features/mot-de-passe.md, sections 3.2 et 4.2, tests 10 et 11.

vi.mock("../env", () => ({
  env: {
    DATABASE_URL: "postgresql://app_facturation:factice@127.0.0.1:1/factice",
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

const JETON = "aB3dE5fG7hJ9kL1mN2pQ4rS6";
const IDENTIFIANT = `reset-password:${JETON}`;
const ID_UTILISATEUR = "0b5c1f6e-4a1d-4f5e-9c2b-7d8e9f0a1b2c";
const ADRESSE = "awa@exemple.invalid";

function utilisateur(emailVerified: boolean) {
  return {
    id: ID_UTILISATEUR,
    email: ADRESSE,
    name: "Awa Koné",
    emailVerified,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

function journal(): () => string {
  const lignes: string[] = [];
  for (const methode of ["error", "warn", "log", "info"] as const) {
    vi.spyOn(console, methode).mockImplementation((...valeurs: unknown[]) => {
      lignes.push(valeurs.map(String).join(" "));
    });
  }
  return () => lignes.join("\n");
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("empreinte du jeton (S-15, section 3.2)", () => {
  test("préfixe reinitialisation:, puis SHA-256 de l'identifiant en base64url", async () => {
    const empreinte = await empreinteJetonReinitialisation(IDENTIFIANT);
    const attendue = createHash("sha256").update(IDENTIFIANT).digest("base64url");
    expect(PREFIXE_EMPREINTE).toBe("reinitialisation:");
    expect(empreinte).toBe(`reinitialisation:${attendue}`);
  });

  test("ne contient pas le jeton, et ne commence pas par reset-password:", async () => {
    const empreinte = await empreinteJetonReinitialisation(IDENTIFIANT);
    expect(empreinte).not.toContain(JETON);
    expect(empreinte.startsWith("reset-password:")).toBe(false);
  });

  test("stable pour un même jeton, différente pour deux jetons", async () => {
    const a = await empreinteJetonReinitialisation(IDENTIFIANT);
    const b = await empreinteJetonReinitialisation(IDENTIFIANT);
    const c = await empreinteJetonReinitialisation(`reset-password:${JETON.slice(1)}x`);
    expect(a).toBe(b);
    expect(c).not.toBe(a);
  });

  // L'empreinte, présentée comme jeton, ne désigne jamais la ligne stockée :
  // la forme en clair que Better Auth essaie aussi est reset-password:<x>.
  test("l'identifiant en clair d'une empreinte présentée comme jeton diffère de la ligne stockée", async () => {
    const stockee = await empreinteJetonReinitialisation(IDENTIFIANT);
    const presentee = stockee.slice(PREFIXE_EMPREINTE.length);
    expect(`reset-password:${presentee}`).not.toBe(stockee);
    expect(await empreinteJetonReinitialisation(`reset-password:${presentee}`)).not.toBe(stockee);
  });
});

describe("apresReinitialisation : rappel onPasswordReset (section 4.2)", () => {
  function banc(
    options: {
      planifier?: () => Promise<void>;
      supprimer?: () => Promise<number>;
      marquer?: () => Promise<void>;
    } = {},
  ) {
    const planifierNotification = vi.fn<(donnees: { user: { email: string } }) => Promise<void>>(
      options.planifier ?? (async () => {}),
    );
    const supprimerJetons = vi.fn(options.supprimer ?? (async () => 1));
    const marquerVerifiee = vi.fn(options.marquer ?? (async () => {}));
    const apres = creerApresReinitialisation({
      planifierNotification,
      supprimerJetons,
      marquerVerifiee,
    });
    return { apres, planifierNotification, supprimerJetons, marquerVerifiee };
  }

  test("compte vérifié : notification planifiée pour l'adresse, autres jetons supprimés, rien à marquer", async () => {
    const b = banc();
    await b.apres({ user: utilisateur(true) });
    expect(b.planifierNotification).toHaveBeenCalledTimes(1);
    expect(b.planifierNotification.mock.calls[0]?.[0]).toMatchObject({
      user: { email: ADRESSE },
    });
    expect(b.supprimerJetons).toHaveBeenCalledWith(ID_UTILISATEUR);
    expect(b.marquerVerifiee).not.toHaveBeenCalled();
  });

  test("compte non vérifié (décision B) : adresse marquée vérifiée", async () => {
    const b = banc();
    await b.apres({ user: utilisateur(false) });
    expect(b.marquerVerifiee).toHaveBeenCalledWith(ID_UTILISATEUR);
    expect(b.supprimerJetons).toHaveBeenCalledWith(ID_UTILISATEUR);
    expect(b.planifierNotification).toHaveBeenCalledTimes(1);
  });

  test.each([
    ["planification", { planifier: async () => Promise.reject(new Error(`after() ${ADRESSE}`)) }],
    [
      "suppression des jetons",
      { supprimer: async () => Promise.reject(new Error(`Failed query ${ID_UTILISATEUR}`)) },
    ],
    [
      "marquage de l'adresse",
      { marquer: async () => Promise.reject(new Error(`Failed query ${ID_UTILISATEUR}`)) },
    ],
  ] as const)(
    "%s en échec : aucune exception, une ligne [auth] sans identifiant ni adresse, les autres étapes faites",
    async (_nom, options) => {
      const lire = journal();
      const b = banc(options);
      await expect(b.apres({ user: utilisateur(false) })).resolves.toBeUndefined();
      expect(b.planifierNotification).toHaveBeenCalledTimes(1);
      expect(b.supprimerJetons).toHaveBeenCalledTimes(1);
      expect(b.marquerVerifiee).toHaveBeenCalledTimes(1);
      const texte = lire();
      expect(texte).toMatch(/^\[auth\] /mu);
      expect(texte).not.toContain(ADRESSE);
      expect(texte).not.toContain(ID_UTILISATEUR);
      expect(texte).not.toContain("Failed query");
    },
  );

  test("tout en échec : toujours aucune exception", async () => {
    journal();
    const b = banc({
      planifier: async () => Promise.reject(new Error("x")),
      supprimer: async () => Promise.reject(new Error("y")),
      marquer: async () => Promise.reject(new Error("z")),
    });
    await expect(b.apres({ user: utilisateur(false) })).resolves.toBeUndefined();
  });
});
