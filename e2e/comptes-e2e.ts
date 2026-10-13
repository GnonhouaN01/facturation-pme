import { randomBytes } from "node:crypto";

// Adresses des comptes créés par les tests de bout en bout (1.1). Hors
// production, la porte d'envoi ne remet un email qu'aux adresses de
// EMAIL_DESTINATAIRES_AUTORISES, transport fichier compris : la liste est
// tirée au début de l'exécution, propre à celle-ci, et posée sur chaque
// serveur par playwright.config.ts. Le domaine .invalid ne peut recevoir
// aucun email réel. Les comptes de l'exécution sont supprimés à la fin
// (e2e/nettoyer-comptes.ts). Fiche : docs/features/inscription.md, test 12.

// Ce fichier est relu par chaque processus de Playwright : la valeur tirée
// par le premier est posée dans l'environnement, dont héritent les suivants.
process.env.E2E_EXECUTION ??= randomBytes(4).toString("hex");
export const EXECUTION = process.env.E2E_EXECUTION;

export const DOMAINE_E2E = "exemple.invalid";
const PROJETS = ["mobile-390", "ordinateur-1280"] as const;
const PAR_PROJET = 30;

// Une adresse par projet et par rang : deux projets lancés en parallèle ne
// partagent aucune adresse.
export function adresseE2E(projet: string, rang: number): string {
  const indice = PROJETS.indexOf(projet as (typeof PROJETS)[number]);
  if (indice < 0 || !Number.isInteger(rang) || rang < 0 || rang >= PAR_PROJET) {
    throw new Error(`Adresse de test hors liste : ${projet}, ${rang}`);
  }
  return `e2e-${EXECUTION}-${indice * PAR_PROJET + rang}@${DOMAINE_E2E}`;
}

// La liste exacte des adresses que les tests de l'exécution peuvent créer :
// la seule que le nettoyage supprime, par égalité.
export const ADRESSES_E2E: readonly string[] = PROJETS.flatMap((projet) =>
  Array.from({ length: PAR_PROJET }, (_, rang) => adresseE2E(projet, rang)),
);
