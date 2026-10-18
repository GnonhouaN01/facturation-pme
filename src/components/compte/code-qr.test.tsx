import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";

import { CodeQr } from "./code-qr";

// Le code QR tracé par React depuis la matrice reçue du serveur : un <svg>,
// un chemin par module noir, une marge de 4 modules, aucun attribut style
// (règle P), aucun contenu injecté (règle O), aucune image distante. Fiche :
// docs/features/double-authentification.md, section 11.3, test 13.

const LIGNES = [
  "111111101",
  "100000101",
  "101110100",
  "101110101",
  "101110100",
  "100000101",
  "111111101",
  "000000001",
  "101010101",
];

describe("CodeQr", () => {
  test("un <svg> avec viewBox incluant la marge de 4 modules, et un texte de remplacement", () => {
    const html = renderToStaticMarkup(<CodeQr lignes={LIGNES} libelle="Code QR à scanner" />);
    expect(html).toMatch(/^<svg[^>]* viewBox="0 0 17 17"/u);
    expect(html).toContain('role="img"');
    expect(html).toContain('aria-label="Code QR à scanner"');
  });

  test("fond clair et modules sombres, quel que soit le thème (lisible par l'appareil photo)", () => {
    const html = renderToStaticMarkup(<CodeQr lignes={LIGNES} libelle="Code QR" />);
    expect(html).toContain('<rect width="17" height="17" fill="#ffffff"');
    expect(html).toContain('fill="#000000"');
  });

  test("un rectangle d'un module par 1 de la matrice, décalé de la marge", () => {
    const html = renderToStaticMarkup(<CodeQr lignes={["10", "01"]} libelle="Code QR" />);
    const chemin = /<path d="([^"]*)"/u.exec(html)?.[1];
    expect(chemin).toBe("M4 4h1v1h-1zM5 5h1v1h-1z");
  });

  test("ni style, ni image, ni script, ni lien", () => {
    const html = renderToStaticMarkup(<CodeQr lignes={LIGNES} libelle="Code QR" />);
    expect(html).not.toMatch(/style=|<image|<img|<script|href=|<foreignObject/u);
  });

  test("une matrice hors forme ne trace rien (aucun module inventé)", () => {
    expect(renderToStaticMarkup(<CodeQr lignes={["10", "0x"]} libelle="Code QR" />)).toBe("");
    expect(renderToStaticMarkup(<CodeQr lignes={["101", "01"]} libelle="Code QR" />)).toBe("");
    expect(renderToStaticMarkup(<CodeQr lignes={[]} libelle="Code QR" />)).toBe("");
  });
});
