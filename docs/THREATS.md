# THREATS.md — Modèle de menaces

Application de facturation pour petites structures.
Statut : **validé**. Version du 2 octobre 2026.

## Comment lire ce document

Ce document répond à quatre questions : que construit-on, qu'est-ce qui peut mal tourner, que fait-on contre, et comment le vérifie-t-on.

- Les sections 1 à 4 décrivent le terrain : ce qu'on protège, contre qui, et par où l'on peut attaquer.
- La section 5 liste les menaces, avec pour chacune sa priorité, ses parades et le test qui les vérifie.
- La section 6 fixe qui a le droit de faire quoi.
- La section 7 traite des données personnelles.
- La section 8 liste ce qu'on accepte de ne pas couvrir.

**Notation des menaces.** Gravité (G) et vraisemblance (V) vont de 1 à 3. La priorité est leur produit : **Haute** à partir de 6, **Moyenne** pour 3 ou 4, **Faible** en dessous. Les parades renvoient aux exigences de SPEC.md.

**Usage pendant le développement.** Chaque fiche de fonctionnalité cite les menaces qui la concernent. Chaque menace de priorité Haute ou Moyenne a au moins un test automatisé. Toute nouvelle fonctionnalité ajoute ses lignes ici avant d'être codée.

---

## 1. Les actifs

| # | Actif | Conséquence d'une compromission |
|---|---|---|
| A1 | Données d'une organisation : clients, devis, factures, paiements | Fuite vers un concurrent, perte de confiance de tous les utilisateurs |
| A2 | Intégrité des documents émis et des paiements | Fraude, litige avec un client ou l'administration fiscale |
| A3 | Instructions de paiement | Détournement des règlements des clients |
| A4 | Comptes et moyens d'accès | Accès à tout ce qui précède |
| A5 | Journal d'audit | Impossibilité d'établir ce qui s'est passé |
| A6 | Données personnelles des clients particuliers | Atteinte à la vie privée de personnes qui ne sont pas des utilisateurs |
| A7 | Secrets de l'application : accès à la base, clés des services | Compromission de toutes les organisations à la fois |
| A8 | Disponibilité du service | Une entreprise ne peut plus facturer |

## 2. Les attaquants

| # | Profil | Moyens | But |
|---|---|---|---|
| P1 | L'inconnu sur Internet | Scripts, essais en masse | Comptes, données à revendre |
| P2 | Le membre d'une autre organisation | Compte légitime, connaissance de l'interface | Prix et clients d'un concurrent |
| P3 | Le membre qui dépasse ses droits | Connaissance interne | Voir ou faire ce que son rôle interdit |
| P4 | Le membre malhonnête ou sur le départ | Droits réels | Détourner un paiement, emporter le fichier client |
| P5 | Le client final | Un lien valide | Voir d'autres documents, modifier le sien |
| P6 | Celui qui a volé un accès | Mot de passe ou session d'un membre | Tout ce que ce membre peut faire |

## 3. Le système et ses frontières de confiance

Une frontière de confiance est un endroit où des données passent d'une zone qu'on ne maîtrise pas à une zone qu'on maîtrise. Tout ce qui la franchit doit être contrôlé.

```mermaid
flowchart LR
    V[Visiteur ou client final] -->|F1| S
    M[Membre connecté] -->|F2| S
    S[Serveur applicatif] -->|F3| B[(Base de données)]
    S -->|F4| E[Service d'email]
    S -->|F4| C[Module de certification]
    S -->|F3| ST[Stockage des fichiers]
```

| Frontière | Entre quoi et quoi | Ce qui la franchit | Règle |
|---|---|---|---|
| F1 | Internet anonyme et serveur | Inscription, connexion, liens publics | Rien n'est fiable. Validation, limitation de débit, réponses uniformes |
| F2 | Navigateur d'un membre et serveur | Toutes les actions métier | L'identité est connue, mais chaque donnée et chaque droit sont revérifiés côté serveur |
| F3 | Serveur et stockage | Requêtes, fichiers | Le serveur est le seul à y accéder. La base applique en plus l'isolation par organisation |
| F4 | Serveur et services extérieurs | Emails, demandes de certification | On envoie le minimum, et on traite toute réponse comme une donnée à valider |

Le navigateur n'est **jamais** une zone de confiance : tout ce qui s'y trouve peut être lu et modifié par l'utilisateur.

## 4. Les surfaces d'attaque

| # | Surface | Accès | Cas d'utilisation |
|---|---|---|---|
| SA1 | Inscription, connexion, réinitialisation | Anonyme | UC-01 à UC-03 |
| SA2 | Lien d'invitation | Anonyme avec jeton | UC-09 |
| SA3 | Page publique d'un devis, avec réponse | Anonyme avec jeton | UC-19 |
| SA4 | Page publique d'une facture | Anonyme avec jeton | UC-24 |
| SA5 | Actions métier des membres | Connecté | UC-06 à UC-31 |
| SA6 | Téléversement du logo | Propriétaire | UC-07 |
| SA7 | Contenus saisis repris dans les pages, PDF, emails, exports | Connecté ou client final | UC-07, UC-14, UC-19, UC-28, UC-30 |
| SA8 | Envoi d'emails | Connecté | UC-08, UC-18, UC-23, UC-28 |
| SA9 | Échanges avec le module de certification | Système | UC-22, UC-25 |
| SA10 | Chaîne de développement : dépôt, dépendances, secrets, déploiement, assistant de code | Développeur | Toutes |

