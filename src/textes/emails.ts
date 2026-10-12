// Phase rouge de la 0.7 (PR 1) : forme fixée par les tests, sans texte.
// Toute lecture lève. Fiche : docs/features/envoi-emails.md, « Notes de
// l'implémentation ».

type TextesEmails = {
  readonly expediteur: string;
  readonly neRepondezPas: string;
  readonly modeles: {
    readonly "essai.verification_envoi": { readonly sujet: string; readonly corps: string };
  };
};

export const TEXTES_EMAILS = new Proxy({} as TextesEmails, {
  get() {
    throw new Error("non implémenté");
  },
});
