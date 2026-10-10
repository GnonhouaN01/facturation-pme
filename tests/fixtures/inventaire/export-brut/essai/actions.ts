"use server";

// Point d'entrée sans la chaîne : ce que l'inventaire doit refuser.
export async function agirSansChaine(): Promise<string> {
  return "fait";
}
