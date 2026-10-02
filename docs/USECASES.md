# USECASES.md — Cas d'utilisation

Application de facturation pour petites structures.
Statut : **validé**. Version du 2 octobre 2026.

## Comment lire ce document

Un cas d'utilisation décrit ce qu'un acteur vient faire dans l'application, étape par étape. Chaque fiche contient :

- **Acteur** : le rôle qui agit. Le Propriétaire peut réaliser tous les cas ouverts aux autres rôles, il n'est cité que lorsqu'un cas lui est réservé.
- **But** : ce que l'acteur veut obtenir.
- **Préconditions** : ce qui doit être vrai avant de commencer.
- **Scénario nominal** : les étapes quand tout se passe bien.
- **Erreurs** : les déviations. `3a` signifie « première déviation possible à l'étape 3 ».
- **Résultat** : ce qui a changé à la fin.
- **Abus** : ce qu'une personne malveillante tenterait, et la réponse attendue.
- **Exigences** : les identifiants de SPEC.md que ce cas met en œuvre.

Deux règles valent pour **tous** les cas et ne sont pas répétées :

1. Toute action d'un membre s'exécute dans son organisation active, et son rôle est vérifié côté serveur (S-01, S-03).
2. Toute tentative sur une ressource d'une autre organisation, ou hors du périmètre du rôle, reçoit la même réponse que si la ressource n'existait pas (S-02).

Les cas marqués ★ sont les plus sensibles pour la sécurité.

## Acteurs

| Acteur | Type | Rôle dans l'application |
|---|---|---|
| Visiteur | Humain, sans compte | Crée un compte, accepte une invitation |
| Propriétaire | Humain | Administre l'organisation |
| Comptable | Humain | Facture, encaisse, relance |
| Commercial | Humain | Gère clients et devis, prépare des brouillons |
| Lecteur | Humain | Consulte et exporte |
| Client final | Humain, sans compte | Consulte un devis ou une facture par lien |
| Module de certification | Système | Certifie factures et avoirs |

---

## 1. Compte

### UC-01 — Créer un compte et vérifier son email

- **Acteur :** Visiteur.
- **But :** disposer d'un compte utilisable.
- **Préconditions :** aucune.

**Scénario nominal**
1. Le Visiteur saisit son nom, son email et un mot de passe.
2. Le système valide le format, la longueur du mot de passe et son absence des listes compromises.
3. Le système crée le compte, non vérifié, et envoie un email contenant un lien de vérification.
4. Le Visiteur ouvre le lien.
5. Le système marque l'email comme vérifié et ouvre la session.

**Erreurs**
- **2a.** Mot de passe trop court ou compromis : refus, avec la raison.
- **3a.** L'email appartient déjà à un compte : le système affiche le même message de succès et envoie à cette adresse un email indiquant qu'un compte existe déjà.
- **4a.** Lien expiré ou déjà utilisé : le système propose d'en renvoyer un.

**Résultat :** un compte vérifié, sans organisation.

**Abus**
- Découvrir quels emails ont un compte en observant les réponses : les réponses sont identiques (3a).
- Créer des comptes en masse : limitation de débit par adresse IP.
- Se connecter sans avoir vérifié l'email : accès refusé tant que l'étape 5 n'est pas faite.

**Exigences :** F-001, S-10, S-11, S-15.

### UC-02 — Se connecter ★

- **Acteur :** tout utilisateur.
- **But :** accéder à ses organisations.
- **Préconditions :** compte vérifié.

**Scénario nominal**
1. L'utilisateur saisit son email et son mot de passe.
2. Le système vérifie les identifiants.
3. Si la double authentification est active, le système demande le code temporaire, et l'utilisateur le saisit.
4. Le système ouvre une session et affiche la dernière organisation active, ou la liste s'il en a plusieurs.

**Erreurs**
- **2a.** Identifiants incorrects : message unique « email ou mot de passe incorrect ».
- **2b.** Trop de tentatives : blocage temporaire, même message pour un compte existant ou non.
- **3a.** Code incorrect : nouvelle saisie, avec un nombre de tentatives limité.
- **3b.** Téléphone perdu : l'utilisateur saisit un code de secours, qui est alors consommé.
- **4a.** Son rôle impose la double authentification et elle n'est pas activée : le système l'amène à UC-04 avant tout accès aux données de cette organisation.

**Résultat :** une session ouverte, visible dans UC-05.

