"use client";

import { Incident } from "@/components/erreurs/incident";

import { CLASSES_POLICES } from "./polices";

import "./globals.css";

// Erreur dans le gabarit racine : cette page le remplace, et porte donc son
// propre document, ses polices et ses styles. Ne lit que error.digest (S-85,
// T-35). Fiche : docs/features/socle-interface.md, section 4.1.
export default function ErreurGlobale({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  return (
    <html lang="fr" className={`${CLASSES_POLICES} h-full antialiased`}>
      <body className="min-h-full flex flex-col">
        <Incident digest={error.digest} retry={retry} />
      </body>
    </html>
  );
}
