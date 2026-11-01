import { z } from "zod";

import { analyserLogo, decoderBase64 } from "@/lib/image/logo";

import { schemaCreationOrganisation } from "./organisation";
import {
  DELAI_MAX,
  DELAI_MIN,
  LONGUEUR_MAX_LOGO_BASE64,
  longueurMaxSaisie,
  normaliserTexte,
  REGLES_TEXTE,
  tauxEnCentiemes,
  texteValide,
  type ChampTexte,
  type TypeLogo,
} from "./regles-parametres";

// Entrées des six actions de la 2.2. Objets stricts : ni organisation, ni
// identifiant d'une autre ressource que le taux visé, ni instructions de
// paiement dans la fiche. Les textes vides deviennent null (non renseigné).
// Fiche : docs/features/parametres-organisation.md, sections 3 à 6.

// Texte facultatif : null s'il est vide après normalisation.
function texte(champ: ChampTexte) {
  const regle = REGLES_TEXTE[champ];
  return z
    .string()
    .max(longueurMaxSaisie(regle))
    .refine((saisie) => texteValide(saisie, regle))
    .transform(normaliserTexte);
}

const delai = z.int().min(DELAI_MIN).max(DELAI_MAX);

export const schemaFiche = z.strictObject({
  raisonSociale: schemaCreationOrganisation.shape.raisonSociale,
  adresse: texte("adresse"),
  ncc: texte("ncc"),
  rccm: texte("rccm"),
  regimeImposition: texte("regimeImposition"),
  mentionsLegales: texte("mentionsLegales"),
  validiteDevisJours: delai,
  echeanceFactureJours: delai,
});

export type FicheSaisie = z.output<typeof schemaFiche>;

// Le taux saisi (« 9,5 ») sort en centièmes (950). Transformations au
// niveau des champs : declarerAction exige un z.strictObject à la racine.
export const schemaAjoutTaux = z.strictObject({
  // Obligatoire : un libellé vide est refusé.
  libelle: texte("libelleTaux").pipe(z.string()),
  taux: z
    .string()
    .max(10)
    .transform((saisie, contexte) => {
      const centiemes = tauxEnCentiemes(saisie);
      if (centiemes === null) {
        contexte.addIssue({ code: "custom", message: "taux" });
        return z.NEVER;
      }
      return centiemes;
    }),
});

export const schemaEtatTaux = z.strictObject({ tauxId: z.uuid(), actif: z.boolean() });

// Le contenu base64 sort en octets décodés et type lu dans la signature.
export const schemaLogo = z.strictObject({
  contenu: z
    .string()
    .max(LONGUEUR_MAX_LOGO_BASE64)
    .transform((saisie, contexte): { octets: Uint8Array; type: TypeLogo } => {
      const octets = decoderBase64(saisie);
      const analyse = octets === null ? null : analyserLogo(octets);
      if (octets === null || analyse === null) {
        contexte.addIssue({ code: "custom", message: "logo" });
        return z.NEVER;
      }
      return { octets, type: analyse.type };
    }),
});

export const schemaRetraitLogo = z.strictObject({});

export const schemaInstructions = z.strictObject({
  mobileMoney: texte("mobileMoney"),
  bancaire: texte("bancaire"),
});

export type InstructionsSaisies = z.output<typeof schemaInstructions>;