**Abus**
- Essayer des milliers de mots de passe : limitation par compte et par adresse IP (2b).
- Deviner le code à six chiffres : tentatives limitées, puis blocage (3a).
- Réutiliser un code de secours : il est à usage unique (3b).
- Réutiliser un identifiant de session volé après déconnexion : la session est invalidée côté serveur.

**Exigences :** F-002, F-003, S-11, S-12, S-13.

### UC-03 — Réinitialiser son mot de passe ★

- **Acteur :** Visiteur.
- **But :** retrouver l'accès à son compte.
- **Préconditions :** aucune.

**Scénario nominal**
1. Le Visiteur saisit son email.
2. Le système affiche « si un compte existe, un email a été envoyé » et, le cas échéant, envoie un lien à usage unique.
3. Le Visiteur ouvre le lien et saisit un nouveau mot de passe.
4. Le système valide le mot de passe, l'enregistre, ferme toutes les autres sessions et prévient l'utilisateur par email.

**Erreurs**
- **3a.** Lien expiré ou déjà utilisé : le système invite à recommencer.
- **4a.** Mot de passe trop court ou compromis : refus.

**Résultat :** nouveau mot de passe, anciennes sessions fermées. La double authentification reste exigée à la connexion suivante.

**Abus**
- Savoir si un email a un compte : la réponse est identique dans tous les cas (2).
- Inonder la boîte de quelqu'un : limitation de débit par email et par adresse IP.
- Contourner la double authentification par la réinitialisation : elle n'est jamais désactivée par ce parcours.
- Deviner le lien : jeton aléatoire long, stocké haché.

**Exigences :** F-002, S-10, S-11, S-15, S-17.

### UC-04 — Activer la double authentification

- **Acteur :** tout utilisateur.
- **But :** protéger son compte par un second facteur.
- **Préconditions :** être connecté.

**Scénario nominal**
1. L'utilisateur demande l'activation et ressaisit son mot de passe.
2. Le système affiche un code QR à scanner avec une application d'authentification.
3. L'utilisateur saisit le code à six chiffres affiché par son application.
4. Le système vérifie le code, active la double authentification et affiche une seule fois les codes de secours.

**Erreurs**
- **3a.** Code incorrect : l'activation n'a pas lieu, nouvelle saisie.

**Résultat :** double authentification active, codes de secours remis.

**Abus**
- Désactiver la double authentification d'une session laissée ouverte : la désactivation exige le mot de passe et un code valide, et reste impossible pour un Propriétaire ou un Comptable.

**Exigences :** F-003, S-12, S-13, S-14.

### UC-05 — Consulter et révoquer ses sessions

- **Acteur :** tout utilisateur.
- **But :** vérifier où son compte est connecté et fermer une session suspecte.
- **Préconditions :** être connecté.

**Scénario nominal**
1. L'utilisateur ouvre la liste de ses sessions (appareil, date, dernière activité).
2. Il révoque une session, ou toutes sauf la sienne.
3. Le système invalide immédiatement les sessions choisies.

**Résultat :** les sessions révoquées ne permettent plus aucun accès.

**Abus**
- Révoquer la session d'un autre utilisateur en changeant un identifiant : seules ses propres sessions sont accessibles.

**Exigences :** F-004.

---

## 2. Organisation

### UC-06 — Créer une organisation

- **Acteur :** tout utilisateur.
- **But :** disposer d'un espace de facturation.
- **Préconditions :** compte vérifié.

**Scénario nominal**
1. L'utilisateur saisit la raison sociale.
2. Le système crée l'organisation avec les valeurs par défaut (TVA 18 %, validité et échéance de 30 jours) et lui attribue le rôle Propriétaire.
3. Le système lui demande d'activer la double authentification si ce n'est pas fait (UC-04).

**Résultat :** une organisation dont il est Propriétaire, devenue son organisation active.

**Abus**
- Créer des organisations en masse : nombre limité par compte et par jour.

**Exigences :** F-010, R-12, S-13.

### UC-07 — Configurer l'organisation ★

- **Acteur :** Propriétaire.
- **But :** renseigner ce qui figurera sur les documents.
- **Préconditions :** être Propriétaire.

