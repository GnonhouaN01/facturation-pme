import "server-only";

import { TAUX_MAX_PAR_ORGANISATION, type TypeLogo } from "@/schemas/regles-parametres";

import type { TransactionOrganisation } from "../db/client";
import {
  changerEtatTaux,
  compterTaux,
  ecrireFiche,
  ecrireInstructionsPaiement,
  ecrireLogo,
  emailsDesProprietaires,
  insererTaux,
  lireInstructions,
  lireParametres,
  lireTaux,
  retirerLogo,
  type FicheParametres,
  type Instructions,
  type ParametresLus,
  type TauxLu,
} from "../db/requetes/parametres";

// Règles de la 2.2 : lire la page des paramètres, enregistrer la fiche, les
// taux, le logo et les instructions de paiement. Chaque fonction reçoit la
// transaction de la chaîne, qu'elle n'ouvre pas ; une ressource absente ou
// d'une autre organisation lève ctx.introuvable() (S-02). Fiche :
// docs/features/parametres-organisation.md, sections 3 à 6.

type ContexteService = {
  tx: TransactionOrganisation;
  introuvable: () => never;
};

export type PageParametres = { parametres: ParametresLus; taux: TauxLu[] };

export async function lirePageParametres(ctx: {
  tx: TransactionOrganisation;
}): Promise<PageParametres> {
  const [parametres, taux] = [await lireParametres(ctx.tx), await lireTaux(ctx.tx)];
  return { parametres, taux };
}

export async function enregistrerFiche(
  ctx: ContexteService,
  fiche: FicheParametres,
): Promise<void> {
  await ecrireFiche(ctx.tx, fiche);
}

// Doublon (actif ou non) et plafond : refus uniforme. Le formulaire les
// signale avant l'envoi, à partir de la liste affichée.
export async function ajouterTaux(
  ctx: ContexteService,
  taux: { libelle: string; tauxCentiemes: number },
): Promise<void> {
  if ((await compterTaux(ctx.tx)) >= TAUX_MAX_PAR_ORGANISATION) ctx.introuvable();
  if (!(await insererTaux(ctx.tx, taux.libelle, taux.tauxCentiemes))) ctx.introuvable();
}

export async function modifierEtatTaux(
  ctx: ContexteService,
  entree: { tauxId: string; actif: boolean },
): Promise<void> {
  if (!(await changerEtatTaux(ctx.tx, entree.tauxId, entree.actif))) ctx.introuvable();
}

export async function enregistrerLogo(
  ctx: ContexteService,
  logo: { octets: Uint8Array; type: TypeLogo },
): Promise<void> {
  await ecrireLogo(ctx.tx, logo.octets, logo.type);
}

export async function supprimerLogo(ctx: ContexteService): Promise<void> {
  await retirerLogo(ctx.tx);
}

export type ResultatInstructions = {
  // Vrai si les valeurs enregistrées diffèrent des précédentes.
  modifiees: boolean;
  organisation: string;
  destinataires: string[];
};

// Ligne verrouillée, comparée, puis écrite ; les Propriétaires à prévenir
// (décision 5 : seulement sur un changement réel, l'action en décide).
export async function enregistrerInstructions(
  ctx: ContexteService,
  instructions: Instructions,
): Promise<ResultatInstructions> {
  const avant = await lireInstructions(ctx.tx);
  const modifiees =
    (avant?.mobileMoney ?? null) !== instructions.mobileMoney ||
    (avant?.bancaire ?? null) !== instructions.bancaire;
  if (modifiees) await ecrireInstructionsPaiement(ctx.tx, instructions);
  const { raisonSociale } = await lireParametres(ctx.tx);
  return {
    modifiees,
    organisation: raisonSociale,
    destinataires: modifiees ? await emailsDesProprietaires(ctx.tx) : [],
  };
}
