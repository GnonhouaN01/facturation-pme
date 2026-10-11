"use client";

import { Incident } from "@/components/erreurs/incident";

// Frontière d'erreur des pages. Ne lit que error.digest : jamais message,
// name, stack ni cause (S-85, T-35). Fiche : docs/features/socle-interface.md,
// section 4.1.
export default function PageErreur({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  return <Incident digest={error.digest} retry={retry} />;
}