---

## 5. Les menaces

### 5.1 Usurpation d'identité

| # | Menace | Qui | G | V | Priorité | Parades | Test |
|---|---|---|---|---|---|---|---|
| T-01 | Trouver un mot de passe par essais en masse ou par réutilisation d'identifiants fuités | P1 | 3 | 3 | Haute | S-10, S-11, S-12 | Après N échecs, la connexion est bloquée, même avec le bon mot de passe |
| T-02 | Utiliser un mot de passe volé sur un compte Propriétaire ou Comptable | P6 | 3 | 2 | Haute | S-12, S-13 | Un rôle sensible sans second facteur n'accède à aucune donnée |
| T-03 | Voler ou rejouer une session | P6 | 3 | 2 | Haute | S-17, S-82, F-004 | Une session révoquée ou fermée est refusée |
| T-04 | Prendre un compte par la réinitialisation du mot de passe | P1 | 3 | 2 | Haute | S-11, S-15, S-17 | Un jeton expiré, déjà utilisé ou modifié est refusé. Le second facteur reste exigé |
| T-05 | Rejoindre une organisation avec une invitation interceptée | P1 | 3 | 1 | Moyenne | S-15, S-16 | Un compte portant un autre email ne peut pas accepter |
| T-06 | Deviner le code de double authentification ou réutiliser un code de secours | P6 | 3 | 1 | Moyenne | S-12 | Tentatives limitées. Un code de secours ne sert qu'une fois |
| T-07 | Découvrir quels emails ont un compte | P1 | 1 | 3 | Moyenne | S-11 | Les réponses sont identiques pour un email connu et inconnu |

### 5.2 Altération

| # | Menace | Qui | G | V | Priorité | Parades | Test |
|---|---|---|---|---|---|---|---|
| T-10 | Modifier ou supprimer une facture ou un avoir émis | P3, P4 | 3 | 2 | Haute | R-05, S-03 | Toute requête de modification d'un document émis est refusée |
| T-11 | Supprimer ou modifier un paiement après encaissement | P4 | 3 | 2 | Haute | S-31, S-70 | Aucune requête ne supprime un paiement. L'annulation est tracée |
| T-12 | Remplacer les instructions de paiement pour détourner les règlements | P4, P6 | 3 | 2 | Haute | S-14, S-33, S-70 | Refusé sans nouvelle authentification. Un email part à tous les Propriétaires |
| T-13 | Envoyer au serveur des totaux ou des prix falsifiés | P3 | 2 | 2 | Moyenne | S-50, R-02 | Le serveur ignore les totaux reçus et recalcule |
| T-14 | Dépasser le total d'une facture par des paiements ou des avoirs simultanés | P4 | 2 | 2 | Moyenne | S-30 | Deux requêtes simultanées : une seule aboutit |
| T-15 | Créer un doublon ou un trou dans la numérotation | P3 | 2 | 2 | Moyenne | R-03, S-32 | Vingt émissions simultanées donnent vingt références consécutives |
| T-16 | Modifier ou rejouer la réponse à un devis | P5 | 2 | 2 | Moyenne | S-22, R-14 | Une seconde réponse est refusée |
| T-17 | Faire agir un membre à son insu depuis un autre site | P1 | 3 | 1 | Moyenne | S-81, S-82 | Une requête modifiante venue d'une autre origine est refusée |
| T-18 | Altérer la réponse du module de certification | P1 | 3 | 1 | Moyenne | S-87 | Une réponse mal formée laisse la facture en attente |

### 5.3 Répudiation

| # | Menace | Qui | G | V | Priorité | Parades | Test |
|---|---|---|---|---|---|---|---|
| T-20 | Nier avoir émis, annulé ou exporté | P4 | 2 | 2 | Moyenne | S-70, S-71 | Chaque action sensible produit une entrée avec son auteur |
| T-21 | Effacer ou modifier ses traces dans le journal d'audit | P4 | 3 | 1 | Moyenne | S-70 | Aucun rôle ne peut modifier ou supprimer une entrée |
| T-22 | Contester l'acceptation d'un devis | P5 | 1 | 2 | Faible | F-042 | La date, l'heure et le nom saisi sont enregistrés |

### 5.4 Divulgation

