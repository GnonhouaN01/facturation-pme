import { describe, expect, test } from "vitest";

import configuration from "../../../playwright.config";

// Les tests de bout en bout lancent next start, donc NODE_ENV=production, qui
// charge .env.local. Chaque serveur de Playwright impose le transport fichier
// et un dossier propre aux tests : aucun ne peut envoyer un vrai email, même
// si une variable d'envoi se trouvait par erreur dans .env.local (variables
// passées par webServer.env : elles l'emportent). Fiche :
// docs/features/envoi-emails.md, section 2.1, « Piège à éviter ».

const serveurs = [configuration.webServer ?? []].flat();

describe("playwright.config.ts : aucun serveur de bout en bout n'envoie", () => {
  test("au moins un serveur est déclaré (garde contre un parcours vide)", () => {
    expect(serveurs.length).toBeGreaterThan(0);
  });

  test.each(serveurs.map((serveur, i) => [i, serveur] as const))(
    "serveur %i : EMAIL_TRANSPORT=fichier, dossier hors de .emails",
    (_i, serveur) => {
      expect(serveur.env?.EMAIL_TRANSPORT).toBe("fichier");
      expect(serveur.env?.EMAIL_DOSSIER).toEqual(expect.any(String));
      expect(serveur.env?.EMAIL_DOSSIER).not.toMatch(/^\.?\/?\.emails\/?$/u);
    },
  );

  test("aucune variable Gmail n'est passée à un serveur", () => {
    for (const serveur of serveurs) {
      for (const cle of Object.keys(serveur.env ?? {})) expect(cle).not.toMatch(/^GMAIL_/u);
    }
  });
});
