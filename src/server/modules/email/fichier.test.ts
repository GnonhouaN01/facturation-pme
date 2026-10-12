import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { creerTransportFichier, lireMessages } from "./fichier";
import type { MessageEmail } from "./transport";

// Transport du poste local et des tests de bout en bout : un fichier JSON par
// message, dans un dossier ignoré par git, relu par les tests de bout en bout
// (décision 12). Fiche : docs/features/envoi-emails.md, sections 2.1 et 2.2.

const MESSAGE: MessageEmail = {
  de: "application@exemple.invalid",
  nomExpediteur: "Facturation PME",
  a: "client-secret-de-nom@exemple.invalid",
  sujet: "Sujet",
  corps: "Corps avec un lien https://facturation.exemple.invalid/lien/devis/abc",
};

let dossier: string;

beforeEach(async () => {
  dossier = await mkdtemp(join(tmpdir(), "emails-"));
});

afterEach(async () => {
  await rm(dossier, { recursive: true, force: true });
});

describe("creerTransportFichier", () => {
  test("un fichier JSON par message, contenu complet", async () => {
    const transport = creerTransportFichier(dossier);

    await transport.remettre(MESSAGE);
    await transport.remettre({ ...MESSAGE, sujet: "Second" });

    const fichiers = await readdir(dossier);
    expect(fichiers).toHaveLength(2);
    for (const nom of fichiers) expect(nom).toMatch(/\.json$/u);
    const contenus = await Promise.all(
      fichiers.map(async (nom) => JSON.parse(await readFile(join(dossier, nom), "utf8"))),
    );
    expect(contenus).toContainEqual(MESSAGE);
  });

  test("le nom du fichier ne contient ni l'adresse ni le sujet", async () => {
    const transport = creerTransportFichier(dossier);

    await transport.remettre(MESSAGE);

    const [nom] = await readdir(dossier);
    expect(nom).not.toContain("client-secret-de-nom");
    expect(nom).not.toContain("exemple");
    expect(nom).not.toContain("Sujet");
  });

  test("crée le dossier s'il n'existe pas", async () => {
    const sousDossier = join(dossier, "a", "b");
    const transport = creerTransportFichier(sousDossier);

    await transport.remettre(MESSAGE);

    expect(await readdir(sousDossier)).toHaveLength(1);
  });

  test("lireMessages relit les messages dans l'ordre de remise", async () => {
    const transport = creerTransportFichier(dossier);

    for (const sujet of ["un", "deux", "trois"]) await transport.remettre({ ...MESSAGE, sujet });

    expect((await lireMessages(dossier)).map((m) => m.sujet)).toEqual(["un", "deux", "trois"]);
  });

  test("lireMessages sur un dossier absent : liste vide", async () => {
    expect(await lireMessages(join(dossier, "absent"))).toEqual([]);
  });
});
