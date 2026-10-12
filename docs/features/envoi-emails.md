# Fonctionnalité : envoi d'emails

Statut : en cours. Validée le 2026-10-12 (décisions en fin de fiche) ; PR 1 fusionnée (#41) ; PR 2 en phase rouge (règle de configuration de production corrigée par le relecteur, sections 2.2 et 9)

Jalon 0, fonctionnalité 0.7 de `docs/PLAN.md`. Taille M. Deux PR (« Découpage en PR », décision 11).

## Contexte

Cette fonctionnalité sert au développeur. Elle fournit la seule façon d'envoyer un email, que les fonctionnalités suivantes utiliseront :

| Fonctionnalité | Email | Organisation connue à l'envoi |
|---|---|---|
| 1.1 | Vérification de l'adresse ; « un compte existe déjà » (UC-01, 3a) | Non |
| 1.3 | Lien de réinitialisation ; avis de changement de mot de passe (UC-03) | Non |
| 2.2 | Avis de modification des instructions de paiement à tous les Propriétaires (S-33, T-12) | Oui |
| 2.3 | Invitation (UC-08) | Oui |
| 2.5 | Avis de suppression demandée à tous les Propriétaires (UC-13) | Oui |
| 4.4 | Envoi d'un devis, avec son lien public (UC-18) | Oui |
| 5.4 | Envoi d'une facture, avec son lien public (UC-23) | Oui |
| 6.3 | Relance (UC-28) | Oui |

Aujourd'hui :

- Aucun email n'est envoyé. Aucune dépendance d'envoi n'est installée (`package.json`), aucune variable d'environnement n'existe pour cela (`src/server/env-schema.ts` : `DATABASE_URL`, `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`).
- Décision déjà prise (`STACK.md` section 12, `PLAN.md` section 7) : **un compte Gmail dédié à l'application**, gratuit, sans nom de domaine, avec double authentification et mot de passe d'application. Resend est écarté, car il exige un domaine vérifié.
- `DESIGN.md` section 4.3, règle 5, et `STRUCTURE.md` section 3.5 : l'envoi d'emails est un **module interchangeable** (`src/server/modules/email/`), avec une version réelle et une version qui intercepte. `DESIGN.md` section 4.4 : emails interceptés en développement, en test et en prévisualisation.
- La 0.5 a livré `verifierDebit` et a reporté ici la limite par organisation (S-55, T-40), avec deux contraintes : pas de compteur d'organisation à l'étape 4 de la chaîne, et jamais `verifierDebit` pendant une transaction ouverte (`limitation-debit.md`, sections 2.1 et 10, et « Reporté »).
- `PLAN.md` section 4.5 : le test de T-40 est écrit au jalon 0, donc ici.

Cas d'utilisation concernés : aucun directement. Abus repris de `USECASES.md` : inonder la boîte de quelqu'un (UC-03), envoyer du courrier indésirable par l'application, harceler un client par des relances (UC-28), injecter du contenu dans un email par un nom de client (UC-14, UC-28).

## Problème

- Rien ne permet d'envoyer un email, et chaque fonctionnalité de la liste ci-dessus en a besoin.
- Écrit dans chacune, l'envoi le serait huit fois, avec autant de façons de se tromper : adresse non validée, retour à la ligne dans un sujet, lien vers un autre site, mot de passe dans un journal, envoi réel depuis un test.
- Un seul compte Gmail sert toutes les organisations. Une organisation, ou un attaquant, qui l'épuise ou le fait suspendre par Google prive **toutes** les organisations d'emails, y compris des liens de réinitialisation du mot de passe.

## Solution retenue

Cinq éléments :

| Élément | Fichier | Rôle |
|---|---|---|
| La porte d'envoi | `src/server/email/envoi.ts` | Seule fonction qui envoie : valide le message, applique la liste autorisée, choisit le transport, traduit les échecs |
| Les modèles | `src/server/email/modeles.ts`, `src/textes/emails.ts` | Liste fermée des emails, schéma strict de leurs paramètres, construction du sujet et du corps |
| Les transports | `src/server/modules/email/` | `memoire.ts` (tests), `fichier.ts` (local et bout en bout), `smtp.ts` (Gmail, seul fichier qui importe Nodemailer) |
| Les limites | `src/server/debit/limites.ts` | Limites d'envoi globale, par organisation, par destinataire |
| Le branchement | `src/server/actions/action.ts` | Les emails d'une action partent après la validation de sa transaction |

### 1. Une seule porte d'envoi

#### 1.1 Forme

Sur le modèle de `journaliser` (liste fermée, schéma strict) et de `verifierDebit` (source unique, règle d'import) :

```ts
// src/server/email/envoi.ts
envoyerEmail<M extends ModeleEmail>(demande: {
  modele: M;                 // clé de la liste fermée (section 4)
  destinataire: string;      // une seule adresse, validée (section 3.1)
  parametres: ParametresDe<M>;
}): Promise<ResultatEnvoi>;

type ResultatEnvoi =
  | { envoye: true }
  | { envoye: false; raison: "limite" | "indisponible" | "refuse_par_serveur" | "non_autorise" };
```

Dans l'ordre :

1. Valider la demande par un schéma strict : modèle de la liste, adresse (section 3.1), paramètres du modèle. Échec : exception `DemandeEmailInvalide`, message fixe, sans valeur reçue ni `cause` (comme `EntreeJournalInvalide`). Rien ne part.
2. Construire le message : expéditeur, sujet et corps viennent du modèle et de la configuration, **jamais de l'appelant**. L'appelant ne fournit ni expéditeur, ni copie, ni copie cachée, ni adresse de réponse, ni en-tête, ni pièce jointe.
3. Hors production, vérifier que le destinataire figure dans la liste autorisée (section 2.2) ; sinon `non_autorise`.
4. Remettre le message au transport choisi par la configuration (section 2).
5. Traduire tout échec du transport en une raison de la liste fermée (section 6.3). Aucune exception du transport ne remonte telle quelle.

La porte n'appelle pas `verifierDebit` elle-même : les limites dépendent de qui envoie (organisation connue ou non, adresse IP au jalon 1). Elle reçoit les limites déjà vérifiées par l'appelant autorisé (section 5).

**Placement.** `src/server/email/` et non `src/server/modules/email/` : la porte contient des règles (validation, liste autorisée, modèles) qui ne changent pas avec le transport. Seuls les transports sont « interchangeables » au sens de `DESIGN.md` règle 5. `STRUCTURE.md` est mis à jour en conséquence.

#### 1.2 Règle ESLint T

Lettre suivante après S (`eslint.config.mjs`). Vérifiée par `regles-import.test.ts`.

- `nodemailer` (et tout sous-chemin) ne s'importe que dans `src/server/modules/email/smtp.ts`. Chargement dynamique refusé, comme pour `drizzle-orm` (règle A).
- `src/server/modules/email/**` ne s'importe que dans `src/server/email/envoi.ts` et les tests.
- `envoyerEmail` ne s'importe que dans `src/server/actions/action.ts` et les tests. La 1.1 ajoutera `src/server/auth/config.ts` (rappels d'envoi de Better Auth), par une modification de la règle dans sa PR.
- La chaîne `smtp.gmail.com` n'apparaît que dans `src/server/modules/email/smtp.ts` et les tests.

Échappement : méthode de `CLAUDE.md`, « Pièges connus » (script Python, `chr(92)`, comptage des barres inverses, puis `regles-import.test.ts`).

Un service n'appelle donc jamais `envoyerEmail` : il demande un envoi par le contexte (section 5.2), et la chaîne envoie après la validation.

### 2. Les environnements : qu'est-ce qui envoie vraiment

#### 2.1 Tableau

| Environnement | Transport | Envoi réel | Comment c'est garanti |
|---|---|---|---|
| Production (`VERCEL_ENV=production`) | Après la PR 1 : `memoire`. À partir de la PR 2 : `smtp` | PR 1 : non. PR 2 : oui, à toute adresse valide | PR 1 : sans `EMAIL_TRANSPORT`, `memoire`, aucun refus ; les variables Gmail sont ignorées. À partir de la PR 2 : `EMAIL_TRANSPORT` absent vaut `smtp` ; toute autre valeur que `smtp` est refusée, comme une variable Gmail absente ou mal formée (décision 4, corrigée) ; les variables Gmail sont posées dans Vercel depuis le 2026-10-13 (section 9) |
| Prévisualisation (`VERCEL_ENV=preview`) | Sans variable : `memoire`, en PR 1 comme en PR 2. Configurée : `smtp`, par un second compte Gmail, vers la liste autorisée (décision 3, PR 2). `fichier` est refusé : système de fichiers en lecture seule sur Vercel | Seulement aux adresses de la liste | La porte refuse tout destinataire hors liste dès que `VERCEL_ENV` n'est pas `production` |
| Poste local, `next dev` | `fichier` | Non | Valeur par défaut hors Vercel. Un essai réel demande `smtp` **et** une liste autorisée |
| Vitest, projets `unitaires` et `integration` | `memoire` | **Jamais** | Configuration refusée si `smtp` sous `NODE_ENV=test` ; garde réseau (section 2.3) |
| Playwright, local et CI (`npm run start`) | `fichier`, dans un dossier temporaire lu par les tests | **Jamais** | `EMAIL_TRANSPORT=fichier` posé dans `env` du `webServer` de `playwright.config.ts`, qui l'emporte sur `.env.local` (Next.js n'écrase pas une variable déjà définie) |
| CI GitHub | `memoire` ou `fichier` | **Jamais** | Aucune variable Gmail dans les secrets de GitHub |

**Invariant central : un envoi à une adresse arbitraire n'est possible que si `VERCEL_ENV === "production"`.** Partout ailleurs, même avec un mot de passe d'application valide par erreur, la porte refuse tout destinataire hors de la liste autorisée. Test unitaire de la porte, et test d'attaque (« Tests à écrire »).

**Piège à éviter, propre à ce projet** : `npm run test:e2e` lance `next start`, donc `NODE_ENV=production`, qui charge `.env.local`. Si le mot de passe Gmail s'y trouvait, un test de bout en bout enverrait un vrai email. D'où trois verrous : aucune variable Gmail dans `.env.local` (section 9), `EMAIL_TRANSPORT=fichier` imposé par `playwright.config.ts`, et l'invariant ci-dessus (`VERCEL_ENV` absent en local).

#### 2.2 Variables d'environnement

Ajoutées à `src/server/env-schema.ts` (fonction pure, règle 12), lues par `env.ts` seul :

| Variable | Valeurs | Règle |
|---|---|---|
| `EMAIL_TRANSPORT` | PR 1 : `fichier`, `memoire`. PR 2 : et `smtp` | Absente : `memoire` sous `NODE_ENV=test` ; `memoire` sur Vercel (`VERCEL_ENV` présent, prévisualisation comme production) ; `fichier` sinon. Vide ou inconnue : refusée. `fichier` sur Vercel : refusé. **À partir de la PR 2 seulement** : en production, facultative, `smtp` si elle est absente, toute autre valeur refusée (décision 4, corrigée : section 9) ; sous `NODE_ENV=test`, `smtp` refusé. Jamais de refus en PR 1 pour une variable absente : la production et la prévisualisation n'en ont aucune à la fusion de la PR 1. **En PR 1, `smtp` est refusé partout**, production comprise |
| `GMAIL_UTILISATEUR` | Adresse `@gmail.com` | Obligatoire si `smtp`, donc toujours en production à partir de la PR 2 ; ignorée par le code de la PR 1. Sert d'expéditeur : Gmail remplace de toute façon l'expéditeur par le compte authentifié |
| `GMAIL_MOT_DE_PASSE_APPLICATION` | 16 lettres minuscules, espaces retirés | Obligatoire si `smtp`, donc toujours en production à partir de la PR 2 ; ignorée par le code de la PR 1. Secret. Le message d'erreur nomme la variable et la raison, jamais la valeur (`env-schema.ts`, comme les autres) |
| `EMAIL_DESTINATAIRES_AUTORISES` | Liste d'adresses séparées par des virgules | Obligatoire si `smtp` hors production ; ignorée en production |
| `EMAIL_DOSSIER` | Chemin d'un dossier | Pour `fichier` seulement. Par défaut `.emails/` à la racine, ajouté à `.gitignore` |

`VERCEL_ENV` est déjà lu par `validerEnvironnement` (déduction de `BETTER_AUTH_URL`) ; `env` exposera `estProduction`.

