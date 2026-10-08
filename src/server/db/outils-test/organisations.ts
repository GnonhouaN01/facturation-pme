import "server-only";

import type { TableOrganisation } from "./isolation";

// Outillage des tests avec base. Ne s'importe que depuis un fichier de test.
// Fiche : docs/features/acces-donnees.md, section 4.2. Non implémenté.

export type Organisations = {
  a: string;
  b: string;
  // Supprime les lignes des tables indiquées, puis les deux organisations.
  nettoyer: () => Promise<void>;
};

export async function creerDeuxOrganisations(options: {
  tables: TableOrganisation[];
}): Promise<Organisations> {
  void options;
  throw new Error("non implémenté : creerDeuxOrganisations");
}
