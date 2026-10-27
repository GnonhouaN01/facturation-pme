"use server";

import { changementOrganisation, creationOrganisation } from "@/server/actions/organisations";
import { exposer } from "@/server/actions/exposer";

// Actions de la page /compte (2.1) : créer une organisation, en changer. Par
// la chaîne « portée compte » (docs/features/organisations.md, section 3).
export const creerOrganisation = exposer(creationOrganisation);
export const changerOrganisation = exposer(changementOrganisation);
