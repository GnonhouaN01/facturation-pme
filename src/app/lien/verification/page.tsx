import { ConfirmationVerification } from "@/components/compte/confirmation-verification";

// Lien de vérification de l'adresse, /lien/verification#<jeton> (décision 3).
// Zone par lien : ne lit jamais la session. Le serveur rend le même document
// pour tout fragment, qu'il ne voit pas. Fiche : docs/features/inscription.md,
// section 4.3.
export default function PageLienVerification() {
  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center px-4 py-12">
      <ConfirmationVerification />
    </main>
  );
}
