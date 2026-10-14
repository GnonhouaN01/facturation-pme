// Mot de passe que le service simulé de Have I Been Pwned déclare compromis
// (e2e/simuler-hibp.mjs). Inventé pour les tests : le vrai service ne le
// connaît pas, si bien qu'un refus « compromis » prouve que la réponse vient
// de la simulation, jamais du service réel. Fiche :
// docs/features/inscription.md, section 5.2.
export const MOT_DE_PASSE_COMPROMIS_E2E = "Fuite-simulee-e2e-Kx7q-2026";

export const HOTE_HIBP = "api.pwnedpasswords.com";
