# Plan — Réseau de la boutique (postes reliés sans internet), mode 100 % local, code d'activation et sauvegarde

Statut : **validé le 31/10/2026** — réalisation lot par lot (voir partie 9).

Avancement : **lot 1 fait le 31/10/2026** (suivi réseau par déclencheurs SQLite — `electron/db/reseau.ts` ; moteur de synchro à cible — `electron/services/sync.ts` ; indicateur de synchronisation dans la barre du haut, bureau et web ; tests `tests/services/reseau.test.ts`). **Lot 2 fait le 31/10/2026** (serveur du poste principal — `electron/services/reseauPrincipal.ts` : port 47800, appairage par code à 6 chiffres → jeton d'appareil, 15 postes max, réseau privé seulement, /sync/push, /sync/pull, /reseau/stock, annonce UDP ; démarrage avec l'appli ; écran Réglages → Réseau de la boutique ; indicateur 🖥️ ; tests `tests/services/reseauPrincipal.test.ts`). Reste à faire du lot 2 : le QR code de l'adresse (aucune bibliothèque QR installée). **Lot 3 fait le 31/10/2026** (caisses — `electron/services/reseauCaisse.ts` : recherche du poste principal par annonce UDP ou adresse, branchement par code (refus d'une autre boutique), échanges toutes les 4 s + échange immédiat après chaque vente, comptes diffusés (sans jetons), vérification du stock avant de vendre un article qui passerait sous le seuil d'alerte (1,5 s, jamais bloquant si le poste principal ne répond pas) ; écran caisse dans Réseau de la boutique ; indicateur 📶 / 🟠 ; tests `tests/services/reseauCaisse.test.ts`). Déjà en place pour le lot 4 : une caisse branchée ne synchronise plus en ligne, le poste principal relaie tout. Limites connues : seuls les comptes déjà connus du poste principal sont transmis (gestion locale des comptes au lot 5) ; les écrans ouverts sur une caisse ne se rafraîchissent pas tout seuls quand des données arrivent. **Lot 4 fait le 31/10/2026** (passerelle internet — `electron/services/sync.ts` : sur le poste principal, la dernière modification gagne (vraies dates, version plus ancienne d'une caisse refusée et version gagnante renvoyée) ; conflit avec le serveur → rechargement complet depuis lui au lieu d'une ligne « en attente » pour toujours ; synchro en ligne toutes les minutes sur le poste principal, jamais sur une caisse ; tests `tests/services/passerelle.test.ts`). Limite : le poste principal n'envoie en ligne que s'il est ouvert et connecté (jeton de session). **Lot 5 fait le 31/10/2026** (mode 100 % local = « Synchro autorisée » décochée ; suppression des données en ligne dans l'admin Django, tests `comptes/tests.py::SuppressionDonneesEnLigneTests` ; comptes mémorisés sur le poste dès leur création/modification par le patron et diffusés aux caisses, suppression d'un vendeur propagée aux caisses ; indicateur 🔒 100 % local ; abonnement rafraîchi par /auth/moi/ toutes les 30 min en 100 % local). À déployer : code serveur (pas de migration). **Lot 6 fait le 31/10/2026** (code d'activation — Ed25519 en Python pur `comptes/activation.py`, conforme au vecteur officiel RFC 8032, aucune dépendance à installer ; commande `manage.py generer_cle_activation` ; action « Générer un code d'activation » dans l'admin Django (date de fin et formule actuelles de la boutique) ; vérification sans internet `electron/services/activation.ts`, code gardé en réglage `code_activation` (transmis aux caisses, jamais effacé par une date du serveur plus ancienne, la date la plus lointaine l'emporte) ; saisie dans Gérer l'abonnement → 🔑 Code d'activation ; tests croisés Python → Node `tests/services/activation.test.ts`). À déployer : code serveur + variable ACTIVATION_CLE_PRIVEE sur O2switch (copier la ligne du .env local). **Lot 7 fait le 31/10/2026** (sauvegarde — `electron/services/sauvegarde.ts` : AES-256-GCM, clé scrypt du mot de passe du patron gardée sous DPAPI Windows, fichier `.gsbak`, écriture sûre (temporaire puis renommage), conservation par boutique, sauvegarde manquée rattrapée au démarrage suivant, sauvegarde à la fermeture si > 24 h, restauration vérifiée avant remplacement avec base actuelle mise de côté puis redémarrage ; Espace Admin → 💾 Sauvegarde (paramétrage, fiche de récupération imprimable, réglages, changement de mot de passe, restauration) ; Réglages → 💾 Sauvegarde côté patron (consultation) ; bandeau d'alerte ; date envoyée au serveur, colonne « Dernière sauvegarde » dans l'admin Django ; tests `tests/services/sauvegarde.test.ts`, `comptes/tests.py::DateDerniereSauvegardeTests`). À déployer : migration comptes/0013. **Lot 8 fait le 01/11/2026** (aide « ❓ Comment relier vos appareils ? » dans Réseau de la boutique — routeur, point d'accès du téléphone, câble, pare-feu, poste introuvable ; libellés « Informations boutique → … » corrigés ; guide PDF : nouveau chapitre 13 « Réseau de la boutique et sauvegarde », FAQ complétée). **Plan terminé.** Ajouts du 01/11/2026 : modale Réseau avec barre latérale ; « Arrêter le code » ; pause / reprise du serveur (en mémoire, les caisses gardent leur jeton) ; adresse du poste principal changée → la caisse le recherche seule après 2 échecs (au plus toutes les 20 s) et le reconnaît par un défi HMAC sur l'empreinte de son jeton (`/reseau/prouver/`), sans jamais envoyer le jeton à un inconnu. Réseau activé par l'administrateur (01/11/2026) : `Boutique.reseau_autorise` (désactivé par défaut, champ protégé, migration comptes/0014 avec `DemandeReseau`), réglé dans l'admin Django (colonne éditable + demandes à accepter/refuser) ou l'Espace Admin (carte « 📶 Réseau de la boutique » : état, demandes à accepter / refuser, activer / désactiver, historique — `POST /auth/reseau-boutique/` ; plus dans Gérer abonnement) ; l'appli refuse de devenir poste principal / se brancher sans lui, et le poste principal arrête son serveur dans la minute s'il est désactivé ; « Demander l'activation » + WhatsApp + « Vérifier l'activation » ; autorisations (envoi en ligne, réseau) affichées dans la modale et l'indicateur. Ordinateur neuf (01/11/2026) : lien « 📶 Nouvel ordinateur ? Rejoindre le réseau de la boutique » sur l'écran de connexion quand aucune boutique n'est installée — branchement par le code à 6 chiffres sans session (`rejoindreAvantConnexion`, refusé si une boutique existe déjà), adoption de la boutique du poste principal, premier échange = boutique + données + comptes, puis connexion hors ligne. Téléphones : non (version web hors du réseau local). Sauvegarde refaite (01/11/2026) : modale commune admin / patron avec barre latérale, liste des copies, restauration depuis la liste ; conservation progressive (jour 30 j → semaine 6 mois → mois pour toujours) ou illimitée ; fiche de récupération en deux exemplaires ; **clé de secours** optionnelle (accord du patron) : fichier `.gsbak` v2 (clé de la sauvegarde + boutique chiffrées RSA-OAEP pour l'administrateur, en-tête authentifié), ouverture par `POST /auth/secours-sauvegarde/` (identifiants admin, RSA en Python pur `comptes/secours.py`, clé privée `SECOURS_CLE_PRIVEE` dans le .env du serveur, clé publique dans `electron/services/sauvegarde.ts`). À déployer : la variable SECOURS_CLE_PRIVEE sur O2switch.
Périmètre : **application de bureau (Electron) uniquement** — un navigateur ne peut pas joindre un ordinateur du réseau local (règle de sécurité des navigateurs). Le client web reste « avec internet ».