**Scénario nominal**
1. Le Propriétaire modifie la fiche : logo, adresse, NCC, régime d'imposition, mentions légales.
2. Il gère la liste des taux de TVA et les délais par défaut.
3. Il renseigne les instructions de paiement (numéro mobile money marchand, coordonnées bancaires).
4. Pour l'étape 3, le système exige une nouvelle saisie du mot de passe.
5. Le système enregistre, inscrit la modification au journal d'audit et, pour les instructions de paiement, notifie tous les Propriétaires par email.

**Erreurs**
- **1a.** Logo d'un type ou d'une taille non admis : refus.
- **2a.** Suppression d'un taux utilisé par le catalogue : le taux est désactivé pour l'avenir, pas supprimé.

**Résultat :** les nouveaux documents utilisent ces valeurs. Les documents déjà émis ne changent pas (R-06).

**Abus**
- Remplacer discrètement le numéro mobile money pour détourner les paiements : action réservée au Propriétaire, nouvelle authentification, journal d'audit et email à tous les Propriétaires.
- Téléverser un fichier malveillant à la place du logo : contrôle du type réel et de la taille.
- Injecter du code dans les mentions légales, reprises dans les PDF et emails : contenu échappé.

**Exigences :** F-011, F-057, R-06, S-14, S-33, S-51, S-53, S-70.

### UC-08 — Inviter un membre

- **Acteur :** Propriétaire.
- **But :** donner accès à un collaborateur.
- **Préconditions :** être Propriétaire.

**Scénario nominal**
1. Le Propriétaire saisit l'email du collaborateur et choisit son rôle.
2. Le système crée une invitation à durée limitée et envoie un email avec un lien.
3. Le Propriétaire voit l'invitation en attente et peut la révoquer.

**Erreurs**
- **1a.** La personne est déjà membre : refus.
- **1b.** Une invitation est déjà en attente pour cet email : le système propose de la renvoyer.

**Résultat :** une invitation en attente, inscrite au journal d'audit.

**Abus**
- Utiliser l'application pour envoyer du courrier indésirable : limitation de débit des invitations par organisation.
- Un Comptable invite un complice comme Propriétaire : action réservée au Propriétaire.

**Exigences :** F-012, S-05, S-15, S-55, S-70.

### UC-09 — Accepter une invitation ★

- **Acteur :** Visiteur ou utilisateur.
- **But :** rejoindre une organisation.
- **Préconditions :** avoir reçu une invitation valide.

**Scénario nominal**
1. La personne ouvre le lien de l'invitation.
2. Le système affiche l'organisation et le rôle proposés.
3. Si elle n'a pas de compte, elle en crée un avec l'email invité (UC-01). Sinon, elle se connecte.
4. Le système vérifie que l'email du compte est celui de l'invitation.
5. La personne accepte. Le système crée l'adhésion et consomme l'invitation.
6. Si le rôle l'impose, le système demande d'activer la double authentification.

**Erreurs**
- **1a.** Invitation expirée, révoquée ou déjà utilisée : message unique, sans détail sur l'organisation.
- **4a.** Le compte connecté a un autre email : refus, avec invitation à se connecter au bon compte.

**Résultat :** la personne est membre, avec le rôle prévu.

**Abus**
- Accepter une invitation interceptée avec un autre compte : l'email doit correspondre (4a).
- Rejouer un lien déjà utilisé : usage unique.
- Modifier le rôle dans la requête d'acceptation : le rôle vient de l'invitation enregistrée, jamais de la requête.

**Exigences :** F-012, S-13, S-15, S-16.

### UC-10 — Modifier le rôle d'un membre ou le retirer ★

- **Acteur :** Propriétaire.
- **But :** ajuster les droits de l'équipe.
- **Préconditions :** être Propriétaire.

**Scénario nominal**
1. Le Propriétaire choisit un membre, puis un nouveau rôle ou le retrait.
2. Le système exige une nouvelle saisie du mot de passe.
3. En cas de retrait, le système demande à qui réaffecter les clients du membre.
4. Le système applique le changement, ferme les sessions du membre sur cette organisation et inscrit l'opération au journal d'audit.

**Erreurs**
- **1a.** Il tente de modifier son propre rôle : refus.
- **1b.** Le membre visé est le dernier Propriétaire : refus.
- **4a.** Le nouveau rôle impose la double authentification : les nouveaux droits ne s'exercent qu'après son activation.

**Résultat :** les droits du membre sont à jour immédiatement.