| # | Menace | Qui | G | V | Priorité | Parades | Test |
|---|---|---|---|---|---|---|---|
| T-30 | Lire ou associer une ressource d'une autre organisation en changeant un identifiant | P2 | 3 | 3 | Haute | S-01, S-02, S-04 | Pour chaque route, un membre de B reçoit sur une ressource de A la réponse « introuvable », même statut et même document qu'un identifiant inexistant sous la même route |
| T-31 | Voir des données hors de son rôle : Commercial en mode restreint, Lecteur | P3 | 2 | 3 | Haute | F-016, S-02, S-03 | Listes, recherche, tableau de bord et fiches ne révèlent rien hors périmètre |
| T-32 | Deviner des liens publics de devis ou de factures | P1, P5 | 3 | 2 | Haute | S-20, S-21, S-22 | Mille jetons au hasard n'obtiennent rien et finissent bloqués |
| T-33 | Exporter massivement le fichier client avant de partir | P4 | 2 | 3 | Haute | S-14, S-70, matrice | Le Commercial n'a pas d'export. Chaque export est tracé |
| T-34 | Exécuter du code dans le navigateur d'un membre par un contenu saisi | P2, P5 | 3 | 2 | Haute | S-51, S-80 | Un nom contenant du code s'affiche comme du texte, partout |
| T-35 | Trouver des secrets ou des données personnelles dans les journaux ou les erreurs | P1, P4 | 3 | 2 | Haute | S-54, S-85 | Une erreur provoquée ne révèle ni requête, ni chemin, ni donnée |
| T-36 | Lire toute la base par une injection | P1, P2 | 3 | 1 | Moyenne | S-50, S-86 | Aucune requête construite par concaténation dans le code |
| T-37 | Faire fuiter un lien public par l'adresse d'origine envoyée à un autre site | P1 | 2 | 1 | Faible | S-80 | Les pages publiques n'envoient pas leur adresse aux sites tiers |
| T-38 | Garder l'accès à un document par un lien ancien | P5 | 1 | 2 | Faible | S-20 | Un lien révoqué ou expiré ne donne plus rien |
| T-39 | Lire un jeton de session dans le journal du serveur : en cas d'échec de la base, Better Auth y écrit la requête et ses paramètres, dont la valeur du jeton (constaté le 2026-10-12 dans les journaux du serveur de test en panne, `e2e/serveur-panne.ts`) | P6 | 3 | 2 | Haute | S-54, S-85 | À la 1.1 : une panne de la base provoquée pendant la lecture d'une session ne fait apparaître aucun jeton dans le journal du serveur (journal de Better Auth coupé ou filtré) |

**Portée de S-02** (précisée le 2026-10-13, `docs/features/controle-deploiement.md`, section 5). L'indiscernabilité porte sur les **ressources** (identifiants, jetons de lien), qui passent toujours par une même route : sous cette route, une ressource refusée, d'une autre organisation ou hors périmètre, et une ressource absente reçoivent la même réponse, même statut et même document au nonce près. Elle ne porte pas sur les **noms de pages** : ils sont déjà publics dans les fichiers JavaScript envoyés au navigateur, et une page de l'application refusée (sans session, cookie forgé) ne répond pas comme une adresse inexistante (RR-11).

### 5.5 Déni de service

| # | Menace | Qui | G | V | Priorité | Parades | Test |
|---|---|---|---|---|---|---|---|
| T-40 | Utiliser l'application pour envoyer des emails en masse | P1, P4 | 2 | 3 | Haute | S-55 | Au-delà du plafond, les envois sont refusés |
| T-41 | Épuiser les quotas gratuits par des inscriptions ou des générations de PDF en masse | P1 | 2 | 2 | Moyenne | S-11, S-84 | Les routes coûteuses sont limitées en débit |
| T-42 | Saturer le serveur par des requêtes ou des fichiers énormes | P1, P3 | 2 | 2 | Moyenne | S-53, S-84 | Une liste est toujours paginée. Un envoi trop gros est refusé |
| T-43 | Bloquer le compte d'un tiers en provoquant des échecs de connexion | P1 | 1 | 2 | Faible | S-11 | Le blocage est temporaire et limité |
| T-44 | Supprimer l'organisation depuis un compte compromis | P6 | 3 | 1 | Moyenne | S-14, R-15 | La suppression reste annulable 30 jours |
| T-45 | Appeler la tâche quotidienne sans autorisation, pour consommer le calcul et les connexions, ou provoquer des suppressions | P1 | 1 | 2 | Faible | S-02, S-83, S-84 | Un appel sans le secret, avec un secret forgé ou mal formé, reçoit la réponse d'une tâche inexistante, sans aucune étape lancée ; même autorisé, un appel ne supprime que ce qui a dépassé sa durée de conservation (`docs/features/tache-quotidienne.md`) |

### 5.6 Élévation de privilèges

| # | Menace | Qui | G | V | Priorité | Parades | Test |
|---|---|---|---|---|---|---|---|
| T-50 | Appeler directement une action réservée à un autre rôle | P3 | 3 | 3 | Haute | S-03, matrice | Pour chaque action, chaque rôle non autorisé est refusé |
| T-51 | S'attribuer ou attribuer un rôle supérieur | P3 | 3 | 2 | Haute | S-05, S-14, S-16 | Un Comptable ne peut modifier aucun rôle, pas même le sien |
| T-52 | Agir avec d'anciens droits après un retrait ou une rétrogradation | P4 | 3 | 2 | Haute | S-17 | Un membre retiré est refusé dès la requête suivante |
| T-53 | Contourner le filtre par organisation au niveau de la base | P2 | 3 | 1 | Moyenne | S-04 | Une requête sans contexte d'organisation ne renvoie aucune ligne |
| T-54 | Rendre l'organisation ingérable en retirant le dernier Propriétaire | P4 | 2 | 1 | Faible | R-12 | Le retrait du dernier Propriétaire est refusé |
| T-55 | Contourner la chaîne de contrôles par les points d'entrée natifs du module organisation de Better Auth (`/organization/*` : changer un rôle, retirer un membre, inviter), qui appliquent leurs propres rôles, sans la matrice, sans journal ni nouvelle authentification | P3, P6 | 3 | 2 | Haute | S-03, S-14, S-70, matrice | Avant toute exposition de `/api/auth`, les points d'entrée natifs du module organisation sont fermés : chacun répond comme une adresse inexistante. Toute opération sur l'organisation et ses membres passe par la chaîne de contrôles |

