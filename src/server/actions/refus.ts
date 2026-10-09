import "server-only";

// Modèle de résultat renvoyé au client, et traduction des erreurs. Des codes,
// jamais de texte ni de valeur reçue (S-02, S-54, S-85). Fiche :
// docs/features/chaine-controles.md, section 6.

export type Resultat<T> =
  | { ok: true; donnees: T }
  | { ok: false; raison: "connexion_requise" }
  | { ok: false; raison: "refuse" }
  | { ok: false; raison: "invalide"; champs: string[] }
  | { ok: false; raison: "erreur"; incident: string };
