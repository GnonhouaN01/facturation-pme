# Fonctionnalité : journal d'audit

Statut : livrée

Jalon 0, fonctionnalité 0.3 de `docs/PLAN.md`. Taille S.

## Contexte

Cette fonctionnalité sert au développeur. Elle fournit le mécanisme d'écriture du journal d'audit, que les fonctionnalités des jalons 2 à 7 appelleront pour chaque action sensible (S-70, et `PLAN.md` section 5 : « Les actions sensibles écrivent au journal d'audit »). La consultation par le Propriétaire (UC-31) est la fonctionnalité 7.3.

Aujourd'hui :

- La fonctionnalité 0.2 est livrée et déployée : `executerDansOrganisation`, le modèle `colonneOrganisation()` et `regleIsolation()` (`src/server/db/schema/isolation.ts`), l'outillage de `src/server/db/outils-test/`, le test d'inventaire, et la table témoin `temoin_isolation`, présente en production et sur `preview`.
- Aucune table du journal n'existe. `docs/DESIGN.md` (section 2.3) en décrivait les colonnes : `id`, `organisation_id`, `auteur_id` (clé étrangère), `action`, `type_ressource`, `ressource_id`, `details`, `cree_le`. Corrigé à la validation : `auteur_id` sans clé étrangère (décision 3).
- Le rôle de l'application reçoit, sur toute table créée par le rôle propriétaire, `SELECT, INSERT, UPDATE, DELETE` par les droits par défaut (`ALTER DEFAULT PRIVILEGES`, `docs/CONFIGURATION.md` et `scripts/preparer-base-test.mjs`). Une nouvelle table est donc modifiable et supprimable par l'application tant qu'on ne retire rien. `TRUNCATE` n'est pas dans ces droits par défaut.
- Vérifié dans `node_modules` (drizzle-orm et drizzle-kit 1.0.0-rc.4) : drizzle-orm n'offre aucun moyen de déclarer un droit sur une table dans le schéma (la liste des droits du schéma est toujours vide), et drizzle-kit ne produit `GRANT` et `REVOKE` que pour une base qu'il lit, jamais depuis le schéma. drizzle-kit ne produit pas non plus de déclencheur. Le retrait de droits ne peut donc pas être généré.

Cas d'utilisation concernés : UC-31 (le journal ne peut être ni modifié ni vidé, il ne contient que des identifiants et des libellés), UC-15 (l'anonymisation ne recopie pas les données effacées dans le journal), UC-13 (la suppression de l'organisation emporte le journal, voir section 3). Indirectement, tous les cas d'utilisation qui « inscrivent au journal d'audit ».

## Problème

- Aucune table ne peut recevoir les traces exigées par S-70 et S-71.
- Une table créée par le chemin habituel serait modifiable et supprimable par l'application : un membre malveillant, par une faille du code, pourrait effacer ses traces (T-21).
- Rien ne garantit qu'une trace est écrite dans la même transaction que l'action qu'elle décrit : une action pourrait réussir sans trace, ou une trace subsister pour une action annulée (S-70, `DESIGN.md` section 3.2, étape 7).
- Rien n'empêche d'écrire dans le champ de détails un nom, un email ou un téléphone (S-54, UC-31).
- La vérification générique d'isolation (`verifierIsolation`) et le nettoyage des tests (`nettoyer`) supposent qu'on peut modifier et supprimer ses propres lignes : ils échoueraient sur une table en ajout seul.

## Solution retenue

Exigences couvertes : S-70 (mécanisme), S-71. Aucune exigence F ou R.

### 1. La table `journal_audit`

Déclarée dans `src/server/db/schema/technique.ts` sous le nom `journalAudit` (`docs/STRUCTURE.md` section 3 y place le journal), par `pgTable.withRLS(...)`, `colonneOrganisation()` et `regleIsolation()`.

| Colonne SQL | Propriété Drizzle | Définition | Remarque |
|---|---|---|---|
| `id` | `id` | `uuid`, clé primaire, `gen_random_uuid()` par défaut | |
| `organisation_id` | `organisationId` | `colonneOrganisation()` : `uuid NOT NULL`, clé étrangère vers `organization.id` en `ON DELETE RESTRICT` | Valeur imposée par la transaction (section 5) |
| `auteur_id` | `auteurId` | `uuid NOT NULL`, **sans clé étrangère** | Section 4 (décision 3) |
| `action` | `action` | `text NOT NULL` | Liste fermée dans le code seulement, sans `CHECK` en base (section 6, décision 6) |
| `type_ressource` | `typeRessource` | `text NOT NULL` | Déduit de l'action, jamais choisi par l'appelant |
| `ressource_id` | `ressourceId` | `uuid NOT NULL` | |
| `details` | `details` | `jsonb NOT NULL`, `'{}'` par défaut | Validé par un schéma par action (section 6) |
| `cree_le` | `creeLe` | `timestamp with time zone NOT NULL`, `now()` par défaut | Jamais fourni par l'appelant. `now()` est l'heure de début de la transaction : l'action et sa trace portent la même heure |

Index exigé par la règle 3 de `CLAUDE.md` : `journal_audit_organisation_cree_le_idx` sur `(organisation_id, cree_le)`. `organisation_id` en première colonne ; `cree_le` en seconde, parce que la consultation (7.3) liste par période, du plus récent au plus ancien. Les index par auteur ou par action sont laissés à la 7.3, qui connaîtra ses filtres.

S-71 est couverte colonne par colonne : auteur (`auteur_id`), organisation (`organisation_id`), action (`action`), ressource (`type_ressource`, `ressource_id`), horodatage (`cree_le`). Toutes sont `NOT NULL`.

### 2. Le retrait des droits, et l'exception sur les migrations `--custom`

#### 2.1 Ce qui est retiré

Au rôle `app_facturation`, sur `journal_audit` : `UPDATE`, `DELETE` et `TRUNCATE`. Il garde `SELECT` (la 7.3 lira le journal ; `INSERT ... RETURNING` en a aussi besoin) et `INSERT`.

- `UPDATE` et `DELETE` : accordés par les droits par défaut, ils doivent être retirés.
- `TRUNCATE` : non accordé aujourd'hui, mais retiré explicitement. `TRUNCATE` **ignore les règles de sécurité au niveau des lignes** : accordé un jour par erreur (par exemple par un `GRANT ALL`), il viderait le journal de toutes les organisations d'un coup. Le retrait explicite documente l'intention, et le test d'inventaire vérifie l'absence de ce droit (section 8).
- Un `REVOKE` d'un droit non accordé n'est pas une erreur quand il est exécuté par le propriétaire de la table.

Effet : toute tentative de modification, de suppression, de vidage ou d'`INSERT ... ON CONFLICT DO UPDATE` par l'application est refusée par la base avec le code `42501`, avant même l'évaluation de la règle d'isolation. Le refus ne dépend pas de l'organisation active.

#### 2.2 Où écrire le `REVOKE`

L'exception actuelle (`CLAUDE.md`, « Méthode de travail », et `acces-donnees.md` décision 2) ne couvre que `ALTER TABLE "<table>" FORCE ROW LEVEL SECURITY;`.

| Option | Avantages | Inconvénients |
|---|---|---|
| **E1. Une seconde forme d'exception, bornée** : migration créée par `npx drizzle-kit generate --custom --name retirer-droits-<table>`, dont le seul contenu est une ou plusieurs lignes `REVOKE UPDATE, DELETE, TRUNCATE ON TABLE "<table>" FROM "app_facturation";` | Même mécanisme que le forçage : dans la chaîne des migrations, appliqué partout par le workflow. Forme unique et vérifiable à l'œil : un seul verbe (`REVOKE`, jamais `GRANT`), une liste de droits fixe, un seul rôle. Le nom du dossier dit ce qu'il contient | Une seconde migration personnalisée par table en ajout seul |
| E2. Autoriser la ligne `REVOKE` dans la migration `forcer-isolation-<table>` | Un fichier de moins | Le nom ne dit plus le contenu. La règle « une seule forme de ligne par fichier » disparaît |
| E3. Exception générale : « tout SQL personnalisé relu » | Couvre d'avance les déclencheurs du jalon 5 | Ouvre `drizzle/` à n'importe quel SQL écrit à la main. Contraire à l'esprit de la règle |
| E4. Retrait par un script de `scripts/` après la migration | Aucun changement de la règle | Écarté pour le forçage pour la même raison : étape hors du workflow, facile à oublier en production |
| E5. Modifier les droits par défaut pour ne plus accorder `UPDATE, DELETE` | Aucune migration | Vaut pour toutes les tables : toutes les autres en ont besoin |

**Retenu (décision 1) : E1.** Texte pour `CLAUDE.md`, à la suite de l'exception actuelle, ajouté à l'implémentation, avant la création de la migration 3 :

> Seconde forme, pour une table en ajout seul : une migration créée par `npx drizzle-kit generate --custom --name retirer-droits-<table>`, dont le seul contenu est une ou plusieurs lignes `REVOKE UPDATE, DELETE, TRUNCATE ON TABLE "<table>" FROM "app_facturation";`. Jamais `GRANT`. Même partage des rôles : l'assistant crée le fichier vide par la commande et indique la ligne exacte ; le développeur la colle.

La liste des tables en ajout seul est tenue dans le test d'inventaire (section 8) : une migration `retirer-droits-` sur une table absente de cette liste fait échouer la suite, et inversement.

#### 2.3 Faut-il en plus un déclencheur ?

Un déclencheur `BEFORE UPDATE OR DELETE ... FOR EACH ROW` et `BEFORE TRUNCATE ... FOR EACH STATEMENT`, appelant une fonction qui lève une exception, refuserait ces opérations à **tout** rôle, propriétaire compris.

| | Retrait de droits seul (D0) | Retrait de droits et déclencheur complet (D1) | Retrait de droits et déclencheur sur `UPDATE` et `TRUNCATE` seulement (D2) |
|---|---|---|---|
| Contre l'application (T-21, attaquant P4) | Suffisant | Redondant | Redondant |
| Contre une erreur du rôle propriétaire (migration fautive, script de réparation) | Rien | Protège | Protège contre la modification et le vidage, pas contre la suppression |
| Contre un propriétaire malveillant | Rien | Rien : le propriétaire peut désactiver ou supprimer le déclencheur | Rien |
| SQL écrit à la main | Une ligne `REVOKE` | Une fonction PL/pgSQL, deux déclencheurs : l'exception de la section 2.2 devrait couvrir du code, pas seulement une ligne | Idem D1 |
| Test d'inventaire | Droits | Droits, et présence et activation des déclencheurs | Idem D1 |
| Suppression d'une organisation (UC-13, R-15) | Le propriétaire peut supprimer le journal de l'organisation à l'issue du délai | Impossible sans désactiver le déclencheur (`ALTER TABLE ... DISABLE TRIGGER`), qui verrouille toute la table pendant la purge, ou sans une condition d'exception dans la fonction (« organisation en attente de suppression depuis 30 jours ») : une règle métier dans un déclencheur | Comme D0 |

Rappel de la conséquence sur UC-13, quelle que soit l'option : avec `ON DELETE RESTRICT` (modèle) et `DELETE` retiré, l'application **ne peut pas** supprimer une organisation qui a une seule ligne au journal. C'est voulu : supprimer l'organisation ne doit pas devenir un moyen d'effacer le journal. La purge de l'étape 5 d'UC-13 demandera donc un chemin privilégié, conçu par la fonctionnalité 2.5 (section « Reporté »).

**Retenu (décision 2) : D0** en 0.3. La menace T-21 vise un membre, qui n'agit que par le rôle de l'application ; le retrait de droits l'arrête entièrement. Le déclencheur ne protège que d'une erreur du propriétaire, au prix d'une exception élargie à du code PL/pgSQL collé à la main, et complique UC-13. La question se reposera au jalon 5, où `DESIGN.md` (section 2.4) prévoit de toute façon un déclencheur contre la modification des documents émis (R-05, T-10) : si une forme d'exception pour les déclencheurs est alors acceptée, D2 pourra s'ajouter au journal pour un coût marginal.

### 3. Suppression d'une organisation et nettoyage des tests

Conséquence directe des sections 1 et 2 : une organisation qui a une ligne au journal ne peut être supprimée ni par l'application, ni par l'outillage de test, qui passe par le même rôle.

- En CI, la base est neuve à chaque exécution : rien à faire.
- Sur `dev`, les organisations de test qui ont écrit au journal **restent**, avec leur `slug` préfixé par `test-`. La recréation de la branche `dev` les efface (`PLAN.md` section 7, décision 7 de `acces-donnees.md`).
- Pour limiter ce reste, les tests qui n'ont pas besoin d'une trace validée écrivent dans une transaction qu'ils annulent eux-mêmes (une exception levée à la fin de `travail`, après les vérifications). Seuls `verifierIsolation` et les tests d'attaque qui exigent une ligne existante valident leurs écritures : de l'ordre de 4 organisations laissées par exécution de `npm run test:integration` sur `dev`. Accepté (décision 8), et noté dans `docs/CONFIGURATION.md`.

Écarté : supprimer les lignes de test par le rôle propriétaire (contraire à la règle 2 : les tests ne connaissent que `DATABASE_URL`) ; une fonction `SECURITY DEFINER` de purge (elle existerait aussi en production, et serait un moyen d'effacer le journal) ; une clé étrangère en `ON DELETE CASCADE` sur le journal (supprimer l'organisation effacerait le journal, ce que `RESTRICT` empêche justement ; contraire au modèle).

`creerDeuxOrganisations` reçoit une option `tablesAjoutSeul`. `nettoyer()` :

- supprime, comme aujourd'hui, les lignes des tables de `tables` ;
- ne tente aucune suppression dans les tables de `tablesAjoutSeul` ;
- compte, dans `executerDansOrganisation`, les lignes de chaque organisation dans ces tables, et ne supprime que les organisations qui n'en ont aucune ;
- ne lève toujours pas d'erreur, et reste appelable deux fois.

### 4. L'auteur

| Option | Compte supprimé (S-62) | Effet sur la preuve (T-20) |
|---|---|---|
| A1. Clé étrangère vers `user.id`, `ON DELETE RESTRICT` | Un utilisateur qui a une seule trace ne peut plus supprimer son compte : S-62 devient inapplicable | Conservée |
| A2. Clé étrangère, `ON DELETE SET NULL` | Possible : la base met `auteur_id` à `NULL`. C'est une modification d'une ligne du journal, faite par la clé étrangère avec les droits du propriétaire, malgré le retrait de droits | Perdue : on ne sait plus qui a agi |
| A3. Clé étrangère, `ON DELETE CASCADE` | Possible : les traces de l'utilisateur sont supprimées | **Faille** : un membre efface ses traces en supprimant son compte (T-21) |
| **A4. Identifiant `uuid` sans clé étrangère** | Possible : la ligne garde l'identifiant, qui ne désigne plus aucun compte | Conservée : les traces d'un même auteur restent reliées entre elles |

**Retenu (décision 3) : A4.** Conforme à `THREATS.md` section 7.2 : l'auteur est conservé « pendant la durée de vie de l'organisation » et supprimé « avec l'organisation », pas avec le compte. L'identifiant seul ne permet plus d'identifier la personne une fois le compte supprimé. La 7.3 affichera « compte supprimé » quand l'identifiant ne correspond à aucun compte. `DESIGN.md` section 2.3 est corrigé en conséquence.

Ce que perd A4 : la base ne vérifie plus que l'auteur existe au moment de l'écriture. C'est la fonction d'écriture qui reçoit l'identifiant, et la 0.4 qui garantira qu'il vient de la session vérifiée (section « Reporté »).

**Action sans compte, par un lien public.** Aucune action de la liste de S-70 n'est faite par un lien public : la réponse à un devis (UC-19) est prouvée par les colonnes du devis (F-042, T-22), pas par le journal. Retenu (décision 3) : `auteur_id NOT NULL`, sans colonne `auteur_type`. Si une fonctionnalité du jalon 4 ou 5 décide de journaliser une action par lien, elle ajoutera une colonne `auteur_type` (`'membre'` par défaut, puis `'lien_public'`, `auteur_id` portant alors l'identifiant du lien) et rendra `auteur_id` facultatif : ces deux changements ne réécrivent aucune ligne existante et passent par une migration générée. Écarté dès maintenant : une colonne et des valeurs sans usage.

