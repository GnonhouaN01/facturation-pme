# SPEC.md — Cahier des charges

Application de facturation pour petites structures.
Statut : **validé**. Version du 2 octobre 2026.

Ce document décrit ce que l'application doit faire, pour qui et dans quelles limites. Il ne décrit pas comment elle est construite. Chaque exigence porte un identifiant, pour pouvoir être citée dans les fiches de fonctionnalité, les tests et les demandes faites à Claude.

Les identifiants ne sont jamais réutilisés : une exigence retirée laisse un trou dans la numérotation.

Préfixes : **F** exigence fonctionnelle, **R** règle métier, **S** exigence de sécurité, **NF** exigence non fonctionnelle.

---

## 1. Contexte

### 1.1 Problème

Les petites structures établissent leurs devis et factures avec des outils dispersés (tableur, traitement de texte, carnet). Elles perdent le suivi de ce qui est dû, encaissé ou en retard, et n'ont aucune trace de qui a fait quoi.

### 1.2 Public

- **Public principal :** structures de 1 à 20 personnes (indépendants, artisans, commerces, petites entreprises de services).
- **Pays de référence :** Côte d'Ivoire. Monnaie : franc CFA (XOF). TVA : 18 % au taux normal.
- **Hors public :** grandes entreprises ayant besoin de circuits de validation à plusieurs niveaux ou d'une intégration comptable.

### 1.3 Contrainte réglementaire : la FNE

En Côte d'Ivoire, la facture normalisée électronique (FNE) est obligatoire : une facture n'a de valeur fiscale qu'une fois certifiée par la plateforme de la DGI. Un PDF seul ne suffit pas.

Positionnement retenu : l'application traite la certification comme un **module interchangeable**. En démonstration, un simulateur joue le rôle de la DGI, et tout document l'indique clairement. Un module réel pourra le remplacer sans modifier le reste de l'application.

L'application ne prétend à aucune conformité légale tant que le module réel n'est pas branché.

### 1.4 Objectif du projet

Projet d'apprentissage et de portfolio, avec un périmètre unique et final, livré par jalons successifs. L'accent est mis sur la sécurité.

---

## 2. Utilisateurs et rôles

### 2.1 Modèle

- Tout compte travaille au sein d'une **organisation**. Un indépendant est une organisation à un seul membre.
- Un utilisateur peut appartenir à **plusieurs organisations** avec un seul compte, et y tenir un rôle différent dans chacune.
- À tout instant, l'utilisateur agit dans une seule **organisation active**.

### 2.2 Rôles

| Rôle | Personne type | Droits en résumé |
|---|---|---|
| Propriétaire | Le gérant | Tout, dont membres, paramètres, secrets, suppression de l'organisation |
| Comptable | Comptable interne ou externe | Clients, catalogue, devis, émission de factures, avoirs, paiements, relances, exports |
| Commercial | Le vendeur | Clients, devis, brouillons de facture. Factures émises, avoirs et paiements en lecture seule. Ni émission, ni avoir, ni paiement, ni export |
| Lecteur | Associé, auditeur | Consultation et export. Aucune modification |

La matrice détaillée rôles x actions figure dans THREATS.md, section 6. Elle fait foi.

### 2.3 Acteurs externes

- **Le client final** (entreprise ou particulier) : n'a pas de compte. Il accède uniquement à un devis ou à une facture par un lien personnel.
- **La plateforme de certification** (simulateur, puis DGI).

---

## 3. Exigences fonctionnelles

### 3.1 Comptes et authentification

- **F-001.** Un visiteur crée un compte avec son email et un mot de passe. L'email doit être vérifié avant tout accès.
- **F-002.** Un utilisateur se connecte, se déconnecte et réinitialise son mot de passe par email.
- **F-003.** Un utilisateur active la double authentification par code temporaire et reçoit des codes de secours à usage unique.
- **F-004.** Un utilisateur consulte ses sessions actives et peut les révoquer.

### 3.2 Organisations et membres

