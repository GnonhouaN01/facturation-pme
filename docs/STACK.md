# STACK.md — Stack technique

Application de facturation pour petites structures.
Statut : **validé**. Version du 5 octobre 2026, mise à jour après la configuration.

Ce document liste les outils et services retenus, leur rôle, la raison du choix et les limites de leur offre gratuite. Versions installées lors de la configuration : Next.js 16.3.8, React 19.2.8, Drizzle 1.0.0-rc.4, Better Auth 1.7.7, Vitest 5.0.3, PostgreSQL 18.6, Node.js 24. Les versions exactes font foi dans `package.json` et `package-lock.json`.

**Ligne directrice :** le moins de services externes possible. Chaque service ajouté représente un compte, un secret à protéger et un destinataire de données supplémentaire.

---

## 1. Outils de construction

| Besoin | Outil | Rôle dans le projet | Raison du choix |
|---|---|---|---|
| Framework | Next.js (App Router) | Interface et serveur dans un seul dépôt | Imposé. Une seule langue de bout en bout |
| Langage | TypeScript, mode strict | Détecter les erreurs avant l'exécution | Imposé |
| Base de données | PostgreSQL | Stockage, contraintes, transactions, isolation par organisation au niveau des lignes | Imposé |
| ORM | Drizzle, avec le pilote `pg` | Requêtes typées et paramétrées, migrations en SQL lisible | Modélisation native des règles de sécurité au niveau des lignes (S-04, T-30). Proche du SQL |
| Authentification | Better Auth, avec l'adaptateur `@better-auth/drizzle-adapter/relations-v2` | Comptes, sessions, vérification d'email, réinitialisation, double authentification, organisations et invitations | Activement développé, alors qu'Auth.js est en maintenance. Double authentification et codes de secours inclus (S-12) |
| Validation | Zod | Vérifier à l'exécution tout ce qui vient de l'extérieur | Imposé. Schémas partagés entre formulaires et serveur (S-50) |
| Interface | Tailwind et shadcn/ui | Style et composants accessibles | Imposé. Le code des composants appartient au projet (NF-04) |
| PDF | @react-pdf/renderer | Générer devis, factures et avoirs | Aucun navigateur lancé, aucune ressource distante chargée (S-87, T-63) |
| Tests unitaires et d'intégration | Vitest, en environnement Node | Calculs, règles métier, tests d'attaque | Imposé |
| Tests de bout en bout | Playwright | Parcours complets dans un vrai navigateur, captures d'écran | Imposé |

## 2. Services hébergés

| Besoin | Service | Limites de l'offre gratuite | Raison du choix |
|---|---|---|---|
| Hébergement | Vercel, fonctions à Francfort (fra1) | Usage personnel et non commercial. Environ 100 Go de transfert et un million d'appels de fonctions par mois | Imposé. Déploiement automatique et prévisualisation de chaque PR |
| Base managée | Neon, région de Francfort, trois branches : `production`, `preview`, `dev` | 0,5 Go de stockage et 100 heures de calcul par projet et par mois. Mise en veille après 5 minutes d'inactivité, réveil automatique. 10 branches. Restauration sur 6 heures | Pas de mise en pause prolongée. Une branche de base par prévisualisation (T-74) |
| Emails | Resend, **à configurer avec la fonctionnalité de vérification d'email** | 3 000 emails par mois, 100 par jour, un domaine vérifié | Suffisant avec notre propre limitation de débit (S-55) |
| Tâches planifiées | Vercel Cron | Une exécution par jour au plus, précision d'une heure | Aucun service en plus |
| Suivi des erreurs | Sentry, **à configurer avec la première fonctionnalité mise en production** | À vérifier à ce moment-là | Identifiant d'incident (S-85) |
| Dépôt et intégration continue | GitHub | Gratuit pour un dépôt public | Imposé |

## 3. Besoins couverts sans service externe

| Besoin | Solution | Raison |
|---|---|---|
| Limitation de débit | Extension de Better Auth pour les connexions, table de compteurs dans PostgreSQL pour le reste | Un service, un compte et un secret en moins |
| Stockage du logo | Dans PostgreSQL, 200 Ko maximum | Même isolation par organisation que les autres données, pas d'adresse publique |
| Emails en développement | Interception locale, rien n'est envoyé | Aucun email réel pendant les tests |
| Statuts « expiré » et « en retard » | Calculés à la lecture à partir des dates | Exacts même si la tâche quotidienne échoue |
| Certification FNE | Module interne avec simulateur | Voir SPEC.md, section 1.3 |

## 4. Coût

Zéro, à l'exception d'un nom de domaine (quelques euros par an), nécessaire pour envoyer des emails à de vrais destinataires. Ce point sera confirmé dans la documentation de Resend en phase 6.

## 5. Destinataires de données

| Service | Ce qu'il reçoit | Précaution |
|---|---|---|
| Neon | Toutes les données | Connexion chiffrée, secrets distincts par environnement |
| Vercel | Le code, les secrets d'exécution, le trafic | Secrets saisis dans son interface, jamais dans le dépôt |
| Resend | Adresses des destinataires et contenu des emails | Contenu limité au nécessaire, liens plutôt que pièces jointes |
| Sentry | Erreurs et leur contexte technique | Réglé pour ne recevoir aucune donnée personnelle ni secret (S-54) |
| GitHub | Le code source | Dépôt public : aucun secret, aucune donnée réelle |