### 5. L'organisation de la ligne

| Option | Écrire au nom d'une autre organisation |
|---|---|
| O1. Fournie par l'appelant | Refusé par la règle (`WITH CHECK`, `42501`) : sûr, mais l'appelant peut se tromper, et la transaction entière échoue |
| O2. Valeur par défaut de la colonne : l'organisation active de la transaction | Sûr. Mais `colonneOrganisation()` deviendrait différente pour cette table, ou le modèle changerait pour toutes |
| **O3. Imposée par la fonction d'écriture**, qui ne reçoit pas d'organisation et insère l'expression SQL de l'organisation active | Impossible par la fonction ; refusé par la règle pour tout autre chemin |

**Retenu : O3.** La fonction d'écriture n'a pas de paramètre d'organisation, et son schéma de validation est strict : une entrée qui contient `organisationId` (ou `organisation_id`) est refusée. L'insertion donne à `organisation_id` la valeur `NULLIF(current_setting('app.organisation_id', true), '')::uuid`, l'expression exacte de la règle. Pour qu'elle n'existe qu'en un seul endroit, `schema/isolation.ts` exporte ce fragment (`ORGANISATION_ACTIVE`) et la condition de la règle le réutilise ; critère : `npm run db:generate` ne produit alors aucune instruction sur `temoin_isolation`.