---

## 1. Objectif et décisions validées

Faire travailler ensemble les ordinateurs d'une même boutique **sans internet**, et laisser une boutique garder ses données **chez elle** si elle le veut.

| Décision | Détail |
|---|---|
| Poste principal | Un ordinateur, choisi dans Réglages, fait « petit serveur » de la boutique (à l'intérieur de l'appli, rien à installer). |
| Branchement des caisses | Même réseau (routeur Wi-Fi sans abonnement, **point d'accès d'un téléphone** même sans forfait, ou câble). Code à **6 chiffres** saisi une seule fois. |
| Fréquence | Synchro locale toutes les **3 à 5 secondes**. |
| Rupture | Avant de vendre un article **presque en rupture**, la caisse **vérifie auprès du poste principal**. |
| Indicateur de synchronisation | Toujours visible, dit **par où** passe la synchro : 🌐 En ligne · 📶 Réseau de la boutique · 🖥️ Poste principal · 🟠 Hors ligne / poste principal injoignable · 🔒 100 % local (détail en 4.9). |
| Poste principal éteint | Les caisses continuent seules et rattrapent au retour. Alerte au patron si un article a été vendu au-delà du stock. |
| Modes | « Local + en ligne » (par défaut) et « **100 % local** » (ventes, stock, clients… jamais envoyés). |
| Abonnement | **Toujours vérifié en ligne** (même en 100 % local) + **code d'activation signé** en secours. |
| Sauvegarde | Sur le **Google Drive de la boutique**, paramétrée **sur place par l'admin** dans un écran protégé — **option A** : dossier « Google Drive pour ordinateur ». Sauvegarde chiffrée, mot de passe choisi par le patron. |

