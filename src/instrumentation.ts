import type { Instrumentation } from "next";

import { installerFiltreConsole } from "./server/erreurs/console";
import { consignerErreurRequete } from "./server/erreurs/consigner";

// Next.js appelle register au lancement du serveur : une variable
// d'environnement invalide l'empêche de démarrer. Le filtre de la console est
// posé d'abord : aucune sortie console du serveur ne contient une requête SQL
// ni ses paramètres, même écrite par une dépendance (T-39, fiche
// docs/features/socle-interface.md, section 4.4).
export async function register() {
  installerFiltreConsole();
  await import("./server/env");
}

// Erreur serveur d'une requête : une ligne au journal technique, sans
// message, pile, adresse demandée ni en-têtes (S-54, S-85). Fiche :
// docs/features/socle-interface.md, section 4.2.
export const onRequestError: Instrumentation.onRequestError = (erreur, requete, contexte) =>
  consignerErreurRequete(erreur, requete, contexte);