Deux barrières contre une trace au nom d'une autre organisation :

1. la fonction d'écriture ne permet pas de la choisir ;
2. un `tx.insert(journalAudit)` direct pour une autre organisation est refusé par la règle (`42501`) ; et une règle ESLint (section 7) confine l'insertion à un seul fichier.

Sans organisation active (une transaction ouverte autrement que par `executerDansOrganisation`), l'expression vaut `NULL` : l'insertion est refusée par la règle (`42501`, attendu) ou par `NOT NULL` (`23502`). Le code exact est constaté pendant la phase rouge et figé dans le test ; les deux sont un refus, et rien n'est écrit.

### 6. Liste fermée des actions et validation des détails

#### 6.1 La liste

Dans `src/server/journal/actions.ts`, un objet constant : pour chaque action, son type de ressource et le schéma Zod de ses détails. Le type TypeScript des actions en est dérivé ; le schéma d'entrée accepte `z.enum(...)` de ses clés. L'appelant ne choisit jamais `type_ressource` : la fonction le lit dans la liste.

Liste retenue (décision 4), tirée de S-70 et des cas d'utilisation qui « inscrivent au journal d'audit ». Elle ne contient que les actions sur l'organisation, les invitations et les membres :

| Action | Ressource | Source |
|---|---|---|
| `organisation.parametres_modifies` | `organisation` | UC-07, étapes 1, 2, 5 |
| `organisation.instructions_paiement_modifiees` | `organisation` | UC-07 étape 3, S-33, T-12 |
| `organisation.visibilite_modifiee` | `organisation` | UC-12 |
| `organisation.suppression_demandee` | `organisation` | UC-13, S-70 « suppression » |
| `organisation.suppression_annulee` | `organisation` | UC-13, erreur 4a |
| `invitation.creee` | `invitation` | UC-08 |
| `invitation.revoquee` | `invitation` | UC-08 étape 3 ; S-70 « changements de membres » |
| `membre.ajoute` | `membre` | UC-09 étape 5 (corrigé à la validation) ; S-70 « changements de membres » |
| `membre.role_modifie` | `membre` | UC-10 |
| `membre.retire` | `membre` | UC-10 |
| `membre.parti` | `membre` | Départ volontaire (`THREATS.md` section 6, dernière phrase) ; S-70 « changements de membres » |

Les types de ressource sont donc, en 0.3 : `organisation`, `invitation`, `membre`.

Les actions sur les clients, factures, avoirs, paiements, remboursements et exports sont **retirées** de la 0.3 (décision 4) : chacune sera ajoutée par sa propre fonctionnalité, quand sa table existera (section « Reporté »).

Non couvert : « connexions sensibles » (S-70). Une connexion concerne un compte, sans organisation : hors de la 0.3, à définir dans les fiches du jalon 1 (décision 5, point ouvert ajouté à `SPEC.md`).

Pour `membre`, `ressource_id` est l'identifiant de la ligne d'adhésion (table `member` de Better Auth), pas celui du compte.

Une fonctionnalité qui ajoute une action modifie cette liste et ses tests, dans sa propre PR. Retirer une action n'est jamais permis : les anciennes lignes doivent rester lisibles par la 7.3.

Écarté (décision 6) : une contrainte `CHECK (action IN (...))` en base, générée par drizzle-kit depuis la même liste. Elle refuserait une action inconnue même si la fonction d'écriture était contournée, mais chaque ajout d'action demanderait une migration. La liste fermée vit dans le code seulement ; le confinement de l'insertion (section 7) rend un contournement visible à la relecture.

#### 6.2 Les détails

**Exigence confirmée à la validation : le schéma des détails est strict. Il refuse toute clé inconnue et n'accepte que des identifiants, des valeurs énumérées, des nombres et des booléens. Aucun texte libre.** Donc aucun nom, email, téléphone, adresse, motif saisi ou secret (S-54, UC-31).

- Le schéma des détails de chaque action est un `z.strictObject` : toute clé inconnue est refusée.
- Ses champs ne sont construits qu'à partir de quatre briques fournies par `actions.ts` : identifiant (`z.uuid()`), valeur énumérée (`z.enum` d'une liste fermée), nombre (`z.int()`, entier, comme tout montant en francs CFA : règle 8 de `CLAUDE.md`, R-01), booléen. Aucune autre chaîne (ni `z.string()` libre, ni date en texte), aucun tableau, aucun objet ouvert, aucun objet imbriqué.
- En 0.3, toutes les actions ont des détails vides (`z.strictObject({})`). Chaque fonctionnalité définira les détails de son action, avec les mêmes briques. Exemple attendu en 2.4 : `membre.role_modifie` avec `{ ancienRole, nouveauRole }` en `z.enum` des rôles.
- Un test unitaire parcourt toute la liste, convertit chaque schéma par `z.toJSONSchema` (Zod 4.6, déjà installé), et échoue si un schéma n'est pas un objet sans propriétés supplémentaires, ou si une propriété n'est pas l'une des quatre briques : chaîne au format `uuid`, chaîne d'un `enum`, entier, booléen. Une action ajoutée plus tard avec un texte libre, une date en texte, un nombre à virgule, un tableau ou un objet imbriqué fait échouer la suite.
- Un motif saisi (avoir, annulation de paiement, plus tard) reste sur la ressource, jamais recopié au journal.