---

## 2. Vocabulaire

- **Poste principal** : l'ordinateur qui garde la version commune des données de la boutique et sert les autres.
- **Caisse** (ou poste relié) : tout autre ordinateur branché sur le poste principal.
- **Réseau de la boutique** : la box, le routeur, le point d'accès du téléphone ou le câble qui relie les postes.
- **Serveur en ligne** : le backend Django (O2switch).

---

## 3. Architecture

```
  Caisse 1 ─┐                                   (quand internet est là,
            ├──  réseau de la boutique  ──  Poste principal  ── internet ──  Serveur en ligne
  Caisse 2 ─┘     (Wi-Fi, téléphone, câble)        (serveur local)          (mode « local + en ligne » ;
                                                                             abonnement seul en 100 % local)
```

- Les caisses **ne parlent qu'au poste principal** quand elles lui sont reliées : un seul chemin vers le serveur en ligne, pas de doublons.
- Le poste principal est la **passerelle** : il reçoit tout des caisses et, en mode « local + en ligne », envoie tout au serveur dès qu'internet est là.
- Un poste qui n'est relié à aucun poste principal fonctionne **comme aujourd'hui** (seul, avec ou sans internet).

---

## 4. Choix techniques

### 4.1 Le serveur local
- Démarré dans le **processus principal d'Electron** (module `http` de Node), seulement si l'ordinateur est réglé « poste principal ».
- Port fixe proposé : **47800** (repli sur 47801… si occupé).
- **Même contrat que le serveur Django** : `POST /sync/push/` et `GET /sync/pull/` (même format de changements, même registre `electron/db/registre.ts`). Le moteur de synchro existant (`electron/services/sync.ts`) est réutilisé en lui donnant une **cible** : « serveur en ligne » ou « poste principal ».
- Routes en plus : `/reseau/appairer/`, `/reseau/stock/`, `/reseau/comptes/`, `/reseau/etat/`.
- **Pare-feu Windows** : au premier lancement en poste principal, Windows demande d'autoriser l'appli sur le réseau privé — l'admin clique « Autoriser » (à documenter dans l'aide).

### 4.2 Trouver le poste principal
- Le poste principal **s'annonce** sur le réseau toutes les 2 secondes (message UDP diffusé : nom de la boutique, adresse, port).
- La caisse affiche les postes trouvés ; **repli** : saisie manuelle de l'adresse (affichée sur le poste principal, avec un QR code).