Le pays d'hébergement de chaque service sera relevé en phase 6 et reporté dans THREATS.md, section 7.5.

## 6. Points de vigilance

1. **Versions majeures en cours de sortie.** Drizzle et Better Auth évoluent vite. Les versions seront fixées explicitement, et les mises à jour de sécurité suivies (S-88, T-71).
2. **Rôles de Better Auth.** Son extension d'organisations a ses propres rôles par défaut. Nos quatre rôles y seront déclarés, et la matrice des droits restera dans notre code, à un seul endroit.
3. **Tables de Better Auth et isolation.** L'isolation au niveau des lignes s'applique à nos tables métier sans gêner celles de la bibliothèque. À traiter dans le modèle de données.
4. **Sauvegardes.** La fenêtre de restauration de Neon étant de six heures, une sauvegarde hebdomadaire automatique sera ajoutée (NF-07).
5. **Usage non commercial de Vercel.** Adapté à un portfolio. Une mise en service réelle imposerait une offre payante ou un autre hébergeur.
6. **Chiffres à reconfirmer.** Les limites ci-dessus viennent de comparatifs récents. Elles seront revérifiées sur les pages officielles à la création des comptes.

## 7. Choix écartés

| Écarté | Au profit de | Raison |
|---|---|---|
| Prisma | Drizzle | Pas de contrôle d'accès intégré, SQL masqué |
| Auth.js | Better Auth | Projet en maintenance, double authentification à écrire soi-même |
| Supabase | Neon | Mise en pause après sept jours d'inactivité, pas de branches en offre gratuite |
| Navigateur sans interface pour les PDF | @react-pdf/renderer | Lourd sur Vercel, risque de chargement de ressources distantes |
| Service Redis externe | Compteurs dans PostgreSQL | Un service de moins |
| Vercel Blob | Logo en base | Adresse publique à protéger, un service de moins |
| Tests de composants en navigateur simulé (jsdom, Testing Library) | Vitest côté serveur et Playwright pour l'interface | Conflit de dépendances à l'installation, et l'essentiel des tests porte sur la logique serveur |

## 8. Écarts constatés pendant la configuration

| Sujet | Prévu | Réalisé | Raison |
|---|---|---|---|
| Tests de composants | Vitest avec navigateur simulé | Abandonnés. Vitest pour la logique serveur, Playwright pour l'interface | Conflit de dépendances entre deux outils tiers, et besoin réel situé côté serveur |
| Resend | Configuré en phase 6 | Reporté à la fonctionnalité de vérification d'email | Aucun email envoyé pour l'instant, nom de domaine requis |
| Sentry | Configuré en phase 6 | Reporté à la première fonctionnalité en production | Pas de secret dormant |
| Base de prévisualisation | Une branche Neon par PR | Une branche `preview` commune | L'organisation Neon est indépendante de Vercel. À réévaluer avec la CI |
| Outil `shadcn` | Dépendance de l'application | Outil de développement | N'est utilisé qu'à la construction |
| Route d'authentification | Créée avec Better Auth | Non créée | Ne rien exposer avant la fonctionnalité et ses règles (S-10 à S-17) |

## 9. Environnements

| Environnement | Hébergement | Branche Neon | Secrets |
|---|---|---|---|
| Développement | Poste local | `dev` | `.env.local`, jamais commité |
| Prévisualisation | Vercel, adresse protégée par connexion | `preview` | Vercel, type Secret, portée Preview |
| Production | Vercel, région de Francfort | `production` | Vercel, type Secret, portée Production |

Chaque environnement a son propre mot de passe pour le rôle `app_facturation` et son propre secret Better Auth. Le rôle propriétaire `neondb_owner` n'est présent dans aucun environnement Vercel.

## 10. Scripts d'administration

| Script | Rôle |
|---|---|
| `scripts/verifier-connexion.mjs` | Vérifie les deux connexions et leurs rôles |
| `scripts/verifier-tables.mjs` | Liste les tables accessibles au rôle de l'application |
| `scripts/verifier-isolation.mjs` | Prouve l'isolation entre organisations |
| `scripts/verifier-auth.mts` | Vérifie que Better Auth lit la base |
| `scripts/renouveler-mot-de-passe-app.mjs` | Renouvelle le mot de passe applicatif de la branche `dev` |
| `scripts/preparer-url-application.mjs` | Prépare l'adresse applicative d'une autre branche, pour Vercel |
| `scripts/retablir-acces-dev.mjs` | Réinscrit dans `.env.local` les deux adresses de la branche `dev`, après recréation de la branche ou renouvellement du mot de passe du propriétaire |

## 11. Mise en garde : expiration des branches Neon

Dans la console de Neon, la case « Automatically delete branch after » est cochée par défaut à la création d'une branche, avec une durée d'un jour. Les branches `dev` et `preview` ont été supprimées ainsi une première fois, le 5 octobre 2026, puis recréées sans cette option.

- Toute nouvelle branche durable se crée avec cette case **décochée**.
- La branche `production`, branche par défaut, ne peut pas expirer.
- Après la recréation d'une branche, son serveur change : relancer `scripts/retablir-acces-dev.mjs` pour `dev`, ou `scripts/preparer-url-application.mjs` puis mettre à jour Vercel pour `preview`.
