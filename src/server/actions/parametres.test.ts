import { beforeEach, describe, expect, test, vi } from "vitest";

import { peut, ROLES } from "../autorisation/matrice";

import {
  ajoutTaux,
  enregistrementFiche,
  enregistrementLogo,
  etatTaux,
  instructionsPaiement,
  retraitLogo,
} from "./parametres";
import { REGISTRE } from "./registre";

// Les six actions de la 2.2 : droit, nouvelle authentification, trace,
// limite et emails déclarés ; email aux Propriétaires seulement quand les
// instructions de paiement changent réellement (décision 5 du développeur,
// 2026-10-28). Fiche : docs/features/parametres-organisation.md, sections 6
// et 10, test 4.

vi.mock("../env", () => ({
  env: {
    DATABASE_URL: "postgresql://app_facturation:factice@localhost:5432/factice",
    BETTER_AUTH_SECRET: "secret-factice-de-trente-deux-caracteres",
    BETTER_AUTH_URL: "https://facturation.exemple.ci",
  },
  configurationEmail: {
    transport: "memoire",
    dossier: null,
    destinatairesAutorises: [],
    estProduction: false,
    gmail: null,
  },
}));

const service = vi.hoisted(() => ({
  enregistrerInstructions: vi.fn(),
}));

vi.mock("../services/parametres", async (importer) => ({
  ...(await importer<typeof import("../services/parametres")>()),
  enregistrerInstructions: service.enregistrerInstructions,
}));

const ORGANISATION = "1f2e3d4c-5b6a-4978-8a9b-0c1d2e3f4a5b";

const DECLARATIONS = [
  enregistrementFiche,
  ajoutTaux,
  etatTaux,
  enregistrementLogo,
  retraitLogo,
  instructionsPaiement,
];

describe("déclarations", () => {
  test("toutes au registre, noms uniques", () => {
    for (const declaration of DECLARATIONS) expect(REGISTRE).toContain(declaration);
    expect(new Set(DECLARATIONS.map((d) => d.nom)).size).toBe(DECLARATIONS.length);
  });

  test("droits : la fiche, les taux et le logo sous organisation.fiche.modifier", () => {
    for (const declaration of [
      enregistrementFiche,
      ajoutTaux,
      etatTaux,
      enregistrementLogo,
      retraitLogo,
    ]) {
      expect(declaration.droit, declaration.nom).toBe("organisation.fiche.modifier");
      expect(declaration.nouvelleAuthentification, declaration.nom).toBe(false);
      expect(declaration.journal, declaration.nom).toBe("organisation.parametres_modifies");
      expect(declaration.emails, declaration.nom).toEqual([]);
      expect(declaration.debit, declaration.nom).toBe("membre.action");
    }
  });

  test("instructions de paiement : droit propre, nouvelle authentification, trace et email", () => {
    expect(instructionsPaiement.droit).toBe("organisation.instructions_paiement.modifier");
    expect(instructionsPaiement.nouvelleAuthentification).toBe(true);
    expect(instructionsPaiement.journal).toBe("organisation.instructions_paiement_modifiees");
    expect(instructionsPaiement.emails).toEqual(["organisation.instructions_paiement_modifiees"]);
    expect(instructionsPaiement.debit).toBe("membre.action");
  });

  test("seule l'action des instructions demande une nouvelle authentification", () => {
    expect(DECLARATIONS.filter((d) => d.nouvelleAuthentification)).toEqual([instructionsPaiement]);
  });

  test("matrice : le Propriétaire seul, pour chacune", () => {
    for (const declaration of DECLARATIONS) {
      expect(
        ROLES.filter((role) => peut(role, declaration.droit)),
        declaration.nom,
      ).toEqual(["proprietaire"]);
    }
  });
});

describe("instructions de paiement : email seulement sur un changement réel", () => {
  const journaliser = vi.fn(async () => undefined);
  const preparerEmail = vi.fn();
  const ctx = () =>
    ({
      utilisateurId: "4b8c5f0e-2a1d-4e3f-9b7a-6c5d4e3f2a1b",
      organisationId: ORGANISATION,
      role: "proprietaire",
      perimetre: "organisation",
      tx: {},
      introuvable: () => {
        throw new Error("introuvable");
      },
      journaliser,
      preparerEmail,
    }) as never;
  const ENTREE = { mobileMoney: "Orange Money : 07 00 00 00 00", bancaire: null };

  beforeEach(() => {
    journaliser.mockClear();
    preparerEmail.mockClear();
    service.enregistrerInstructions.mockReset();
  });

  test("changement : trace, puis un email par Propriétaire, raison sociale seule", async () => {
    service.enregistrerInstructions.mockResolvedValue({
      modifiees: true,
      organisation: "Kouamé & Fils",
      destinataires: ["a@exemple.invalid", "b@exemple.invalid"],
    });

    expect(await instructionsPaiement.executer(ctx(), ENTREE)).toEqual({ modifiees: true });
    expect(journaliser).toHaveBeenCalledWith({ ressourceId: ORGANISATION });
    expect(preparerEmail.mock.calls).toEqual([
      [
        {
          modele: "organisation.instructions_paiement_modifiees",
          destinataire: "a@exemple.invalid",
          parametres: { organisation: "Kouamé & Fils" },
        },
      ],
      [
        {
          modele: "organisation.instructions_paiement_modifiees",
          destinataire: "b@exemple.invalid",
          parametres: { organisation: "Kouamé & Fils" },
        },
      ],
    ]);
  });

  test("mêmes valeurs : trace de la tentative, aucun email", async () => {
    service.enregistrerInstructions.mockResolvedValue({
      modifiees: false,
      organisation: "Kouamé & Fils",
      destinataires: ["a@exemple.invalid"],
    });

    expect(await instructionsPaiement.executer(ctx(), ENTREE)).toEqual({ modifiees: false });
    expect(journaliser).toHaveBeenCalledTimes(1);
    expect(preparerEmail).not.toHaveBeenCalled();
  });
});
