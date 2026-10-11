import type { Metadata } from "next";
import { connection } from "next/server";

import { TEXTES_COMMUNS } from "@/textes/commun";

import { CLASSES_POLICES } from "./polices";

import "./globals.css";

export const metadata: Metadata = {
  title: TEXTES_COMMUNS.produit,
  description: TEXTES_COMMUNS.description,
};

// connection() rend toutes les pages à la requête, page « introuvable »
// comprise : une page préconstruite n'aurait pas de nonce, et la politique
// de sécurité du contenu bloquerait ses scripts. Fiche :
// docs/features/socle-interface.md, section 5.2.
export default async function RootLayout({ children }: LayoutProps<"/">) {
  await connection();
  return (
    <html lang="fr" className={`${CLASSES_POLICES} h-full antialiased`}>
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
