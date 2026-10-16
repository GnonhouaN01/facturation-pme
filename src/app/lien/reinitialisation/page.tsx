import { ChoixMotDePasse } from "@/components/compte/choix-mot-de-passe";

// Lien de réinitialisation du mot de passe, /lien/reinitialisation#<jeton>.
// Zone par lien : ne lit jamais la session. Le serveur rend le même document
// pour tout fragment, qu'il ne voit pas. Fiche :
// docs/features/mot-de-passe.md, section 3.4.
export default function PageLienReinitialisation() {
  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center px-4 py-12">
      <ChoixMotDePasse />
    </main>
  );
}