**Abus**
- Un Comptable s'attribue le rôle Propriétaire par un appel direct : refus, réservé au Propriétaire, et nul ne modifie son propre rôle.
- Un membre retiré continue d'agir avec une session ouverte : les droits sont relus à chaque requête.
- Rendre l'organisation ingérable en retirant tous les Propriétaires : règle du dernier Propriétaire.

**Exigences :** F-013, F-017, R-12, S-05, S-13, S-14, S-70.

### UC-11 — Changer d'organisation active

- **Acteur :** tout utilisateur membre de plusieurs organisations.
- **But :** travailler pour une autre structure.
- **Préconditions :** être membre d'au moins deux organisations.

**Scénario nominal**
1. L'utilisateur choisit une organisation dans la liste des siennes.
2. Le système vérifie son adhésion, change l'organisation active et recharge l'interface avec le rôle correspondant.

**Erreurs**
- **2a.** Le rôle dans cette organisation impose la double authentification et elle n'est pas active : renvoi vers UC-04.

**Résultat :** toutes les actions suivantes portent sur la nouvelle organisation.

**Abus**
- Indiquer dans une requête l'identifiant d'une organisation dont on n'est pas membre : refus.
- Créer dans l'organisation B un devis pour un client de l'organisation A : le client est introuvable dans B.

**Exigences :** F-014, S-01, S-02.

### UC-12 — Régler la visibilité des Commerciaux

- **Acteur :** Propriétaire.
- **But :** cloisonner ou non les portefeuilles des vendeurs.
- **Préconditions :** être Propriétaire.

**Scénario nominal**
1. Le Propriétaire choisit « toute l'organisation » ou « restreinte ».
2. Le système explique l'effet et demande confirmation.
3. Le système applique le réglage immédiatement et l'inscrit au journal d'audit.

**Résultat :** en mode restreint, chaque Commercial ne voit que les clients, devis et brouillons dont il est responsable.

**Abus**
- Un Commercial en mode restreint consulte le client d'un collègue en devinant son adresse : même réponse que si le client n'existait pas.
- Il obtient les données par un autre chemin (recherche, export, tableau de bord) : le filtre s'applique à toutes les lectures, et le Commercial n'a pas accès aux exports.

**Exigences :** F-015, F-016, S-02, S-70.

### UC-13 — Supprimer l'organisation

- **Acteur :** Propriétaire.
- **But :** fermer définitivement l'espace.
- **Préconditions :** être Propriétaire.

**Scénario nominal**
1. Le Propriétaire demande la suppression.
2. Le système rappelle les conséquences et propose l'export complet (UC-30).
3. Le Propriétaire ressaisit son mot de passe, un code de double authentification et le nom de l'organisation.
4. Le système place l'organisation en attente de suppression pendant 30 jours, bloque tout accès et prévient tous les Propriétaires par email.
5. À l'issue du délai, le système supprime les données.

**Erreurs**
- **4a.** Un Propriétaire annule pendant le délai : l'organisation est rétablie.

**Résultat :** organisation supprimée après le délai.

**Abus**
- Supprimer l'organisation depuis une session volée : mot de passe, second facteur, délai de 30 jours et email aux Propriétaires.

**Exigences :** F-018, R-15, S-14, S-70.

---

## 3. Clients et catalogue

### UC-14 — Gérer les clients

- **Acteur :** Commercial, Comptable.
- **But :** tenir à jour le fichier des clients.
- **Préconditions :** être membre avec l'un de ces rôles.

**Scénario nominal**
1. Le membre crée un client en choisissant son type, Entreprise ou Particulier.
2. Le système valide les champs obligatoires du type choisi et désigne le créateur comme responsable.
3. Le membre peut ensuite rechercher, modifier ou archiver le client, et consulter ses devis, factures et solde dû.
4. Le Propriétaire peut réaffecter le client à un autre membre.

**Erreurs**
- **2a.** Entreprise sans raison sociale ou NCC, particulier sans nom ou téléphone : refus, champ indiqué.
- **3a.** Archivage d'un client ayant des factures : autorisé, le client n'est plus proposé pour de nouveaux documents, et ses documents restent consultables.

**Résultat :** fichier client à jour. Les documents déjà émis conservent les anciennes coordonnées (R-06).

**Abus**
- Un nom de client contenant du code pour qu'il s'exécute dans une page, un PDF ou un email : contenu échappé partout.
- Un nom commençant par `=` pour s'exécuter comme formule dans un export : cellule neutralisée.
- Un Commercial en mode restreint modifie le client d'un collègue : refus.