#### 2.3 Aucun test n'envoie un vrai email

Quatre barrières indépendantes :

1. **Configuration.** `validerEnvironnement` refuse `EMAIL_TRANSPORT=smtp` sous `NODE_ENV=test` (Vitest pose `NODE_ENV=test` s'il est absent, à vérifier en phase rouge).
2. **Aucun secret.** Ni GitHub, ni `.env.local`, ni aucun fichier du dépôt ne contient le mot de passe d'application. La CI n'a aucun moyen d'envoyer.
3. **Garde réseau sous Vitest.** Un fichier de préparation (`tests/garde-reseau.ts`, `setupFiles` des deux projets) remplace `net.connect`, `net.createConnection` et `tls.connect` par une version qui lève une exception pour les ports 25, 465, 587 et 2525, quel que soit l'hôte. Les tests d'intégration gardent l'accès à PostgreSQL (port 5432). Le serveur SMTP factice (« Tests à écrire ») écoute sur `127.0.0.1` et un port libre choisi par le système, autorisé par la garde.
4. **Liste autorisée.** Même si les trois premières tombaient, hors production la porte refuse tout destinataire hors liste, et la liste des tests ne contient que des adresses en `.invalid` (RFC 2606, domaine réservé qui ne peut pas exister).

### 3. Les messages

#### 3.1 L'adresse du destinataire

Schéma propre, plus étroit que `z.email()`, appliqué par la porte quel que soit l'appelant :

- une seule adresse, forme `partie-locale@domaine`, sans nom affiché, sans `<`, `>`, guillemets, virgule, point-virgule, parenthèse ni espace ;
- ASCII imprimable seulement : aucun caractère de contrôle, donc ni `\r`, ni `\n`, ni `\0`, ni tabulation ; aucun caractère non ASCII (pas d'adresse internationalisée en 0.7) ;
- 254 caractères au plus, partie locale de 64 au plus ;
- domaine avec au moins un point, étiquettes `[a-z0-9-]`, sans tiret au bord.

Les parenthèses sont refusées à cause de deux avis récents sur l'analyse des commentaires RFC 5322 par Nodemailer (GHSA-g73g-hqqh-jr95, GHSA-g57g-f23g-4646, section 8) : l'adresse que nous validons doit être exactement celle que Nodemailer met dans l'enveloppe.

Normalisation avant envoi : espaces de bord retirés, domaine en minuscules. La partie locale est gardée telle quelle pour l'envoi.

#### 3.2 L'injection d'en-têtes

Un retour à la ligne dans un sujet ou une adresse permet d'ajouter un en-tête (`Bcc:` vers mille adresses) ou un second corps.

- **Adresse** : refusée par le schéma (section 3.1).
- **Sujet** : construit par le modèle à partir de textes fixes de `src/textes/emails.ts`. En 0.7, aucun contenu saisi par un utilisateur n'entre dans un sujet (question 7). Si une fonctionnalité en ajoute un plus tard, il passe par `ligneEnTete(texte)`, qui retire tout caractère de contrôle et limite la longueur ; testée en 0.7.
- **Nom de l'expéditeur** : fixe, dans `src/textes/emails.ts` (question 7).
- **Défense en profondeur** : Nodemailer encode lui-même les en-têtes. Un test contourne volontairement la validation (appel direct du transport `smtp` vers le serveur factice, avec un sujet qui contient `\r\nBcc: x@exemple.invalid`) et vérifie, sur les octets reçus par le serveur, qu'aucun en-tête `Bcc` n'apparaît et qu'il n'y a qu'un seul `RCPT TO`.

#### 3.3 Le contenu

- **Texte brut seulement** en 0.7 (question 6). Aucun HTML, donc aucune injection de balise possible dans le client de messagerie (S-51, T-62). Un nom de client `<script>` s'affiche tel quel.
- **Aucune donnée sensible** : ni montant détaillé, ni ligne de facture, ni instructions de paiement, ni pièce jointe, ni mot de passe, ni code. L'email dit qu'un document attend, et donne un lien. Le document se lit derrière le lien, qui est expirable et révocable (S-20).
- **Liens** : chaque modèle reçoit au plus un lien, sous forme de jeton, jamais d'adresse complète. La porte construit l'adresse : origine de `BETTER_AUTH_URL`, chemin fixe `/lien/<type>/<jeton>`. Le jeton est validé (alphabet `base64url`, longueur fixe). Un appelant ne peut donc pas produire de lien vers un autre site ni vers un autre chemin de l'application. La question 8 traite des liens de Better Auth (jalon 1).
- **Réponses des destinataires** : chaque modèle se termine par une phrase fixe de `src/textes/emails.ts`, la même pour tous, qui demande de ne pas répondre à cet email et de contacter directement l'entreprise concernée. Les réponses arrivent quand même dans la boîte de réception du compte, qui n'est pas lue (« Limites connues », RR-9).
- **Textes** : en français, dans `src/textes/emails.ts` (NF-01). La règle R d'ESLint ne voit que le JSX ; un test unitaire vérifie que chaque modèle tire ses textes de ce fichier.
- **Taille** : corps limité (par exemple 10 000 caractères) ; un paramètre texte (nom d'organisation, nom de client) limité à sa longueur en base.

### 4. Les modèles : une liste fermée

Dans `src/server/email/modeles.ts`, sur le modèle de `journal/actions.ts` : pour chaque modèle, le schéma strict de ses paramètres et la fonction qui construit sujet et corps.

En 0.7, **un seul modèle**, de démonstration et de vérification : `essai.verification_envoi` (aucun paramètre, aucun lien), utilisé par les tests et par la vérification manuelle en prévisualisation (section 9, étape 5). Chaque fonctionnalité ajoute ses modèles dans sa PR, avec leurs tests. Retirer un modèle est permis (il n'est pas stocké).

Briques admises pour les paramètres, sur le modèle de `journal-audit.md` section 6.2, avec une de plus : identifiant (`z.uuid()`), valeur énumérée, entier, booléen, jeton de lien (section 3.3), et **texte court affichable** (`texteAffichable(max)` : sans caractère de contrôle, longueur bornée). Un test parcourt la liste par `z.toJSONSchema` et refuse toute autre forme (tableau, objet imbriqué, chaîne libre, adresse).

### 5. Les limites

#### 5.1 Ce que dit Gmail

Source : Google, « Limites d'envoi dans Gmail », <https://support.google.com/mail/answer/22839>, consultée le 2026-10-12. Pour un compte Gmail personnel :

- plus de **500 destinataires dans un seul email**, ou plus de **500 emails envoyés en un jour**, et l'envoi est bloqué ;
- l'envoi redevient possible « dans un délai de **1 à 24 heures** », sans plus de précision ;
- si beaucoup de messages ne peuvent pas être remis, l'envoi peut n'être rétabli qu'après 24 heures.

Les chiffres de Google Workspace (2 000 par jour, <https://knowledge.workspace.google.com/admin/gmail/gmail-sending-limits-in-google-workspace>) ne s'appliquent pas à un compte `@gmail.com`. La page ne dit pas si « un jour » est une journée calendaire ou 24 heures glissantes : on suppose le cas le plus défavorable, 24 heures glissantes. Elle ne dit rien non plus du filtrage des messages semblables (`PLAN.md` section 7) : c'est un risque sans chiffre (« Limites connues »).

Conséquence : un dépassement bloque **toute l'application** pendant 1 à 24 heures, réinitialisations de mot de passe comprises. Nos limites doivent donc rester nettement en dessous, même dans le pire cas de la fenêtre fixe.

#### 5.2 Nos limites, par `verifierDebit`

Ajoutées à `LIMITES` (`src/server/debit/limites.ts`), avec trois nouvelles valeurs de `par` : `"application"`, `"organisation"`, `"destinataire"`. Valeurs proposées (question 5) :

| Nom | Maximum | Fenêtre | Clé | But |
|---|---|---|---|---|
| `email.application` | 200 | 24 h | Valeur fixe `"gmail"` | Ne jamais atteindre 500. La fenêtre fixe admet jusqu'à 2 × le maximum autour d'une fin de fenêtre (`limitation-debit.md` section 5) : 400 au pire, sous 500 |
| `email.organisation` | 40 | 24 h | Identifiant de l'organisation de la transaction | S-55, T-40 : une organisation, même légitime, ne prive pas les autres. Il faut au moins 5 organisations au plafond pour épuiser `email.application` |
| `email.destinataire` | 3 | 1 h | Adresse normalisée (question 10) | Inonder une boîte (UC-03, UC-28) ; relais de spam vers une même cible |
| `email.destinataire_jour` | 10 | 24 h | Idem | Idem, sur la journée |

- La clé est une empreinte HMAC (`cle.ts`, livré par la 0.5) : ni l'adresse ni l'identifiant n'apparaissent en clair dans `compteur_debit`.
- Toutes les fenêtres restent sous 24 heures : `fenetreMaxSecondes` et la purge ne changent pas.
- Les limites d'envoi s'ajoutent à `membre.action` (60 par minute et par utilisateur, étape 4), qui reste en place.
- Ordre de vérification : destinataire, organisation, application. Chaque appel consomme, même si le suivant refuse : un refus coûte donc une unité à chaque compteur déjà passé. Accepté (on compte les tentatives, `limitation-debit.md` section 2.1).
- **Goulot à surveiller.** À partir de 5 organisations actives qui envoient chacune près de leur plafond, `email.application` (200) devient la limite réelle, avant `email.organisation`. Et une relance de fin de mois peut, à elle seule, dépasser 40 emails pour une organisation. Valeurs à revoir au jalon 6 (relances, 6.3) et au jalon 8 (exploitation), sur les compteurs observés.
- Une organisation au plafond n'affecte ni une autre organisation, ni les emails du jalon 1 (sans organisation), qui n'ont que les limites `application`, `destinataire` et, à la 1.1, adresse IP.

#### 5.3 Où compter : après la validation de la transaction

Les deux contraintes de la 0.5 excluent l'étape 4 (organisation pas encore vérifiée) et la transaction (`verifierDebit` interdit pendant une transaction ouverte, règle 15). Reste : **après la validation**.

- Le service demande un envoi par `ctx.preparerEmail({ modele, destinataire, parametres })`. La demande est validée tout de suite (une demande invalide lève et annule la transaction), puis gardée en mémoire par la chaîne. Rien ne part pendant la transaction.
- Après la validation de la transaction (étape 12 de `chaine-controles.md` section 5), pour chaque demande : `verifierDebit` des quatre limites, puis `envoyerEmail`. Aucune transaction n'est ouverte à ce moment : la règle 15 est respectée.
- Si la transaction est annulée, aucune demande n'est envoyée ni comptée.
- La déclaration gagne un champ obligatoire, sans défaut, comme `debit` et `journal` : `emails: readonly ModeleEmail[]`, la liste des modèles que l'action peut envoyer (`[]` explicite). `ctx.preparerEmail` n'existe que si la liste est non vide (type), et refuse un modèle hors liste (exécution). Le registre des actions rend ainsi visible, en revue, toute action qui envoie.

Ce choix a une conséquence : l'action est faite **avant** de savoir si l'email part. C'est l'objet de la section 6.

### 6. Si Gmail refuse ou ne répond pas

#### 6.1 Les cas

| Cas | Origine | Fréquence attendue |
|---|---|---|
| Limite interne atteinte | Nos compteurs (section 5.2) | Rare, sauf abus |
| Gmail ne répond pas, délai dépassé | Réseau, Google | Rare |
| Authentification refusée (`EAUTH`) | Mot de passe d'application révoqué (changement du mot de passe du compte, suppression du mot de passe d'application) | Rare, mais **bloque tout** jusqu'à intervention |
| Limite de Gmail atteinte, compte suspendu | Google | Rare si nos limites tiennent |
| Destinataire refusé à l'envoi (`5xx` sur `RCPT TO`) | Adresse mal formée pour Google | Rare : une adresse inexistante est en général acceptée puis rejetée plus tard par un message de non-remise, que l'application ne voit pas |

#### 6.2 Que devient l'action de l'utilisateur

Options, à trancher (question 2) :

| Option | Description | Pour | Contre |
|---|---|---|---|
| **A. Envoi direct après la validation, échec signalé** | Section 5.3 telle quelle. Le résultat de l'action dit si l'email est parti : `{ ok: true, valeur, emails: { envoyes, nonEnvoyes } }`. L'interface affiche « Invitation créée, mais l'email n'a pas pu partir. Réessayez plus tard. » La fonctionnalité qui envoie prévoit un « renvoyer » (UC-08 1b le prévoit déjà pour les invitations) | Aucune table, aucune tâche. L'utilisateur sait tout de suite. Simple à tester | L'utilisateur attend la réponse de Gmail (une à quelques secondes depuis Francfort). Aucun nouvel essai automatique : un email non parti l'est jusqu'à ce que quelqu'un réessaie. Les emails du jalon 1 (réinitialisation) ne peuvent pas dire « non parti » sans révéler si le compte existe (T-07) : échec silencieux, consigné |
| B. File d'envoi en base | Table `email_sortant` (avec `organisation_id`, règle d'isolation), écrite dans la transaction de l'action ; envoi après la validation, comme A ; en cas d'échec, la ligne reste, et la tâche quotidienne réessaie | Aucun email perdu en silence. Historique des envois | Une table de plus, qui stocke des adresses et des jetons de lien en clair (donnée personnelle, A6), avec sa purge. La tâche de Vercel (offre gratuite) ne passe qu'une fois par jour : un email « mis en file » part avec jusqu'à 24 heures de retard, trop tard pour une invitation ou une réinitialisation. Plus de code, plus de tests |
| C. Envoi dans la transaction, échec qui annule l'action | L'envoi a lieu à l'étape 10 ; une erreur annule tout | L'action et l'email réussissent ou échouent ensemble, en apparence | Faux en pratique : l'email peut partir et la validation échouer ensuite (lien vers une invitation qui n'existe pas). La transaction et sa connexion restent ouvertes pendant l'échange SMTP. Contraire à la règle 15 si l'on compte. Écarté |
| D. Envoi après la réponse (`after()` de Next.js) | Comme A, mais la réponse part avant l'envoi | L'utilisateur n'attend pas | Il ne sait jamais si l'email est parti ; aucune trace hors du journal technique. Durée de vie de la fonction après la réponse à vérifier sur Vercel |

**Recommandation : A pour la 0.7**, avec B gardée en réserve le jour où un volume réel justifie une file (jalon 8). La 0.7 livre le mécanisme et le contrat du résultat ; chaque fonctionnalité qui envoie décide de son texte et de son bouton « renvoyer ».

#### 6.3 Les échecs du transport

- Délais courts et explicites dans `smtp.ts` : connexion, accueil et inactivité de quelques secondes (par exemple 5, 5 et 10 s). Les valeurs par défaut de Nodemailer, beaucoup plus longues, sont relues dans `node_modules` à l'installation et notées ici. La durée maximale d'une fonction Vercel n'est pas en jeu avec ces valeurs.
- Aucun nouvel essai automatique dans la requête : un deuxième essai doublerait l'attente sans meilleure chance.
- Toute erreur de Nodemailer est traduite par sa propriété `code` (`EAUTH`, `ETIMEDOUT`, `ECONNECTION`, `EENVELOPE`, `EMESSAGE`...) et son `responseCode` numérique en une raison de la liste fermée (`indisponible`, `refuse_par_serveur`). **Son `message` et sa `response` ne sont jamais lus ni consignés** : la réponse d'un serveur SMTP cite souvent l'adresse du destinataire (« 550 5.1.1 ... <adresse> »).
- Le journal technique (`src/server/erreurs/consigner.ts`) reçoit : le modèle, la raison, le `code` de Nodemailer, le `responseCode`, et un identifiant d'incident. Jamais l'adresse, jamais le contenu.
- `EAUTH` est signalé comme un incident à part : il exige une intervention (nouveau mot de passe d'application, section 9). Le signalement au service de suivi des erreurs est la 8.1.

### 7. Les menaces

| Menace | Parade | Test |
|---|---|---|
| **Injection d'en-têtes** : retour à la ligne dans un sujet, une adresse, un nom (nouvelle T-64) | Adresse refusée (3.1) ; sujet et expéditeur fixes (3.2) ; `ligneEnTete` ; encodage de Nodemailer en plus | Unitaires sur le schéma ; test sur les octets reçus par le serveur factice, validation contournée |
| **Envoi vers une adresse arbitraire** | Le destinataire vient d'une ressource lue en base par le service (client, invitation), jamais directement de l'entrée en 0.7 et dans la mesure du possible ensuite ; hors production, liste autorisée ; un seul destinataire par message, ni copie ni copie cachée possibles | Hors production, adresse hors liste : `non_autorise`, rien dans le transport ; la porte n'accepte pas de champ `cc`, `bcc`, `replyTo`, `headers`, `attachments` (schéma strict) |
| **Relais de spam** (T-40) | Quatre limites (5.2) ; contenu fixe par modèle, aucun texte libre de l'utilisateur dans le corps en 0.7 ; un lien seulement vers `/lien/` | **T-40** : au-delà du plafond, les envois sont refusés, le transport ne reçoit rien ; une organisation au plafond n'empêche pas une autre d'envoyer |
| **Lien piégé** : un email de l'application qui mène vers un autre site (nouvelle T-65) | La porte construit l'adresse depuis un jeton (3.3) | Un jeton contenant `/`, `:`, `.`, `%` ou trop long est refusé ; l'adresse produite commence toujours par l'origine de `BETTER_AUTH_URL` suivie de `/lien/` |
| **Fuite du mot de passe d'application** (nouvelle T-76, A7) | Variable de type Secret sur Vercel, production seulement (et compte distinct en prévisualisation, question 3) ; jamais dans `.env.local`, la CI ou le dépôt ; détection de secrets existante (T-70) ; `logger: false` et `debug: false` explicites dans `smtp.ts` (le mode de débogage de Nodemailer écrit la conversation SMTP, dont la ligne `AUTH` qui contient le mot de passe encodé en base64, réversible) ; message de `env-schema.ts` sans valeur ; erreurs de Nodemailer jamais consignées telles quelles | Test : un envoi vers le serveur factice ne fait rien apparaître sur `stdout` ni `stderr` qui contienne le mot de passe, sa forme base64, ni l'adresse ; options du transport réel figées (`logger`, `debug` à `false`) |
| **Contenu des emails** (T-62, S-51) | Texte brut ; aucune donnée sensible ; paramètres en briques fermées | `<script>`, `=CMD()`, `\r\n` dans un paramètre texte : refusés ou rendus tels quels selon la brique ; aucun HTML produit |
| **Adresses dans les journaux** (S-54, T-35) | Ni journal technique, ni journal d'audit (détails stricts sans texte libre, déjà), ni compteur (empreinte) | Les messages consignés pendant les tests ne contiennent aucune adresse de test ; aucune ligne de `compteur_debit` ne contient l'adresse |
| **Énumération de comptes par l'email** (T-07, jalon 1) | Le résultat d'envoi n'est pas transmis au visiteur dans les parcours anonymes ; temps de réponse : à traiter par la 1.1 | Reporté à la 1.1 |
| **Compte Gmail suspendu ou compromis** | Compte dédié, double authentification, aucun autre usage ; nos limites sous celles de Google ; IMAP et POP désactivés dans les réglages Gmail si l'envoi SMTP reste possible (à vérifier, section 9) | Manuel (section 9) |

Nouvelles lignes proposées pour `THREATS.md` :

- **T-64** (section 5.7) : injecter un en-tête dans un email par un retour à la ligne. P4, P5. G 2, V 2, Moyenne. Parades S-50, S-51.
- **T-65** (section 5.7) : faire envoyer par l'application un email contenant un lien vers un autre site. P2, P4. G 2, V 2, Moyenne. Parade S-51.
- **T-76** (section 5.8) : fuite du mot de passe d'application Gmail, qui donne l'envoi au nom de l'application et la lecture de sa boîte. Développeur. G 3, V 1, Moyenne. Parades S-83, S-54.
- **RR-9** : le dossier « Messages envoyés » du compte Gmail garde une copie de chaque email, donc l'adresse du destinataire et le lien ; la boîte de réception reçoit les réponses des destinataires, malgré la phrase qui demande de ne pas répondre (section 3.3), et n'est pas lue. Parade : purge manuelle mensuelle des deux dossiers par le développeur (décision 9) ; liens expirables et révocables (S-20).
- **RR-10** : Google peut suspendre ou ralentir le compte sans préavis ; l'application n'envoie plus rien pendant 1 à 24 heures, ou plus. En particulier, un compte Gmail neuf qui se connecte depuis un serveur de Francfort (Vercel, `fra1`) peut être bloqué comme connexion suspecte : à observer à l'étape 5 de la section 9, et toute alerte de Google y est notée.
- Section 7.5 : **Google (Gmail)** devient destinataire de données (adresses des destinataires, contenu des emails). Hébergement : États-Unis et réseau mondial de Google, à confirmer.

### 8. La dépendance

Règle 10 : **aucune installation sans accord**. Proposition :

| Critère | `nodemailer` |
|---|---|
| Rôle | Client SMTP : connexion TLS, authentification, construction MIME, encodage des en-têtes |
| Éditeur | Andris Reinman (`andris`), auteur et mainteneur depuis l'origine ; publication par GitHub Actions avec provenance (« trusted publisher ») |
| Ancienneté | Paquet créé le 2011-01-21 |
| Téléchargements | 25 536 101 la semaine du 2026-10-04 au 2026-10-10 (`api.npmjs.org`) |
| Licence | MIT-0 |
| Dépendances | **Aucune** dépendance d'exécution (10.1.0) |
| Types | Fournis par le paquet depuis la 10.0 (`types: ./dist/cjs/nodemailer.d.ts`) : `@types/nodemailer` n'est pas nécessaire |
| Moteur | Node.js 20 ou plus (projet : Node 24) |
| Version proposée | Fixée exactement, au moins **10.0.13** (question 1) |

**État de sécurité, à connaître avant de choisir une version.** La 10.0.0 (2026-09-04) est une réécriture en TypeScript. Elle a été suivie de seize correctifs en un mois (10.0.1 à 10.0.16, puis 10.1.0 le 2026-10-10), et de neuf avis de sécurité publiés entre le 2026-09-10 et le 2026-09-30 (<https://github.com/nodemailer/nodemailer/security/advisories>), qui touchent aussi les versions 3 à 9 :

| Avis | Gravité | Versions touchées | Corrigé en |
|---|---|---|---|
| GHSA-4ffr-jq9g-5ffx, déni de service par l'analyse des mécanismes `AUTH` | Haute | 3.0.0 à 10.0.12 | 10.0.13 |
| GHSA-g73g-hqqh-jr95, commentaire RFC 5322 dans `<...>` : destinataire d'enveloppe mal formé | Moyenne | 3.0.0 à 10.0.12 | 10.0.13 |
| GHSA-39m8-27wv-hr27, DKIM, déni de service | Moyenne | 3.0.0 à 10.0.9 | 10.0.10 |
| GHSA-4g23-2xm8-66gc, réponses SMTP, déni de service par un serveur malveillant | Moyenne | 3.0.0 à 10.0.9 | 10.0.10 |
| GHSA-g57g-f23g-4646, partie locale entre guillemets : destinataire mal formé | Moyenne | 9.1.0 à 10.0.8 | 10.0.9 |
| GHSA-v53p-9fqp-m79j, analyse des adresses, déni de service | Haute | jusqu'à 10.0.5 | 10.0.6 |
| GHSA-prgh-xp8r-p3m5, analyse des adresses, déni de service | Haute | 9.1.0 à 10.0.4 | 10.0.5 |
| GHSA-6vj9-mwq6-2f5v, cache DNS global : identifiants SMTP exposés entre transports | Moyenne | 5.0.0 à 10.0.1 | 10.0.2 |

Conséquences : aucune version 8 ou 9 n'est sûre ; il faut la branche 10, à partir de 10.0.13 ; le rythme de publication impose de relancer `npm audit` et de relire les avis le jour de l'installation, pas seulement aujourd'hui. Dependabot (hebdomadaire) suivra ensuite les correctifs de la branche 10.

**Alternatives :**

| Alternative | Éditeur, ancienneté, téléchargements | Raison de l'écarter |
|---|---|---|
| `emailjs` 5.0.3 | `eleith`, publication par GitHub Actions ; 46 406 téléchargements par semaine ; aucune dépendance d'exécution | 550 fois moins utilisé, donc beaucoup moins éprouvé ; ses propres outils de test figent `nodemailer` 6.7.4. Reste l'alternative sérieuse si Nodemailer devait être écarté |
| API Gmail en HTTPS par `fetch`, sans dépendance | — | Vercel recommande une API HTTP plutôt que SMTP (section 10). Mais il faut un client OAuth 2.0 chez Google Cloud et un jeton d'actualisation ; tant que l'écran de consentement est en statut « Testing », ce jeton **expire au bout de 7 jours** (<https://developers.google.com/identity/protocols/oauth2>, section « Refresh token expiration »), et la publication de l'application pour la portée `gmail.send` passe par une vérification de Google. Plus de réglages manuels, plus de secrets, pour un gain faible à notre volume. À reconsidérer si SMTP échoue sur Vercel |
| Client SMTP écrit à la main (`node:tls`) | — | TLS, `AUTH`, encodage MIME et des en-têtes : exactement là où Nodemailer vient de corriger neuf failles. Écarté |
| `smtp-server` en dépendance de développement, pour les tests | Même éditeur que Nodemailer | Un serveur factice de quelques dizaines de lignes en `node:net` suffit pour lire les octets reçus (« Tests à écrire ») |
| `@types/nodemailer` | Microsoft (`types`) | Inutile, les types sont fournis par la 10.x ; les installer risque un conflit de déclarations |

Rien n'est installé par cette fiche. L'installation a lieu dans la PR 2, après accord sur la question 1.

### 9. Ce que le développeur fait à la main

**À aucun moment le mot de passe d'application n'est transmis à l'assistant, écrit dans un fichier, dans le dépôt, dans `.env.local`, dans la CI ou dans une conversation.** Il va directement de la page de Google au champ de Vercel.

**Une variable de Vercel ne s'applique qu'au déploiement suivant.** Toute variable posée, modifiée ou retirée est lue par le prochain déploiement, quel que soit le code qu'il contient. D'où la règle corrigée par le relecteur pour la PR 2 : le code de la PR 1 refuse `EMAIL_TRANSPORT=smtp`, et poser cette variable en production avant la fusion de la PR 2 ferait échouer chaque requête du site au déploiement suivant.

**Règle de configuration de la PR 2** (sections 2.1 et 2.2) :

- en production, `EMAIL_TRANSPORT` est facultatif et vaut `smtp` s'il est absent ; toute autre valeur est refusée ;
- en production, `GMAIL_UTILISATEUR` et `GMAIL_MOT_DE_PASSE_APPLICATION` restent obligatoires ;
- en prévisualisation sans variable d'envoi : `memoire`, inchangé.

Dans cet ordre :

1. **Compte de production et variables de production : fait.** Compte Gmail réservé à l'application (jamais le compte personnel, `PLAN.md` section 7), validation en deux étapes par une application d'authentification ou le téléphone (pas uniquement une clé de sécurité, sans « Protection avancée » : sinon la page des mots de passe d'application n'est pas proposée, <https://support.google.com/accounts/answer/185833>), codes de secours dans le gestionnaire de mots de passe. Mot de passe d'application créé sur <https://myaccount.google.com/apppasswords> et collé aussitôt dans Vercel. **Posées depuis le 2026-10-13, environnement Production seulement** : `GMAIL_UTILISATEUR` et `GMAIL_MOT_DE_PASSE_APPLICATION` (type Sensitive). **`EMAIL_TRANSPORT` n'est pas posée, et ne doit pas l'être avant la fusion de la PR 2** : le code de la PR 1 refuse `smtp`. Après la fusion, elle reste inutile (absente, elle vaut `smtp`). Le code de la PR 1, déployé avec ces deux variables, les ignore : `memoire`, aucun refus (`env-schema.email.test.ts` et `env.test.ts`, « après la PR 1 »).
2. **Réglages Gmail du compte de production** : désactiver IMAP et POP (Paramètres, « Transfert et POP/IMAP »). À vérifier au premier envoi que SMTP fonctionne toujours ; sinon les réactiver et le noter ici. Aucun transfert automatique.
3. **Second compte, pour la prévisualisation** (décision 3) : mêmes étapes que pour le compte de production (compte, validation en deux étapes, réglages, mot de passe d'application nommé par exemple `vercel-preview`).
4. **Variables de prévisualisation, limitées à la seule branche `feat/envoi-emails-2`** (champ « Preview Branch » de Vercel) : `GMAIL_UTILISATEUR` (adresse du second compte), `GMAIL_MOT_DE_PASSE_APPLICATION` (son mot de passe d'application, type Sensitive), `EMAIL_TRANSPORT=smtp`, `EMAIL_DESTINATAIRES_AUTORISES` (l'adresse personnelle du développeur). Les autres branches gardent une prévisualisation sans variable d'envoi, donc `memoire`. **À poser seulement quand le code de la PR 2 (transport `smtp`) est poussé sur la branche** : un déploiement de la branche qui porterait encore le code de la PR 1, ou la seule phase rouge, refuserait `smtp` et échouerait à chaque requête.
5. **Vérification sur le déploiement de prévisualisation de la PR 2** : envoi du modèle `essai.verification_envoi` à l'adresse autorisée, réception, en-têtes de l'email reçu (`From`, un seul destinataire, `SPF` et `DKIM` en `pass` pour `gmail.com`), dossier « Messages envoyés » du second compte (décision 9). **Noter toute alerte de Google** (« Alerte de sécurité critique », connexion bloquée, demande de confirmation d'identité) reçue dans la boîte du compte ou sur le téléphone de récupération : un compte neuf qui se connecte depuis un serveur de Francfort peut être bloqué comme suspect (RR-10). Le résultat est noté dans « Notes de l'implémentation » : c'est la preuve de la section 10. **Si elle échoue**, la PR 2 n'est pas fusionnée (section 10).
6. **Fusion de la PR 2.** Les variables de production existent déjà (étape 1) : le déploiement de production qui suit la fusion trouve `smtp` par défaut et les deux variables Gmail. Avant de fusionner, vérifier dans Vercel qu'elles sont toujours présentes en Production, et qu'aucune `EMAIL_TRANSPORT` autre que `smtp` n'y a été ajoutée.
7. **Après la fusion**, un envoi d'essai en production vers l'adresse du développeur, par le même modèle (le moyen de le déclencher, sans exposer de route, est fixé à l'implémentation de la PR 2 : par exemple un script `scripts/` qui lit les variables d'un terminal, jamais d'un fichier). Même observation des alertes de Google qu'à l'étape 5, pour le compte de production.
8. **Après la vérification**, retirer de Vercel les variables de prévisualisation de la branche `feat/envoi-emails-2`, ou les garder pour une branche de vérification désignée (au jalon 1, suivre un lien de vérification sur `preview`) : à décider à ce moment-là.
9. **Renouvellement.** Changer le mot de passe du compte Google **révoque tous ses mots de passe d'application** (même source). Après tout changement : créer un nouveau mot de passe d'application, le saisir dans Vercel, redéployer. Même marche en cas de doute sur une fuite (T-76) : supprimer le mot de passe d'application sur la page de Google, en créer un autre.

Ne jamais ajouter ces variables à `.env.local` : `npm run test:e2e` charge ce fichier (section 2.1). Un essai réel depuis le poste se fait en passant les variables dans le terminal, pour une commande, avec `EMAIL_DESTINATAIRES_AUTORISES`.

### 10. Vercel peut-il ouvrir une connexion SMTP vers Gmail

Source : Vercel, « Sending emails from an application on Vercel », <https://vercel.com/kb/guide/sending-emails-from-an-application-on-vercel>, mise à jour du 2026-09-24, consultée le 2026-10-12 :

- « Vercel blocks port 25 for outgoing connections, while ports 465 and 587 stay open. »
- Nodemailer « runs in the Node.js runtime on ports 465 or 587 ».
- Vercel recommande une API HTTP plutôt que SMTP : « For production traffic, an HTTP API is the more reliable choice », car une fonction n'est pas faite pour tenir une connexion longue.

Conséquences :

- **Port 465**, TLS dès la connexion (`secure: true`), retenu de préférence au 587 : avec STARTTLS, un intermédiaire peut retirer l'annonce `STARTTLS` et obtenir une session en clair si `requireTLS` est oublié. Sur 465, aucune session sans TLS n'existe. TLS 1.2 au moins, certificat vérifié (`rejectUnauthorized` laissé à `true`, et testé comme tel).
- **Exécution Node.js obligatoire** : l'envoi ne peut pas s'exécuter dans le moteur « Edge » (pas de `node:net`). Les actions serveur et les pages de l'application s'exécutent déjà en Node.js ; `src/proxy.ts` n'envoie rien.
- **Une connexion par envoi**, fermée aussitôt (pas de `pool: true`) : une instance de fonction peut être gelée entre deux requêtes.
- **Ce que la source ne prouve pas** : qu'une connexion depuis la région `fra1` vers `smtp.gmail.com:465` aboutit réellement, et que Google l'accepte sans bloquer la connexion comme suspecte. Ni l'assistant ni la CI ne peuvent le vérifier. C'est l'étape 5 de la section 9, faite par le développeur sur le déploiement de prévisualisation de la PR 2. **Si elle échoue**, la PR 2 n'est pas fusionnée, et l'on revient à l'alternative de l'API Gmail en HTTPS (section 8).

### 11. Points d'accroche pour la suite

| Point | Fonctionnalité | Ce que la 0.7 prépare |
|---|---|---|
| Emails de Better Auth (vérification, réinitialisation) | 1.1, 1.3 | `envoyerEmail` utilisable hors de la chaîne ; limites `application` et `destinataire` ; la 1.1 ajoute `auth/config.ts` à la règle T, la limite par adresse IP, et règle l'uniformité de réponse (T-07) et la forme des liens (question 8). À vérifier par la 1.1 : si Better Auth appelle ses rappels d'envoi pendant une transaction ouverte (règle 15) |
| Emails des actions | 2.2, 2.3, 2.5, 4.4, 5.4, 6.3 | `emails` dans la déclaration, `ctx.preparerEmail`, résultat `emails: { envoyes, nonEnvoyes }`, quatre limites |
| Destinataire saisi par l'utilisateur | 4.4, 5.4 (« vérifie l'email du destinataire ») | Si le Commercial peut corriger l'adresse à l'envoi, le service relit le client en base et n'accepte que son adresse ; sinon, la fiche doit traiter T-40 pour une adresse libre |
| Relances avec modèles saisis | 6.3 (F-100) | Brique `texteAffichable` ; variables remplacées par le serveur, texte brut |
| File d'envoi | 8.x | Option B de la section 6.2 |
| Signalement de `EAUTH` et des limites atteintes | 8.1 | Codes fermés dans le journal technique |

### Alternatives écartées

| Alternative | Raison de l'écarter |
|---|---|
| Resend, ou tout service d'envoi | Exige un nom de domaine (`STACK.md` section 12) |
| Envoi depuis le service, dans la transaction | Email parti pour une action annulée ; connexion tenue pendant l'échange SMTP ; contraire à la règle 15 (section 6.2, C) |
| Limite par organisation à l'étape 4 | Organisation pas encore vérifiée : un membre retiré épuiserait la limite de l'organisation (`limitation-debit.md` section 10) |
| Corps en HTML en 0.7 | Surface d'injection sans besoin ; à reconsidérer avec une fiche (question 6) |
| Intercepteur SMTP local (Mailpit, MailHog) | Un programme de plus à installer sur le poste et en CI, pour ce que `fichier` fait déjà |
| Garder les emails interceptés en mémoire et les afficher par une page de développement | Une route de plus, à exclure de la production (règle 11) |

## Règles de sécurité et permissions

- Exigences couvertes :
  - **S-55** (envoi limité en débit par organisation) : limites `email.organisation`, plus `application` et `destinataire`.
  - **S-51** (contenus échappés dans les emails) : texte brut, briques fermées, adresse et sujet sans retour à la ligne.
  - **S-50**, **S-87** : toute demande validée par un schéma strict ; toute réponse du serveur SMTP réduite à un code d'une liste fermée.
  - **S-54** : aucune adresse ni contenu dans les journaux ; compteurs en empreinte.
  - **S-83** : mot de passe d'application en secret Vercel, production seulement ; distinct en prévisualisation ; jamais en local ni en CI.
  - **S-88** : dépendance proposée avec son état de sécurité ; version fixée.
- Menaces : **T-40** (test écrit ici, `PLAN.md` section 4.5), **T-62**, **T-35**, **T-70**, **T-71** ; nouvelles **T-64**, **T-65**, **T-76** ; risques **RR-9**, **RR-10**.
- Matrice des droits : inchangée. Envoyer n'est pas un droit en soi : le droit est celui de l'action qui envoie (« Inviter un membre », « Envoyer une facture »...).
- Tables : aucune créée ni modifiée en 0.7 avec l'option A. `compteur_debit` reçoit de nouvelles clés, sans changement de forme.

## Critères d'acceptation

PR 1 :

- [x] `envoyerEmail` est la seule fonction qui remet un message à un transport ; la règle T refuse tout autre import de `src/server/modules/email/` et de `nodemailer` (`src/server/email/regles-email.test.ts`).
- [x] Une adresse avec `\r`, `\n`, `\0`, tabulation, virgule, `<`, `>`, guillemet, parenthèse, espace, caractère non ASCII, ou de plus de 254 caractères est refusée ; rien n'atteint le transport.
- [x] La demande refuse toute clé hors de `modele`, `destinataire`, `parametres` (dont `cc`, `bcc`, `replyTo`, `from`, `headers`, `attachments`).
- [x] Hors production, un destinataire hors de la liste autorisée donne `non_autorise` ; en production, la liste est ignorée.
- [x] Configuration de la PR 1 : `EMAIL_TRANSPORT` vaut `memoire` ou `fichier`, toute autre valeur (vide comprise) est refusée, `fichier` est refusé sur Vercel ; sur Vercel sans aucune variable d'envoi, `memoire`, en production comme en prévisualisation ; une configuration invalide fait échouer le chargement de `env.ts` ; aucun message d'erreur ne contient de valeur.
- [x] Sous Vitest, une connexion vers les ports 25, 465, 587 ou 2525 lève une exception.
- [x] Un lien produit commence toujours par l'origine de `BETTER_AUTH_URL` suivie de `/lien/` ; un jeton hors alphabet ou hors longueur est refusé.
- [x] Les emails d'une action ne partent qu'après la validation de sa transaction ; une transaction annulée n'envoie et ne compte rien.
- [x] **T-40** : au-delà de `email.organisation`, les envois de cette organisation sont refusés sans rien remettre au transport (comptés dans `nonEnvoyes`), et une autre organisation envoie toujours ; même chose pour `email.destinataire` et `email.application`.
- [x] Une déclaration sans `emails` ne compile pas ; un modèle hors de sa liste est refusé par `ctx.preparerEmail`.
- [x] Le corps produit ne contient aucune balise HTML générée, et un paramètre `<script>` est gardé tel quel (brique `texteAffichable` ; aucun modèle de la 0.7 n'a de paramètre texte).
- [x] Aucune dépendance ajoutée (`package-lock.json` inchangé).
- [x] Tout nouveau fichier de `src/server/` commence par `import "server-only";`.
- [x] `npm run lint`, `npm run typecheck`, `npm test`, `npm run test:integration` (sur `dev`), `npm run build`, `npm run test:e2e` passent (2026-10-12). En CI : à constater sur la PR.

PR 2 :

- [ ] `EMAIL_TRANSPORT=smtp` est refusé sous `NODE_ENV=test` ; en production, `EMAIL_TRANSPORT` absent vaut `smtp`, toute autre valeur, ou une variable Gmail absente ou mal formée, est refusée ; en prévisualisation sans variable, `memoire` ; `smtp` hors production exige `EMAIL_DESTINATAIRES_AUTORISES` ; aucun message d'erreur ne contient de valeur.
- [ ] `nodemailer` installé en version exacte, après accord, `npm audit --omit=dev` sans faille ouverte.
- [ ] Le transport `smtp` se connecte en TLS sur 465, vérifie le certificat, avec `logger` et `debug` à `false` et des délais courts ; ces options sont figées par un test.
- [ ] Contre le serveur factice : un seul `RCPT TO`, aucun en-tête injecté même si la validation est contournée ; ni le mot de passe, ni sa forme base64, ni l'adresse n'apparaissent sur `stdout` ou `stderr`.
- [ ] Chaque erreur de Nodemailer est traduite en une raison de la liste fermée, sans lire `message` ni `response`.
- [ ] Envoi réel vérifié par le développeur depuis la prévisualisation (section 9, étape 5), résultat noté.
- [ ] Tout nouveau fichier de `src/server/` commence par `import "server-only";`.
- [ ] `npm run typecheck`, `npm run lint`, `npm test`, `npm run build`, `npm run test:integration` (sur `dev` et en CI) et `npm run test:e2e` passent.

## Tests à écrire

Tous écrits avant le code et vus en échec.

### Tests unitaires

`src/server/email/adresse.test.ts` :

- [ ] Adresses valides acceptées ; chaque forme refusée de la section 3.1 refusée ; normalisation du domaine.

`src/server/email/modeles.test.ts` :

- [ ] Chaque modèle : schéma strict ; briques admises seulement (`z.toJSONSchema`) ; textes tirés de `src/textes/emails.ts` ; sujet sans caractère de contrôle ; corps sans HTML ; longueur bornée.
- [ ] `ligneEnTete` retire `\r`, `\n`, `\0`, et toute la plage de contrôle ; `lienPublic` refuse un jeton invalide et produit toujours `<origine>/lien/...`.

`src/server/email/envoi.test.ts` (transport `memoire`) :

- [ ] Demande valide : un message dans la boîte, expéditeur de la configuration, un seul destinataire.
- [ ] Demande avec une clé de plus : `DemandeEmailInvalide`, message fixe, boîte vide.
- [ ] Hors production, destinataire hors liste : `non_autorise`, boîte vide ; en production, accepté.
- [ ] Transport qui lève une erreur portant l'adresse dans son message : raison fermée, et l'adresse n'apparaît dans aucun message consigné.

`src/server/env-schema.email.test.ts` (nouveau fichier, « Notes de l'implémentation ») :

- [ ] Règles de la section 2.2 pour la PR 1 ; aucune valeur reçue dans un message d'erreur. Les règles des variables Gmail et de `smtp` sont écrites avec la PR 2.

`src/server/actions/action-email.test.ts` (dépendances factices) :

- [ ] Envoi après la validation, jamais avant ; transaction annulée : rien d'envoyé, `verifierDebit` non appelée ; ordre des limites ; résultat `emails: { envoyes, nonEnvoyes }`.
- [ ] `@ts-expect-error` : déclaration sans `emails` ; `ctx.preparerEmail` absent quand `emails: []`.

`src/server/email/garde-reseau.test.ts` et `src/server/db/garde-reseau.integration.test.ts` (un par projet de Vitest) :

- [ ] Une connexion vers les ports 25, 465, 587 et 2525, sur `127.0.0.1` ou un hôte en `.invalid`, par `net.connect`, `net.createConnection` ou `tls.connect`, lève ; vers `127.0.0.1` sur un port libre, non ; la base répond toujours.

`src/server/debit/limites.test.ts` (existant, ajouts) : nouvelles valeurs de `par` ; `2 × email.application.maximum < 500`.

`src/server/db/regles-import.test.ts` : règle T.

### Tests d'intégration

`src/server/db/chaine-email.integration.test.ts` (vraie base, sessions réelles, transport `memoire`, limites de test passées à `creerChaine`) :

- [ ] Une action de test qui crée une ligne témoin et prépare un email : ligne validée, puis un message dans la boîte, compteurs incrémentés.
- [ ] Une action qui prépare un email puis lève : aucune ligne, aucun message, aucun compteur incrémenté.

`src/server/modules/email/smtp.test.ts` (PR 2, projet `unitaires`, serveur factice en `node:net` sur `127.0.0.1`, sans TLS pour le test seulement ; options de production vérifiées à part) :

- [ ] Conversation complète : `EHLO`, `AUTH`, `MAIL FROM`, un seul `RCPT TO`, `DATA`.
- [ ] Validation contournée : sujet avec `\r\nBcc:` ; les octets reçus n'ont pas d'en-tête `Bcc`.
- [ ] Serveur qui répond `535` : raison `indisponible`, code `EAUTH` consigné, rien d'autre ; serveur muet : délai, `indisponible`, en moins de quelques secondes ; serveur qui répond `550` avec l'adresse dans le texte : l'adresse n'est consignée nulle part.
- [ ] `stdout` et `stderr` capturés : ni mot de passe, ni base64 de `\0utilisateur\0motdepasse`, ni adresse.

### Tests d'attaque

`src/server/db/chaine-email.attaque.integration.test.ts` :

- [ ] **Sans session** : aucun email, aucun compteur d'envoi.
- [ ] **Autre organisation** : membre de B, organisation active A forcée : `refuse`, aucun email, le compteur `email.organisation` de A ne bouge pas.
- [ ] **Rôle insuffisant** : refus à l'étape 6, aucun email.
- [ ] **Entrée falsifiée** : une entrée qui contient `destinataire`, `cc`, `bcc`, `from` ou `organisationId` : `invalide`, aucun email.
- [ ] **T-40, plafond par organisation** : au-delà de la limite de test, `limite`, boîte inchangée ; une autre organisation envoie toujours.
- [ ] **T-40, même destinataire** depuis deux organisations : la limite `destinataire` tient.
- [ ] **T-40, plafond global** : plusieurs organisations jusqu'à `email.application` : refus pour toutes au-delà.
- [ ] **Données personnelles** : aucune ligne de `compteur_debit` ne contient l'adresse ; aucune entrée de `journal_audit` non plus.

### Tests de bout en bout

- [ ] Aucun en 0.7 : aucune page, aucune action exposée. Le transport `fichier` est éprouvé en bout en bout par la 1.1 (lecture du lien de vérification).
- [ ] `playwright.config.ts` pose `EMAIL_TRANSPORT=fichier` et un dossier propre aux tests sur chaque serveur, sans variable Gmail : `src/server/email/configuration-e2e.test.ts`.

## Découpage en PR

| PR | Contenu | Ce qu'elle prouve | Base | Dépendance |
|---|---|---|---|---|
| 1. Porte et limites | `email/envoi.ts`, `modeles.ts`, `adresse.ts`, transports `memoire` et `fichier`, `textes/emails.ts`, variables `EMAIL_TRANSPORT`, `EMAIL_DESTINATAIRES_AUTORISES`, `EMAIL_DOSSIER`, garde réseau, règle T, limites d'envoi, champ `emails` et `ctx.preparerEmail` dans la chaîne, tests de T-40 ; mise à jour des documents (`STACK.md`, `DESIGN.md`, `THREATS.md`, `PLAN.md`, `STRUCTURE.md`, `CLAUDE.md`) | Aucun envoi possible hors de la porte ; aucune adresse arbitraire hors production ; le plafond par organisation tient (T-40) ; aucun test n'envoie | Oui | Aucune |
| 2. Gmail | `nodemailer` (après accord), `modules/email/smtp.ts`, variables Gmail, serveur SMTP factice, envoi réel vérifié depuis la prévisualisation | Le transport réel n'écrit ni secret ni adresse ; pas d'injection sur le fil ; Vercel joint Gmail | Non | `nodemailer` |

Cohérence de `main` entre les deux. À la fusion de la PR 1, la production et la prévisualisation de Vercel n'ont **aucune** variable d'envoi (ni `EMAIL_TRANSPORT`, ni variable Gmail). Une configuration refusée fait échouer chaque requête (`CLAUDE.md`, « Pièges connus ») : refuser ce cas serait une panne totale du site. Donc, en PR 1 :

- `VERCEL_ENV=production`, aucune variable d'envoi : `memoire`, `estProduction` vrai, aucun refus. Sans effet, puisqu'aucune action n'envoie encore.
- `VERCEL_ENV=preview`, aucune variable d'envoi : `memoire`, aucun refus.
- Prouvé par `env-schema.email.test.ts` (« après la PR 1 ») et par `env.test.ts`, qui charge `env.ts` avec ces variables seulement.

La règle de production de la PR 2 (décision 4, corrigée : `EMAIL_TRANSPORT` facultatif, `smtp` s'il est absent, variables Gmail obligatoires) n'entre en vigueur qu'avec la PR 2, dont les tests remplacent ceux de la production ; les variables Gmail de production sont posées dans Vercel depuis le 2026-10-13, et ignorées par le code de la PR 1 (section 9). La prévisualisation sans variable reste à `memoire` après la PR 2 : un déploiement de prévisualisation ne tombe jamais faute de configuration d'envoi.

## Fichiers concernés

Selon `docs/STRUCTURE.md`, section 9.

Créés : `src/server/email/envoi.ts`, `adresse.ts`, `modeles.ts` et leurs tests ; `src/server/modules/email/memoire.ts`, `fichier.ts`, `smtp.ts` (PR 2) et leurs tests ; `src/server/modules/email/outils-test/serveur-smtp.ts` ; `src/textes/emails.ts` ; `tests/garde-reseau.ts` et son test ; `src/server/actions/action-email.test.ts` ; `src/server/db/chaine-email.integration.test.ts`, `chaine-email.attaque.integration.test.ts`.

Modifiés : `src/server/env-schema.ts`, `env.ts` et leurs tests ; `src/server/debit/limites.ts` et son test ; `src/server/actions/action.ts`, `refus.ts` ; déclarations de test existantes (`emails: []`) ; `eslint.config.mjs`, `src/server/db/regles-import.test.ts` (règle T) ; `vitest.config.mts` (`setupFiles`) ; `playwright.config.ts` ; `.gitignore` (`.emails/`) ; `.env.example` (variables sans valeur, avec l'avertissement de la section 9) ; `package.json` et `package-lock.json` (PR 2).

Documents : `STACK.md` (sections 2, 4, 5 et 8 citent encore Resend ; section 5 : Google), `DESIGN.md` (sections 4.1, 4.2 et 4.4 : Resend, interception en prévisualisation), `THREATS.md` (T-64, T-65, T-76, RR-9, RR-10, section 7.5), `PLAN.md` (section 7 : « 100 emails par jour » vient de Resend, à remplacer par les chiffres de la section 5.1), `SPEC.md` (hypothèse 4), `STRUCTURE.md` (`server/email/`, section 7, règle T), `CLAUDE.md` (règle sur la porte d'envoi, piège de `.env.local` et des tests de bout en bout), `docs/CONFIGURATION.md` (marche de la section 9).

## Dépendances nouvelles

`nodemailer`, dans la PR 2, après accord (section 8, question 1). Aucune autre.

## Migration

Aucune avec l'option A de la question 2. L'option B créerait une table `email_sortant`, avec `organisation_id`, règle d'isolation et forçage.

## Reporté

### Au jalon 1

- 1.1 : rappels d'envoi de Better Auth branchés sur `envoyerEmail` ; `auth/config.ts` ajouté à la règle T ; limite par adresse IP ; uniformité des réponses et des temps (T-07) ; liens (question 8) ; modèles de vérification et de « compte existant ».
- 1.3 : modèles de réinitialisation et d'avis de changement.

### Aux jalons 2 à 6

- Modèles et textes de chaque email ; bouton « renvoyer » ; contrôle que le destinataire est celui de la ressource en base (section 11).

### Au jalon 8

- 8.1 : signalement de `EAUTH`, des limites atteintes et des échecs au service de suivi des erreurs.
- File d'envoi (option B), si le volume le justifie.

## Limites connues

- **Un seul compte pour tous.** Une suspension par Google prive toute l'application d'emails, réinitialisations comprises (RR-10). Nos limites réduisent le risque sans l'annuler : Google peut aussi réagir à des messages semblables, sans seuil publié.
- **Aucun retour de non-remise.** Une adresse inexistante est acceptée par Gmail, puis un message de non-remise arrive dans la boîte du compte, que l'application ne lit pas. Trop de non-remises peuvent bloquer l'envoi 24 heures (section 5.1).
- **Copie dans « Messages envoyés »** (RR-9, décision 9).
- **Réponses non lues.** Malgré la phrase de fin de chaque email (section 3.3), un destinataire peut répondre : sa réponse arrive dans la boîte de réception du compte, que personne ne lit. Elle est effacée par la purge manuelle mensuelle (RR-9). Un client qui croit avoir prévenu l'entreprise par cette voie ne l'a pas fait.
- **Plafonds serrés.** À partir de 5 organisations actives, `email.application` devient le goulot ; une relance de fin de mois peut dépasser `email.organisation` (40). À revoir aux jalons 6 et 8 (section 5.2).
- **Compte neuf jugé suspect.** Google peut bloquer la première connexion depuis Francfort (RR-10, section 9, étape 5).
- **Contournement de la limite par destinataire** par les sous-adresses (`nom+1@`) et, chez Gmail, les points dans la partie locale, selon la question 10.
- **Plusieurs comptes, plusieurs organisations.** Un attaquant qui crée N organisations a N fois `email.organisation`, jusqu'à `email.application`, qui protège alors le compte au prix de bloquer tout le monde. La création d'organisations en masse relève du jalon 1 et du 2.1.
- **Expéditeur `@gmail.com`.** Les destinataires peuvent s'en méfier, et certains filtres le classer en indésirable. Le module interchangeable permet de passer à un service spécialisé le jour où un domaine existe (`PLAN.md` section 7).

## Questions (tranchées le 2026-10-12, voir « Décisions »)

1. **Version de Nodemailer.**
   - a. 10.0.16 (2026-10-07), dernière de la branche 10.0, tous les avis corrigés.
   - b. 10.1.0 (2026-10-10), qui renforce en plus la fin de session SMTP (réponse 421, `DATA` après un expéditeur refusé), mais n'a que deux jours.
   - c. `emailjs` 5.0.3.
   - **Recommandation** : a ou b, décidé le jour de l'installation (PR 2) : la plus récente 10.x publiée depuis au moins sept jours, sans avis ouvert, après `npm audit` et lecture de la page des avis. Version exacte, sans `^`.

2. **Que devient l'action quand l'email ne part pas** (section 6.2).
   - A. Envoi direct après la validation, échec signalé, « renvoyer » à la main.
   - B. File d'envoi en base, nouvel essai par la tâche quotidienne.
   - C. Envoi dans la transaction (écarté).
   - D. Envoi après la réponse.
   - **Recommandation** : A.

3. **Prévisualisation.**
   - a. Aucun envoi réel : transport `memoire`.
   - b. Envoi réel par un **second compte Gmail**, limité à `EMAIL_DESTINATAIRES_AUTORISES`.
   - c. Envoi réel par le compte de production, limité à la liste.
   - **Recommandation** : b. Seule façon de vérifier Gmail depuis Vercel avant la production (section 10) et, au jalon 1, de suivre un lien de vérification sur `preview`. Un compte distinct respecte S-83 (secrets distincts par environnement) et ne consomme pas le quota de production. c est écarté : le secret de production serait sur `preview`.

4. **Configuration Gmail manquante ou invalide en production.**
   - a. Configuration refusée : tout le site échoue (comportement actuel de `env.ts`).
   - b. Repli silencieux sur `memoire` : le site marche, aucun email ne part, personne ne le sait.
   - c. Site en marche, chaque envoi échoue avec un incident.
   - **Recommandation** : a, cohérent avec les autres variables, et impossible à ignorer. Le mot de passe révoqué (`EAUTH`), qui ne se voit qu'à l'exécution, donne c de toute façon.

5. **Valeurs des limites** (section 5.2).
   - a. Celles proposées : application 200 par 24 h, organisation 40 par 24 h, destinataire 3 par heure et 10 par 24 h.
   - b. Plus larges (application 240, organisation 100).
   - c. Plus strictes (organisation 20).
   - **Recommandation** : a. 200 garantit moins de 500 même au bord de la fenêtre fixe ; 40 couvre largement une petite structure (invitations, devis, factures, relances d'une journée).

6. **Format des emails.**
   - a. Texte brut seulement.
   - b. Texte brut et HTML, HTML produit par un gabarit qui échappe tout.
   - **Recommandation** : a en 0.7. Le HTML demanderait un gabarit, son échappement et ses tests, sans besoin démontré.

7. **Contenu saisi dans le sujet et le nom de l'expéditeur.**
   - a. Aucun : sujet et nom fixes (« Invitation à rejoindre une organisation », nom « Facturation PME »). Le nom de l'organisation figure dans le corps.
   - b. Nom de l'organisation dans le sujet ou dans le nom de l'expéditeur, après `ligneEnTete`.
   - **Recommandation** : a. Moins de surface d'injection, et moins d'hameçonnage possible au nom de l'application (une organisation nommée « Service client de votre banque »).

8. **Liens de Better Auth** (vérification, réinitialisation).
   - a. `/lien/` seulement : la 1.1 et la 1.3 créent des pages `/lien/verification/<jeton>` et `/lien/reinitialisation/<jeton>`, qui appellent Better Auth côté serveur.
   - b. Admettre aussi `/api/auth/...`, adresse produite par Better Auth.
   - **Recommandation** : a. Une seule forme de lien dans tous les emails, contrôlée par la porte ; la décision finale revient à la fiche 1.1, qui lira ce que Better Auth 1.7.7 permet.

9. **Copies dans « Messages envoyés » de Gmail.**
   - a. Accepter (RR-9), avec une purge manuelle mensuelle de ce dossier par le développeur.
   - b. Purge automatique par IMAP : une dépendance et un accès de plus.
   - c. Accepter sans purge.
   - **Recommandation** : a, après avoir constaté à l'étape 5 de la section 9 que Gmail garde bien ces copies. Les liens expirent et se révoquent (S-20), ce qui limite la valeur d'une copie volée.

10. **Normalisation de l'adresse pour le compteur `destinataire`.**
    - a. Domaine en minuscules seulement.
    - b. En plus, partie locale en minuscules et sous-adresse `+...` retirée, pour tous les domaines.
    - c. b, et points retirés de la partie locale pour `gmail.com` et `googlemail.com`.
    - **Recommandation** : c, **pour le compteur seulement**. L'email part à l'adresse saisie.

11. **Découpage.**
    - a. Deux PR (« Découpage en PR »).
    - b. Une seule PR.
    - **Recommandation** : a. La PR 1 se valide sans dépendance ni secret ; la PR 2 isole la dépendance et la seule vérification manuelle.

12. **Transport en local.**
    - a. `fichier`, dans `.emails/` ignoré par git.
    - b. Journal du serveur (console).
    - **Recommandation** : a. La console est un journal technique : y écrire des adresses contredit S-54, même en local, et les tests de bout en bout ont besoin de relire le lien.

## Sources consultées le 2026-10-12

- Google, limites d'envoi de Gmail : <https://support.google.com/mail/answer/22839>
- Google Workspace, limites d'envoi (pour comparaison, non applicable) : <https://knowledge.workspace.google.com/admin/gmail/gmail-sending-limits-in-google-workspace>
- Google, mots de passe d'application : <https://support.google.com/accounts/answer/185833>
- Google, expiration des jetons d'actualisation OAuth 2.0 : <https://developers.google.com/identity/protocols/oauth2>
- Vercel, envoi d'emails depuis une application : <https://vercel.com/kb/guide/sending-emails-from-an-application-on-vercel>
- Registre npm : <https://registry.npmjs.org/nodemailer>, <https://registry.npmjs.org/emailjs/latest>, <https://registry.npmjs.org/@types/nodemailer/latest> ; téléchargements : <https://api.npmjs.org/downloads/point/last-week/nodemailer>, `.../emailjs`, `.../@types/nodemailer`
- Avis de sécurité de Nodemailer : <https://github.com/nodemailer/nodemailer/security/advisories> ; journal des changements : <https://github.com/nodemailer/nodemailer/blob/master/CHANGELOG.md>

## Décisions

Prises par le relecteur à la validation de la fiche, le 2026-10-12. Toutes les recommandations des questions ouvertes sont retenues.

1. **Version de Nodemailer.** La 10.x la plus récente publiée depuis au moins sept jours, sans avis de sécurité ouvert, en version exacte, décidée le jour de l'installation (PR 2), après `npm audit` et lecture de la page des avis.
2. **Email non parti.** Option A : envoi direct après la validation de la transaction, échec signalé dans le résultat, « renvoyer » à la main.
3. **Prévisualisation.** Option b : second compte Gmail, envoi limité à `EMAIL_DESTINATAIRES_AUTORISES`.
4. **Configuration Gmail absente ou invalide en production.** Option a : configuration refusée (à partir de la PR 2). Corrigée par le relecteur avant la phase rouge de la PR 2 : `EMAIL_TRANSPORT` facultatif en production, `smtp` s'il est absent (section 9).
5. **Limites.** Option a : application 200 par 24 h, organisation 40 par 24 h, destinataire 3 par heure et 10 par 24 h. À revoir aux jalons 6 et 8 (section 5.2).
6. **Format.** Texte brut seulement.
7. **Sujet et expéditeur.** Fixes, sans contenu saisi.
8. **Liens.** `/lien/` seulement ; la fiche 1.1 confirme pour Better Auth.
9. **Copies et réponses dans la boîte Gmail.** Acceptées (RR-9), avec une purge manuelle mensuelle de « Messages envoyés » et de la boîte de réception.
10. **Normalisation pour le compteur `destinataire`.** Option c : minuscules, sous-adresse `+...` retirée, points retirés pour `gmail.com` et `googlemail.com` ; pour le compteur seulement.
11. **Découpage.** Deux PR.
12. **Transport en local.** `fichier`, dans `.emails/` ignoré par git.

Ajouts du relecteur, portés dans la fiche :

- Phrase fixe « ne pas répondre » à la fin de chaque modèle (section 3.3) ; réponses non lues (« Limites connues », RR-9).
- Goulot de `email.application` à partir de 5 organisations actives, relance de fin de mois au-delà de 40 (section 5.2, « Limites connues »).
- Compte neuf bloqué comme suspect depuis Francfort (RR-10, section 9, étape 8).
- `vitest.config.mts` (et non `.ts`).

## Notes de l'implémentation

### Phase rouge de la PR 1, le 2026-10-12

Tests écrits sans aucune implémentation : aucun module de `src/server/email/` ni de `src/server/modules/email/`, aucune modification de `action.ts`, `limites.ts`, `env-schema.ts`, `eslint.config.mjs`, `vitest.config.mts` ni `playwright.config.ts`. Aucune dépendance.

**Interfaces fixées par les tests** (à confirmer par le relecteur) :

- `email/adresse.ts` : `schemaAdresse` (schéma Zod, renvoie l'adresse normalisée) et `adressePourCompteur(adresse)`.
- `email/modeles.ts` : `MODELES_EMAIL` (par modèle : `parametres`, schéma strict, et `construire(parametres, { origine })` qui renvoie `{ sujet, corps }`), `ModeleEmail`, `briques` (`identifiant`, `enumeree`, `entier`, `booleen`, `jeton`, `texteAffichable`), `LONGUEUR_JETON` (43 : 32 octets en `base64url`), `LONGUEUR_MAX_CORPS`, `ligneEnTete(texte, max = 200)`, `lienPublic(origine, type, jeton)`.
- `textes/emails.ts` : `TEXTES_EMAILS` (`expediteur`, `neRepondezPas`, `modeles[nom].sujet` et `.corps`).
- `email/envoi.ts` : `validerDemande(demande)` (pure, renvoie la demande normalisée ou lève `DemandeEmailInvalide`, dont `name` vaut `"DemandeEmailInvalide"`), `creerPorteEmail({ transport, expediteur, estProduction, destinatairesAutorises, origine })` qui renvoie `{ envoyerEmail }`, `DemandeEmail`, `ResultatEnvoi`, et `envoyerEmail` lié à la configuration. Hors production, la comparaison à la liste autorisée se fait après normalisation (domaine en minuscules), sans retirer la sous-adresse. Le journal technique reçoit une ligne par échec du transport : modèle, raison, `code`, `responseCode`, incident.
- `modules/email/transport.ts` : `MessageEmail` (`de`, `nomExpediteur`, `a`, `sujet`, `corps`), `Transport` (`remettre(message)`), `EchecTransport({ raison, code?, responseCode? })`. `memoire.ts` : `creerTransportMemoire()` (`remettre`, `messages`, `vider`). `fichier.ts` : `creerTransportFichier(dossier)` et `lireMessages(dossier)`.
- `env-schema.ts` : `validerConfigurationEmail(source)`, à côté de `validerEnvironnement`, qui renvoie un objet figé `{ transport, dossier, destinatairesAutorises, estProduction }` ; `env.ts` exporte `configurationEmail`. Choisi pour ne pas modifier le test existant « renvoie les trois valeurs, et seulement elles » de `env-schema.test.ts`. Deux règles déduites de la fiche, à confirmer : absente sur Vercel, `EMAIL_TRANSPORT` vaut `memoire` (en PR 1) ; `fichier` y est refusé (système de fichiers en lecture seule). Une valeur vide est refusée.
- Chaîne (`actions/action.ts`) : champ `emails` de la déclaration ; dépendance `envoyerEmail` de `DependancesChaine` ; `ctx.preparerEmail(demande)` **synchrone** ; résultat `{ ok: true, donnees, emails: { envoyes, nonEnvoyes } }` quand `emails` n'est pas vide, inchangé (`{ ok: true, donnees }`) quand il est vide ; limites vérifiées dans l'ordre `email.destinataire`, `email.destinataire_jour`, `email.organisation`, `email.application`, arrêt au premier refus ; valeur de la clé `application` : `"gmail"` ; un `debit` d'étape 4 qui désigne une limite d'envoi est refusé par `declarerAction`.
- Outillage : `src/server/db/outils-test/email.ts` (`creerBanc`, `LIMITES_TEST`, `adresseDeTest`), avec un secret aléatoire par banc, pour que les compteurs d'un test ne soient partagés avec aucun autre. La règle T doit donc l'autoriser à importer `modules/email/` (cas inscrit dans `regles-email.test.ts`).

**Écarts avec la liste « Tests à écrire »** : les tests de la garde réseau sont dans `src/` (les projets de Vitest n'incluent que `src/**`), un par projet ; les tests de configuration sont dans un fichier nouveau, `env-schema.email.test.ts` ; la règle T est testée dans `src/server/email/regles-email.test.ts`, comme les règles O à R de la 0.6 l'ont été dans un fichier propre ; un test de `fichier.ts` et un de `memoire.ts` s'ajoutent.

**Modification d'un test existant** : `src/server/debit/limites.test.ts`, la liste admise des valeurs de `par` passe de `["utilisateur"]` à quatre valeurs (section 5.2) ; ajouts des valeurs de la décision 5 et de `2 × email.application < 500`.

**Reporté à l'implémentation** : ajout de `emails: []` aux déclarations existantes des tests (`action.test.ts`, `action-debit.test.ts`, `exposer.test.ts`, `marque.test.ts`, `inventaire.test.ts`, `registre.integration.test.ts`, `chaine*.integration.test.ts`, `tests/fixtures/inventaire/`) et de `envoyerEmail` à leurs dépendances : sans implémentation, la clé serait ignorée ; avec, une déclaration sans `emails` est refusée.

**Constats** :

- `npm test` : 41 fichiers, 11 en échec ; 1 287 tests, 110 en échec, 1 177 réussis. Cinq fichiers échouent au chargement, faute de module (`adresse.test.ts`, `envoi.test.ts`, `modeles.test.ts`, `memoire.test.ts`, `fichier.test.ts`) : leurs tests ne sont pas comptés. Aucun test existant n'échoue.
- `npm run test:integration` sur `dev` : 18 fichiers, 3 en échec ; 4 tests en échec (garde réseau), 151 réussis, 1 échec attendu existant. `chaine-email.integration.test.ts` et `chaine-email.attaque.integration.test.ts` échouent au chargement (`email/adresse` absent) : aucune organisation créée sur `dev`.
- `npm run lint` : vert. `npm run typecheck` : 61 erreurs, toutes dans les fichiers de test nouveaux ou complétés (modules absents, champs `emails`, `envoyerEmail`, `preparerEmail` et limites d'envoi absents des types).
- Construction : non nécessaire, aucun test de bout en bout ajouté.

**Tests nouveaux qui passent déjà, et pourquoi c'est légitime** :

- Témoins de non-blocage de la règle T (15 cas « autorisé ») : sans la règle, rien n'est refusé ; ils empêchent une règle trop large.
- Garde réseau, port libre sur `127.0.0.1` (unitaires) et base joignable (intégration) : témoins, la garde ne doit pas couper le reste.
- `configuration-e2e.test.ts` : « au moins un serveur » (garde contre un parcours vide) et « aucune variable Gmail passée » (invariant déjà vrai, à garder).
- Chaîne : refus à l'étape 6 et entrée invalide, sans envoi ni compteur (le refus a lieu avant le service ; invariant à garder) ; `emails: []` sans `preparerEmail` et résultat inchangé (compatibilité avec les actions existantes) ; `etablirContexte` sans `preparerEmail` ; `declarerAction` accepte `[MODELE]` et `[]` (témoin contre un refus trop large) ; les cas « ne compile pas », dont la preuve est `npm run typecheck`.
- `declarerAction` refuse un `debit` d'étape 4 nommé `email.*` : passe aujourd'hui parce que ces noms n'existent pas dans `LIMITES` ; après l'implémentation, ils existeront, et le test vérifiera le refus d'une limite qui ne compte pas l'utilisateur.
- Quatre tests passaient d'abord pour une mauvaise raison (`ctx.preparerEmail` absent, donc `TypeError`, donc le même refus) : renforcés pour échouer aujourd'hui. Transaction annulée : l'ordre exact des étapes est exigé, préparation et service compris. Adresse invalide : la classe consignée doit être `DemandeEmailInvalide`, jamais `TypeError`. Modèle hors liste : jamais `TypeError`. Message d'erreur sans la valeur reçue : le message doit d'abord nommer `EMAIL_TRANSPORT`.

### Phase rouge de la PR 1, reprise du 2026-10-12

Décisions du relecteur sur la phase rouge :

1. Interfaces acceptées (`validerConfigurationEmail`, `preparerEmail` synchrone, clé `"gmail"`, `fichier` refusé sur Vercel, valeur vide refusée), à condition d'un test qui prouve qu'une configuration d'envoi invalide fait échouer le chargement de `env.ts`, comme une `DATABASE_URL` invalide : `src/server/env.test.ts`.
2. Modules vides autorisés, comme en 0.5 : seulement les exports attendus par les tests, chacun levant « non implémenté », sans logique.
3. Modification de `limites.test.ts` autorisée.
4. `emails: []` dans les tests existants : autorisé à l'implémentation, et rien d'autre dans ces fichiers.
5. Règle T et `outils-test/email.ts` : acceptée.

**Configuration de Vercel à la fusion de la PR 1.** Les sections 2.1 et 2.2 disaient « en production : obligatoire et égale à `smtp` », sans le dater : lues seules, elles refusaient la production sans variable d'envoi, donc une panne totale du site à la fusion. Corrigé (sections 2.1, 2.2 et « Découpage en PR ») : en PR 1, production et prévisualisation sans variable d'envoi donnent `memoire` ; la règle de la décision 4 n'entre en vigueur qu'avec la PR 2 ; la prévisualisation sans variable reste à `memoire` ensuite. Tests : `env-schema.email.test.ts` (« après la PR 1 ») et `env.test.ts` (chargement réel avec ces variables seulement).

**Modules vides** : `src/server/email/adresse.ts`, `modeles.ts`, `envoi.ts` ; `src/server/modules/email/transport.ts`, `memoire.ts`, `fichier.ts` ; `src/textes/emails.ts` (un `Proxy` qui lève à toute lecture) ; `validerConfigurationEmail` et `ConfigurationEmail` ajoutés à `src/server/env-schema.ts`. `MODELES_EMAIL` est un objet vide, sans exception : `modeles.test.ts` le parcourt au chargement. `env.ts` n'est pas modifié : appeler la fonction vide y ferait échouer tout chargement de la configuration. Rien n'est ajouté à `action.ts` ni à `limites.ts` (champs et valeurs, qui sont l'implémentation).

**Constats** :

- `npm test` : 42 fichiers, 12 en échec ; 1 405 tests, 226 en échec, 1 179 réussis. Aucun fichier n'échoue plus au chargement. Aucun test existant n'échoue.
- `npm run test:integration` sur `dev` : 18 fichiers, 3 en échec ; 172 tests, 20 en échec, 151 réussis, 1 échec attendu existant. Les tests d'envoi échouent à la création du banc (`creerTransportMemoire`), avant toute création de membre ; les organisations sont supprimées par `nettoyer` (aucune ligne au journal).
- `npm run lint` : vert. `npm run typecheck` : 40 erreurs, toutes dans des fichiers de test, sur ce que les modules vides ne fournissent pas (`emails`, `envoyerEmail`, `preparerEmail` dans la chaîne ; limites d'envoi dans `LIMITES` ; `configurationEmail` dans `env.ts`).

**Tests renforcés** : les 14 cas de refus de `lienPublic` passaient avec la fonction vide (`toThrow()` accepte « non implémenté »). Chacun vérifie d'abord, dans le même test, qu'un jeton valide produit le lien attendu.

**Tests nouveaux qui passent encore (30)** : les justifications de la première phase rouge restent valables (15 témoins de la règle T, 2 témoins de la garde réseau, 2 de `configuration-e2e.test.ts`, 10 de la chaîne). S'y ajoutent : `env.test.ts`, « DATABASE_URL invalide, le chargement échoue » (le cas de référence, déjà vrai, auquel les cas d'envoi sont comparés) ; `modeles.test.ts`, « le contrôle refuse les formes interdites » (il éprouve la fonction de contrôle du test elle-même, sur des schémas Zod écrits dans le test).

### Implémentation de la PR 1, le 2026-10-12

Code : `src/server/email/adresse.ts`, `modeles.ts`, `envoi.ts` ; `src/server/modules/email/transport.ts`, `memoire.ts`, `fichier.ts` ; `src/textes/emails.ts` ; `validerConfigurationEmail` dans `src/server/env-schema.ts`, `configurationEmail` dans `src/server/env.ts` ; quatre limites `email.*` dans `src/server/debit/limites.ts` ; champ `emails`, `ctx.preparerEmail`, dépendance `envoyerEmail` et envoi après la validation dans `src/server/actions/action.ts` ; variante `emails` du résultat dans `refus.ts` ; règle T dans `eslint.config.mjs` ; garde réseau `tests/garde-reseau.ts`, branchée dans les deux projets de `vitest.config.mts` ; transport `fichier` imposé par `playwright.config.ts`.

**Tests existants complétés (décision 4 de la phase rouge)** : 33 lignes `emails: [],` et 4 dépendances factices `envoyerEmail: async () => ({ envoye: false, raison: "non_autorise" }),`, que des ajouts, dans `action.test.ts`, `action-debit.test.ts`, `exposer.test.ts`, `marque.test.ts`, `registre.integration.test.ts`, `chaine-debit.integration.test.ts`, `chaine-debit.attaque.integration.test.ts`, `chaine.integration.test.ts`, `chaine.attaque.integration.test.ts` et `tests/fixtures/inventaire/declarations.ts`. Aucun autre test modifié.

**Écarts d'implémentation, et pourquoi** :

1. **Porte liée à la configuration, construite au premier envoi.** `envoyerEmail` (instance liée) ne lit `configurationEmail` qu'au premier appel. Cinq fichiers de test existants simulent `../env` sans `configurationEmail` ; une lecture au chargement de `envoi.ts`, importé par la chaîne, les ferait tous échouer. La configuration reste validée au démarrage, par `env.ts`.
2. **`verifierDebit` et `executer` écrits en méthodes** dans `DependancesChaine` et `DeclarationAction`. Leurs paramètres deviennent bivariants. Sans cela, deux tests existants ne compilaient plus : `chaine-debit.attaque.integration.test.ts` passe un `verifierDebit` typé pour `membre.action` seule ; `registre.integration.test.ts` convertit une déclaration sans email en `DeclarationQuelconque`. Le contexte d'une action reste calculé depuis sa propre déclaration : `ctx.journaliser` et `ctx.preparerEmail` restent de type `never` quand le journal ou les modèles sont absents (tests `@ts-expect-error`).
3. **`creerVerificateur` accepte une partie des limites** (`Partial<Record<NomLimite, Limite>>`) : les tests de la 0.5 ne passent que `membre.action`. Une limite absente lève, comme un nom inconnu.
4. **Expéditeur de la PR 1** : `ne-pas-repondre@facturation.invalid`, constant, pour les transports `memoire` et `fichier`, qui n'envoient rien. La PR 2 prendra `GMAIL_UTILISATEUR`.
5. **Refus d'une limite** : l'email compte dans `nonEnvoyes` ; la raison n'est pas transmise dans le résultat de l'action (ni `limite`, ni le nom de la limite), comme pour `trop_de_requetes`.
6. **Journal technique** : un échec du transport donne une ligne `[email]` (modèle, raison, `code`, `responseCode`, incident) ; un échec après la validation (compteur ou porte qui lève) une ligne `[chaine-controles]` (action, étape `envoi_email`, classe, incident). Un refus de limite n'est pas consigné (signalement : 8.1).
7. **`.env.example`** : les trois variables `EMAIL_*` y sont en commentaire. Une variable présente mais vide est refusée : recopier le modèle tel quel ferait échouer le démarrage.
8. **Construction de la règle T** : deux blocs nouveaux, `src/server/email/envoi.ts` (cas général sans la restriction de `modules/email/`) et `src/server/modules/email/smtp.ts` (sans celle de `nodemailer` ni de `smtp.gmail.com`), retirés du bloc général ; les autres blocs reçoivent les restrictions T qui les concernent (`action.ts` : toutes sauf `envoyerEmail`). Écrite par un script Python (`chr(92)`), barres inverses comptées sans expression régulière : toutes doublées sur les lignes nouvelles ; les trois barres isolées du fichier sont les guillemets échappés existants des messages G et H. Constaté : un premier script de comptage par expression régulière a échoué, réduit par l'outil, comme le décrit `CLAUDE.md`.

**Constats du 2026-10-12** :

- `npm run lint` : vert. `npm run typecheck` : vert.
- `npm test` : 1 417 tests réussis, aucun échec.
- `npm run test:integration` sur `dev` : 18 fichiers ; 171 réussis, 1 échec attendu existant.
- `npm run build` : réussi. `npm run test:e2e` : 104 réussis. Ports 3000 et 3101 libres avant et après.

### Phase rouge de la PR 2, le 2026-10-13

Branche `feat/envoi-emails-2`. Tests écrits sans implémentation ; aucune dépendance installée ; `package.json` et `package-lock.json` inchangés.

**Vercel au 2026-10-13, avant tout le reste.** `GMAIL_UTILISATEUR` et `GMAIL_MOT_DE_PASSE_APPLICATION` sont posées en Production seulement, sans `EMAIL_TRANSPORT`. Le code de la PR 1 les **ignore** : `validerConfigurationEmail` ne lit aucune variable `GMAIL_*`, et `validerEnvironnement` ne passe à Zod que `DATABASE_URL`, `BETTER_AUTH_SECRET` et `BETTER_AUTH_URL`. Résultat en production : `memoire`, aucun refus. Prouvé par deux tests qui passent sur le code de la PR 1 : `env-schema.email.test.ts` et `env.test.ts` (chargement réel), « après la PR 1 », avec ces deux variables (valeurs factices) et sans `EMAIL_TRANSPORT`.

**Règle corrigée par le relecteur** (section 9) : en production, `EMAIL_TRANSPORT` est facultatif et vaut `smtp` s'il est absent ; toute autre valeur est refusée ; les deux variables Gmail restent obligatoires. En prévisualisation sans variable : `memoire`. Sections 2.1, 2.2, 9, « Découpage en PR », critères de la PR 2 et décision 4 mises à jour.

**Interfaces fixées par les tests** (à confirmer par le relecteur) :

- `env-schema.ts` : `TransportEmail` reçoit `"smtp"` ; `ConfigurationEmail` reçoit une **cinquième propriété**, `gmail` : `{ utilisateur, motDePasse }` figé, ou `null` hors `smtp`. `GMAIL_UTILISATEUR` : adresse acceptée par `schemaAdresse` au domaine `gmail.com`. `GMAIL_MOT_DE_PASSE_APPLICATION` : exactement 16 lettres minuscules. `smtp` hors production (prévisualisation, poste local) exige `EMAIL_DESTINATAIRES_AUTORISES` ; en production, la liste est ignorée sans refus.
- `modules/email/smtp.ts` : `optionsTransportSmtp({ utilisateur, motDePasse })`, objet figé en profondeur, exactement : `host: "smtp.gmail.com"`, `port: 465`, `secure: true`, `auth`, `tls: { minVersion: "TLSv1.2", rejectUnauthorized: true, servername: "smtp.gmail.com" }`, `connectionTimeout: 5000`, `greetingTimeout: 5000`, `socketTimeout: 10000`, `pool: false`, `logger: false`, `debug: false`, `disableFileAccess: true`, `disableUrlAccess: true`. `creerTransportSmtp(options)` renvoie un `Transport` ; le test lui passe ces options redirigées vers le serveur factice (`host`, `port`, `secure: false`, `ignoreTLS: true`). `traduireErreurSmtp(erreur)` renvoie une `EchecTransport` sans lire `message` ni `response`.
- Traduction : `EENVELOPE` ou `EMESSAGE` avec un `responseCode` 5xx donnent `refuse_par_serveur` ; tout le reste, `EAUTH` compris, donne `indisponible` (4xx compris : refus temporaire). Un `code` ou un `responseCode` mal formé est écarté.
- Outillage : `src/server/modules/email/outils-test/serveur-smtp.ts` (`demarrerServeurSmtp({ reponseAuth, reponseRcpt, muet })`), en `node:net` sur `127.0.0.1`, port choisi par le système.

**Ajouts à la fiche, à confirmer** : `servername`, `disableFileAccess` et `disableUrlAccess` ne figuraient pas dans la fiche. Les deux derniers ferment l'accès aux fichiers et aux adresses depuis un message (avis GHSA-8m3c-c648-2xjj et GHSA-p6gq-j5cr-w38f, sur ces options). Inutiles avec nos messages en texte brut, ils ne coûtent rien.

**Tests existants que la PR 2 contredit**, à modifier à l'implémentation après accord (comme « La PR 2 remplace le cas de la production ») :

- `env-schema.email.test.ts` : « après la PR 1 », production sans variable (`memoire`) et production avec les variables Gmail (`memoire`) : la PR 2 donne respectivement un refus et `smtp`. « prévisualisation : memoire » et « forme du résultat : quatre propriétés exactement » : `toStrictEqual` sans `gmail`.
- `env.test.ts` : « témoin : configuration valide » et « après la PR 1 : Vercel production / preview » (`toStrictEqual` sans `gmail` ; la production sans variable devient un refus) ; « après la PR 1 : production avec les variables Gmail » (devient `smtp`).

**Tests nouveaux qui passent déjà, et pourquoi** :

- Les deux tests « après la PR 1 » avec les variables Gmail : ils décrivent le code de production actuel (point 1 ci-dessus), et seront remplacés.
- `env.test.ts`, « prévisualisation sans aucune variable d'envoi : se charge, memoire » : comportement inchangé par la PR 2, témoin.
- Renforcés pour échouer aujourd'hui : « `EMAIL_TRANSPORT=%j` refusée en production » (5 cas) et « sous `NODE_ENV=test`, `smtp` refusé » passaient parce que la PR 1 refuse toute valeur `smtp`. Chacun vérifie d'abord, dans le même test, que la configuration voisine valide donne `smtp`.

**Constats du 2026-10-13** :

- `npm test` : 43 fichiers, 3 en échec ; 1 489 tests, 69 en échec, 1 420 réussis. Les 1 417 tests de la PR 1 passent ; les 69 échecs sont tous nouveaux.
- `npm run lint` : vert. `npm run typecheck` : 39 erreurs, toutes dans `smtp.test.ts` (34 : exports de `smtp.ts` sans paramètre ni type) et `env-schema.email.test.ts` (5 : `gmail` absent du type).
- Construction, intégration et bout en bout : non lancés, aucun test de ces projets ajouté.

**Dépendance (décision 1)**, relue le 2026-10-13, rien d'installé : proposition `nodemailer` **10.0.15**, publiée le 2026-10-05, la plus récente 10.x publiée depuis au moins sept jours (10.0.16 : 2026-10-07 ; 10.1.0 : 2026-10-10). Aucun avis publié ni mis à jour depuis le 2026-10-12, ni dans le dépôt (<https://github.com/nodemailer/nodemailer/security/advisories>, avis les plus récents le 2026-09-30), ni dans la base de GitHub (`api.github.com/advisories?affects=nodemailer`, dernière mise à jour le 2026-10-05) ; aucun avis connu ne touche 10.0.15. Les quatre avis du dépôt du 2026-09-30 (GHSA-4ffr-jq9g-5ffx, GHSA-g73g-hqqh-jr95, GHSA-39m8-27wv-hr27, GHSA-4g23-2xm8-66gc) n'apparaissent pas dans la base de GitHub lue par `npm audit` : un `npm audit` vert ne suffit pas, la page du dépôt se relit à l'installation. `npm audit` n'a pas été lancé (il exige l'installation) ; attendu après l'installation : `npm audit --omit=dev` sans faille, et `npm audit` identique à aujourd'hui.