### 7. La fonction d'écriture

Deux fichiers, pour respecter « `drizzle-orm` ne s'importe que dans `src/server/db/` » (règle 4) :

- `src/server/db/requetes/journal.ts` : `insererEntreeJournal(tx, entree)`, une seule insertion par Drizzle, `organisation_id` pris de l'organisation active (section 5), `cree_le` laissé à la base. Ne valide rien. Premier fichier de `requetes/`.
- `src/server/journal/audit.ts` : la fonction publique.

```ts
journaliser<A extends ActionJournal>(
  tx: TransactionOrganisation,
  entree: { action: A; auteurId: string; ressourceId: string; details?: DetailsDe<A> },
): Promise<void>
```

Dans l'ordre :

1. Valider `entree` par un schéma strict (`z.strictObject`, union discriminée sur `action`) : action de la liste, `auteurId` et `ressourceId` en `z.uuid()`, détails selon l'action. Toute clé de plus, dont une organisation, est refusée.
2. En cas d'échec, lever `EntreeJournalInvalide`, message fixe « Entrée du journal d'audit invalide. », sans valeur reçue ni `cause` (S-54, même principe que `OrganisationActiveInvalide`). Aucune requête n'est envoyée. Levée à l'intérieur de `travail`, l'erreur annule toute la transaction : **une action dont la trace est invalide n'a pas lieu**.
3. Appeler `insererEntreeJournal(tx, ...)` avec le `type_ressource` lu dans la liste.

« Utilisable seulement dans `executerDansOrganisation` » repose sur trois barrières :

- le type : le premier paramètre est une `TransactionOrganisation`. `db` n'est pas de ce type (il n'a pas de `rollback`) : `journaliser(db, ...)` ne compile pas, vérifié par un `@ts-expect-error` dans un test ;
- la base : dans une transaction sans organisation active, l'insertion est refusée (section 5) ;
- la portée de la transaction : la trace est écrite par la même `tx` que l'action, donc validée ou annulée avec elle (S-70, `DESIGN.md` section 3.2, étape 7).

Limite connue : une transaction ouverte par `db.transaction` dans `src/server/db/` a aussi le type `TransactionOrganisation`. Cette porte est déjà fermée hors de `db/` par la règle ESLint sur `db` ; la garantie qu'un service ne reçoit que la transaction de la chaîne est reportée à la 0.4 (`acces-donnees.md`, « Reporté »).

Règle ESLint ajoutée (`no-restricted-imports`), vérifiée par `regles-import.test.ts` : `src/server/db/requetes/journal.ts` ne s'importe que depuis `src/server/journal/audit.ts` et les fichiers de test. Sans elle, un service pourrait écrire au journal sans validation des détails.

`docs/STRUCTURE.md` section 7 reçoit une ligne pour `server/journal/` : peut importer `server/db/` (le type `TransactionOrganisation` et `requetes/journal.ts`), et rien d'autre du projet ; `zod` en plus.

### 8. Adaptation des contrôles de test

#### 8.1 `verifierIsolation` en mode ajout seul

Sur une table en ajout seul, les contrôles 5, 7 et 8 rencontrent un refus de droit (`42501`) au lieu d'un résultat vide : ils échoueraient par une exception.

| Option | Avis |
|---|---|
| V1. Accepter, pour toute table, « 0 ligne » ou « refus `42501` » aux contrôles 5, 7 et 8 | **Écarté** : affaiblit toutes les tables. Une table métier qui aurait perdu par erreur son droit `UPDATE` passerait, et une autre qui aurait le droit mais pas la règle passerait par l'autre branche |
| V2. Fonction séparée `verifierAjoutSeul`, sans les contrôles 1 à 4 et 6 | Le journal ne prouverait plus son isolation en lecture et en insertion |
| **V3. Option `{ ajoutSeul: true }` de `verifierIsolation`, qui change les contrôles 5, 7, 8 et en ajoute deux, et vérifie d'abord que la table est réellement en ajout seul** | Retenu |

En mode ajout seul :

| # | Contrôle | Attendu |
|---|---|---|
| 0 (nouveau) | Le rôle de la connexion a `SELECT` et `INSERT`, et n'a ni `UPDATE`, ni `DELETE`, ni `TRUNCATE` sur la table (`has_table_privilege(current_user, $1, ...)`, nom de table en paramètre lié, lu par `getTableName`) | Sinon échec du « contrôle 0 » : **le mode ne peut pas masquer une table qui a encore ces droits** |
| 1 à 4, 6 | Inchangés | Inchangés |
| 5 | Organisation A active, modifier les lignes de B | Refus `42501`, et la ligne de B est intacte (relue dans une transaction de B) |
| 7 | Organisation A active, supprimer les lignes de B | Refus `42501`, et la ligne de B existe toujours |
| 8 | Organisation A active, déplacer sa propre ligne vers B | Refus `42501`, et la ligne de A est intacte |
| 9 (nouveau) | Organisation A active, `TRUNCATE` de la table | Refus `42501`, et les lignes de A et de B existent toujours |

Sans l'option, rien ne change : les huit contrôles et leurs attentes restent ceux de la 0.2. Le nettoyage interne de `verifierIsolation` passe la table dans `tablesAjoutSeul` quand l'option est donnée.

`TRUNCATE` n'a pas de constructeur dans Drizzle : il s'écrit `sql\`TRUNCATE ${table}\``, où Drizzle rend l'objet table comme un identifiant entre guillemets. Aucune valeur reçue n'est concaténée (S-86).

#### 8.2 Le test d'inventaire

Ce qui s'applique au journal sans changement : il porte `organisation_id`, donc le test vérifie déjà `NOT NULL`, `uuid`, la clé en `ON DELETE RESTRICT`, la règle activée et forcée, la règle unique identique à celle de `temoin_isolation`. Un oubli de la migration de forçage fait échouer la suite.

Ajouts à `schema-isolation.integration.test.ts`, dans de nouveaux tests ; le test existant de la 0.2 n'est pas modifié :

1. **Ajout seul.** Une constante `TABLES_AJOUT_SEUL = ["journal_audit"]`. Parmi les tables portant `organisation_id`, l'ensemble de celles où le rôle de l'application n'a pas `UPDATE` ou pas `DELETE` est **exactement** cette liste, et chacune a `SELECT` et `INSERT` et n'a pas `TRUNCATE`. Un `REVOKE` oublié ou posé sur la mauvaise table fait échouer la suite.
2. **`TRUNCATE` nulle part.** Aucune table du schéma `public` (tables de Better Auth et `compteur_debit` comprises) n'accorde `TRUNCATE` au rôle de l'application. Raison : `TRUNCATE` ignore la règle d'isolation.
3. **Index (décision 7).** Toute table portant `organisation_id` a un index dont `organisation_id` est la première colonne, sauf les tables d'une liste d'exemption explicite, `EXEMPTIONS_INDEX`, réduite à `temoin_isolation`. Motif de l'exemption, écrit à côté de la constante : la table témoin n'a aucun usage métier, ne reçoit de lignes que des tests et reste vide en production ; aucune requête de l'application ne la filtre, et lui ajouter un index demanderait une migration sur une table déjà déployée, sans gain. Exigence de la règle 3 de `CLAUDE.md`, jamais vérifiée jusqu'ici. Le journal est la première table à y être soumise. Le test vérifie aussi que chaque table de l'exemption existe et porte `organisation_id`, pour qu'une exemption ne survive pas à sa table.

