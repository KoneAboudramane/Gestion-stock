# Plan — Appli mobile complète (mêmes fonctions et même rôle que le bureau)

Statut : **validé et réalisé le 06/11/2026** (lots 1 à 5) — réalisation lot par lot (voir partie 5 ; décisions de la partie 10 prises le même jour).

Avancement : **lot 1 fait le 06/11/2026** (non commité, à vérifier sur la tablette) — carte et liste « Crédits en attente » (Tableau de bord) ; « 🛒 Commander » sur une alerte de rupture (`services/stock.ts::obtenirLigneStock`) ; « 🔑 Code d'activation » (`services/activation.ts`, Ed25519 par `@noble/curves`, vérifié avec les codes de test signés par le serveur ; date la plus lointaine serveur / code dans `services/abonnement.ts`) ; logo de la boutique (`contexts/LogoContext.tsx`, gardé sur l'appareil, réduit à 400 px) affiché dans le menu, la facture, le reçu de crédit et le bon de commande ; nom de la boutique à jour sans reconnexion (`contexts/NomBoutiqueContext.tsx`) ; vrai vendeur sur la facture (avant : la personne connectée) ; trace du ticket WhatsApp dans Messages ; module natif `OutilsAppliPlugin.java` (impression Android avec « Enregistrer en PDF », partage de fichiers) derrière `lib/impression.ts`, utilisé par toutes les impressions et `lib/export.ts`. Dépendances ajoutées : `@noble/curves`, `@noble/hashes`. **Lot 2 fait le 06/11/2026** (non commité, à essayer en vrai : PC poste principal + tablette) — suivi réseau par interception des écritures IndexedDB (`db/suiviReseau.ts` : `synchronise = 0` → `synchro_reseau = 0` + `seq_reseau` ; `ecritureDeSuivi()` pour les marques ; base v16 avec index `synchro_reseau` / `seq_reseau`) ; moteur à cible (`sync/index.ts` : `CibleSynchro`, `pousserVers`, `tirerDe`, `appliquerPull`, `synchroniserVers`, `compterEnAttente(canal)`) ; mots de passe compatibles (`algo` scrypt / pbkdf2 dans `api/authHorsLigne.ts` avec `@noble/hashes`, et dans `client-electron/electron/services/auth.ts` — seul changement du bureau, ses 314 tests passent) ; module natif `ReseauBoutiquePlugin.java` (écoute UDP avec verrou multicast, requêtes http vers adresses privées seulement, nom de l'appareil) + `network_security_config.xml` ; service caisse `services/reseau.ts` (port de `reseauCaisse.ts` : branchement, rejoindre avant connexion, boucle 4 s, comptes, défi HMAC, vérification de rupture, état) ; `creerVente` vérifie le stock puis envoie tout de suite ; synchro en ligne coupée sur une caisse (`SynchroContext`) ; boucle lancée au démarrage (`main.tsx`) ; écrans copiés du bureau via l'adaptateur `api/reseauBoutique.ts` : `ModaleReseauBoutique.tsx`, `IndicateurSynchro.tsx`, `RejoindreReseauAvantConnexion.tsx` (« appareil » au lieu d'« ordinateur »), carte 📶 dans Réglages (grisée dans un navigateur ou si non activé), lien sur l'écran de connexion (appli seulement). « Devenir poste principal » répond « prochaine mise à jour » (lot 3). Vérifié par un test croisé temporaire (vrai serveur du bureau + vrai code caisse web sur IndexedDB simulée, 5 scénarios : appareil neuf, ventes dans les deux sens, rupture, fiche modifiée, données d'avant le branchement) — gardé hors du dépôt. **Lot 3 fait le 06/11/2026** (non commité ; la preuve « serveur joignable écran éteint 1 h » reste À FAIRE sur la tablette avant de s'y fier) — `services/reseauPrincipal.ts` (port de `reseauPrincipal.ts` du bureau : appairage, jetons par empreinte, /sync/push, /sync/pull, /reseau/comptes, /reseau/stock, /reseau/prouver, pause / reprise / redémarrage, débrancher, activation revérifiée chaque minute) ; `services/reseauConfig.ts` (partagé caisse / principal) ; `sync/index.ts::recevoirChangements` / `extraireDepuis` (curseur `seq_reseau`) ; suivi réseau : toute écriture prend un numéro (ce qui vient du serveur en ligne est redistribué aux caisses), seules les marques « envoyé » passent par `ecritureDeSuivi()` ; synchro en ligne chaque minute sur le poste principal ; comptes créés / modifiés / supprimés par le patron mémorisés sur l'appareil (`api/comptes.ts`) pour être transmis aux caisses ; natif : serveur HTTP maison dans `ReseauBoutiquePlugin.java` (requête → évènement « requete » → `repondre`), annonce UDP sur chaque interface, adresses locales, `ServicePostePrincipal.java` (service de premier plan « specialUse », notification « 🟢 Serveur de la boutique actif · N caisses », verrous processeur + Wi-Fi), permissions et service au manifeste. Vérifié par un second test croisé temporaire (vraie caisse du bureau sur le vrai poste principal web, 5 scénarios) ; le test du lot 2 repasse aussi. **Lot 4 fait le 06/11/2026** (non commité, à essayer sur la tablette avec un vrai dossier Google Drive) — `services/sauvegarde.ts` (port de `sauvegarde.ts` du bureau, MÊME format `.gsbak` v2 : AES-256-GCM par WebCrypto, scrypt N=2^15 par `@noble/hashes`, clé de secours RSA-OAEP ; contenu = toutes les données IndexedDB + comptes connus de l'appareil, en JSON compressé gzip ; copie d'ordinateur refusée avec un message clair → lot 6 ; conservation progressive ; avant restauration, l'état actuel est déposé dans le dossier sous « avant-restauration_… » ; sauvegarde planifiée toutes les 5 min + au passage en arrière-plan si > 24 h) ; natif `SauvegardePlugin.java` (dossier choisi par le sélecteur d'Android avec autorisation gardée, écrire / lire / lister / supprimer, clé gardée dans le Keystore) ; écrans copiés du bureau via `api/sauvegardeBoutique.ts` : `ModaleSauvegardeAdmin.tsx` (« Ouvrir le dossier » masqué, conseils appli Google Drive / carte mémoire), `EtatSauvegarde.tsx` (bandeau) ; carte 💾 dans Réglages et dans l'Espace Admin (grisées dans un navigateur), pastille + « à faire » de l'accueil admin. Vérifié par un test croisé temporaire (copie mobile ouverte par le bureau et inversement, clé de secours ouverte par la clé privée, cycle complet sur IndexedDB simulée, conservation). **Lot 5 fait le 06/11/2026** — aide « ❓ » de Réseau de la boutique : bloc « 📱 Téléphones et tablettes » (bureau et mobile) ; sur mobile, vérification « économie de batterie » dans « Faire de cet appareil le poste principal », étape « 🔋 Régler la batterie » dans la vue d'ensemble du poste principal (`OutilsAppliPlugin.etatBatterie` / `ouvrirReglagesBatterie`) ; guide PDF (31 p.) : nouveau chapitre 14 « L'appli mobile » (installer, imprimer / partager, caisse, poste principal, montages conseillés, sauvegarde), présentation à trois versions, chapitre 13 élargi aux appareils, FAQ (chapitre 15) complétée. **Plan terminé** (non commité). Restent : essais réels (lot 3 écran éteint 1 h, lot 4 vrai Google Drive, lot 2 PC + tablette) ; lot 6 (restauration croisée PC ↔ mobile) et plan séparé imprimante Bluetooth, décidés pour plus tard.

Références : `docs/plan_reseau_local.md` (réseau du bureau, à relire avant chaque lot), mémoire « Appli mobile Capacitor ».

---

## 1. Objectif et décisions validées

L'appli Android (Capacitor sur `client-web`) doit pouvoir **remplacer complètement l'ordinateur** :

- le patron gère toute sa boutique depuis son téléphone ou sa tablette ;
- un commerçant **sans ordinateur** fait tourner sa boutique avec seulement des téléphones / tablettes ;
- ces appareils se relient **entre eux sans internet** (point d'accès d'un téléphone même sans forfait, routeur Wi-Fi), exactement comme les ordinateurs aujourd'hui.

| Décision (06/11/2026) | Détail |
|---|---|
| Parité de fonctions | **Toutes** les fonctions du bureau dans l'appli mobile ; ce qui dépend du PC est **adapté**, jamais retiré. |
| Rôles réseau | Un mobile peut être **caisse branchée** ET **poste principal**. |
| Mélange | PC et mobiles dans le **même réseau**, dans tous les sens (PC principal + téléphones caisses, téléphone principal + PC caisse…). Un seul langage d'échange : celui du bureau, inchangé. |
| Poste principal mobile | Notification permanente « 🟢 Serveur de la boutique actif » (sinon Android coupe le serveur) ; téléphone allumé et de préférence sur chargeur. |
| Ordre | Lot 1 fonctions manquantes → lot 2 caisse → lot 3 poste principal → lot 4 sauvegarde → lot 5 aide. |

Le site web (navigateur) profite du lot 1 ; les lots 2 à 4 ne concernent que l'**appli** Android (un navigateur ne peut pas joindre un appareil du réseau local, ni faire serveur). Le bureau ne change pas, sauf la compatibilité des mots de passe (4.4).

---

## 2. État des lieux (comparaison du 06/11/2026)

Toutes les pages existent sur mobile ; il manque des **fonctions à l'intérieur** :

| Où | Manque sur mobile |
|---|---|
| Tableau de bord | Carte « 👥 Crédits en attente » (le commentaire du fichier la dit « non portée », c'est périmé). |
| Notifications | Bouton « 🛒 Commander » sur une alerte de rupture. |
| Abonnement | Saisie du « 🔑 Code d'activation ». |
| Informations boutique | Choix du **logo**. |
| Ticket / facture / reçu de crédit | Logo, **nom complet du vendeur**, « Exporter en PDF ». |
| Espace Admin (accueil) | Cartes « 💾 Sauvegarde » et « 📶 Réseau de la boutique ». |
| Informations boutique | Cartes « 📶 Réseau de la boutique » et « 💾 Sauvegarde ». |
| Connexion | « 📶 Nouvel appareil ? Rejoindre le réseau de la boutique ». |
| Barre du haut | Indicateur détaillé (📶 / 🖥️ / « Échanger maintenant »). |

**Problèmes propres à l'appli Android** (le code marche dans un navigateur, pas dans l'appli) :

1. **Impression** : `window.print()` ne fait rien dans la vue web d'Android → tickets, factures, reçus, affiche, fiche de récupération **impossibles à imprimer** aujourd'hui dans l'appli.
2. **Téléchargements** : les exports Excel / CSV / PDF (`lib/export.ts`, Clients, Achats, Commandes…) passent par un lien de téléchargement que la vue web d'Android **ignore**.
3. **Mots de passe hors ligne** : le bureau les protège en **scrypt**, le web en **PBKDF2** → un vendeur créé sur un PC ne pourrait pas se connecter sur un téléphone branché (et inversement).

---

## 3. Architecture

```
            ┌── Caisse PC (Electron, SQLite)
Réseau  ────┼── Caisse téléphone (appli, IndexedDB)
boutique    ├── Caisse tablette (appli, IndexedDB)
            └── Poste principal : PC (Electron) OU téléphone/tablette (appli)  ── internet ── Serveur en ligne
```

- **Même contrat** que le poste principal du bureau (`client-electron/electron/services/reseauPrincipal.ts`) : port **47800**, annonce UDP, `GET /reseau/etat/`, `POST /reseau/prouver/`, `POST /reseau/appairer/`, `POST /sync/push/`, `GET /sync/pull/` (curseur `seq_reseau`), `GET /reseau/comptes/`, `GET /reseau/stock/`. Code à 6 chiffres, jeton d'appareil, 15 postes max, réseau privé seulement, synchro toutes les 4 s.
- **Même format de données** : les deux clients ont le même registre de 48 tables et échangent au format du serveur (`versDonneesServeur` / `versLigneLocale`). Rien à traduire entre PC et mobile.
- Activation par l'administrateur (`Boutique.reseau_autorise`), mode 100 % local, code d'activation : **mêmes règles** que le bureau.

---

## 4. Choix techniques

### 4.1 Un module natif Android « ReseauBoutique » (Java, dans `client-web/android`)
Une vue web ne peut ni ouvrir un port, ni diffuser en UDP, ni rester active en arrière-plan. Le module natif fait **seulement le transport** ; toute la logique (base, synchro, jetons) reste en TypeScript, partagée avec le reste de l'appli.

| Fonction native | Usage |
|---|---|
| Serveur HTTP sur 47800 (petite bibliothèque Java NanoHTTPD) | Reçoit la requête d'une caisse → la passe au TypeScript → renvoie sa réponse (délai max 10 s). Refuse les adresses hors réseau privé. |
| Annonce UDP (diffusion toutes les 2 s) | Envoyée sur **chaque** interface (Wi-Fi ET point d'accès du téléphone lui-même), pas seulement 255.255.255.255. |
| Écoute UDP | Pour qu'une caisse trouve le poste principal (verrou « multicast » Wi-Fi d'Android). |
| Requêtes HTTP vers le poste principal | Côté caisse : l'appli est en `https://localhost`, la vue web bloquerait du `http://192.168…` (contenu mixte) → requête faite en natif (CapacitorHttp) + autorisation du trafic non chiffré **réseau local seulement**. |
| Service de premier plan + verrou de veille | Poste principal : notification permanente « 🟢 Serveur de la boutique actif · N caisses », le processus reste vivant écran éteint. |
| Adresse IP et nom de l'appareil | Écran « Faire de cet appareil le poste principal ». |

### 4.2 Suivi des changements (équivalent des déclencheurs SQLite)
- IndexedDB n'a pas de déclencheurs. On ajoute `seq_reseau` et `synchro_reseau` aux lignes, posés par **un point unique** : l'ouverture de la base (`db/index.ts`) renvoie une base dont toute écriture (`put` / `add`, y compris dans une transaction) sur une table du registre prend un nouveau numéro et repasse `synchro_reseau` à 0. Les 59 écritures existantes des services ne sont pas touchées.
- Compteur gardé dans un petit magasin `compteur_reseau`. Marquer « envoyé » ne compte pas comme une modification (même règle que le bureau).
- Montée de version de la base IndexedDB (additive).

### 4.3 Moteur de synchro à cible
`sync/index.ts` reçoit une **cible** (serveur en ligne / poste principal), comme `electron/services/sync.ts` au lot 1 du bureau. Côté poste principal mobile : `recevoirChangements` (la dernière modification gagne, conflit → version gagnante renvoyée) et `extraireDepuis` (curseur), portés du bureau. Une caisse branchée n'appelle plus le serveur en ligne ; le poste principal relaie (passerelle), qu'il soit PC ou mobile.

### 4.4 Comptes et mots de passe compatibles
- Chaque mot de passe mémorisé porte son **algorithme** (`scrypt` ou `pbkdf2`).
- Le **web/mobile apprend scrypt** (bibliothèque `@noble/hashes`, mêmes paramètres que Node : N=16384, r=8, p=1, 64 octets) ; le **bureau apprend PBKDF2** (natif dans Node). Les deux savent vérifier les deux → un compte diffusé par n'importe quel poste principal marche partout.
- Seul changement côté bureau de tout le plan.

### 4.5 Impression et fichiers dans l'appli
- **Impression** : module natif qui imprime la page affichée par le service d'impression d'Android (imprimantes Wi-Fi / Mopria, et **« Enregistrer en PDF »** proposé par Android). Remplace `window.print()` dans l'appli seulement (le site web garde le navigateur).
- **Fichiers** (exports Excel / CSV / PDF, fiche de récupération) : écriture du fichier puis **feuille de partage Android** (WhatsApp, Drive, e-mail, Fichiers). Un seul point à changer : la fonction de téléchargement de `lib/export.ts` (+ les quelques téléchargements directs des pages).
- Imprimante de tickets **Bluetooth** : hors de ce plan (décision à prendre à part).

### 4.6 Sauvegarde mobile
- Même principe que le bureau : copie **chiffrée** (AES-256-GCM, clé scrypt du mot de passe du patron, fiche de récupération, clé de secours optionnelle), **une par jour** à l'heure réglée, conservation progressive, restauration vérifiée avant remplacement.
- **Où** : un dossier choisi une fois avec le sélecteur d'Android (Google Drive du compte de la boutique, carte mémoire, « Téléchargements »…), l'autorisation est gardée.
- **Clé** gardée dans le coffre d'Android (Android Keystore) — équivalent de la protection Windows (DPAPI) du bureau.
- **Contenu** : toutes les tables au **format de synchro** (JSON), pas un fichier SQLite → voir point ouvert 10.2.
- Faite par le **poste principal** (ou l'appareil seul) ; une caisse branchée n'en a pas besoin.

---

## 5. Lots de réalisation

| Lot | Contenu | Livrable testable |
|---|---|---|
| **1. Fonctions manquantes** (web + appli) | Carte Crédits en attente ; « 🛒 Commander » ; « 🔑 Code d'activation » (vérification Ed25519 hors ligne portée du bureau, transmise par le réseau au lot 2) ; logo (choix, affichage menu, ticket, facture, reçu) ; nom complet du vendeur ; **impression native** et **fichiers partagés** dans l'appli (4.5). | Chaque fonction du tableau 2 présente ; ticket imprimé et export Excel partagé depuis l'appli sur le téléphone. |
| **2. Caisse branchée** (appli) | Suivi des changements (4.2), moteur à cible (4.3), mots de passe compatibles (4.4, + bureau) ; recherche UDP / adresse tapée ; branchement par code ; échanges toutes les 4 s + après chaque vente ; vérification du stock avant de vendre un article presque en rupture ; comptes reçus ; retrouver le poste principal (défi HMAC) ; « Rejoindre le réseau » depuis l'écran de connexion d'un appareil neuf ; écran Réseau de la boutique (vue caisse) ; indicateur 📶 / 🟠. | **PC principal + téléphone caisse** sur le point d'accès d'un téléphone, sans internet : ventes croisées, rupture bloquée, vendeur créé sur le PC connecté sur le téléphone. |
| **3. Poste principal** (appli) | **D'abord une preuve sur le vrai téléphone** : serveur qui reste joignable écran éteint pendant 1 h (4.1) — si ça échoue, on s'arrête et on en reparle. Puis : module natif complet, appairage, liste des appareils, débrancher, arrêter / redémarrer, passerelle internet, mode 100 % local, notification permanente ; écran Réseau de la boutique (vue poste principal). | **Téléphone principal + tablette caisse + PC caisse**, sans internet ; puis retour d'internet : tout arrive au serveur une seule fois. |
| **4. Sauvegarde** (appli) | 4.6 ; cartes Sauvegarde dans Espace Admin et Informations boutique ; bandeau d'alerte ; date envoyée au serveur (route existante). | Sauvegarde → désinstallation de l'appli → réinstallation → restauration identique. |
| **5. Aide et guide** | « ❓ Comment relier vos appareils ? » version téléphone (point d'accès, garder l'appli ouverte, économie de batterie à désactiver) ; guide PDF : chapitre mobile. | Relecture. |

Chaque lot : `tsc`, tests unitaires des parties portées (comme `tests/services/reseau*.test.ts` du bureau), puis vérification sur le vrai téléphone.

---

## 6. Écrans (appli mobile)

- **Informations boutique** : cartes « 📶 Réseau de la boutique » et « 💾 Sauvegarde », identiques au bureau, textes adaptés (« cet appareil » au lieu de « cet ordinateur »).
- **Réseau de la boutique** : « 🖥️ Faire de cet appareil le poste principal » / « 📶 Se brancher au poste principal », code à 6 chiffres en grand, liste des appareils, aide.
- **Connexion** : « 📶 Nouvel appareil ? Rejoindre le réseau de la boutique ».
- **Barre du haut** : indicateur 🌐 / 📶 / 🖥️ / 🟠 / 🔒 et panneau détaillé, comme le bureau.
- **Espace Admin** : cartes Sauvegarde et Réseau.

---

## 7. À déployer sur le serveur (O2switch)

Rien de nouveau : le contrat de synchro, l'activation du réseau, le code d'activation et la date de sauvegarde existent déjà. (Restent les déploiements déjà en attente : migrations, `ACTIVATION_CLE_PRIVEE`, `SECOURS_CLE_PRIVEE`, HTTPS valide, CORS `https://localhost`.)

---

## 8. Play Store

- Le service de premier plan d'un serveur local doit être déclaré (type « usage spécial ») avec une justification à la publication ; le type « synchronisation » est limité à 6 h par jour depuis Android 15, il ne convient pas.
- Permissions ajoutées : réseau Wi-Fi (état, multicast), service de premier plan, notification, verrou de veille.

---

## 9. Risques et limites

- **Android qui endort l'appli** malgré le service (certaines marques : Tecno, Infinix, Itel, Xiaomi…) → réglage « Pas d'économie de batterie pour Gestion Stock » expliqué dans l'aide, et la preuve du lot 3 avant d'aller plus loin.
- **Point d'accès qui isole les appareils** (rare) → message clair « poste principal introuvable », adresse tapée à la main.
- **Gros volumes** : IndexedDB sur un téléphone d'entrée de gamme est plus lent qu'un PC ; le poste principal mobile convient à une **petite boutique** (quelques caisses). À mesurer au lot 3.
- **Le poste principal mobile s'éteint** (batterie, appel, redémarrage) → les caisses continuent seules et rattrapent au retour, comme avec un PC.
- **iPhone / iPad** : hors de ce plan (Android d'abord).

---

## 10. Décisions prises (06/11/2026)

1. Plan validé dans son ensemble.
2. **Sauvegarde PC ↔ mobile** : oui, **plus tard**, dans un lot à part (lot 6, après ce plan) — le format de synchro le permet.
3. **Imprimante de tickets Bluetooth** : dans un **plan séparé**.