**Exigences :** F-020, F-021, F-022, F-017, R-06, S-50, S-51, S-52, S-60.

### UC-15 — Anonymiser un client particulier

- **Acteur :** Propriétaire.
- **But :** répondre à la demande d'un particulier qui ne veut plus figurer dans le fichier.
- **Préconditions :** le client est de type Particulier.

**Scénario nominal**
1. Le Propriétaire demande l'anonymisation et confirme.
2. Le système remplace le nom, le téléphone et les autres coordonnées de la fiche par une mention neutre, et archive la fiche.
3. Le système inscrit l'opération au journal d'audit, sans y recopier les données effacées.

**Résultat :** la fiche ne permet plus d'identifier la personne. Les documents émis restent intacts, comme l'exige leur immutabilité.

**Abus**
- Anonymiser un client pour masquer une facture frauduleuse : les documents émis et le journal d'audit ne sont pas modifiés.

**Exigences :** S-60, S-61, R-05, S-70.

### UC-16 — Gérer le catalogue

- **Acteur :** Comptable.
- **But :** tenir la liste des produits et services.
- **Préconditions :** être Comptable ou Propriétaire.

**Scénario nominal**
1. Le Comptable crée un article : désignation, prix unitaire hors taxe, taux de TVA, unité.
2. Il le modifie ou le désactive.

**Erreurs**
- **1a.** Prix négatif ou non entier : refus.

**Résultat :** catalogue à jour. Les devis et factures existants ne changent pas (R-07).

**Abus**
- Un Commercial baisse un prix du catalogue pour avantager un client : le catalogue est réservé au Comptable et au Propriétaire. Le prix reste ajustable sur la ligne, où la modification est visible sur le document.

**Exigences :** F-030, R-01, R-07.

---

## 4. Devis

### UC-17 — Créer et modifier un devis

- **Acteur :** Commercial.
- **But :** préparer une proposition chiffrée.
- **Préconditions :** un client actif existe.

**Scénario nominal**
1. Le Commercial choisit un client et ajoute des lignes, depuis le catalogue ou en saisie libre.
2. Pour chaque ligne, il ajuste quantité, prix, remise et taux de TVA.
3. Le système calcule en continu les totaux par taux et le total toutes taxes comprises.
4. Le Commercial fixe la date de validité et enregistre le brouillon.

**Erreurs**
- **2a.** Quantité nulle, remise supérieure au montant de la ligne : refus.
- **4a.** Le devis a déjà été envoyé : il n'est plus modifiable, le système propose de le dupliquer en nouveau brouillon.

**Résultat :** un devis à l'état brouillon.

**Abus**
- Envoyer au serveur des totaux falsifiés : le serveur recalcule tout et ignore les totaux reçus.
- Choisir un client d'une autre organisation : client introuvable.

**Exigences :** F-031, F-040, F-041, F-051, F-052, F-053, R-01, R-02, R-08, S-50.

### UC-18 — Envoyer un devis

- **Acteur :** Commercial.
- **But :** transmettre la proposition au client.
- **Préconditions :** un devis à l'état brouillon, avec au moins une ligne.

**Scénario nominal**
1. Le Commercial demande l'envoi et vérifie l'email du destinataire.
2. Le système génère le PDF et un lien de consultation, puis envoie l'email.
3. Le devis passe à l'état « envoyé » et n'est plus modifiable.

**Erreurs**
- **1a.** Le client n'a pas d'email : le Commercial télécharge le PDF et copie le lien pour le transmettre autrement.
- **2a.** L'envoi échoue : le devis reste en brouillon, l'erreur est signalée.

**Résultat :** devis envoyé, lien actif jusqu'à la date de validité.

**Abus**
- Se servir de l'envoi pour inonder des adresses : limitation de débit par organisation.

**Exigences :** F-041, F-042, F-045, R-14, S-20, S-55.

### UC-19 — Consulter un devis et y répondre par lien ★

- **Acteur :** Client final.
- **But :** lire le devis et donner sa réponse.
- **Préconditions :** détenir un lien valide.

**Scénario nominal**
1. Le Client ouvre le lien.
2. Le système affiche ce seul devis, avec le nom et les coordonnées de l'organisation.
3. Le Client choisit d'accepter ou de refuser et saisit son nom.
4. Le système enregistre la décision, la date, l'heure et le nom, puis affiche une confirmation.
5. Le système prévient le responsable du devis.