### 4.3 Brancher une caisse (appairage)
- Le poste principal affiche un **code à 6 chiffres valable 10 minutes**.
- La caisse l'envoie à `/reseau/appairer/` et reçoit un **jeton d'appareil** (long, aléatoire), gardé sur la caisse. Toutes les requêtes suivantes portent ce jeton.
- Le poste principal tient la **liste des appareils branchés** (nom, dernière connexion), **15 postes au maximum** (poste principal compris), et peut **débrancher** un appareil (jeton révoqué).
- Le serveur local **refuse** toute requête sans jeton valide et ne répond qu'aux adresses du réseau privé.

### 4.4 Reprendre là où on s'était arrêté (curseur)
- Aujourd'hui le pull en ligne repart de la **date de modification**. Entre ordinateurs, les horloges diffèrent : on ne peut pas s'y fier.
- Le poste principal numérote chaque écriture (reçue ou faite sur place) avec un **compteur** (colonne `seq_reseau`). La caisse demande « tout ce qui a un numéro plus grand que N ».

### 4.5 Savoir ce qui a été envoyé, et à qui
- La colonne `synchronise` garde son sens actuel : **envoyé au serveur en ligne**.
- Nouvelle colonne `synchro_reseau` sur les caisses : **envoyé au poste principal**.
- Sur le poste principal, une ligne reçue d'une caisse garde `synchronise = 0` : elle partira au serveur en ligne avec le reste.