### 5.7 Fichiers et documents générés

| # | Menace | Qui | G | V | Priorité | Parades | Test |
|---|---|---|---|---|---|---|---|
| T-60 | Téléverser un fichier malveillant à la place du logo | P4, P6 | 2 | 2 | Moyenne | S-53 | Un fichier dont le contenu ne correspond pas au type annoncé est refusé |
| T-61 | Injecter une formule dans un export CSV | P2, P5 | 2 | 2 | Moyenne | S-52 | Un nom commençant par `=` ressort neutralisé |
| T-62 | Injecter du contenu dans un PDF ou un email par un champ saisi | P4, P5 | 2 | 2 | Moyenne | S-51, S-87 | Les balises saisies apparaissent comme du texte |
| T-63 | Faire charger au serveur une ressource distante pendant la génération d'un PDF | P4 | 3 | 1 | Moyenne | S-87 | La génération ne fait aucune requête sortante |
| T-64 | Injecter un en-tête dans un email (copie cachée vers des tiers, second corps) par un retour à la ligne dans une adresse, un sujet ou un nom | P4, P5 | 2 | 2 | Moyenne | S-50, S-51 | Une adresse avec un retour à la ligne, une virgule ou des chevrons est refusée avant tout envoi ; sujet et expéditeur fixes (`docs/features/envoi-emails.md`, section 3) |
| T-65 | Faire envoyer par l'application un email contenant un lien vers un autre site | P2, P4 | 2 | 2 | Moyenne | S-51 | La porte d'envoi construit chaque lien sur l'origine de l'application, sous deux formes seulement : un chemin `/lien/` construit depuis un jeton, ou une page fixe d'une liste fermée écrite dans le modèle (`/connexion`, `/mot-de-passe-oublie`), jamais fournie par l'appelant ; un jeton hors format ou une page hors de la liste est refusé |

### 5.8 Chaîne de développement

| # | Menace | Qui | G | V | Priorité | Parades | Test |
|---|---|---|---|---|---|---|---|
| T-70 | Publier un secret dans le dépôt | Développeur | 3 | 2 | Haute | S-83 | La détection de secrets bloque le commit et la PR |
| T-71 | Installer une dépendance vulnérable, malveillante ou inventée par l'assistant | P1 | 3 | 2 | Haute | S-88 | L'audit des dépendances échoue sur une faille connue. Toute nouvelle dépendance est validée à la main |
| T-72 | Fusionner du code généré non relu qui retire un contrôle d'accès | Développeur | 3 | 2 | Haute | NF-06, S-89 | Les tests d'attaque tournent sur chaque PR. La branche principale refuse une PR en échec |
| T-73 | Laisser l'assistant de code lire des secrets ou exécuter une commande dangereuse | Développeur | 3 | 1 | Moyenne | S-83, S-89 | Les fichiers de secrets sont interdits de lecture à l'assistant |
| T-74 | Exposer les données de production dans un déploiement de prévisualisation | Développeur | 3 | 2 | Haute | S-83 | Les prévisualisations utilisent une base distincte |
| T-75 | Perdre les données sans pouvoir les restaurer | — | 3 | 1 | Moyenne | NF-07 | Une restauration a été réalisée et documentée |
| T-76 | Faire fuiter le mot de passe d'application du compte Gmail d'envoi, qui donne l'envoi au nom de l'application et la lecture de sa boîte | Développeur | 3 | 1 | Moyenne | S-83, S-54 | Secret dans Vercel seulement, jamais dans `.env.local`, la CI ni le dépôt ; journalisation du client SMTP désactivée ; erreurs du transport réduites à un code (PR 2 de la 0.7) |

---

## 6. Matrice rôles x actions

**Lecture.** ✔ autorisé. ✖ interdit. **P\*** autorisé sur son portefeuille seulement lorsque la visibilité des Commerciaux est restreinte, sur toute l'organisation sinon. **L\*** lecture seule, avec la même limite de portefeuille.

Le Visiteur et le Client final n'ont accès à rien de ce tableau, en dehors des deux lignes « par lien ».

