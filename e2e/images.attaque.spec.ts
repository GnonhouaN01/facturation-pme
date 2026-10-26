import { randomBytes } from "node:crypto";

import { expect, test } from "@playwright/test";

import { TEXTES_ERREURS } from "../src/textes/erreurs";

// L'optimiseur d'images de Next.js (/_next/image) est fermé : l'application
// n'utilise aucune image, et GHSA-2464-fhr4-w9xw (exécution de code à
// distance par l'optimisation d'images) montre ce qu'une surface inutile
// coûte. next.config.ts pose images.unoptimized : toute adresse de
// /_next/image reçoit la page « introuvable », avec la politique de sécurité
// du contenu du proxy, comme une adresse sans page. Fiche :
// docs/features/socle-interface.md, section 6.1.

const ADRESSES = [
  // Une image locale existante (l'icône) : servie, optimisée, avant.
  "/_next/image?url=%2Ffavicon.ico&w=64&q=75",
  // Une image distante : refusée par 400 avant, sans liste remotePatterns.
  "/_next/image?url=https%3A%2F%2Fexemple.invalid%2Fx.png&w=64&q=75",
  // Sans paramètres, et sous un chemin plus long.
  "/_next/image",
  "/_next/image/x",
];

for (const adresse of ADRESSES) {
  test(`${adresse} : page « introuvable », aucune image, politique posée`, async ({ request }) => {
    const reponse = await request.get(adresse);
    expect(reponse.status()).toBe(404);
    expect(reponse.headers()["content-type"]).toMatch(/^text\/html/u);
    expect(reponse.headers()["content-security-policy"]).toMatch(/script-src 'self' 'nonce-/u);
    expect(await reponse.text()).toContain(TEXTES_ERREURS.introuvable);
  });
}

test("même statut et même type qu'une adresse sans page", async ({ request }) => {
  const image = await request.get(ADRESSES[0] ?? "");
  const absente = await request.get(`/adresse-inexistante-${randomBytes(8).toString("hex")}`);
  expect([image.status(), image.headers()["content-type"]]).toEqual([
    absente.status(),
    absente.headers()["content-type"],
  ]);
});
