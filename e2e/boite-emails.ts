import { readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative, sep } from "node:path";

import { EXECUTION } from "./comptes-e2e";

// Boîte des emails de bout en bout (transport fichier, un fichier JSON par
// message). Deux causes de lenteur corrigées (fix(e2e), test 46 de
// double-authentification.spec.ts) :
// - le dossier était commun à toutes les exécutions et jamais vidé : 3 131
//   fichiers (15 Mo) le 2026-10-25, et il grossissait à chaque exécution ;
// - chaque tentative d'attente (expect.poll) relisait et analysait tous les
//   fichiers : 396 ms par tentative à 3 131 fichiers, davantage avec les
//   tests lancés en parallèle (EMFILE à 10 lectures simultanées).
// Désormais : un dossier par exécution, supprimé en fin d'exécution
// (nettoyer-comptes.ts), et chaque fichier lu une seule fois par processus.
// Fiche : docs/features/e2e-base-jetable.md, section 6.

export const RACINE_EMAILS = join(tmpdir(), "facturation-pme-e2e-emails");
export const DOSSIER_EMAILS = join(RACINE_EMAILS, EXECUTION);

export type Message = { a: string; sujet: string; corps: string };

// Messages déjà lus, par nom de fichier : un fichier écrit par le transport
// ne change plus. Une lecture qui échoue (fichier en cours d'écriture) est
// reprise à la tentative suivante.
const lus = new Map<string, Message>();

export async function lireMessages(dossier = DOSSIER_EMAILS): Promise<Message[]> {
  let noms: string[];
  try {
    noms = (await readdir(dossier)).filter((nom) => nom.endsWith(".json")).sort();
  } catch {
    return [];
  }
  const cle = (nom: string) => join(dossier, nom);
  await Promise.all(
    noms
      .filter((nom) => !lus.has(cle(nom)))
      .map(async (nom) => {
        try {
          lus.set(cle(nom), JSON.parse(await readFile(cle(nom), "utf8")) as Message);
        } catch {
          // Fichier incomplet : relu à la prochaine tentative.
        }
      }),
  );
  return noms.flatMap((nom) => {
    const message = lus.get(cle(nom));
    return message ? [message] : [];
  });
}

export async function messagesPour(adresse: string, dossier = DOSSIER_EMAILS): Promise<Message[]> {
  return (await lireMessages(dossier)).filter((message) => message.a === adresse);
}

// Suppression du dossier de l'exécution, et de lui seul : un enfant direct
// de RACINE_EMAILS au nom d'une exécution (8 caractères hexadécimaux).
export async function supprimerBoite(dossier = DOSSIER_EMAILS): Promise<void> {
  const chemin = relative(RACINE_EMAILS, dossier);
  if (chemin.includes(sep) || !/^[0-9a-f]{8}$/u.test(chemin)) {
    throw new Error("Suppression de la boîte de bout en bout refusée : dossier inattendu.");
  }
  await rm(dossier, { recursive: true, force: true });
}
