# Plan — Laissez-passer admin (Espace Admin sans internet, sur un appareil neuf)

Statut : **validé et réalisé le 07/11/2026** (lots A à D), non commité.

Avancement : **A** serveur — `administration/laissez_passer.py` (fabriquer / lire), modèle `LaissezPasser` (migration `administration/0002_laissez_passer`), droit `laissez_passer`, `administration/api_laissez_passer.py` (générer, lister, révoquer, `admin/laissez-passer/utilisation/` pour les appareils), admin Django en lecture ; 6 tests (`administration/tests_laissez_passer.py`), suites `administration` (48) et `comptes` (95) vertes. **B** `client-admin` — page `pages/LaissezPasser.tsx` (menu « 🎫 Laissez-passer », badge du droit, libellés du journal). **C** applis — `client-web/src/services/laissezPasser.ts` et `client-electron/electron/services/laissezPasser.ts` (même format ; date sûre contre le recul d'horloge ; accès mémorisé ; utilisations signalées au retour d'internet, accès retiré si le laissez-passer ne vaut plus), case « 🎫 J'ai un laissez-passer » sur l'écran d'accès admin des deux clients ; test permanent `client-electron/tests/services/laissezPasser.test.ts` avec des codes signés par le serveur (318 tests bureau verts). **E** (07/11/2026, demandé ensuite) génération aussi depuis l'Espace Admin de l'appli, avec internet : route `admin/laissez-passer/depuis-appli/` (identifiants admin dans la requête, même droit, journal origine « bureau », 1 test), carte « 🎫 Laissez-passer » + `ModaleLaissezPasserAdmin.tsx` dans les deux clients (bureau par IPC `auth:genererLaissezPasser`). La génération HORS ligne reste exclue (clé privée du serveur) ; option discutée et écartée pour l'instant : certificat d'admin délégué à son téléphone. **D** guide PDF : encadré « Pour l'administrateur : installer dans une zone sans réseau » (chapitre 14). À déployer : migration administration/0002, code serveur, client-admin.

## 1. Le besoin

Installer ou dépanner une boutique dans une **zone sans réseau**, sur un appareil (téléphone, tablette, ordinateur) qui n'a **jamais** vu internet. Aujourd'hui, l'Espace Admin hors ligne n'accepte que les identifiants admin **déjà vérifiés en ligne sur ce même appareil** : sur un appareil neuf, c'est bloqué.

Constaté le 07/11/2026 sur la Galaxy Tab A11 (le serveur était injoignable).

## 2. Décisions (07/11/2026)

| Décision | Détail |
|---|---|
| Principe | Un **laissez-passer** : un code signé par le serveur, vérifié **sans internet** par l'appli, comme le code d'activation. **Rien de secret dans l'appli** (seulement la clé publique) : impossible d'en fabriquer un en ouvrant l'APK. |
| Durée | **Choisie à chaque génération** : 1, 7, 15, 30, 90 jours ou **illimitée**. |
| Qui génère | Le **superutilisateur**, et les admins qui ont le nouveau droit **« Laissez-passer hors ligne »**. |

## 3. Comment ça marche

**Avant de partir (avec internet), sur le site d'administration :**
1. Laissez-passer → « Générer » → choisir la durée → **retaper son mot de passe** (le serveur le vérifie).
2. Le serveur fabrique le code : identifiant de l'admin, **empreinte protégée de son mot de passe** (PBKDF2, comme le cache des appareils), date de fin (ou illimitée), numéro du laissez-passer, signature Ed25519.
3. Le code s'affiche : copier, envoyer par WhatsApp, imprimer. Il est noté au journal admin.

**Sur place, sans réseau, sur n'importe quel appareil :**
1. ⚙ → onglet **« 🎫 Laissez-passer »** → coller le code, taper **identifiant et mot de passe**.
2. L'appli vérifie : la signature, la date, et le mot de passe contre l'empreinte du code.
3. Accepté : l'Espace Admin s'ouvre, et l'identifiant admin est **mémorisé sur l'appareil** comme après une connexion en ligne. Les fois suivantes, identifiant et mot de passe suffisent.

**Au retour d'internet :**
- L'appareil vérifie que le laissez-passer n'a pas été **révoqué** et que le compte admin est toujours actif (le mécanisme existant `verifierRevocationAdmin`). Sinon, l'accès mémorisé est effacé.
- L'utilisation est remontée au journal admin (appareil, boutique, date).

## 4. Pourquoi le mot de passe EN PLUS du code

- Un code perdu ou intercepté (WhatsApp, papier photographié) **ne suffit pas** : il faut aussi le mot de passe de l'admin.
- Le mot de passe n'est jamais dans le code en clair : seulement son empreinte protégée (100 000 tours de PBKDF2), la même protection que sur chaque appareil aujourd'hui.
- Un laissez-passer **illimité** reste ainsi raisonnable. Il peut aussi être **révoqué** en ligne (pris en compte par chaque appareil à son retour sur internet).

## 5. Lots

| Lot | Contenu |
|---|---|
| **A. Serveur** | Modèle `administration.LaissezPasser` (admin, numéro, date de fin ou illimité, révoqué, date de révocation, ajout seul pour le reste) ; droit `laissez_passer` dans `administration/droits.py` ; API `admin/laissez-passer/` (lister, générer avec mot de passe retapé, révoquer) ; signature avec la clé du code d'activation (préfixe distinct `gestion-stock/laissez-passer/v1`) ; route de vérification de révocation pour les appareils ; journal ; tests (dont : un code signé ici est accepté par Node). |
| **B. Site d'administration** (`client-admin`) | Écran « 🎫 Laissez-passer » : générer (durée, mot de passe), afficher (copier, WhatsApp, imprimer), liste avec état (actif / expiré / révoqué), révoquer. |
| **C. Applis** (bureau ET web / mobile, même comportement) | Onglet « 🎫 Laissez-passer » sur l'écran d'accès admin ; vérification hors ligne (signature, date, mot de passe) ; mémorisation de l'accès ; contrôle de révocation au retour d'internet ; journal local remonté. |
| **D. Aide et guide** | Texte d'aide sur l'écran ; guide PDF (chapitre Espace Admin / installation sans réseau). |

## 6. À déployer

Migration `administration` (modèle LaissezPasser), code serveur, `client-admin`. Pas de nouvelle variable : la clé `ACTIVATION_CLE_PRIVEE` sert aussi ici.

## 7. Décisions sur les points ouverts (validées le 07/11/2026 : les trois recommandations)

1. **Mot de passe en plus du code** (partie 4) : d'accord ? (recommandé)
2. **Ce qu'ouvre le laissez-passer** : tout l'Espace Admin de l'appareil, comme une connexion admin normale, avec les droits de l'admin qui l'a généré ? (recommandé)
3. **Changement de mot de passe de l'admin** : ses laissez-passer déjà générés deviennent-ils invalides (l'empreinte ne correspond plus) ? Recommandé : **oui**, c'est une protection naturelle — il en génère de nouveaux.
