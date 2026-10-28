import "server-only";

import { and, asc, count, eq, sql } from "drizzle-orm";

import { DELAI_DEFAUT, type TypeLogo } from "@/schemas/regles-parametres";

import type { TransactionOrganisation } from "../client";
import { member, organization, user } from "../schema/auth";
import { ORGANISATION_ACTIVE } from "../schema/isolation";
import { parametresOrganisation, tauxTva } from "../schema/parametres";

// Requêtes de la 2.2, dans la transaction ouverte par la chaîne pour
// l'organisation active. parametres_organisation et taux_tva ont leurs
// règles d'isolation ; chaque requête filtre aussi sur l'organisation de la
// transaction (ORGANISATION_ACTIVE, sans second paramètre qui pourrait
// diverger). organization, member et user (Better Auth, RR-8) sont filtrées
// de même. Deux séparations, vérifiées par parametres.test.ts : seul
// ecrireInstructionsPaiement écrit les instructions de paiement (S-33), et
// seules lireLogo, ecrireLogo et retirerLogo nomment la colonne logo.
// Fiche : docs/features/parametres-organisation.md, sections 1 à 6.

export type ParametresLus = {
  raisonSociale: string;
  adresse: string | null;
  ncc: string | null;
  rccm: string | null;
  regimeImposition: string | null;
  mentionsLegales: string | null;
  validiteDevisJours: number;
  echeanceFactureJours: number;
  paiementMobileMoney: string | null;
  paiementBancaire: string | null;
  logoType: TypeLogo | null;
  modifieLe: Date | null;
};

export type FicheParametres = {
  raisonSociale: string;
  adresse: string | null;
  ncc: string | null;
  rccm: string | null;
  regimeImposition: string | null;
  mentionsLegales: string | null;
  validiteDevisJours: number;
  echeanceFactureJours: number;
};

export type Instructions = { mobileMoney: string | null; bancaire: string | null };

export type TauxLu = { id: string; libelle: string; tauxCentiemes: number; actif: boolean };

// Plafond de lecture des taux (T-42), au-dessus du plafond d'écriture.
const TAUX_LUS_MAX = 100;
// Plafond de lecture des Propriétaires destinataires (T-42).
const PROPRIETAIRES_MAX = 20;

const DE_L_ORGANISATION = eq(parametresOrganisation.organisationId, ORGANISATION_ACTIVE);

function typeLogo(valeur: string | null): TypeLogo | null {
  return valeur === "image/png" || valeur === "image/jpeg" ? valeur : null;
}

// Fiche, instructions et type du logo, sans ses octets. Organisation sans
// ligne (créée avant la 2.2) : valeurs par défaut.
export async function lireParametres(tx: TransactionOrganisation): Promise<ParametresLus> {
  const [nom] = await tx
    .select({ nom: organization.name })
    .from(organization)
    .where(eq(organization.id, ORGANISATION_ACTIVE))
    .limit(1);
  const [ligne] = await tx
    .select({
      adresse: parametresOrganisation.adresse,
      ncc: parametresOrganisation.ncc,
      rccm: parametresOrganisation.rccm,
      regimeImposition: parametresOrganisation.regimeImposition,
      mentionsLegales: parametresOrganisation.mentionsLegales,
      validiteDevisJours: parametresOrganisation.validiteDevisJours,
      echeanceFactureJours: parametresOrganisation.echeanceFactureJours,
      paiementMobileMoney: parametresOrganisation.paiementMobileMoney,
      paiementBancaire: parametresOrganisation.paiementBancaire,
      logoType: parametresOrganisation.logoType,
      modifieLe: parametresOrganisation.modifieLe,
    })
    .from(parametresOrganisation)
    .where(DE_L_ORGANISATION)
    .limit(1);
  return {
    raisonSociale: nom?.nom ?? "",
    adresse: ligne?.adresse ?? null,
    ncc: ligne?.ncc ?? null,
    rccm: ligne?.rccm ?? null,
    regimeImposition: ligne?.regimeImposition ?? null,
    mentionsLegales: ligne?.mentionsLegales ?? null,
    validiteDevisJours: ligne?.validiteDevisJours ?? DELAI_DEFAUT,
    echeanceFactureJours: ligne?.echeanceFactureJours ?? DELAI_DEFAUT,
    paiementMobileMoney: ligne?.paiementMobileMoney ?? null,
    paiementBancaire: ligne?.paiementBancaire ?? null,
    logoType: typeLogo(ligne?.logoType ?? null),
    modifieLe: ligne?.modifieLe ?? null,
  };
}

// Ligne des valeurs par défaut, à la création de l'organisation (UC-06).
export async function insererParametresParDefaut(tx: TransactionOrganisation): Promise<void> {
  await tx.insert(parametresOrganisation).values({ organisationId: ORGANISATION_ACTIVE });
}

// La fiche et la raison sociale ; insère la ligne si elle manque.
export async function ecrireFiche(
  tx: TransactionOrganisation,
  fiche: FicheParametres,
): Promise<void> {
  const { raisonSociale, ...valeurs } = fiche;
  await tx
    .update(organization)
    .set({ name: raisonSociale })
    .where(eq(organization.id, ORGANISATION_ACTIVE));
  await tx
    .insert(parametresOrganisation)
    .values({ organisationId: ORGANISATION_ACTIVE, ...valeurs })
    .onConflictDoUpdate({
      target: parametresOrganisation.organisationId,
      set: { ...valeurs, modifieLe: sql`now()` },
    });
}

