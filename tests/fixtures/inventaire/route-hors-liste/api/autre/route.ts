// Gestionnaire de route hors de la liste admise : ce que l'inventaire doit
// refuser.
export async function GET(): Promise<Response> {
  return new Response(null, { status: 204 });
}