**Déclenchement automatique :** à la date de validité, un devis envoyé et sans réponse passe à « expiré », et son lien ne permet plus de répondre.

**Erreurs**
- **1a.** Lien invalide, expiré ou révoqué : page unique « ce lien n'est plus valable », sans autre information.
- **3a.** Une décision a déjà été enregistrée : le système l'affiche et n'en accepte pas d'autre.

**Résultat :** devis accepté ou refusé, avec la trace de la réponse.

**Abus**
- Deviner des liens pour lire les devis d'autres clients : jeton aléatoire long, limitation de débit.
- Distinguer un lien inexistant d'un lien expiré pour repérer les liens réels : réponse identique.
- Modifier ou rejouer une décision : une seule décision possible.
- Remonter de la page publique vers d'autres documents : aucun identifiant interne n'y figure.
- Injecter du code dans le nom saisi : contenu échappé à l'affichage.

**Exigences :** F-042, R-13, S-20, S-21, S-22, S-51.

### UC-20 — Transformer un devis accepté en brouillon de facture

- **Acteur :** Commercial.
- **But :** facturer sans ressaisir.
- **Préconditions :** un devis à l'état « accepté », en ligne ou marqué manuellement.

**Scénario nominal**
1. Le Commercial demande la transformation.
2. Le système crée un brouillon de facture en recopiant le client et les lignes, et le relie au devis.

**Erreurs**
- **1a.** Le devis a déjà donné lieu à une facture : le système le signale et demande confirmation.

**Résultat :** un brouillon de facture, que seul un Comptable ou un Propriétaire pourra émettre.

**Exigences :** F-043, F-044.

---

## 5. Factures et avoirs

### UC-21 — Préparer un brouillon de facture

- **Acteur :** Commercial, Comptable.
- **But :** préparer une facture avant émission.
- **Préconditions :** un client actif existe.

**Scénario nominal**
1. Le membre crée un brouillon, directement ou depuis un devis (UC-20).
2. Il compose les lignes comme pour un devis et fixe l'échéance.
3. Le système calcule les totaux.

**Résultat :** un brouillon, modifiable et supprimable, sans référence.

**Abus**
- Envoyer des totaux falsifiés : recalcul côté serveur.

**Exigences :** F-050, F-051, F-052, F-053, R-01, R-02, R-03.

### UC-22 — Émettre une facture

- **Acteur :** Comptable.
- **But :** rendre la facture définitive.
- **Préconditions :** un brouillon avec au moins une ligne.

**Scénario nominal**
1. Le Comptable ouvre le brouillon et demande l'émission.
2. Le système vérifie son rôle et la complétude du brouillon.
3. Le système affiche un récapitulatif et prévient que la facture ne sera plus modifiable.
4. Le Comptable confirme.
5. Le système attribue la référence interne et transmet la facture au module de certification.
6. Le module renvoie le numéro fiscal et les éléments de certification.
7. Le système fige la facture avec les coordonnées du moment, l'inscrit au journal d'audit et propose l'envoi.

**Erreurs**
- **2a.** Client entreprise sans NCC, ou fiche de l'organisation incomplète : refus, champ indiqué.
- **5a.** Une autre facture est émise au même instant : chacune reçoit une référence distincte, sans trou.
- **6a.** La certification échoue : la facture passe « en attente de certification », n'est pas envoyée, et peut être retransmise.

**Résultat :** une facture émise, immuable. En mode simulateur, elle porte la mention de non-certification.

**Abus**
- Un Commercial appelle directement l'adresse d'émission : même réponse que si la facture n'existait pas.
- Modifier une facture émise par un appel direct : refus, immutabilité vérifiée côté serveur.
- Confirmer deux fois pour créer deux factures : une seule émission par brouillon.

**Exigences :** F-054, F-060, F-061, F-062, R-03, R-04, R-05, R-06, S-32, S-70.

### UC-23 — Envoyer une facture

- **Acteur :** Comptable.
- **But :** transmettre la facture au client.
- **Préconditions :** une facture émise et certifiée.

**Scénario nominal**
1. Le Comptable demande l'envoi et vérifie le destinataire.
2. Le système génère le PDF, avec les instructions de paiement, et un lien de consultation, puis envoie l'email.

**Erreurs**
- **1a.** Le client n'a pas d'email : téléchargement du PDF et copie du lien.
- **1b.** La facture est en attente de certification : envoi refusé.