// Instructions actuelles, ligne verrouillée jusqu'à la fin de la transaction
// (deux modifications simultanées se suivent) ; null si la ligne manque.
export async function lireInstructions(tx: TransactionOrganisation): Promise<Instructions | null> {
  const [ligne] = await tx
    .select({
      mobileMoney: parametresOrganisation.paiementMobileMoney,
      bancaire: parametresOrganisation.paiementBancaire,
    })
    .from(parametresOrganisation)
    .where(DE_L_ORGANISATION)
    .limit(1)
    .for("update");
  return ligne ?? null;
}

// Seule écriture des instructions de paiement (S-33).
export async function ecrireInstructionsPaiement(
  tx: TransactionOrganisation,
  instructions: Instructions,
): Promise<void> {
  const valeurs = {
    paiementMobileMoney: instructions.mobileMoney,
    paiementBancaire: instructions.bancaire,
  };
  await tx
    .insert(parametresOrganisation)
    .values({ organisationId: ORGANISATION_ACTIVE, ...valeurs })
    .onConflictDoUpdate({
      target: parametresOrganisation.organisationId,
      set: { ...valeurs, modifieLe: sql`now()` },
    });
}

// Les octets du logo, pour la route qui le sert ; null sans logo.
export async function lireLogo(
  tx: TransactionOrganisation,
): Promise<{ octets: Uint8Array; type: TypeLogo } | null> {
  const [ligne] = await tx
    .select({ octets: parametresOrganisation.logo, type: parametresOrganisation.logoType })
    .from(parametresOrganisation)
    .where(DE_L_ORGANISATION)
    .limit(1);
  const type = typeLogo(ligne?.type ?? null);
  if (!ligne?.octets || type === null) return null;
  return { octets: new Uint8Array(ligne.octets), type };
}

export async function ecrireLogo(
  tx: TransactionOrganisation,
  octets: Uint8Array,
  type: TypeLogo,
): Promise<void> {
  const valeurs = { logo: Buffer.from(octets), logoType: type };
  await tx
    .insert(parametresOrganisation)
    .values({ organisationId: ORGANISATION_ACTIVE, ...valeurs })
    .onConflictDoUpdate({
      target: parametresOrganisation.organisationId,
      set: { ...valeurs, modifieLe: sql`now()` },
    });
}

export async function retirerLogo(tx: TransactionOrganisation): Promise<void> {
  await tx
    .update(parametresOrganisation)
    .set({ logo: null, logoType: null, modifieLe: sql`now()` })
    .where(DE_L_ORGANISATION);
}

// Taux de l'organisation, par valeur croissante.
export async function lireTaux(tx: TransactionOrganisation): Promise<TauxLu[]> {
  return tx
    .select({
      id: tauxTva.id,
      libelle: tauxTva.libelle,
      tauxCentiemes: tauxTva.tauxCentiemes,
      actif: tauxTva.actif,
    })
    .from(tauxTva)
    .where(eq(tauxTva.organisationId, ORGANISATION_ACTIVE))
    .orderBy(asc(tauxTva.tauxCentiemes))
    .limit(TAUX_LUS_MAX);
}

export async function compterTaux(tx: TransactionOrganisation): Promise<number> {
  const [ligne] = await tx
    .select({ n: count() })
    .from(tauxTva)
    .where(eq(tauxTva.organisationId, ORGANISATION_ACTIVE));
  return ligne?.n ?? 0;
}

// Faux si l'organisation a déjà un taux de cette valeur (actif ou non).
export async function insererTaux(
  tx: TransactionOrganisation,
  libelle: string,
  tauxCentiemes: number,
): Promise<boolean> {
  const inseres = await tx
    .insert(tauxTva)
    .values({ organisationId: ORGANISATION_ACTIVE, libelle, tauxCentiemes })
    .onConflictDoNothing({ target: [tauxTva.organisationId, tauxTva.tauxCentiemes] })
    .returning({ id: tauxTva.id });
  return inseres.length === 1;
}

// Faux si le taux n'existe pas dans l'organisation de la transaction.
export async function changerEtatTaux(
  tx: TransactionOrganisation,
  tauxId: string,
  actif: boolean,
): Promise<boolean> {
  const modifies = await tx
    .update(tauxTva)
    .set({ actif })
    .where(and(eq(tauxTva.id, tauxId), eq(tauxTva.organisationId, ORGANISATION_ACTIVE)))
    .returning({ id: tauxTva.id });
  return modifies.length === 1;
}

// Adresses des Propriétaires de l'organisation de la transaction (RR-8 :
// filtrées sur elle), pour l'email des instructions de paiement.
export async function emailsDesProprietaires(tx: TransactionOrganisation): Promise<string[]> {
  const lignes = await tx
    .select({ email: user.email })
    .from(member)
    .innerJoin(user, eq(user.id, member.userId))
    .where(and(eq(member.organizationId, ORGANISATION_ACTIVE), eq(member.role, "proprietaire")))
    .orderBy(asc(user.email))
    .limit(PROPRIETAIRES_MAX);
  return lignes.map((ligne) => ligne.email);
}

// Taux par défaut, à la création de l'organisation (UC-06, F-051).
export async function insererTauxParDefaut(
  tx: TransactionOrganisation,
  taux: readonly { libelle: string; tauxCentiemes: number }[],
): Promise<void> {
  await tx.insert(tauxTva).values(taux.map((t) => ({ organisationId: ORGANISATION_ACTIVE, ...t })));
}