| Action | Propriétaire | Comptable | Commercial | Lecteur |
|---|---|---|---|---|
| **Organisation** | | | | |
| Voir la liste des membres et leur rôle | ✔ | ✔ | ✔ | ✔ |
| Modifier la fiche, les taux de TVA, les délais | ✔ | ✖ | ✖ | ✖ |
| Modifier les instructions de paiement | ✔ | ✖ | ✖ | ✖ |
| Inviter un membre, révoquer une invitation | ✔ | ✖ | ✖ | ✖ |
| Modifier un rôle, retirer un membre | ✔ | ✖ | ✖ | ✖ |
| Régler la visibilité des Commerciaux | ✔ | ✖ | ✖ | ✖ |
| Supprimer l'organisation | ✔ | ✖ | ✖ | ✖ |
| Quitter l'organisation | ✔ | ✔ | ✔ | ✔ |
| **Clients** | | | | |
| Voir les clients | ✔ | ✔ | P\* | ✔ |
| Créer, modifier, archiver un client | ✔ | ✔ | P\* | ✖ |
| Réaffecter un client | ✔ | ✖ | ✖ | ✖ |
| Anonymiser un particulier | ✔ | ✖ | ✖ | ✖ |
| **Catalogue** | | | | |
| Voir le catalogue | ✔ | ✔ | ✔ | ✔ |
| Créer, modifier, désactiver un article | ✔ | ✔ | ✖ | ✖ |
| **Devis** | | | | |
| Voir les devis | ✔ | ✔ | P\* | ✔ |
| Créer, modifier, supprimer un brouillon | ✔ | ✔ | P\* | ✖ |
| Envoyer, révoquer le lien | ✔ | ✔ | P\* | ✖ |
| Marquer accepté ou refusé | ✔ | ✔ | P\* | ✖ |
| Transformer en brouillon de facture | ✔ | ✔ | P\* | ✖ |
| **Factures et avoirs** | | | | |
| Voir les brouillons de facture | ✔ | ✔ | P\* | ✔ |
| Créer, modifier, supprimer un brouillon | ✔ | ✔ | P\* | ✖ |
| Voir les factures émises, les avoirs et les paiements | ✔ | ✔ | L\* | ✔ |
| Émettre une facture, relancer une certification | ✔ | ✔ | ✖ | ✖ |
| Envoyer une facture, révoquer le lien | ✔ | ✔ | ✖ | ✖ |
| Émettre un avoir | ✔ | ✔ | ✖ | ✖ |
| **Paiements et relances** | | | | |
| Enregistrer un paiement | ✔ | ✔ | ✖ | ✖ |
| Annuler un paiement, enregistrer un remboursement | ✔ | ✔ | ✖ | ✖ |
| Gérer les modèles de relance | ✔ | ✔ | ✖ | ✖ |
| Envoyer une relance | ✔ | ✔ | ✖ | ✖ |
| **Pilotage** | | | | |
| Voir le tableau de bord | ✔ | ✔ | P\* | ✔ |
| Exporter en CSV | ✔ | ✔ | ✖ | ✔ |
| Exporter l'ensemble des données | ✔ | ✖ | ✖ | ✖ |
| Consulter le journal d'audit | ✔ | ✖ | ✖ | ✖ |
| **Par lien, sans compte** | | | | |
| Consulter un devis et y répondre | Client final détenteur du lien | | | |
| Consulter une facture | Client final détenteur du lien | | | |

Chaque utilisateur gère en outre son propre compte : mot de passe, double authentification, sessions, suppression du compte. Le départ d'une organisation figure dans le tableau (« Quitter l'organisation ») ; la règle du dernier Propriétaire (R-12) s'y applique.

**Règle de construction.** Cette matrice est écrite une seule fois dans le code, à un seul endroit. Les contrôles d'accès et les tests la lisent tous deux. Un test parcourt chaque case et vérifie que la réponse du serveur lui correspond.

---

## 7. Données personnelles

### 7.1 Cadre

La Côte d'Ivoire dispose d'une loi sur la protection des données à caractère personnel et d'une autorité de contrôle. Le texte applicable et les obligations de déclaration sont **à vérifier** auprès de cette autorité avant toute mise en service réelle. Ce document applique les principes communs à ces législations : collecter le minimum, pour un but précis, pendant une durée limitée, en le protégeant.

L'application traite deux catégories de personnes : ses **utilisateurs**, qui ont un compte, et les **clients de ses utilisateurs**, qui n'ont rien signé avec elle. Pour ces derniers, c'est l'organisation qui décide des données saisies, et l'application agit pour son compte.

### 7.2 Inventaire