**Résultat :** facture transmise, date d'envoi enregistrée.

**Exigences :** F-056, F-057, F-062, S-20, S-55.

### UC-24 — Consulter une facture par lien

- **Acteur :** Client final.
- **But :** lire sa facture et savoir comment payer.
- **Préconditions :** détenir un lien valide.

**Scénario nominal**
1. Le Client ouvre le lien.
2. Le système affiche cette seule facture, son reste dû, les instructions de paiement, et permet de télécharger le PDF.

**Erreurs**
- **1a.** Lien invalide, expiré ou révoqué : page unique, sans autre information.

**Résultat :** aucune modification. La page ne permet aucune action sur la facture.

**Abus**
- Deviner des liens, ou remonter vers d'autres documents : mêmes protections que UC-19.

**Exigences :** F-056, F-057, S-20, S-21, S-22, S-34.

### UC-25 — Émettre un avoir

- **Acteur :** Comptable.
- **But :** corriger ou annuler une facture émise.
- **Préconditions :** une facture émise.

**Scénario nominal**
1. Le Comptable ouvre la facture et demande un avoir.
2. Il choisit les lignes et les quantités concernées, ou la facture entière, et saisit le motif.
3. Le système calcule le montant et vérifie qu'il ne dépasse pas ce qui reste créditable.
4. Le Comptable confirme.
5. Le système attribue la référence de l'avoir, le fait certifier, le fige et met à jour le reste dû de la facture.

**Erreurs**
- **3a.** Le cumul des avoirs dépasserait le total de la facture : refus.
- **5a.** La certification échoue : l'avoir reste en attente, comme une facture.
- **5b.** Le reste dû devient négatif : la facture affiche un trop-perçu (UC-27).

**Résultat :** un avoir émis, immuable, rattaché à la facture.

**Abus**
- Annuler par un avoir une facture encaissée en espèces pour détourner l'argent : l'avoir est réservé au Comptable et au Propriétaire, motivé, inscrit au journal d'audit, et le trop-perçu reste visible.
- Deux avoirs saisis au même instant pour dépasser le total : contrôle garanti côté base.

**Exigences :** F-070, F-071, R-05, R-09, R-10, S-30, S-70.

---

## 6. Paiements et relances

### UC-26 — Enregistrer un paiement ★

- **Acteur :** Comptable.
- **But :** constater un règlement reçu.
- **Préconditions :** une facture émise avec un reste dû positif.

**Scénario nominal**
1. Le Comptable ouvre la facture et demande l'ajout d'un paiement.
2. Il saisit la date, le montant, le mode de règlement et une référence facultative.
3. Le système vérifie que le montant est positif et ne dépasse pas le reste dû.
4. Le système enregistre le paiement avec son auteur, met à jour le statut de la facture et inscrit l'opération au journal d'audit.

**Erreurs**
- **3a.** Montant supérieur au reste dû : refus.
- **3b.** Date dans le futur : refus.
- **4a.** Un collègue enregistre un paiement au même instant : le second est refusé si le total dépasse le reste dû.

**Résultat :** paiement enregistré, facture « partiellement payée » ou « payée ».

**Abus**
- Enregistrer un faux paiement pour faire disparaître une facture des relances : auteur tracé, journal d'audit consultable par le Propriétaire.
- Supprimer un paiement en espèces après l'avoir encaissé : aucune suppression possible, seulement une annulation motivée et tracée (UC-27).
- Un Commercial enregistre un paiement par appel direct : refus.

**Exigences :** F-080, F-055, R-09, S-30, S-31, S-70.

### UC-27 — Annuler un paiement ou enregistrer un remboursement

- **Acteur :** Comptable.
- **But :** corriger une erreur de saisie ou rendre un trop-perçu.
- **Préconditions :** un paiement valide, ou une facture en trop-perçu.

**Scénario nominal (annulation)**
1. Le Comptable choisit un paiement et saisit le motif.
2. Le système marque le paiement comme annulé, sans l'effacer, recalcule le reste dû et inscrit l'opération au journal d'audit.

**Scénario nominal (remboursement)**
1. Sur une facture en trop-perçu, le Comptable saisit la date, le montant et le mode du remboursement.
2. Le système vérifie que le montant ne dépasse pas le trop-perçu, l'enregistre et l'inscrit au journal d'audit.

**Erreurs**
- **1a.** Motif absent : refus.

