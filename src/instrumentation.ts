// Next.js appelle register au lancement du serveur : une variable
// d'environnement invalide l'empêche de démarrer.
export async function register() {
  await import("./server/env");
}
