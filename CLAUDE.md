@AGENTS.md

# Facturation PME

Application de facturation multi-organisation pour petites structures (Côte d'Ivoire, francs CFA).

## Documents de référence

Lis la section utile avant toute tâche. Ne les charge pas en entier.

- `docs/SPEC.md` : exigences numérotées (F fonctionnelle, R règle métier, S sécurité, NF non fonctionnelle)
- `docs/USECASES.md` : cas d'utilisation, erreurs et cas d'abus
- `docs/THREATS.md` : menaces (T), matrice des droits en section 6
- `docs/DESIGN.md` : modèle de données, chaîne de contrôles en section 3.2, règles d'architecture en 4.3
- `docs/STACK.md` : outils retenus et choix écartés
- `docs/EXCEPTIONS-SECURITE.md` : failles connues et acceptées

## Commandes

- `npm run dev`, `npm run build`, `npm run typecheck`, `npm run lint`, `npm run format`
- `npm test` : Vitest, fichiers `src/**/*.test.ts`
- `npm run test:e2e` : Playwright, dossier `e2e/`
- `npm run db:generate` puis lecture du SQL généré, puis `npm run db:migrate`
- `node scripts/verifier-connexion.mjs`, `verifier-tables.mjs`, `verifier-isolation.mjs`

## Règles de sécurité (non négociables)

1. Ne lis, n'affiche et ne modifie jamais `.env.local`. N'écris aucun secret dans le code, les tests, les journaux ou les commits.
2. Aucun fichier de `src/` ne mentionne `DATABASE_URL_MIGRATION`. L'application n'utilise que `DATABASE_URL`, le rôle restreint `app_facturation`.
3. Toute table métier porte `organisation_id NOT NULL` et une règle de sécurité au niveau des lignes, activée et forcée. Modèle : `scripts/verifier-isolation.mjs`.
4. Toute requête passe par la couche d'accès aux données. Aucun import de `drizzle-orm` ailleurs. Aucune requête construite par concaténation.
5. Toute action serveur et toute route passe par la fonction commune de contrôle : origine, session, rôle, validation. La matrice des droits vit dans un seul fichier.
6. Un accès refusé reçoit la même réponse qu'une ressource inexistante (S-02).
7. Toute entrée externe est validée côté serveur par un schéma Zod. Le serveur recalcule les totaux et ignore ceux reçus.
8. Les montants sont des entiers en francs CFA. Aucun nombre à virgule flottante.
9. Un document émis, un paiement et le journal d'audit ne sont jamais modifiés ni supprimés.
10. Aucune nouvelle dépendance sans accord explicite : propose le nom exact, la raison et une alternative. Jamais `npm audit fix`. Composants shadcn par leur nom uniquement, jamais par une adresse.
11. Aucune route exposée, dont `/api/auth`, hors d'une fiche de fonctionnalité validée.

## Méthode de travail

- Une fonctionnalité correspond à une fiche `docs/features/<nom>.md`, validée avant d'écrire le code : contexte, problème, solution retenue, sécurité et permissions, critères d'acceptation, tests, statut.
- Les tests d'abord : écris les tests, dont les tests d'attaque des menaces citées dans la fiche, montre qu'ils échouent, puis implémente.
- Avant de dire qu'une tâche est terminée : `npm run typecheck`, `npm run lint`, `npm test`, `npm run build`. Montre les sorties. N'affirme rien sans preuve.
- Ne modifie que les fichiers du périmètre de la tâche. Si un autre changement semble nécessaire, demande.
- Ne modifie jamais une migration déjà appliquée, ni le dossier `drizzle/` à la main.
- Une branche par fonctionnalité (`feat/...`, `fix/...`). Commits au format `type(portée): message`, en français.
- Interface en français, textes regroupés dans des fichiers dédiés (NF-01).
- En cas de doute sur une exigence, demande. N'invente pas de règle métier.

## Pièges connus

- Drizzle 1.0 en version candidate avec Better Auth : utiliser `@better-auth/drizzle-adapter/relations-v2`. Le fichier `src/db/auth-schema.ts` est généré par `npx auth@latest generate`, ne l'édite pas à la main.
- Connexion groupée de Neon : l'organisation active se fixe avec `set_config('app.organisation_id', ..., true)` à l'intérieur d'une transaction.
- Poste sous Windows avec Git Bash. Fins de ligne au format LF.
- L'emplacement `src/db/` est provisoire, la structure définitive des dossiers reste à fixer.
