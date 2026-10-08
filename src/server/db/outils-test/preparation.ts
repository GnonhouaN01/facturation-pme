import "server-only";

import { verifierBaseDeTest } from "./garde-base";

// Fichier setupFiles du projet Vitest integration : s'exécute avant chaque
// fichier de test. Un refus fait échouer le fichier avant toute écriture.
await verifierBaseDeTest();
