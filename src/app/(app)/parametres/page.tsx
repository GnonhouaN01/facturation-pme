import { EnTetePage } from "@/components/gabarits/en-tete-page";
import { FormulaireFiche } from "@/components/parametres/formulaire-fiche";
import { InstructionsPaiement } from "@/components/parametres/instructions-paiement";
import { Logo } from "@/components/parametres/logo";
import { TauxTva } from "@/components/parametres/taux-tva";
import { lirePourPage } from "@/server/actions/exposer";
import { lirePageParametres } from "@/server/services/parametres";
import { TEXTES_PARAMETRES } from "@/textes/parametres";

import {
  ajouterTaux,
  changerEtatTaux,
  enregistrerFiche,
  enregistrerInstructions,
  enregistrerLogo,
  retirerLogo,
} from "./actions";

// Paramètres de l'organisation (2.2, UC-07). Réservée au Propriétaire : la
// page se protège elle-même par lirePourPage, avec le droit de modifier la
// fiche ; tout autre rôle, sans session ou sans adhésion : « introuvable »
// (S-02). Aucune métadonnée propre. Le logo n'est jamais lu ici : l'aperçu
// passe par la route /parametres/logo. Fiche :
// docs/features/parametres-organisation.md, section 8.
export default async function PageParametres() {
  const { parametres, taux } = await lirePourPage("organisation.fiche.modifier", (ctx) =>
    lirePageParametres(ctx),
  );
  return (
    <div className="flex flex-col gap-8">
      <EnTetePage titre={TEXTES_PARAMETRES.titre} />
      <FormulaireFiche fiche={parametres} enregistrer={enregistrerFiche} />
      <TauxTva taux={taux} ajouter={ajouterTaux} changerEtat={changerEtatTaux} />
      <Logo
        logo={
          parametres.logoType === null
            ? null
            : {
                type: parametres.logoType,
                version: String(parametres.modifieLe?.getTime() ?? 0),
              }
        }
        enregistrer={enregistrerLogo}
        retirer={retirerLogo}
      />
      {/* Le Propriétaire a toujours son second facteur (étape 7 de la
          chaîne, S-12) : le code est exigé avec le mot de passe. */}
      <InstructionsPaiement
        instructions={{
          mobileMoney: parametres.paiementMobileMoney,
          bancaire: parametres.paiementBancaire,
        }}
        codeExige
        enregistrer={enregistrerInstructions}
      />
    </div>
  );
}
