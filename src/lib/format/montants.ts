// Formatage des montants en francs CFA (NF-02, R-01). Fiche :
// docs/features/socle-interface.md, section 11.2.
//
// Écrit à la main plutôt que par Intl.NumberFormat : le résultat est le même
// au caractère près sur le serveur et dans tout navigateur, quelle que soit
// la version des données de langue.

// Espace insécable : un montant ne se coupe pas en fin de ligne, et le
// caractère existe dans toute police, DM Mono comprise.
const INSECABLE = " ";

// Groupes de trois chiffres, à partir de la droite.
const MILLIERS = /\B(?=(\d{3})+(?!\d))/g;

// Un montant est un entier sûr (R-01). Un montant négatif est refusé jusqu'à
// la 5.5 (avoirs, décision 5). Le message ne reprend pas la valeur.
function verifierMontant(montant: number): void {
  if (!Number.isSafeInteger(montant)) {
    throw new RangeError("Montant invalide : un entier est attendu.");
  }
  if (montant < 0) {
    throw new RangeError("Montant invalide : un montant négatif n'est pas pris en charge.");
  }
}

// Montant en colonne, sans l'unité, rappelée dans l'en-tête : « 1 180 000 ».
export function formaterMontantColonne(montant: number): string {
  verifierMontant(montant);
  // String(-0) vaut "0" : aucun signe.
  return String(montant).replace(MILLIERS, INSECABLE);
}

// Montant suivi de l'unité : « 1 180 000 F CFA ».
export function formaterMontant(montant: number): string {
  return `${formaterMontantColonne(montant)}${INSECABLE}F${INSECABLE}CFA`;
}
