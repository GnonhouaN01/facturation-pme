import { useSyncExternalStore } from "react";

// Vrai une fois la page hydratée, faux au rendu du serveur. Les formulaires
// de compte ne s'affichent qu'avec JavaScript : sans lui, un formulaire HTML
// partirait en GET, mot de passe dans l'adresse. Fiche :
// docs/features/inscription.md, section 5.1.
const aucunAbonnement = () => () => {};

export function useHydrate(): boolean {
  return useSyncExternalStore(
    aucunAbonnement,
    () => true,
    () => false,
  );
}