### 4.6 Le stock
- Inchangé dans son principe : **recalculé à partir des mouvements** après chaque réception (même fonction qu'après un pull en ligne).
- Ventes, mouvements, paiements : **ajout seul**, donc pas de conflit entre caisses. Fiches (prix, nom…) : **la dernière modification gagne**, comme aujourd'hui.

### 4.7 Vérification avant de vendre un article presque en rupture
- « Presque en rupture » : le stock local **après** la vente passerait **sous le seuil d'alerte** de l'article (ou sous 0).
- La caisse interroge `/reseau/stock/` (article + dépôt) avant de valider. Délai maximum **1,5 s** : si le poste principal ne répond pas, la vente passe avec un avertissement (on ne bloque jamais la caisse).
- Si le poste principal confirme une rupture : message « Plus en stock (vendu sur un autre poste) » et la vente est refusée.

### 4.8 Les comptes (vendeurs, rôles)
- Aujourd'hui, un vendeur ne peut se connecter sans internet **que s'il s'est déjà connecté sur ce même ordinateur** (cache `identifiants-locaux.json`), et les comptes se gèrent via le serveur.
- Le poste principal tient une **table locale des comptes** (identifiant, mot de passe **protégé** — même hachage que le cache actuel, jamais en clair —, rôle, permissions, dépôt, code vendeur) et la **diffuse aux caisses** (`/reseau/comptes/`). Ainsi un vendeur peut se connecter sur n'importe quelle caisse branchée.
- Mode « local + en ligne » : la source reste le **serveur** ; le poste principal rafraîchit sa table à chaque connexion en ligne.
- Mode « 100 % local » : les comptes se **gèrent sur le poste principal** (créer, modifier, désactiver un vendeur), sans serveur.

### 4.9 Savoir par où passe la synchronisation
Aujourd'hui l'état de la synchro n'est visible que dans Réglages → Synchronisation. On ajoute un **indicateur permanent** dans la barre du haut, qui dit toujours **par quel chemin** les données partent, et un **panneau détaillé** au clic.

**Indicateur (barre du haut), selon le rôle du poste :**

| Situation | Ce qui s'affiche |
|---|---|
| Poste seul, internet présent | 🌐 **En ligne** · synchronisé à 14:05 |
| Poste seul, pas d'internet | 🟠 **Hors ligne** · 12 en attente d'envoi |
| Caisse reliée au poste principal | 📶 **Réseau de la boutique** (poste « Bureau ») · il y a 3 s |
| Caisse dont le poste principal ne répond plus | 🟠 **Poste principal injoignable** · 5 en attente |
| Poste principal | 🖥️ **Poste principal** · 2 caisses reliées |
| Mode 100 % local (ajouté à l'un des cas ci-dessus) | 🔒 **100 % local** |

**Deuxième ligne (sous l'indicateur), l'état d'internet :**
- Caisse reliée : « Internet (par le poste principal) : 🌐 envoyé à 14:05 » ou « ✗ pas d'internet — 37 en attente » ou « 🔒 100 % local, rien n'est envoyé ».
- Poste principal : « 🌐 En ligne — envoyé à 14:05 » ou « ✗ Pas d'internet — 37 en attente ».

**Panneau détaillé (clic sur l'indicateur, et dans Réglages → Synchronisation) :**
- Le **chemin** en clair : « Cette caisse → Poste principal « Bureau » → Serveur en ligne » (ou « → rien, 100 % local »).
- **Dernière synchro réseau local** et **dernière synchro en ligne**, séparées.
- **En attente** : vers le poste principal / vers le serveur en ligne (par type : ventes, mouvements…).
- Poste principal : **liste des caisses reliées** avec leur dernière connexion.
- Bouton « ⟳ Synchroniser maintenant » qui agit sur le bon chemin (réseau local ou en ligne).

**Traçabilité** : chaque synchronisation est notée avec son **canal** (« réseau local » ou « en ligne ») ; côté serveur, les envois relayés par le poste principal portent l'appareil d'origine et la mention « via poste principal ».

---

## 5. Les deux modes

| | Local + en ligne (défaut) | 100 % local |
|---|---|---|
| Ventes, stock, clients, chiffres… | Envoyés au serveur (par le poste principal) | **Jamais envoyés** |
| Abonnement | En ligne | En ligne (+ code d'activation) |
| Nom de la boutique, contact | En ligne | En ligne |
| Date de la dernière sauvegarde | En ligne | En ligne (la date seulement, jamais le contenu) |
| Comptes vendeurs | Gérés via le serveur | Gérés sur le poste principal |
| Sauvegarde | Recommandée | **Obligatoire** (alerte au-delà de 7 jours) |

- Le mode **existe déjà** sur le serveur : c'est le réglage **« Synchro autorisée »** de la boutique (`Boutique.synchro_autorisee`), décoché par défaut et réglé par l'administrateur dans l'espace admin Django, sur demande du commerçant. Décoché = **100 % local** (le serveur refuse tout envoi de données). Pas de nouveau champ ni d'écran local (décision du 31/10/2026, plus simple et centralisé).
- **Passage en 100 % local** : l'appli arrête d'envoyer. Les données **déjà** sur le serveur restent tant qu'on ne les supprime pas : action **« Supprimer les données en ligne (mode 100 % local) »** dans l'espace admin Django (liste des boutiques) — garde la boutique, l'abonnement, les comptes et les réglages ; refusée tant que la synchro est autorisée.
- **Retour en ligne** : tout l'historique part au serveur à la première synchronisation.
- En 100 % local, l'appli contacte le serveur **uniquement** pour l'état de l'abonnement, par la route existante `/auth/moi/` (au démarrage puis toutes les 30 minutes) — aucune donnée de la boutique. La date de dernière sauvegarde viendra au lot 7.

---

## 6. Code d'activation (secours de l'abonnement)

- Contenu : **identifiant de la boutique + nouvelle date de fin + numéro du code**, avec une **signature** (Ed25519).
- La **clé privée** reste sur le serveur (variable d'environnement, jamais dans le dépôt) ; la **clé publique** est dans l'appli, qui vérifie le code **sans internet**. Impossible de fabriquer un code ou de le réutiliser pour une autre boutique.
- Généré dans l'**Espace Admin en ligne**, depuis le registre des paiements (après validation du paiement) ; affiché sous forme courte à dicter / envoyer par WhatsApp.
- Saisi sur le **poste principal** (Espace Admin local ou écran d'abonnement) ; la nouvelle date est transmise aux caisses par le réseau de la boutique.
- La protection existante contre le **recul de l'horloge** (date plafond) reste en place.

---

## 7. Sauvegarde (option A : dossier Google Drive pour ordinateur)

- **Qui** : le poste principal (il a toutes les données).
- **Quoi** : un fichier `.gsbak` = la base complète **chiffrée** (AES-256-GCM, clé tirée du mot de passe du patron par scrypt).
- **Où** : un dossier choisi par l'admin — en pratique le dossier **Google Drive pour ordinateur** connecté au **compte Google de la boutique** ; Google l'envoie tout seul dès qu'internet est là. Possible aussi : clé USB, autre dossier.
- **Quand** : **réglé pour chaque boutique** par l'admin lors du paramétrage — heure de la sauvegarde quotidienne et conservation (par défaut : 21 h, conservation **progressive** — chaque jour pendant 30 jours, puis une par semaine jusqu'à 6 mois, puis une par mois pour toujours ; ou « ne jamais supprimer », décision du 01/11/2026). Sauvegarde aussi à la fermeture de l'appli si la dernière date de plus de 24 h.
- **Paramétrage** : **Espace Admin local → Sauvegarde**, ouvert avec les identifiants admin. L'admin choisit le dossier, l'heure, lance un essai. **Le patron tape lui-même le mot de passe** (l'admin ne le voit pas) ; l'appli imprime une **fiche de récupération**.
- **Patron** : voit « ✅ Dernière sauvegarde : hier 21 h » mais ne peut ni débrancher ni modifier.
- **Restauration** : Espace Admin local → « Restaurer une sauvegarde » (choisir le fichier + mot de passe du patron), avec confirmation forte.
- **Alertes** : échec plusieurs jours de suite → bandeau au patron ; la date de dernière sauvegarde remonte à l'Espace Admin en ligne.
- **Limite connue de l'option A** : l'appli sait que le fichier est **déposé dans le dossier**, pas que Google l'a **envoyé**. (Option B — connexion directe au Drive — pour plus tard.)

---

## 8. Écrans

**Appli de bureau**
- **Réglages → Réseau de la boutique** :
  - « Faire de cet ordinateur le poste principal » → adresse, QR code, code à 6 chiffres, liste des appareils branchés (débrancher).
  - « Se brancher au poste principal » → postes trouvés / adresse manuelle, saisie du code, état de la liaison.
  - « Comment relier vos appareils ? » (routeur, point d'accès du téléphone, câble, pare-feu).
- **Indicateur de synchronisation** permanent dans la barre du haut : **par où** passent les données (🌐 en ligne / 📶 réseau de la boutique / 🖥️ poste principal / 🟠 hors ligne / 🔒 100 % local) + état d'internet + panneau détaillé au clic (voir 4.9).
- **Espace Admin local** : Mode des données (local + en ligne / 100 % local), Sauvegarde, Restauration, Code d'activation.
- **Comptes** (mode 100 % local) : gestion des vendeurs sur le poste principal.

**Espace Admin en ligne**
- Générer un code d'activation (depuis un paiement validé).
- Date de dernière sauvegarde et mode des données de chaque boutique.
- Supprimer les données en ligne d'une boutique.

---

## 9. Étapes de réalisation

Chaque lot est livrable et testable seul ; on avance lot par lot, avec validation.

| Lot | Contenu | Livrable testable |
|---|---|---|
| **1. Fondations** | Colonnes `synchro_reseau` (caisses) et `seq_reseau` (poste principal) ; moteur de synchro à **cible** (serveur en ligne / poste principal) sans changer le comportement actuel ; **indicateur de synchronisation** dans la barre du haut (d'abord 🌐 En ligne / 🟠 Hors ligne + en attente, puis enrichi aux lots 2-5). | Tests : synchro en ligne inchangée ; deux bases en mémoire qui s'échangent des changements par le moteur ; l'indicateur affiche le bon état en ligne / hors ligne. |
| **2. Poste principal** | Serveur local (http), appairage (code 6 chiffres → jeton), liste des appareils, `/sync/push` + `/sync/pull` locaux avec compteur, recalcul du stock. Écran « Faire de cet ordinateur le poste principal ». | Tests de bout en bout sur la machine (deux instances) ; vente sur l'une visible sur l'autre. |
| **3. Caisses** | Découverte UDP + adresse manuelle, branchement par code, boucle 3-5 s, voyant, vérification avant vente presque en rupture, comptes diffusés et connexion d'un vendeur sur une caisse. | Deux PC sur le point d'accès d'un téléphone : ventes croisées, rupture bloquée, vendeur connecté sur la caisse 2. |
| **4. Passerelle internet** | En mode réseau, seul le poste principal parle au serveur ; il envoie aussi les données des caisses ; les caisses n'appellent plus le serveur. | Coupure / retour d'internet : tout arrive au serveur une seule fois. |
| **5. Mode 100 % local** | Réglage du mode (Espace Admin local), arrêt de l'envoi, route serveur légère « abonnement + date de sauvegarde », gestion locale des comptes, suppression des données en ligne (Espace Admin en ligne). | En 100 % local : aucune donnée métier ne part (vérifié par le journal), l'abonnement se rafraîchit. |
| **6. Code d'activation** | Génération signée côté serveur (Espace Admin, lié au registre des paiements), vérification hors ligne, transmission aux caisses. | Code valide accepté sans internet ; code modifié ou d'une autre boutique refusé. |
| **7. Sauvegarde** | Sauvegarde chiffrée quotidienne (heure et conservation réglées par boutique), écran admin protégé, mot de passe du patron, fiche de récupération, restauration, alertes, date remontée au serveur. | Sauvegarde → suppression de la base → restauration identique. |
| **8. Aide et guide** | Écran « Comment relier vos appareils ? », messages d'erreur clairs, mise à jour du guide d'utilisation PDF. | Relecture. |

---

## 10. À déployer sur le serveur (O2switch)

- **Lot 5** : **pas de migration** — code seulement : `comptes/services.py::supprimer_donnees_en_ligne` + action et page de confirmation dans `comptes/admin.py`.
- **Lot 6** : génération des codes d'activation (code seulement, sans migration ni dépendance) ; **clé privée Ed25519** `ACTIVATION_CLE_PRIVEE` à recopier du `.env` local vers celui d'O2switch.
- **Lot 7** : champ `date_derniere_sauvegarde` sur `comptes.Boutique` (migration) et sa réception.
- Lots 1 à 4 : **rien** côté serveur (le contrat de synchro ne change pas).

---

## 11. Risques et limites

- **Poste principal éteint** : les caisses ne se voient plus ; ventes au-delà du stock possibles → alerte au patron au retour.
- **Pare-feu Windows** et **téléphones qui isolent les appareils** sur leur point d'accès (rare) : à expliquer dans l'aide, message clair si le poste principal est introuvable.
- **Base entière réécrite à chaque enregistrement** (sql.js) : surveiller les performances avec 3-5 s de synchro sur une grosse base ; on n'écrit sur le disque que s'il y a eu des changements.
- **Mot de passe de sauvegarde perdu** = sauvegarde illisible (c'est le prix de la confidentialité) → fiche de récupération imprimée.
- **Client web** : non concerné (internet obligatoire).

---

## 12. Valeurs retenues (validées le 31/10/2026)

1. Port du serveur local : **47800** (repli 47801…).
2. « Presque en rupture » : le stock après la vente passerait **sous le seuil d'alerte** de l'article (ou sous 0).
3. Sauvegarde : **heure et conservation choisies pour chaque boutique** par l'admin (défaut : 21 h, conservation progressive ; « ne jamais supprimer » au choix).
4. **15 postes** branchés au maximum (poste principal compris).
5. Synchro réseau local toutes les **4 secondes**.