| Donnée | Personnes | Pourquoi | Durée de conservation | Suppression |
|---|---|---|---|---|
| Nom, email, mot de passe haché | Utilisateurs | Authentifier | Durée de vie du compte | À la suppression du compte |
| Secret de double authentification, chiffré (XChaCha20-Poly1305, clé tirée de `BETTER_AUTH_SECRET`) ; codes de secours sous empreinte HMAC à clé dérivée (1.4) | Utilisateurs | Authentifier | Durée de vie du compte | À la désactivation, à la remise à zéro manuelle ou à la suppression |
| Connexion en attente du code (1.4) : empreinte SHA-256 de l'identifiant, identifiant de l'utilisateur, compte d'essais | Utilisateurs | Second facteur à la connexion (UC-02, étape 3) | 5 minutes ; consommée au code juste | Purge quotidienne des lignes expirées |
| Dernière tranche de temps acceptée (anti-rejeu, 1.4) : identifiant de l'utilisateur, numéro de tranche | Utilisateurs | Refuser un code déjà accepté (T-06) | 3 minutes | Purge quotidienne des lignes expirées |
| Sessions : appareil, adresse IP, dates | Utilisateurs | Sécurité, affichage des sessions | 30 jours sans activité | Automatique |
| Compte non vérifié | Visiteurs | Inscription en cours | 7 jours | Automatique |
| Invitation : email invité | Personnes invitées | Inviter | 7 jours | Automatique à l'expiration |
| Fiche client entreprise : contact, email, téléphone | Clients | Facturer | Durée de vie de l'organisation | À la suppression de l'organisation |
| Fiche client particulier : nom, téléphone, adresse, email facultatifs | Clients particuliers | Facturer | Durée de vie de l'organisation | Anonymisation sur demande |
| Coordonnées figées sur un document émis | Clients | Preuve et obligation de conservation des pièces | Durée de vie de l'organisation | Non modifiable. Suppression avec l'organisation |
| Réponse à un devis : nom saisi, date, heure | Clients | Preuve de l'accord | Durée de vie du devis | Avec le devis |
| Journal d'audit : auteur, action, date | Utilisateurs | Traçabilité | Durée de vie de l'organisation | Avec l'organisation |
| Journaux techniques | Utilisateurs | Diagnostic | 30 jours | Automatique. Sans donnée personnelle ni secret |
| Jeton de réinitialisation du mot de passe : empreinte SHA-256 seulement, identifiant de l'utilisateur, date d'expiration (1.3) | Utilisateurs | Réinitialiser le mot de passe (UC-03, S-15) | 30 minutes ; supprimé au premier usage, et avec les autres jetons du compte au premier succès | Purge quotidienne des lignes expirées. Jamais le jeton en clair |
| Compteurs de débit : nom de la limite, empreinte HMAC de l'utilisateur (plus tard de l'adresse IP ou de l'email), nombre, date | Utilisateurs, visiteurs | Limiter les tentatives (S-11, S-22, S-55, S-84) | La plus longue fenêtre de limite, au plus 24 heures | Purge quotidienne des lignes expirées. Jamais la valeur en clair |

### 7.3 Ce que l'application ne collecte pas

Date de naissance, pièce d'identité, données bancaires des clients, géolocalisation, et aucune mesure d'audience par un service tiers.

### 7.4 Droits des personnes

- **Un utilisateur** consulte et modifie ses informations, et supprime son compte, sauf s'il est le dernier Propriétaire d'une organisation.
- **Un client particulier** s'adresse à l'organisation qui l'a facturé. Celle-ci peut corriger sa fiche ou l'anonymiser. Les documents émis ne sont pas modifiés, car leur conservation est une obligation de l'organisation.
- **Une organisation** exporte l'ensemble de ses données et peut demander sa suppression.

### 7.5 Destinataires extérieurs

