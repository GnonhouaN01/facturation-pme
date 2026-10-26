import { mkdir, mkdtemp, readdir, rm, stat, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";

import { expect, test } from "@playwright/test";

import { EXECUTION } from "./comptes-e2e";
import {
  DOSSIER_EMAILS,
  lireMessages,
  messagesPour,
  RACINE_EMAILS,
  supprimerBoite,
} from "./boite-emails";

// Boîte des emails de bout en bout, sans navigateur : un dossier par
// exécution, chaque fichier lu une fois, suppression du seul dossier de
// l'exécution. Fiche : docs/features/e2e-base-jetable.md, section 6.

const message = (a: string, sujet: string) => JSON.stringify({ a, sujet, corps: "texte" });

test("un dossier par exécution, sous la racine commune", () => {
  expect(DOSSIER_EMAILS).toBe(join(RACINE_EMAILS, EXECUTION));
});

test("lecture incrémentale : un fichier déjà lu n'est pas relu ; un fichier incomplet est repris", async () => {
  const dossier = await mkdtemp(join(RACINE_EMAILS, "essai-"));
  try {
    await writeFile(join(dossier, "001.json"), message("a@exemple.invalid", "Premier"));
    await writeFile(join(dossier, "002.json"), "{ incomplet");
    expect((await lireMessages(dossier)).map((m) => m.sujet)).toEqual(["Premier"]);

    // Le premier fichier change sur le disque : la copie lue est gardée,
    // preuve qu'il n'est pas relu. Le second, désormais complet, est lu.
    await writeFile(join(dossier, "001.json"), message("a@exemple.invalid", "Modifié"));
    await writeFile(join(dossier, "002.json"), message("b@exemple.invalid", "Second"));
    expect((await lireMessages(dossier)).map((m) => m.sujet)).toEqual(["Premier", "Second"]);
    expect((await messagesPour("b@exemple.invalid", dossier)).map((m) => m.sujet)).toEqual([
      "Second",
    ]);
  } finally {
    await rm(dossier, { recursive: true, force: true });
  }
});

test("dossier absent : aucun message", async () => {
  expect(await lireMessages(join(RACINE_EMAILS, "absent-0000"))).toEqual([]);
});

test("suppression : refusée hors d'un dossier d'exécution, acceptée pour celui-ci", async () => {
  for (const dossier of [
    RACINE_EMAILS,
    join(RACINE_EMAILS, ".."),
    join(RACINE_EMAILS, "abcdef01", "sous-dossier"),
    join(RACINE_EMAILS, "pas-une-execution"),
  ]) {
    await expect(supprimerBoite(dossier)).rejects.toThrow("refusée");
  }
  const dossier = join(RACINE_EMAILS, "0badc0de");
  const voisin = await mkdtemp(join(RACINE_EMAILS, "voisin-"));
  try {
    await mkdir(dossier, { recursive: true });
    await writeFile(join(dossier, "1.json"), message("c@exemple.invalid", "S"));
    await supprimerBoite(dossier);
    await expect(stat(dossier)).rejects.toThrow();
    // Un autre dossier de la racine n'est pas touché.
    expect(await readdir(RACINE_EMAILS)).toContain(basename(voisin));
  } finally {
    await rm(voisin, { recursive: true, force: true });
  }
});
