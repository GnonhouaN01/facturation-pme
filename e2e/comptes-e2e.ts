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
// Rangs d'adresse par test, essais (1 + les 2 nouveaux essais de la CI) et
// répétitions (--repeat-each) au plus. Une adresse n'est jamais reprise par
// un autre projet, un autre essai ni une autre répétition : un compte, ses
// emails et ses compteurs de débit laissés par un essai échoué ne faussent
// pas le suivant. 1.2 : 18 rangs au lieu de 10, pour les comptes de la
// connexion (rangs 8 à 17, docs/features/connexion.md, section 8.1). 1.3 :
// 24 rangs, pour les comptes du mot de passe oublié (rangs 18 à 23,
// docs/features/mot-de-passe.md). 1.4 : 30 rangs, pour les comptes de la
// double authentification (rangs 24 à 29,
// docs/features/double-authentification.md) ; 31 rangs en PR 2 (rang 30, le
// Propriétaire de la zone application). 1.5 : 35 rangs, pour les comptes
// du profil et des sessions (rangs 31 à 34, docs/features/profil-sessions.md).
// 10 répétitions au lieu de 5 : la preuve d'un correctif de test instable
// demande --repeat-each=10.
export const RANGS = 35;
export const ESSAIS_MAX = 3;
export const REPETITIONS_MAX = 10;

function borne(valeur: number, maximum: number): boolean {
  return Number.isInteger(valeur) && valeur >= 0 && valeur < maximum;
}

export function adresseE2E(projet: string, rang: number, essai = 0, repetition = 0): string {
  const indice = PROJETS.indexOf(projet as (typeof PROJETS)[number]);
  if (
    indice < 0 ||
    !borne(rang, RANGS) ||
    !borne(essai, ESSAIS_MAX) ||
    !borne(repetition, REPETITIONS_MAX)
  ) {
    throw new Error(
      `Adresse de test hors liste : ${projet}, rang ${rang}, essai ${essai}, répétition ${repetition} ` +
        `(au plus ${ESSAIS_MAX} essais et ${REPETITIONS_MAX} répétitions, e2e/comptes-e2e.ts)`,
    );
  }
  const numero = ((indice * REPETITIONS_MAX + repetition) * ESSAIS_MAX + essai) * RANGS + rang;
  return `e2e-${EXECUTION}-${numero}@${DOMAINE_E2E}`;
}

// La liste exacte des adresses que les tests de l'exécution peuvent créer :
// la seule que le nettoyage supprime, par égalité.
export const ADRESSES_E2E: readonly string[] = PROJETS.flatMap((projet) =>
  Array.from({ length: REPETITIONS_MAX }, (_, repetition) =>
    Array.from({ length: ESSAIS_MAX }, (_, essai) =>
      Array.from({ length: RANGS }, (_, rang) => adresseE2E(projet, rang, essai, repetition)),
    ),
  ).flat(2),
);