**Résultat :** le paiement annulé reste visible avec son motif et son auteur.

**Abus**
- Annuler un paiement réel pour masquer un détournement : l'annulation ne retire rien de l'historique, et son auteur est tracé.

**Exigences :** F-081, F-082, R-10, S-31, S-70.

### UC-28 — Relancer une facture en retard

- **Acteur :** Comptable.
- **But :** rappeler au client une facture impayée.
- **Préconditions :** une facture en retard, un modèle de relance défini.

**Déclenchement automatique :** chaque jour, le système marque « en retard » les factures dont l'échéance est dépassée avec un reste dû positif, et les signale lorsque le délai d'un modèle est atteint.

**Scénario nominal**
1. Le Comptable ouvre la liste des factures à relancer.
2. Il choisit une facture. Le système prépare le message à partir du modèle, avec les variables remplies.
3. Le Comptable relit, ajuste si besoin, puis envoie.
4. Le système envoie l'email et enregistre la relance sur la facture.

**Erreurs**
- **2a.** Le client n'a pas d'email : le système propose de copier le texte.
- **3a.** La facture a été payée entre-temps : envoi refusé.

**Résultat :** relance envoyée et tracée. Aucune relance ne part sans action humaine.

**Abus**
- Un nom de client conçu pour injecter du contenu dans l'email : valeurs échappées.
- Harceler un client par des relances répétées : limitation de débit, historique visible.

**Exigences :** F-100, F-101, R-11, S-51, S-55.

---

## 7. Pilotage

### UC-29 — Consulter le tableau de bord

- **Acteur :** tout membre.
- **But :** connaître la situation de l'organisation.
- **Préconditions :** être membre.

**Scénario nominal**
1. Le membre ouvre le tableau de bord.
2. Le système affiche, pour la période choisie : montant facturé, montant encaissé, reste dû, factures en retard, devis en attente.

**Résultat :** aucune modification.

**Abus**
- Un Commercial en mode restreint déduit le chiffre d'affaires de ses collègues : ses indicateurs ne portent que sur son portefeuille.

**Exigences :** F-110, F-016.

### UC-30 — Exporter des données

- **Acteur :** Lecteur, Comptable, Propriétaire.
- **But :** exploiter les données dans un tableur ou les conserver.
- **Préconditions :** avoir l'un de ces rôles.

**Scénario nominal (export de travail)**
1. Le membre choisit clients, factures ou paiements, et une période.
2. Le système produit un fichier CSV et inscrit l'export au journal d'audit.

**Scénario nominal (export complet)**
1. Le Propriétaire demande l'export complet et ressaisit son mot de passe.
2. Le système produit l'archive et inscrit l'export au journal d'audit.

**Résultat :** un fichier téléchargé, limité à l'organisation active.

**Abus**
- Sortir massivement le fichier client avant de quitter l'entreprise : chaque export est tracé avec son auteur, et le Commercial n'y a pas accès.
- Placer une formule dans un nom de client pour qu'elle s'exécute chez celui qui ouvre l'export : cellules neutralisées.
- Un Comptable lance l'export complet par appel direct : refus, réservé au Propriétaire.

**Exigences :** F-111, F-112, S-14, S-52, S-70.

### UC-31 — Consulter le journal d'audit

- **Acteur :** Propriétaire.
- **But :** vérifier qui a fait quoi.
- **Préconditions :** être Propriétaire.

**Scénario nominal**
1. Le Propriétaire ouvre le journal et filtre par période, membre ou type d'action.
2. Le système affiche les entrées : auteur, action, ressource, date et heure.

**Résultat :** aucune modification. Le journal ne peut être ni modifié ni vidé depuis l'application.

**Abus**
- Un membre efface ses traces : aucune fonction de modification ou de suppression n'existe, pour aucun rôle.
- Retrouver dans le journal des mots de passe ou des données personnelles : le journal ne contient que des identifiants et des libellés d'action.

**Exigences :** F-113, S-54, S-70, S-71.

---

## Points décidés pendant la rédaction

La rédaction a fait apparaître trois situations que SPEC.md ne tranchait pas. Elles ont été validées et reportées dans SPEC.md.

1. **Invitation liée à l'email (UC-09)** : exigence S-16.
2. **Devis envoyé non modifiable (UC-17, UC-18)** : règle R-14.
3. **Suppression différée de l'organisation (UC-13)** : règle R-15.