Les droits sont lus par `has_table_privilege`, que le rôle de l'application peut appeler sur lui-même. Le test garde sa garde contre un catalogue vide : il exige aussi de trouver `journal_audit`.

## Règles de sécurité et permissions

- Exigences couvertes :
  - **S-70** : table en ajout seul, non modifiable depuis l'application ; écriture dans la transaction de l'action. Liste des actions de la 0.3 : section 6.1 ; les autres actions de S-70 arrivent avec leur fonctionnalité.
  - **S-71** : auteur, organisation, action, ressource et horodatage, tous obligatoires.
  - **S-54** : détails sans texte libre ni donnée personnelle ; message d'erreur fixe, sans valeur reçue.
  - **S-01, S-04** : le journal suit le modèle d'isolation ; l'organisation de la trace est celle de la transaction.
  - **S-86** : aucune concaténation, y compris pour `has_table_privilege` et `TRUNCATE` dans les tests.
  - Règles 3, 4, 9 et 13 de `CLAUDE.md`.
- Menaces concernées :
  - **T-20** : chaque entrée porte son auteur ; elle est écrite avec l'action ou pas du tout. La preuve que chaque action sensible produit une entrée appartient à chaque fonctionnalité qui l'introduit.
  - **T-21** : ni modification, ni suppression, ni vidage par le rôle de l'application ; ni effacement par la suppression du compte (A4) ou de l'organisation (`RESTRICT`).
  - **T-30, T-53** : isolation du journal entre organisations, par `verifierIsolation`.
- Matrice des droits : aucune ligne. La 0.3 n'expose ni route ni action. La ligne « Consulter le journal d'audit » (Propriétaire seul) est réalisée par la 7.3.
- Table créée : `journal_audit`, `organisation_id uuid NOT NULL`, clé étrangère vers `organization.id` en `ON DELETE RESTRICT`, règle `isolation_organisation` activée et forcée, index `(organisation_id, cree_le)`, droits `UPDATE, DELETE, TRUNCATE` retirés au rôle `app_facturation`. Aucune table modifiée.

## Dépendances nouvelles

Aucune (règle 10). `zod` (avec `z.toJSONSchema`), `drizzle-orm`, `eslint`, `vitest` sont déjà déclarés.

## Migration

Trois migrations, dans cet ordre, relues avant `npm run db:migrate` :

1. **Générée** par `npm run db:generate` : création de `journal_audit`, `ENABLE ROW LEVEL SECURITY`, clé étrangère, règle, index. SQL attendu, à comparer à la lecture (l'ordre des instructions et le nom de la clé étrangère sont ceux de drizzle-kit, comme pour `temoin_isolation`) :

   ```sql
   CREATE TABLE "journal_audit" (
   	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
   	"organisation_id" uuid NOT NULL,
   	"auteur_id" uuid NOT NULL,
   	"action" text NOT NULL,
   	"type_ressource" text NOT NULL,
   	"ressource_id" uuid NOT NULL,
   	"details" jsonb DEFAULT '{}' NOT NULL,
   	"cree_le" timestamp with time zone DEFAULT now() NOT NULL
   );
   --> statement-breakpoint
   ALTER TABLE "journal_audit" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
   CREATE INDEX "journal_audit_organisation_cree_le_idx" ON "journal_audit" USING btree ("organisation_id","cree_le");--> statement-breakpoint
   ALTER TABLE "journal_audit" ADD CONSTRAINT "journal_audit_organisation_id_organization_id_fkey" FOREIGN KEY ("organisation_id") REFERENCES "organization"("id") ON DELETE RESTRICT;--> statement-breakpoint
   CREATE POLICY "isolation_organisation" ON "journal_audit" AS PERMISSIVE FOR ALL TO public USING (organisation_id = NULLIF(current_setting('app.organisation_id', true), '')::uuid) WITH CHECK (organisation_id = NULLIF(current_setting('app.organisation_id', true), '')::uuid);
   ```

   Points à vérifier : aucune clé étrangère sur `auteur_id` ; l'expression de la règle identique à celle de `temoin_isolation` ; **aucune instruction sur `temoin_isolation`** (la réécriture de la condition par `ORGANISATION_ACTIVE` ne doit rien changer).

2. **Personnalisée**, créée vide par l'assistant avec `npx drizzle-kit generate --custom --name forcer-isolation-journal-audit`. Ligne à coller par le développeur, seule instruction du fichier (exception existante) :

   ```sql
   ALTER TABLE "journal_audit" FORCE ROW LEVEL SECURITY;
   ```

3. **Personnalisée**, créée vide par l'assistant avec `npx drizzle-kit generate --custom --name retirer-droits-journal-audit`, **une fois l'exception E1 (décision 1) écrite dans `CLAUDE.md`**. Ligne à coller par le développeur, seule instruction du fichier :

   ```sql
   REVOKE UPDATE, DELETE, TRUNCATE ON TABLE "journal_audit" FROM "app_facturation";
   ```

Entre les migrations 1 et 3, le rôle de l'application a brièvement `UPDATE` et `DELETE` sur une table vide qu'aucun code n'utilise encore ; le workflow applique les trois à la suite.

Le rôle `app_facturation` existe sur les quatre bases (`dev`, `preview`, `production`, CI) : le `REVOKE` ne peut pas échouer faute de rôle.

### Ordre de déploiement

1. Validation de la fiche et des décisions. Fait. Mises à jour de `DESIGN.md`, `USECASES.md`, `SPEC.md` et `CONFIGURATION.md` faites à la validation.
2. Tests écrits et vus en échec.
3. `CLAUDE.md` (exception E1, décision 1), puis migrations 1 à 3 créées, relues, collées ; implémentation.
4. `dev` en local : `npm run db:migrate`, puis `npm run test:integration` (dont le regroupement de Neon).
5. PR : la CI applique les trois migrations sur sa base neuve, où les droits par défaut sont posés par `preparer-base-test.mjs` : le `REVOKE` y est donc réellement prouvé.
6. Après la fusion : `production` puis `preview` par `migrations.yml`.
7. Vérification sur `production` et `preview` par une requête manuelle en lecture seule, avec le rôle de l'application (décision 9 ; `scripts/verifier-tables.mjs` n'est pas modifié) :

   ```sql
   SELECT privilege_type
   FROM information_schema.role_table_grants
   WHERE table_schema = 'public' AND table_name = 'journal_audit' AND grantee = 'app_facturation'
   ORDER BY privilege_type;
   ```

   Attendu : exactement `INSERT` et `SELECT`. `node scripts/verifier-tables.mjs`, inchangé, doit lister 11 tables dont `journal_audit`.

## Critères d'acceptation

