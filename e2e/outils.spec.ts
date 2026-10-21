import { expect, test } from "@playwright/test";

import { documentEtFlux } from "./outils";

// Tests unitaires des outils de comparaison des tests de bout en bout, sans
// navigateur ni serveur. documentEtFlux (alerte CodeQL 9, 2026-10-21) : retirer
// les scripts du flux RSC d'une chaîne pouvait recoller ce qui les entourait
// en une balise <script ; aucune sortie ne doit en contenir une qui n'était
// pas déjà entière dans l'entrée.

const flux = (texte: string) => `<script>self.__next_f.push([1,${JSON.stringify(texte)}])</script>`;

test.describe("documentEtFlux", () => {
  test("une balise brisée autour d'un script de flux ne se recompose pas", () => {
    const html = `<p>x</p><scr${flux("0:a\n")}ipt>alert(1)</script>`;

    const sortie = documentEtFlux(html);

    expect(JSON.stringify(sortie)).not.toMatch(/<script/i);
    expect(sortie.lignes).toContain("0:a");
  });

  test("brisures imbriquées, sur plusieurs scripts de flux : aucun <script recomposé", () => {
    const html = `<scr<scr${flux("1:b\n")}ipt>${flux("2:c\n")}ipt>alert(1)</script><SCR${flux("3:d\n")}IPT src=x>`;

    const sortie = documentEtFlux(html);

    expect(JSON.stringify(sortie)).not.toMatch(/<script/i);
    expect(sortie.lignes.filter((ligne) => ligne !== "")).toEqual(["1:b", "2:c", "3:d"]);
  });

  test("le découpage du flux et l'ordre de ses lignes ne changent rien ; son contenu, si", () => {
    const avant = "<html><body><main>Introuvable</main>";
    const apres = "</body></html>";
    const un = documentEtFlux(`${avant}${flux("0:x\n4:E{}\nb:E{}\n")}${apres}`);
    const deux = documentEtFlux(`${avant}${flux("0:x\nb:E{}\n")}${flux("4:E{}\n")}${apres}`);
    const autre = documentEtFlux(`${avant}${flux("0:y\nb:E{}\n4:E{}\n")}${apres}`);

    expect(deux).toEqual(un);
    expect(autre).not.toEqual(un);
  });

  test("un script entier hors du flux reste visible", () => {
    const sortie = documentEtFlux(`<p>a</p><script src="/x.js"></script>${flux("0:a\n")}`);

    expect(JSON.stringify(sortie)).toContain('<script src=\\"/x.js\\">');
  });
});
