import { mkdirSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";

// Sortie des serveurs de bout en bout, conservée à chaque exécution pour
// expliquer après coup une réponse 500 : un fichier par serveur
// (<horodatage>-site.log, <horodatage>-panne.log) dans un dossier ignoré
// par git. Les exécutions les plus anciennes sont supprimées au-delà de
// garder. Fiche : docs/features/e2e-base-jetable.md, section 4.

export const DOSSIER_JOURNAUX = ".e2e-journaux";

const FICHIER = /^(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z)-(site|panne)\.log$/;

export function preparerJournaux(options: {
  dossier: string;
  garder?: number;
  maintenant?: Date;
}): { site: string; panne: string } {
  const { dossier, garder = 10, maintenant = new Date() } = options;
  mkdirSync(dossier, { recursive: true });

  const executions = new Map<string, string[]>();
  for (const nom of readdirSync(dossier)) {
    const horodatage = FICHIER.exec(nom)?.[1];
    if (horodatage) executions.set(horodatage, [...(executions.get(horodatage) ?? []), nom]);
  }
  // La nouvelle exécution compte parmi celles gardées.
  const anciennes = [...executions.keys()]
    .sort()
    .reverse()
    .slice(Math.max(garder - 1, 0));
  for (const horodatage of anciennes) {
    for (const nom of executions.get(horodatage) ?? []) rmSync(join(dossier, nom), { force: true });
  }

  const prefixe = maintenant.toISOString().replace(/[:.]/g, "-");
  return {
    site: join(dossier, `${prefixe}-site.log`),
    panne: join(dossier, `${prefixe}-panne.log`),
  };
}