Les données ne quittent l'application que vers l'hébergeur, le fournisseur de base de données, le service d'envoi d'emails, le service de vérification des mots de passe compromis (un préfixe d'empreinte, jamais le mot de passe) et, à terme, la plateforme de certification.

| Destinataire | Rôle | Hébergement |
|---|---|---|
| Neon | Base de données | Allemagne (Francfort) |
| Vercel | Serveur applicatif | Allemagne (Francfort) pour les fonctions. Les pages statiques sont distribuées par un réseau mondial |
| GitHub | Code source, sans secret ni donnée réelle | États-Unis |
| Google (Gmail), compte d'envoi dédié | Adresses des destinataires et contenu des emails (texte brut, sans donnée sensible), copie dans « Messages envoyés », réponses des destinataires | États-Unis et réseau mondial de Google, à confirmer |
| Have I Been Pwned (service de Cloudflare), vérification des mots de passe compromis (S-10, fonctionnalité 1.1) | Les 5 premiers caractères de l'empreinte SHA-1 d'un mot de passe saisi, sans adresse email ni autre donnée du compte | Réseau mondial de Cloudflare |
| Sentry | Non encore configuré | À relever lors de sa mise en place |

---

## 8. Risques résiduels acceptés

Ce sont les situations que les parades ne couvrent pas, et qu'on choisit d'assumer en le sachant.

| # | Risque | Pourquoi on l'accepte | Ce qui le limite |
|---|---|---|---|
| RR-1 | Un Propriétaire malhonnête peut tout faire dans son organisation | Il en est le responsable légitime | Journal d'audit non modifiable, emails aux autres Propriétaires |
| RR-2 | Un client transfère son lien à un tiers | Le lien fonctionne comme un courrier transmis | Lien limité à un document, expirable, révocable |
| RR-3 | Le poste ou la boîte email d'un membre est compromis | Hors du contrôle de l'application | Double authentification, sessions révocables |
| RR-4 | Une faille chez l'hébergeur ou le fournisseur de base | Dépendance inévitable | Choix de fournisseurs reconnus, sauvegardes, secrets renouvelables |
| RR-5 | Une attaque massive visant à saturer le service | Hors de portée d'une offre gratuite | Limitation de débit, protections de l'hébergeur |
| RR-6 | Les documents produits en mode simulateur n'ont pas de valeur fiscale | L'accès réel à la plateforme dépend de démarches externes | Mention visible sur chaque document |
| RR-7 | Un Comptable enregistre un faux paiement | Il faut bien faire confiance à celui qui saisit | Auteur tracé, aucune suppression possible |
| RR-8 | Les tables de Better Auth (`member`, `user`, `session`, `organization`, `invitation`) n'ont pas de règle d'isolation : une requête écrite avec la transaction d'une organisation peut lire les lignes d'une autre | Un utilisateur n'appartient pas à une seule organisation, et Better Auth lit et écrit ces tables hors de toute organisation active, à la connexion par exemple (`DESIGN.md` section 2.5) | Traité au jalon 2 : toute requête de l'application sur ces tables filtre explicitement sur l'organisation du contexte, et reçoit un test d'attaque qui tente de lire l'autre organisation. Aujourd'hui, une seule requête : `lireAdhesion`, filtrée sur l'organisation de la transaction et l'utilisateur de la session |
| RR-9 | Le compte Gmail d'envoi garde une copie de chaque email dans « Messages envoyés » (adresse du destinataire, lien), et reçoit dans sa boîte les réponses des destinataires, qui ne sont pas lues | Comportement de Gmail, sans réglage pour l'éviter ; un compte gratuit, sans nom de domaine | Chaque email demande de ne pas répondre et renvoie vers l'entreprise ; liens expirables et révocables (S-20) ; compte dédié, double authentification ; purge manuelle mensuelle des deux dossiers par le développeur (`docs/features/envoi-emails.md`, décision 9) |
| RR-10 | Google peut ralentir ou suspendre le compte d'envoi sans préavis (volume, messages semblables, non-remises, ou première connexion d'un compte neuf depuis un serveur de Francfort jugée suspecte) : l'application n'envoie plus rien pendant 1 à 24 heures, ou plus, réinitialisations de mot de passe comprises | Un seul compte gratuit sert toutes les organisations | Nos limites restent sous celles de Google (200 par 24 heures pour l'application, 40 par organisation) ; toute alerte de Google est notée à la vérification manuelle (`docs/features/envoi-emails.md`, section 9) ; module interchangeable pour passer à un service spécialisé |
| RR-11 | Le nom d'une page de l'application est observable : sans session, `/tableau-de-bord` répond 404 avec le document d'erreur de Next.js, une adresse inexistante avec la page « introuvable » rendue par le serveur (constaté le 2026-10-13, en production et en local) | Les noms de pages sont déjà publics dans les fichiers JavaScript envoyés au navigateur ; masquer la différence demandait une route attrape-tout, sans effet sur Vercel | Le contenu d'une page n'est jamais envoyé sans droit (aucun texte du gabarit, vérifié en production par le contrôle après déploiement) ; S-02 porte sur les ressources (section 5.4) |
| RR-12 | Un tiers qui connaît l'adresse d'un compte peut en bloquer la connexion pendant 15 minutes, et renouveler ce blocage, par 5 tentatives (limite `auth.connexion_compte`, T-43) ; le titulaire est refusé même avec le bon mot de passe | La limite par compte compte toutes les tentatives, quelle que soit l'adresse IP : c'est elle qui arrête les essais de mots de passe venus de nombreuses adresses (T-01). Elle s'applique à toute adresse, avec ou sans compte : le blocage n'apprend pas au tiers si le compte existe (T-07) | Blocage temporaire, fenêtre de 15 minutes ; 10 tentatives par 15 minutes et par adresse IP bornent le nombre de comptes qu'une même adresse bloque ; réponse identique pour un compte existant ou non (`docs/features/connexion.md`, section 3, décision 5). Même nature depuis la 1.3 pour « mot de passe oublié » : 2 demandes par heure et par adresse email (`auth.reinitialisation_compte`) bloquent la demande d'une adresse une heure, pour toute adresse, sans rien apprendre (`docs/features/mot-de-passe.md`, section 5) |
| RR-14 | Qui connaît le mot de passe d'un compte à second facteur peut, par 20 codes faux, en bloquer la connexion 24 heures au plus, même avec le bon code (limite `auth.double_auth_compte`) | C'est la limite qui borne la recherche du code à 20 essais par jour (T-06) ; le tiers a déjà le mot de passe, le titulaire doit le changer | Alerte par email au titulaire (`compte.double_auth_tentatives`, bornée par destinataire) ; changer le mot de passe arrête l'attaquant à l'étape 1 (`docs/features/double-authentification.md`, section 6, décision 3) |
| RR-13 | Un attaquant qui dispose de quelques adresses IP épuise en un jour le budget des emails de compte (`email.compte`, 100 par 24 h : vérifications, « Tentative d'inscription ») ; avec beaucoup d'adresses, celui de la réinitialisation (`email.reinitialisation`, 50 par 24 h). Plus aucun email de ce budget ne part jusqu'à la fin de la fenêtre, pour tous les utilisateurs | Aucune protection contre les adresses IP nombreuses avant S-22 (jalon 4) ; un seul compte Gmail gratuit, dont il faut protéger la limite de 500 par jour (RR-10) | Budgets séparés : une vague d'inscriptions ne bloque pas la réinitialisation, et inversement ; fenêtre de 24 h au plus ; ligne `[email]` qui nomme la limite atteinte, surveillée dans les journaux de Vercel, avec une conduite à tenir et le retour arrière (`docs/features/mot-de-passe.md`, sections 6.4 et 12.3, décision C) |

---

## 9. Exigences ajoutées par cette phase

Le modèle de menaces a fait apparaître des protections techniques absentes de SPEC.md. Elles y ont été reportées, en section 5.8.

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

## 10. Points tranchés et points ouverts

1. **Validé :** le Commercial voit les factures émises, avoirs et paiements de ses clients en lecture seule (SPEC.md, F-016).
2. **Validé :** les durées de conservation de la section 7.2 (SPEC.md, S-63).
3. **Ouvert :** le cadre légal ivoirien sur les données personnelles et la durée de conservation des pièces comptables reste à vérifier auprès d'une source officielle.
4. **Traité en 1.1 (T-39) :** en cas d'échec de la base, Better Auth écrivait dans le journal du serveur la requête et ses paramètres, dont la valeur du jeton de session (constaté le 2026-10-12). Depuis la 1.1, son journal n'écrit qu'une ligne fixe, sans message ni argument, et les erreurs sont relancées hors du routeur `better-call` (`docs/features/inscription.md`, section 1). Deux tests le prouvent : sous Vitest, et sur le site construit, où la sortie du serveur en panne est relue après une lecture de session au cookie signé et une inscription (`e2e/erreurs.attaque.spec.ts`). T-55 est traitée dans la même PR : `/api/auth` n'ouvre qu'une liste fermée de trois points d'entrée, `/organization/*` répond comme une adresse inexistante, vérifié aussi après chaque déploiement de production.
   **Complété le 2026-10-22 (T-39) :** `@better-auth/core` écrivait encore l'erreur entière par un `console.error` direct (`handleFallbackJoin`, jointure de secours), requête SQL et paramètres compris, hors de son journal. Un filtre de `console.error` posé au démarrage (`register`, `src/server/erreurs/console.ts`) n'y laisse passer ni objet formaté (classe et code seulement) ni texte de requête ; prouvé par une vraie jointure de secours en échec (`docs/features/socle-interface.md`, section 4.4). Signalement à Better Auth : `docs/signalements/better-auth-fallback-join.md`.
5. **Traité en 1.2 (T-01, T-03, T-07) :** la connexion et la déconnexion sont ouvertes hors production (fermées en production jusqu'à la 1.3). Adresse inconnue, mauvais mot de passe et compte non vérifié reçoivent la même réponse, en 800 ms au moins ; limites par adresse IP et par compte (RR-12) ; session de 7 jours sans prolongation ; déconnexion vérifiée en base ; `/get-session` reste fermé, son corps portant le jeton (`docs/features/connexion.md`).
6. **Traité en 1.3, PR 1 (T-04, T-07, S-15, S-17) :** mot de passe oublié, hors production (comptes fermés en production jusqu'à la PR 2 de la 1.3). Même réponse et même durée pour toute adresse ; jeton de 30 minutes, à usage unique, stocké sous son empreinte, jamais dans une adresse reçue (fragment et bouton) ; mot de passe compromis vérifié avant la consommation du jeton ; toutes les sessions fermées et autres jetons supprimés après le changement ; notification par email ; compte non vérifié marqué vérifié ; liens d'email vers deux pages fixes (T-65) ; budget d'emails séparé (RR-13) (`docs/features/mot-de-passe.md`).
7. **Traité en 1.4, PR 1 (T-06, T-04, T-02 en partie) :** double authentification par application (TOTP), hors production comme le reste des comptes. Sept points d'entrée composés par la passerelle, un cookie par usage, corps de Better Auth jamais transmis ; secret chiffré, codes de secours et connexion en attente sous empreinte ; 5 essais par attente, verrou de Better Auth, 20 codes par jour et par compte (RR-14), code déjà accepté refusé (dernière tranche) ; mot de passe et code pour régénérer, remplacer ou désactiver ; désactivation refusée à un Propriétaire ou un Comptable ; autres sessions fermées après un changement ; réinitialisation du mot de passe sans effet sur le second facteur (T-04) ; six notifications par email ; remise à zéro manuelle avec délai de 72 heures et trace d'audit (`docs/features/double-authentification.md`, `docs/exploitation/remise-a-zero-double-authentification.md`). L'exigence par rôle (S-12, S-13, T-02) suit en PR 2.
8. **Traité en 1.4, PR 2 (T-02, S-12, S-13) :** étape 7 de la chaîne de contrôles : un Propriétaire ou un Comptable sans second facteur actif n'accède à aucune donnée (`refuse` sur toute action, page « introuvable » sur toute page de l'application), refus avant la validation de l'entrée ; rôle et état relus à chaque requête. La zone compte reste ouverte pour l'activation (`docs/features/double-authentification.md`, section 9).
9. **Traité en 1.5 (T-03, T-01, S-17, F-004) :** sessions actives listées côté serveur, sans jeton (l'identifiant seul désigne une session) ; fermeture d'une session ou des autres, effet immédiat, même réponse pour une session d'un autre compte ou absente ; `/list-sessions` et `/revoke-sessions` de Better Auth toujours fermés. Changement du mot de passe depuis une session : mot de passe actuel puis Have I Been Pwned avant Better Auth, 8 essais par jour et par compte, session courante remplacée et autres fermées (vérifié), liens de réinitialisation supprimés, notification. Correction du nom. Appareil décrit en liste fermée, texte du navigateur jamais affiché (T-34) (`docs/features/profil-sessions.md`).