- [x] `journal_audit` est déclarée avec `colonneOrganisation()`, `regleIsolation()` et l'index `(organisation_id, cree_le)` ; la migration générée a été relue et ne touche pas `temoin_isolation`.
- [x] Règle activée et forcée en base ; le test d'inventaire passe et inclut `journal_audit`.
- [x] Le rôle de l'application a `SELECT` et `INSERT`, et n'a ni `UPDATE`, ni `DELETE`, ni `TRUNCATE` sur `journal_audit`, sur `dev` et en CI ; puis vérifié sur `production` et `preview` après le workflow. `dev` : prouvé (`schema-journal.integration.test.ts` et test d'inventaire). CI : verte sur la PR. `production` puis `preview` : migrées par le workflow, puis vérifiées : isolation activée et forcée ; lire et ajouter à `true` ; modifier, supprimer, vider à `false` ; `scripts/verifier-tables.mjs` liste 11 tables.
- [x] `UPDATE`, `DELETE`, `TRUNCATE` et `INSERT ... ON CONFLICT DO UPDATE` sur le journal sont refusés par `42501`, et les lignes restent intactes.
- [x] Supprimer une organisation qui a une entrée au journal est refusé (`23001`) ; supprimer le compte de l'auteur laisse l'entrée intacte, `auteur_id` compris.
- [x] `journaliser` n'a pas de paramètre d'organisation ; l'entrée écrite porte l'organisation de la transaction ; une entrée qui fournit une organisation est refusée.
- [x] Une action annulée n'a pas de trace ; une trace invalide annule l'action.
- [x] Sans organisation active, `journaliser` n'écrit rien.
- [x] Une action hors liste, une clé inconnue, un texte libre dans les détails, un identifiant invalide sont refusés par `EntreeJournalInvalide`, au message fixe, sans valeur reçue ni `cause`, et sans requête envoyée.
- [x] Le test sur les schémas de détails échoue si l'un admet une clé supplémentaire ou un champ autre qu'identifiant, valeur énumérée, entier ou booléen.
- [x] La liste fermée contient exactement les onze actions de la section 6.1.
- [x] `journaliser(db, ...)` ne compile pas.
- [x] ESLint refuse l'import de `src/server/db/requetes/journal.ts` hors de `src/server/journal/audit.ts` et des tests.
- [x] `verifierIsolation(journalAudit, ..., { ajoutSeul: true })` passe (contrôles 0 à 9) ; la même option sur `temoin_isolation` échoue au contrôle 0 ; `verifierIsolation(temoinIsolation, ...)` sans option passe toujours ses huit contrôles inchangés.
- [x] Le test d'inventaire échoue si l'on rend temporairement `UPDATE` au rôle de l'application sur `journal_audit` (vérification manuelle sur `dev`, annulée ensuite). Vérifié par le développeur sur `dev` : avec `GRANT UPDATE` rendu au rôle de l'application sur `journal_audit`, les tests d'intégration donnent 7 failed dans 3 fichiers ; après `REVOKE`, 64 passed, et les droits valent lire et ajouter seulement (`UPDATE`, `DELETE`, `TRUNCATE` à `false`).
- [x] `nettoyer` ne lève pas d'erreur avec une table en ajout seul, supprime les organisations sans entrée au journal et laisse les autres.
- [x] `CLAUDE.md` contient l'exception E1 ; `STRUCTURE.md` (sections 3.1 et 7) est à jour.
- [x] `DESIGN.md` (auteur sans clé étrangère, index, `TRUNCATE`), `USECASES.md` (UC-09), `SPEC.md` (point ouvert sur les connexions sensibles) et `CONFIGURATION.md` (organisations de test laissées sur `dev`) sont à jour (faits à la validation).
- [x] Tout nouveau fichier de `src/server/` commence par `import "server-only";`.
- [x] Aucune dépendance ajoutée : `package-lock.json` inchangé.
- [x] `npm run typecheck`, `npm run lint`, `npm test`, `npm run build`, `npm run test:integration` (sur `dev` et en CI) passent. `dev` : prouvé le 2026-10-09. CI : verte sur la PR.

## Tests à écrire

Valeurs factices ou aléatoires (`crypto.randomUUID()`), aucun identifiant fixe d'organisation. Les tests qui n'ont pas besoin d'une écriture validée annulent leur transaction (section 3).

### Tests unitaires

Fichier : `src/server/journal/audit.test.ts` (sans base : la validation précède toute requête ; `tx` factice dont l'insertion est espionnée).

- [x] Entrée valide pour une action de la liste : `insererEntreeJournal` appelé une fois, avec le `type_ressource` de la liste, sans organisation ni `cree_le`.
- [x] Action absente de la liste (dont une action reportée, `facture.emise`), chaîne vide, casse différente (`Membre.ajoute`) : refus, aucune insertion.
- [x] Clé supplémentaire `organisationId`, `organisation_id`, `typeRessource`, `creeLe` : refus.
- [x] `auteurId` ou `ressourceId` vide, non UUID, entouré d'espaces, avec un essai d'injection (`' OR '1'='1`) : refus.
- [x] Détails avec une clé inconnue (`email`, `nom`, `telephone`, `motif`) : refus.
- [x] Message exactement « Entrée du journal d'audit invalide. » ; ni le message, ni `String(erreur)`, ni `JSON.stringify(erreur)` ne contiennent une valeur reçue ; pas de `cause`.
- [x] `// @ts-expect-error` : `journaliser(db, ...)` ne compile pas (vérifié par `npm run typecheck`).

Fichier : `src/server/journal/actions.test.ts`.

- [x] La liste contient exactement les onze actions de la section 6.1, et leur type de ressource.
- [x] Pour chaque action, `z.toJSONSchema` du schéma des détails : objet, `additionalProperties: false`, chaque propriété est une chaîne `format: uuid`, une chaîne d'un `enum`, un entier ou un booléen.
- [x] Le contrôle accepte un schéma de démonstration fait des quatre briques, et refuse des schémas de démonstration contenant `z.string()`, `z.iso.date()`, `z.number()` (non entier), `z.array(...)`, un `z.object` ouvert ou un objet imbriqué (le contrôle ne réussit pas à vide).
- [x] Chaque type de ressource appartient à la liste fermée des types (`organisation`, `invitation`, `membre`).

Fichier : `src/server/db/regles-import.test.ts` (ajouts).

- [x] Import de `requetes/journal.ts` depuis `src/server/services/`, `src/app/` ou `src/server/db/requetes/autre.ts` : erreur.
- [x] Le même import depuis `src/server/journal/audit.ts` et depuis un fichier `*.test.ts` : aucune erreur.

### Tests d'intégration

Fichier : `src/server/db/schema-journal.integration.test.ts`.

- [x] `verifierIsolation(journalAudit, fabriquer, { ajoutSeul: true })` : contrôles 0 à 9.
- [x] Le rôle de l'application a `SELECT` et `INSERT`, pas `UPDATE`, `DELETE` ni `TRUNCATE` (`has_table_privilege`).
- [x] Une entrée écrite a `cree_le` non nul, compris entre le début et la fin du test.

Fichier : `src/server/db/schema-isolation.integration.test.ts` (inventaire, section 8.2).

- [x] L'ensemble des tables en ajout seul est exactement `TABLES_AJOUT_SEUL`.
- [x] Aucune table de `public` n'accorde `TRUNCATE` au rôle de l'application.
- [x] Toute table portant `organisation_id`, hors exemption, a un index qui commence par `organisation_id`.

Fichier : `src/server/db/outils-test/outils-test.integration.test.ts` (ajouts).

- [x] `verifierIsolation(temoinIsolation, ..., { ajoutSeul: true })` échoue au contrôle 0.
- [x] `nettoyer` avec `tablesAjoutSeul: [journalAudit]` : l'organisation sans entrée est supprimée, celle qui en a une reste, aucune erreur, appelable deux fois.

Fichier : `src/server/db/journal.integration.test.ts`. Ces tests et les tests d'attaque vivent dans `src/server/db/`, et non dans `src/server/journal/` : les règles ESLint de la 0.2 n'autorisent `db` et `drizzle-orm` que dans les tests de `src/server/db/` (constaté en écrivant les tests).

- [x] Dans une transaction de A, `journaliser` écrit une entrée qui porte l'organisation A, l'auteur, l'action, le type de ressource de la liste, la ressource, les détails ; une transaction de B ne la voit pas.
- [x] Deux entrées écrites dans une même transaction portent le même `cree_le`.

### Tests d'attaque

Les quatre tests obligatoires du modèle (sans session, autre organisation par une action, rôle insuffisant, entrée falsifiée par un utilisateur) ne s'appliquent pas tels quels : aucune route, aucune action. Les tests ci-dessous visent les menaces de la fiche. Fichier : `src/server/db/journal.attaque.integration.test.ts`.

Effacer ou modifier ses traces (T-21), organisation A active, sur une entrée validée de A :

- [x] Modification (`UPDATE ... SET action = ...`, puis `SET auteur_id = ...`) : refus `42501`, entrée intacte.
- [x] Suppression (`DELETE` filtré sur l'entrée, puis sans filtre) : refus `42501`, entrée intacte.
- [x] Vidage (`TRUNCATE journal_audit`) : refus `42501`, entrées de A et de B intactes.
- [x] Réécriture par `INSERT ... ON CONFLICT (id) DO UPDATE` avec l'identifiant de l'entrée : refus `42501`, entrée intacte.
- [x] Sans organisation active, par `db` : `UPDATE` et `DELETE` refusés `42501` (le refus de droit précède la règle).
- [x] Suppression de l'organisation A par `db` : refus `23001`, entrées intactes.
- [x] Suppression du compte de l'auteur (ligne `user` créée pour le test, puis supprimée par `db`) : la suppression réussit, l'entrée reste avec le même `auteur_id`.

Trace au nom d'une autre organisation :

- [x] `journaliser` avec une entrée contenant `organisationId: b` : `EntreeJournalInvalide`, rien n'est écrit.
- [x] Organisation A active, `tx.insert(journalAudit).values({ organisationId: b, ... })` direct : refus `42501`.
- [x] Organisation A active, l'entrée écrite par `journaliser` porte A ; relue dans une transaction de B : absente.

Sans organisation active :

- [x] `journaliser` dans une transaction ouverte par `db.transaction` sans `set_config`, puis avec le réglage fixé à `''` : refus (code constaté en phase rouge, `42501` attendu), aucune ligne écrite.

Annulation de la transaction (S-70) :

- [x] Action (insertion dans `temoin_isolation`) puis `journaliser`, puis exception levée dans `travail` : ni la ligne témoin ni l'entrée n'existent.
- [x] Action puis `journaliser` avec des détails invalides : `EntreeJournalInvalide` remonte, la ligne témoin n'existe pas.
- [x] `journaliser` puis action refusée par la base (insertion témoin pour B, `42501`) : l'entrée n'existe pas.
- [x] Action et `journaliser` réussis : les deux existent après la validation.

Injection :

- [x] Valeurs d'injection SQL dans `ressourceId`, `auteurId` et `action` : refusées par la validation, rien n'est écrit.

### Tests de bout en bout

- [x] Aucun. Aucune page, aucune route.

## Fichiers concernés

Selon `docs/STRUCTURE.md`, section 9.

Créés :

- `src/server/journal/actions.ts` : liste fermée, types de ressource, briques et schémas des détails
- `src/server/journal/audit.ts` : `journaliser`, `EntreeJournalInvalide`
- `src/server/db/requetes/journal.ts` : `insererEntreeJournal`
- `src/server/journal/audit.test.ts`, `src/server/journal/actions.test.ts`
- `src/server/db/journal.integration.test.ts`, `src/server/db/journal.attaque.integration.test.ts`
- `src/server/db/schema-journal.integration.test.ts`
- `drizzle/<horodatage>_<nom>/` : la migration générée
- `drizzle/<horodatage>_forcer-isolation-journal-audit/` et `drizzle/<horodatage>_retirer-droits-journal-audit/` : créées vides par drizzle-kit, ligne collée par le développeur

Modifiés :

- `src/server/db/schema/technique.ts` : `journalAudit`
- `src/server/db/schema/isolation.ts` : export `ORGANISATION_ACTIVE`, réutilisé par la condition (texte SQL inchangé)
- `src/server/db/outils-test/isolation.ts` : option `ajoutSeul`, contrôles 0 et 9
- `src/server/db/outils-test/organisations.ts` : option `tablesAjoutSeul`
- `src/server/db/outils-test/outils-test.integration.test.ts`, `src/server/db/schema-isolation.integration.test.ts`, `src/server/db/regles-import.test.ts`
- `eslint.config.mjs` : import de `requetes/journal.ts` réservé à `journal/audit.ts` et aux tests
- `CLAUDE.md` : exception E1
- `docs/DESIGN.md` section 2.3 : `auteur_id` sans clé étrangère, index ; section 2.4 : `TRUNCATE` retiré (fait à la validation)
- `docs/USECASES.md` UC-09 : inscription de `membre.ajoute` au journal (fait à la validation)
- `docs/SPEC.md` points ouverts : « connexions sensibles » (fait à la validation)
- `docs/CONFIGURATION.md` : organisations de test laissées sur `dev` (fait à la validation)
- `docs/STRUCTURE.md` sections 3.1 et 7 : `requetes/journal.ts`, `server/journal/`
- `docs/features/journal-audit.md` : statut

Inchangés : `scripts/` (décision 9), `.github/workflows/` (la CI lance déjà `npm run test:integration` et applique les migrations), `vitest.config.mts`, `package.json`.

## Reporté

### À la fonctionnalité 0.4 (chaîne de contrôles)

- L'origine de `auteurId` : lu dans la session vérifiée, jamais dans l'entrée de l'utilisateur. `journaliser` recevra alors le contexte de la chaîne plutôt qu'un identifiant nu.
- Déclarer, avec chaque action de la chaîne, l'action du journal qu'elle produit, pour qu'une action sensible ne puisse pas oublier sa trace (T-20) ; et le test qui le vérifie avec la matrice.
- La traduction de `EntreeJournalInvalide` : une erreur de programmation, donc un message générique et un identifiant d'incident (S-85), pas « introuvable ».
- La garantie qu'un service ne reçoit que la transaction de la chaîne (déjà reportée par la 0.2).

### À la fonctionnalité 0.8 (contrôle après déploiement)

- Vérifier automatiquement, en production, que le rôle de l'application n'a ni `UPDATE`, ni `DELETE`, ni `TRUNCATE` sur `journal_audit`.

### Au jalon 1

- La définition des « connexions sensibles » de S-70 (décision 5) : une connexion concerne un compte, sans organisation. À définir dans les fiches du jalon 1 ; point ouvert de `SPEC.md`.
- Les évènements sans organisation (connexion échouée, création de compte, réinitialisation du mot de passe) : hors de ce journal, qui exige une organisation. À trancher à la 1.2, entre les journaux techniques (S-54, 30 jours) et une table propre aux comptes, sans `organisation_id`, sur le modèle de `compteur_debit`. Écarté pour `journal_audit` : un `organisation_id` facultatif sortirait la table du modèle, du test d'inventaire, et rendrait ces lignes invisibles à la règle.

### À la fonctionnalité 2.5 (suppression différée)

- Le chemin privilégié de la purge à l'issue des 30 jours (UC-13 étape 5, R-15) : le rôle de l'application ne peut supprimer ni le journal ni, à cause de `RESTRICT`, l'organisation. Pistes : tâche planifiée par le rôle propriétaire hors de `src/` (comme `migrations.yml`), ou fonction `SECURITY DEFINER` limitée aux organisations en attente depuis 30 jours. Le choix D0 (pas de déclencheur) laisse ces deux pistes ouvertes.
- Les entrées `organisation.suppression_demandee` et `organisation.suppression_annulee`.

### Au jalon 7

- 7.3 : la fonction de lecture (paginée, S-84 ; filtres période, membre, type d'action), les index qu'elle demande, l'affichage « compte supprimé », la ligne de la matrice (Propriétaire seul), les libellés français des actions dans `src/textes/` (NF-01).
- 7.2 : l'inclusion du journal dans l'export complet (`DESIGN.md`, E3).

### Actions retirées de la liste de la 0.3 (décision 4)

Chacune est ajoutée à `src/server/journal/actions.ts`, avec ses détails et ses tests, par la fonctionnalité qui crée sa table ou son action :

| Action | Ressource | Fonctionnalité |
|---|---|---|
| `client.anonymise` | `client` | 3.2 Anonymisation d'un particulier (UC-15) |
| `facture.emise` | `facture` | 5.3 Émission (UC-22) |
| `avoir.emis` | `avoir` | 5.5 Avoirs (UC-25) |
| `paiement.enregistre` | `paiement` | 6.1 Enregistrement d'un paiement (UC-26) |
| `paiement.annule` | `paiement` | 6.2 Annulation et remboursement (UC-27) |
| `remboursement.enregistre` | `remboursement` | 6.2 Annulation et remboursement (UC-27) |
| `export.csv` | `organisation` | 7.2 Exports (UC-30) |
| `export.complet` | `organisation` | 7.2 Exports (UC-30) |

Les noms ci-dessus sont indicatifs ; chaque fiche les fixe.

### Au jalon 5, avec la question du déclencheur

- `cree_le` fourni par l'appelant : le rôle de l'application peut encore donner sa propre valeur de `cree_le` lors d'une insertion directe dans `journal_audit`. `journaliser` ne le permet pas, et la règle ESLint confine l'insertion à `requetes/journal.ts`, mais la base elle-même ne l'interdit pas. Pistes : droit `INSERT` limité aux colonnes autres que `cree_le` (forme de migration personnalisée à valider), ou déclencheur qui impose `now()`. Consigné à la relecture de l'étape 4 de l'implémentation, sans changement du code.

### Conservation et purge

Hors périmètre, et sans rien à prévoir en 0.3 : `THREATS.md` section 7.2 fixe la conservation à « la durée de vie de l'organisation », suppression « avec l'organisation ». Aucune purge par ancienneté n'est exigée. Le seul effet à prévoir, la suppression avec l'organisation, est reporté à la 2.5 ci-dessus. Si le cadre légal ivoirien (point ouvert de `THREATS.md` section 10) impose une durée, elle fera l'objet de sa propre fiche.

## Décisions

1. **Exception sur les migrations.** E1 validée : migration `retirer-droits-<table>`, seule forme `REVOKE UPDATE, DELETE, TRUNCATE ON TABLE "<table>" FROM "app_facturation";`. Comme pour `FORCE`, l'assistant crée le fichier vide par la commande ; le développeur colle la ligne.
2. **Déclencheur.** D0 : pas de déclencheur en 0.3. Question reposée au jalon 5.
3. **Auteur.** A4 : `auteur_id uuid NOT NULL`, sans clé étrangère, sans `auteur_type`. `DESIGN.md` mis à jour.
4. **Liste des actions.** Les onze actions sur l'organisation, les invitations et les membres, dont `invitation.revoquee`, `membre.ajoute` et `membre.parti`, confirmées. Les huit autres (client, facture, avoir, paiement, remboursement, export) sont retirées : chacune sera ajoutée par sa propre fonctionnalité, quand sa table existera (section « Reporté »). `USECASES.md` corrigé : UC-09 inscrit `membre.ajoute` au journal.
5. **« Connexions sensibles ».** Hors de la 0.3. Une connexion concerne un compte, sans organisation. À définir dans les fiches du jalon 1 ; ajouté aux points ouverts de `SPEC.md`.
6. **Contrainte `CHECK` sur `action`.** Non. Liste fermée dans le code seulement.
7. **Index dans le test d'inventaire.** Oui : toute table portant `organisation_id` a un index qui commence par cette colonne, avec `temoin_isolation` en exemption explicite et motivée.
8. **Organisations de test laissées sur `dev`.** Accepté : environ 4 organisations `test-` restent sur `dev` à chaque exécution des tests d'intégration. Noté dans `CONFIGURATION.md`.
9. **Vérification après déploiement.** Requête manuelle en lecture seule (section « Ordre de déploiement »). `scripts/verifier-tables.mjs` n'est pas modifié.

Exigence confirmée à la validation : le schéma des détails est strict. Il refuse toute clé inconnue et n'accepte que des identifiants, des valeurs énumérées, des nombres et des booléens. Aucun texte libre (section 6.2).

## Notes de l'implémentation

### Correction du typage de `audit.test.ts`, validée par le développeur

Constat : `npm run typecheck` refusait `src/server/journal/audit.test.ts`. Le test parcourt la table `RESSOURCES` des actions attendues et passe chaque nom à `journaliser`, dont le paramètre `action` est typé par la liste fermée (`ActionJournal`, section 7). Le comportement testé était juste ; seul le typage du test était faux. Deux lignes du test ont changé, aucune assertion :

- `const RESSOURCES: Record<ActionJournal, string>` (au lieu de `Record<string, string>`), avec `import type { ActionJournal } from "./actions"` ;
- `test.each(Object.entries(RESSOURCES) as [ActionJournal, string][])`.

1. **Pourquoi le défaut n'était pas visible en phase rouge.** La liste des actions était alors vide (`ACTIONS_JOURNAL = {}`, typée `Record<string, ...>`) : `ActionJournal` valait donc `string`, et toute chaîne était acceptée par le type. Le défaut n'est apparu qu'avec la liste des onze actions, qui a donné à `ActionJournal` son type précis.
2. **Pourquoi deux lignes, et non une.** La première recommandation (changer seulement le type de `RESSOURCES`) **n'avait pas été essayée** avant d'être proposée. Appliquée, elle laissait l'erreur : en TypeScript, `Object.entries` renvoie toujours des clés de type `string`, quel que soit le type de l'objet. Le second changement convertit le résultat du parcours. Cette conversion est sûre : le type `Record<ActionJournal, string>` interdit à `RESSOURCES` toute clé hors de la liste.
3. **Pourquoi l'option B est écartée.** Élargir `EntreeJournal.action` à `string` aurait fait passer le test sans le modifier, mais aurait retiré à toute l'application la vérification des noms d'action à la compilation : une action mal orthographiée n'aurait été refusée qu'à l'exécution, par `EntreeJournalInvalide`.

### Code de refus sans organisation active

Constaté sur `dev` : `42501`. C'est la règle d'isolation (`WITH CHECK`) qui refuse l'insertion, avant la contrainte `NOT NULL`. Les deux tests d'attaque « sans organisation active » passent sans ajustement.
