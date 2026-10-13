import { getIP } from "better-auth/api";
import { describe, expect, test, vi } from "vitest";

import { optionsAuth } from "../auth/config";

// L'adresse IP lue par Better Auth, avec notre configuration : la règle de
// docs/features/limitation-debit.md, section 9 (un seul en-tête, valeur
// unique et valide, sinon compteur partagé). Ce test fige le comportement de
// la version installée : une mise à jour qui le change le fait échouer.
// Fiche : docs/features/inscription.md, section 3.4.

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

// Sous Vitest (NODE_ENV=test), une adresse introuvable vaut 127.0.0.1 : le
// compteur partagé « local ». En production, null (compteur no-trusted-ip).
const PARTAGEE_EN_TEST = "127.0.0.1";

function adresse(entetes: Record<string, string>): string | null {
  return getIP(
    new Request("http://localhost:3000/api/auth/sign-up/email", { headers: entetes }),
    optionsAuth,
  );
}

describe("adresse IP de Better Auth, configuration de l'application", () => {
  test("valeur unique valide : gardée", () => {
    expect(adresse({ "x-forwarded-for": "203.0.113.7" })).toBe("203.0.113.7");
  });

  test("liste de plusieurs valeurs : refusée, jamais « la première »", () => {
    expect(adresse({ "x-forwarded-for": "198.51.100.1, 203.0.113.7" })).toBe(PARTAGEE_EN_TEST);
  });

  test.each(["pas-une-adresse", "203.0.113.999", "", " "])(
    "valeur invalide « %s » : refusée",
    (valeur) => {
      expect(adresse({ "x-forwarded-for": valeur })).toBe(PARTAGEE_EN_TEST);
    },
  );

  test("un autre en-tête n'est pas lu (x-real-ip, forwarded)", () => {
    expect(adresse({ "x-real-ip": "203.0.113.7", forwarded: "for=203.0.113.7" })).toBe(
      PARTAGEE_EN_TEST,
    );
  });

  test("IPv6 : réduite à son sous-réseau (deux adresses du même /64 se confondent)", () => {
    const a = adresse({ "x-forwarded-for": "2001:db8:1:2::1" });
    const b = adresse({ "x-forwarded-for": "2001:db8:1:2:ffff::9" });
    const autre = adresse({ "x-forwarded-for": "2001:db8:1:3::1" });
    expect(a).not.toBeNull();
    expect(a).toBe(b);
    expect(a).not.toBe(autre);
  });
});