- **F-010.** Un utilisateur crée une organisation et en devient Propriétaire.
- **F-011.** Le Propriétaire renseigne la fiche de l'organisation : raison sociale, logo, adresse, numéro de compte contribuable (NCC), régime d'imposition, mentions légales, taux de TVA disponibles, délais par défaut.
- **F-012.** Le Propriétaire invite un membre par email en lui attribuant un rôle. L'invitation expire et peut être révoquée.
- **F-013.** Le Propriétaire modifie le rôle d'un membre ou le retire de l'organisation.
- **F-014.** Un utilisateur membre de plusieurs organisations bascule de l'une à l'autre.
- **F-015.** Le Propriétaire choisit la visibilité des Commerciaux : « toute l'organisation » (par défaut) ou « restreinte ».
- **F-016.** En mode restreint, un Commercial ne voit et ne modifie que les clients, devis et brouillons dont il est le responsable, et ne consulte que les factures, avoirs et paiements de ces clients. Les autres rôles voient tout.
- **F-017.** Le Propriétaire réaffecte un client à un autre membre. Le retrait d'un membre impose de réaffecter ses clients.
- **F-018.** Le Propriétaire supprime l'organisation, après confirmation renforcée.

### 3.3 Clients

- **F-020.** Un client est de type Entreprise (raison sociale, NCC, régime d'imposition, adresse, contact) ou Particulier (nom et téléphone obligatoires, le reste facultatif).
- **F-021.** Un membre autorisé crée, modifie, archive et recherche des clients. Chaque client a un responsable.
- **F-022.** La fiche d'un client présente ses devis, ses factures et son solde dû.

### 3.4 Catalogue

- **F-030.** L'organisation tient un catalogue de produits et services : désignation, prix unitaire hors taxe, taux de TVA, unité.
- **F-031.** Une ligne de devis ou de facture se crée depuis le catalogue ou en saisie libre.

### 3.5 Devis

- **F-040.** Un membre autorisé crée un devis pour un client, avec des lignes (désignation, quantité, prix unitaire, remise, taux de TVA) et une date de validité.
- **F-041.** Un devis suit le cycle : brouillon, envoyé, accepté, refusé, expiré.
- **F-042.** L'envoi d'un devis génère un lien de consultation. Le client l'ouvre sans compte, voit ce seul devis et peut l'accepter ou le refuser. L'application enregistre la date, l'heure et le nom saisi.
- **F-043.** Un membre autorisé peut aussi marquer un devis comme accepté ou refusé manuellement.
- **F-044.** Un devis accepté se transforme en brouillon de facture, avec ses lignes recopiées.
- **F-045.** Un devis s'exporte en PDF.

### 3.6 Factures

- **F-050.** Un membre autorisé crée un brouillon de facture, depuis un devis ou directement.
- **F-051.** Chaque ligne porte son taux de TVA, choisi parmi ceux de l'organisation (18 % par défaut, 0 % pour les exonérations).
- **F-052.** Chaque ligne peut porter une remise en pourcentage ou en montant. Un raccourci applique une même remise à toutes les lignes.
- **F-053.** Le pied de facture présente, pour chaque taux, la base hors taxe et la TVA, puis les totaux hors taxe, TVA et toutes taxes comprises.
- **F-054.** Un Propriétaire ou un Comptable émet la facture. Elle reçoit alors sa référence interne et part en certification.
- **F-055.** Le statut d'une facture se déduit de son état : brouillon, émise, partiellement payée, payée, en retard.
- **F-056.** Une facture s'exporte en PDF et s'envoie par email au client, avec un lien de consultation.
- **F-057.** L'organisation renseigne des instructions de paiement (numéro mobile money marchand, coordonnées bancaires), affichées sur ses factures. Le client paie par ses moyens habituels, et l'organisation enregistre le paiement reçu.

### 3.7 Certification (module FNE)

- **F-060.** À l'émission, la facture ou l'avoir est transmis au module de certification, qui renvoie un numéro fiscal et les éléments de certification.
- **F-061.** En mode simulateur, chaque document porte une mention visible indiquant qu'il n'est pas certifié par la DGI et n'a pas de valeur fiscale.
- **F-062.** Si la certification échoue, le document reste « en attente de certification » et peut être retransmis. Il n'est pas envoyé au client dans cet état.

### 3.8 Avoirs

- **F-070.** Un avoir se rattache à une facture émise et porte sur tout ou partie de ses lignes et quantités.
- **F-071.** Un avoir a sa propre numérotation et passe par le module de certification.

### 3.9 Paiements

- **F-080.** Une facture émise reçoit un ou plusieurs paiements. Chaque paiement enregistre sa date, son montant, son mode (espèces, mobile money, virement, chèque, carte), une référence facultative et son auteur.
- **F-081.** Un paiement erroné s'annule avec un motif obligatoire.
- **F-082.** Un trop-perçu donne lieu à un remboursement enregistré comme opération distincte.

### 3.10 Relances

- **F-100.** L'organisation définit des modèles de relance par email, avec des variables (nom du client, numéro de facture, reste dû, échéance) et un délai de déclenchement.
- **F-101.** L'application signale les factures à relancer. Un Propriétaire ou un Comptable relit le message prérempli et l'envoie. Aucune relance ne part automatiquement.

### 3.11 Tableau de bord, exports, journal

- **F-110.** Le tableau de bord présente, pour l'organisation active : montant facturé, montant encaissé, reste dû, factures en retard, devis en attente.
- **F-111.** Propriétaire, Comptable et Lecteur exportent en CSV les clients, les factures et les paiements.
- **F-112.** Le Propriétaire exporte l'ensemble des données de l'organisation.
- **F-113.** Le Propriétaire consulte le journal d'audit de l'organisation.

---

## 4. Règles métier

- **R-01. Montants.** Tous les montants sont des entiers en francs CFA. Aucun nombre à virgule flottante.
- **R-02. Calcul de la TVA.** La TVA se calcule par taux, sur la somme des bases hors taxe après remise, puis s'arrondit au franc le plus proche.
- **R-03. Référence interne.** Chaque organisation a une séquence continue et sans trou pour ses factures, et une autre pour ses avoirs. La référence est attribuée à l'émission, jamais au brouillon.
- **R-04. Numéro fiscal.** Le numéro fiscal est fourni par le module de certification. L'application ne le génère pas.
- **R-05. Immutabilité.** Un document émis ne se modifie pas et ne se supprime pas. Une facture se corrige par un avoir.
- **R-06. Copie figée.** Un document émis conserve les coordonnées du client et de l'organisation telles qu'elles étaient à l'émission.
- **R-07. Copie du catalogue.** Une ligne recopie les valeurs du catalogue à sa création. Modifier le catalogue est sans effet sur les documents existants.
- **R-08. Remises.** Une remise ne rend jamais une ligne négative et figure sur le document.
- **R-09. Reste dû.** Reste dû = total de la facture, moins ses avoirs, moins ses paiements valides.
- **R-10. Trop-perçu.** Si le reste dû devient négatif après un avoir, la facture affiche un trop-perçu.
- **R-11. Retard.** Une facture est en retard si son échéance est dépassée et son reste dû strictement positif.
- **R-12. Dernier Propriétaire.** Une organisation a toujours au moins un Propriétaire. Le dernier ne peut ni partir ni changer de rôle.
- **R-13. Expiration du devis.** Un devis envoyé et sans réponse passe à « expiré » à sa date de validité.
- **R-14. Devis envoyé.** Un devis envoyé ne se modifie plus. Pour le corriger, on le duplique en nouveau brouillon.
- **R-15. Suppression différée.** La suppression d'une organisation n'est effective qu'après 30 jours, pendant lesquels tout accès est bloqué et un Propriétaire peut l'annuler.

Valeurs par défaut proposées, modifiables par organisation : validité d'un devis 30 jours, échéance d'une facture 30 jours, format de référence `FAC-AAAA-0001` et `AVO-AAAA-0001`.

---

## 5. Exigences de sécurité

### 5.1 Isolation et autorisations

- **S-01.** Toute action s'exécute dans le contexte d'une seule organisation active. Aucune ressource d'une organisation ne peut être lue, modifiée ni associée depuis une autre.
- **S-02.** Une requête portant sur une ressource d'une autre organisation, ou hors du périmètre du rôle, reçoit la même réponse que si la ressource n'existait pas.
- **S-03.** Les autorisations sont vérifiées côté serveur à chaque requête. L'interface masque les actions interdites, mais ce masquage n'est jamais le contrôle.
- **S-04.** L'isolation entre organisations est appliquée à deux niveaux : dans le code d'accès aux données et dans la base elle-même.
- **S-05.** Seul un Propriétaire attribue les rôles. Nul ne modifie son propre rôle.

### 5.2 Comptes

- **S-10.** Mots de passe de douze caractères minimum, refusés s'ils figurent dans les listes de mots de passe compromis.
- **S-11.** Les tentatives de connexion et de réinitialisation sont limitées en débit. Les messages sont identiques, que le compte existe ou non.
- **S-12.** La double authentification est obligatoire pour les Propriétaires et les Comptables, facultative pour les autres. Un Propriétaire peut l'imposer à toute son organisation.
- **S-13.** Un membre promu Propriétaire ou Comptable active la double authentification avant d'exercer ses nouveaux droits.
- **S-14.** Une nouvelle authentification est exigée avant toute action sensible : instructions de paiement, rôles, export complet, suppression de l'organisation.
- **S-15.** Les jetons d'invitation et de réinitialisation sont aléatoires, à usage unique, à durée limitée et stockés sous forme hachée.
- **S-16.** Une invitation ne peut être acceptée que par un compte portant l'email invité. Le rôle attribué vient de l'invitation enregistrée, jamais de la requête d'acceptation.
- **S-17.** Un changement de mot de passe ferme toutes les autres sessions. Un membre retiré ou dont le rôle change perd ses anciens droits immédiatement.

### 5.3 Pages publiques (devis et factures)

- **S-20.** Un lien de consultation contient un jeton aléatoire long, stocké haché, limité à un seul document, expirable et révocable.
- **S-21.** Une page publique n'expose que le document concerné et aucun identifiant interne. Elle répond de façon identique pour un jeton invalide, expiré ou révoqué.
- **S-22.** Les pages publiques sont limitées en débit. Une décision d'acceptation ou de refus ne peut être ni rejouée ni modifiée.

### 5.4 Argent

- **S-30.** La somme des paiements valides et des avoirs d'une facture ne dépasse jamais son total, y compris lors de saisies simultanées.
- **S-31.** Un paiement ne se modifie pas et ne se supprime pas. Son annulation, motivée, est réservée au Propriétaire et au Comptable.
- **S-32.** Les références internes restent uniques et continues lors d'émissions simultanées.
- **S-33.** Les instructions de paiement ne sont modifiables que par le Propriétaire, après nouvelle authentification. Chaque modification est inscrite au journal d'audit et notifiée par email à tous les Propriétaires.
- **S-34.** L'application n'encaisse rien et ne manipule aucune donnée de carte ni de compte mobile money.

### 5.5 Données et contenus

- **S-50.** Toute entrée externe est validée côté serveur par un schéma avant usage.
- **S-51.** Les contenus saisis par les utilisateurs sont échappés dans les pages, les emails, les PDF et les modèles de relance.
- **S-52.** Les cellules exportées en CSV sont neutralisées pour ne pas être interprétées comme des formules.
- **S-53.** Le logo téléversé est contrôlé en type et en taille.
- **S-54.** Aucun secret ni donnée personnelle n'apparaît dans les journaux techniques ni dans les messages d'erreur.
- **S-55.** L'envoi d'emails (invitations, devis, factures, relances) est limité en débit par organisation.

### 5.6 Données personnelles

- **S-60.** La fiche d'un particulier ne contient que les données nécessaires à la facturation.
- **S-61.** La fiche d'un particulier peut être anonymisée sur demande, sans altérer les documents émis.
- **S-62.** Un utilisateur peut supprimer son compte, sous réserve de la règle R-12.
- **S-63.** Durées de conservation : 7 jours pour un compte non vérifié et une invitation, 30 jours pour une session inactive et pour les journaux techniques. L'inventaire complet figure dans THREATS.md, section 7.

### 5.7 Traçabilité

- **S-70.** Un journal d'audit, non modifiable depuis l'application, enregistre : connexions sensibles, changements de rôle et de membres, émissions, avoirs, paiements et annulations, modification des instructions de paiement, changement de visibilité, exports, suppression.
- **S-71.** Chaque entrée indique l'auteur, l'organisation, l'action, la ressource et l'horodatage.

### 5.8 Protections techniques

- **S-80. En-têtes de sécurité.** L'application envoie une politique de sécurité du contenu stricte, interdit son affichage dans un cadre d'un autre site, impose HTTPS et n'envoie pas l'adresse des pages publiques aux sites tiers.
- **S-81. Requêtes venues d'un autre site.** Toute requête modifiante est refusée si elle ne provient pas de l'application elle-même.
- **S-82. Cookies de session.** Ils sont inaccessibles aux scripts, transmis uniquement en HTTPS et non envoyés lors d'une navigation venue d'un autre site.
- **S-83. Secrets.** Aucun secret dans le dépôt. Les secrets sont distincts entre développement, prévisualisation et production, et renouvelables. Les prévisualisations n'accèdent jamais aux données de production.
- **S-84. Limites de volume.** Toute liste est paginée, toute requête et tout fichier a une taille maximale, et les opérations coûteuses sont limitées en débit.
- **S-85. Erreurs.** Le client ne reçoit qu'un message générique et un identifiant d'incident. Le détail reste dans les journaux.
- **S-86. Accès aux données.** Toute requête à la base passe par la couche d'accès prévue, avec des requêtes paramétrées. Aucune requête n'est construite par concaténation.
- **S-87. Documents générés et réponses externes.** La génération d'un PDF ne charge aucune ressource distante. Toute réponse d'un service extérieur est validée par un schéma avant usage.
- **S-88. Dépendances.** Les versions sont figées. Un audit automatique s'exécute sur chaque PR. Toute nouvelle dépendance est vérifiée à la main : existence, éditeur, popularité.
- **S-89. Chaîne de développement.** La branche principale n'accepte que des PR dont les tests, l'analyse du code et la détection de secrets ont réussi. L'assistant de code n'a pas accès aux fichiers de secrets.

---

## 6. Exigences non fonctionnelles

- **NF-01. Langue.** Interface, emails et documents en français. Les textes sont regroupés dans des fichiers dédiés.
- **NF-02. Formats.** Dates au format jour/mois/année, montants avec séparateur de milliers et mention « F CFA ».
- **NF-03. Appareils.** Utilisable sur mobile (à partir de 360 px de large) et sur ordinateur.
- **NF-04. Accessibilité.** Navigation au clavier, libellés sur tous les champs, contrastes conformes au niveau AA des WCAG.
- **NF-05. Performance.** Une liste de 1 000 factures s'affiche, paginée, en moins d'une seconde sur une connexion correcte.
- **NF-06. Tests.** Chaque exigence de sécurité est couverte par au moins un test automatisé qui tente de la violer.
- **NF-07. Sauvegarde.** Les données sont sauvegardées, et la restauration a été testée au moins une fois.
- **NF-08. Coût.** L'ensemble fonctionne sur des offres gratuites, hors nom de domaine éventuel.

---

## 7. Hors périmètre

| Élément | Raison |
|---|---|
| Paiement en ligne (agrégateur, mobile money, carte) | Écarté : les instructions de paiement sur la facture suffisent, et l'application ne stocke aucun secret de paiement |
| Intégration réelle à la plateforme FNE de la DGI | Dépend de démarches externes ; l'architecture la prévoit |
| Agent IA de relance | Écarté au profit de modèles : gratuité et prévisibilité |
| Multi-devises | Le public de référence facture en franc CFA |
| Factures récurrentes | Émission sans intervention humaine, peu compatible avec la certification |
| Acomptes facturés séparément, bons de livraison | Complexité non nécessaire au public visé |
| Comptabilité, gestion de stock | Autre métier |
| Application mobile native | L'interface web adaptée au mobile suffit |
| Interface en anglais | Prévue par la structure des textes, non réalisée |
| Rôles personnalisables | Quatre rôles fixes couvrent le public visé |

---

## 8. Points à vérifier et hypothèses

Ces points reposent sur des informations non confirmées auprès d'une source officielle. Ils doivent être vérifiés avant de figer la conception.

1. **Règles FNE.** Mentions obligatoires, catégories de documents, dérogations : à vérifier sur dgi.gouv.ci et sur la plateforme FNE.
2. **Taux de TVA.** Taux réduits et exonérations applicables : à vérifier auprès de la DGI.
3. **Numérotation.** Le format et la remise à zéro annuelle de la référence interne sont une proposition : à confirmer.
4. **Offres gratuites.** Limites de l'hébergement, de la base et de l'envoi d'emails : à vérifier en phase 4.
5. **Connexions sensibles (S-70).** Le terme n'est pas défini. Une connexion concerne un compte, sans organisation : elle ne peut pas aller dans le journal d'audit, qui exige une organisation. À définir dans les fiches du jalon 1, avec le lieu où ces évènements sont enregistrés (`docs/features/journal-audit.md`, décision 5).

---

## 9. Journal des décisions

| # | Décision | Raison principale |
|---|---|---|
| 1 | Tout compte est une organisation | Un seul modèle pour l'indépendant et la PME |
| 2 | Côte d'Ivoire comme pays de référence | Marché visé |
| 3 | Module FNE interchangeable avec simulateur | Ne dépendre d'aucune démarche externe, sans fausse conformité |
| 4 | Un utilisateur dans plusieurs organisations | Cas du comptable externe |
| 5 | Quatre rôles fixes | Un rôle par personne réelle, tests maîtrisés |
| 6 | Visibilité des Commerciaux réglable | Souplesse selon l'organisation |
| 7 | TVA par ligne | Produits à régimes différents sur une même facture |
| 8 | Paiements partiels | Acomptes et règlements échelonnés courants |
| 9 | Clients entreprises et particuliers | Le public vend aux deux |
| 10 | Acceptation du devis en ligne | Preuve horodatée de l'accord |
| 11 | Périmètre unique, livré par jalons | Pas de version ultérieure, mais un produit utilisable à chaque étape |
| 12 | Pas de paiement en ligne ; instructions de paiement sur la facture | Correspond à la pratique du public, aucun secret tiers à protéger |
| 13 | Avoirs totaux et partiels | Corriger sans tout refacturer |
| 14 | Remise par ligne avec raccourci global | Confort sans répartition entre taux |
| 15 | Catalogue avec saisie libre | Rapidité et cohérence des prix |
| 16 | Relances par modèles, envoi manuel | Gratuité et prévisibilité |
| 17 | Double authentification selon le rôle | Contrainte sur les comptes les plus sensibles |
| 18 | Français uniquement | Public visé, textes prêts pour une traduction |
| 19 | Invitation liée à l'email invité | Un lien intercepté ne donne pas accès à l'organisation |
| 20 | Devis envoyé non modifiable | Le client accepte exactement ce qu'il a lu |
| 21 | Suppression de l'organisation différée de 30 jours | Protection contre une suppression depuis un compte compromis |
| 22 | Le Commercial voit les factures de ses clients en lecture seule | Savoir si un client a payé avant un nouveau devis |
| 23 | Dix protections techniques ajoutées (S-80 à S-89) | Issues du modèle de menaces |
