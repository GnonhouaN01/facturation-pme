import "server-only";

import { randomUUID } from "node:crypto";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type { MessageEmail, Transport } from "./transport";

// Transport du poste local et des tests de bout en bout : un fichier JSON par
// message, dans un dossier ignoré par git (décision 12). Rien ne part. Jamais
// sur Vercel : son système de fichiers est en lecture seule, et la
// configuration y refuse ce transport. Le nom du fichier ne dit rien du
// message (ni adresse, ni sujet). Fiche : docs/features/envoi-emails.md,
// sections 2.1 et 2.2.

const SUFFIXE = ".json";

// Nom triable dans l'ordre de remise : horodatage en millisecondes sur 15
// chiffres, compteur du processus, puis un identifiant aléatoire.
let sequence = 0;
function nomFichier(): string {
  sequence += 1;
  const horodatage = String(Date.now()).padStart(15, "0");
  return `${horodatage}-${String(sequence).padStart(9, "0")}-${randomUUID()}${SUFFIXE}`;
}

export function creerTransportFichier(dossier: string): Transport {
  return {
    remettre: async (message) => {
      await mkdir(dossier, { recursive: true });
      await writeFile(join(dossier, nomFichier()), JSON.stringify(message, null, 2), {
        encoding: "utf8",
        flag: "wx",
      });
    },
  };
}

// Relit les messages d'un dossier, dans l'ordre de remise. Dossier absent :
// aucun message.
export async function lireMessages(dossier: string): Promise<MessageEmail[]> {
  let noms: string[];
  try {
    noms = await readdir(dossier);
  } catch (erreur) {
    if ((erreur as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw erreur;
  }
  const fichiers = noms.filter((nom) => nom.endsWith(SUFFIXE)).sort();
  return Promise.all(
    fichiers.map(
      async (nom) => JSON.parse(await readFile(join(dossier, nom), "utf8")) as MessageEmail,
    ),
  );
}
