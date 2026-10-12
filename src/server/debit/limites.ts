import "server-only";

// Les limites de débit : source unique. Une fonctionnalité qui en ajoute une
// le fait ici, dans sa PR. Le nom apparaît en clair dans la clé du compteur :
// il ne désigne personne. Fiche : docs/features/limitation-debit.md,
// section 1.

export type Limite = {
  maximum: number;
  fenetreSecondes: number;
  // Ce que la clé désigne : l'utilisateur de la session (étape 4 de la
  // chaîne) ; pour les emails (0.7), l'application entière, l'organisation de
  // la transaction ou l'adresse du destinataire, normalisée pour le compteur.
  par: "utilisateur" | "application" | "organisation" | "destinataire";
};

export const LIMITES = {
  // Actions des membres, par la chaîne de contrôles (décision 4).
  "membre.action": { maximum: 60, fenetreSecondes: 60, par: "utilisateur" },
  // Envoi d'emails (S-55, T-40), vérifiées par la chaîne après la validation
  // de la transaction, dans cet ordre : destinataire, destinataire_jour,
  // organisation, application. Un seul compte Gmail sert tout : 2 × 200 reste
  // sous ses 500 par jour, même au bord de la fenêtre fixe. Valeurs de la
  // décision 5, à revoir aux jalons 6 et 8. Fiche :
  // docs/features/envoi-emails.md, section 5.2.
  "email.destinataire": { maximum: 3, fenetreSecondes: 60 * 60, par: "destinataire" },
  "email.destinataire_jour": { maximum: 10, fenetreSecondes: 24 * 60 * 60, par: "destinataire" },
  "email.organisation": { maximum: 40, fenetreSecondes: 24 * 60 * 60, par: "organisation" },
  "email.application": { maximum: 200, fenetreSecondes: 24 * 60 * 60, par: "application" },
} as const satisfies Record<string, Limite>;

export type NomLimite = keyof typeof LIMITES;

// La plus longue fenêtre d'un ensemble de limites : au-delà, une ligne du
// compteur ne peut plus servir (purge, section 7).
export function fenetreMaxSecondes(limites: Readonly<Record<string, Limite>>): number {
  const fenetres = Object.values(limites).map((limite) => limite.fenetreSecondes);
  // Sans limite, Math.max renverrait -Infinity : la purge viderait tout.
  if (fenetres.length === 0) throw new Error("Aucune limite de débit déclarée.");
  return Math.max(...fenetres);
}
