import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { app } from "electron";

import { colonnesDeLaTable, executer, unResultat } from "../db/helpers";
import { sauvegarder } from "../db/index";
import { REGISTRE_CLIENT } from "../db/registre";
import { appelerApi, connexion, estErreurReseau, ouvrirSessionLocale } from "./auth";
import type { Session } from "./auth";

/**
 * "Créer une boutique" hors-ligne, depuis l'Espace Admin (voir Inscription.tsx) :
 * contrairement à l'ancien flux (DemandeInscription, en attente de validation
 * par email), la boutique est créée directement en local — utilisable tout de
 * suite, exactement comme n'importe quelle boutique déjà installée (voir
 * CLAUDE.md : SQLite local = source de vérité). "Activer en ligne" plus tard
 * (voir activerEnLigne ci-dessous) est un geste séparé, jamais un préalable.
 *
 * Reprend ROLES_PAR_DEFAUT["Patron"] (comptes/services.py) : pas d'appel
 * serveur possible ici pour l'obtenir, donc dupliqué — à garder synchronisé
 * si la matrice de permissions change côté backend.
 */
const PERMISSIONS_PATRON: Record<string, boolean> = {
  vendre: true,
  consulter_stock: true,
  gerer_clients: true,
  gerer_produits_stock_achats: true,
  voir_benefices_achat: true,
  modifier_prix: true,
  annuler_vente: true,
  voir_rapports_complets: true,
  gerer_utilisateurs_reglages: true,
  consulter_tresorerie: true,
  enregistrer_depense: true,
  gerer_tresorerie: true,
  consulter_comptabilite: true,
};

export class ErreurInscriptionLocale extends Error {}

export interface BoutiqueLocaleEnAttente {
  boutiqueId: string;
  utilisateurIdLocal: string;
  boutiqueNom: string;
  adresse: string;
  telephone: string;
  email: string;
  devise: string;
  patronUsername: string;
  patronEmail: string;
  patronTelephone: string;
}

function cheminEnAttente(): string {
  return path.join(app.getPath("userData"), "boutique-locale-en-attente.json");
}

export function lireBoutiqueLocaleEnAttente(): BoutiqueLocaleEnAttente | null {
  const chemin = cheminEnAttente();
  if (!fs.existsSync(chemin)) return null;
  try {
    return JSON.parse(fs.readFileSync(chemin, "utf-8"));
  } catch {
    return null;
  }
}

function enregistrerEnAttente(entree: BoutiqueLocaleEnAttente): void {
  fs.writeFileSync(cheminEnAttente(), JSON.stringify(entree, null, 2));
}

function effacerEnAttente(): void {
  const chemin = cheminEnAttente();
  if (fs.existsSync(chemin)) fs.unlinkSync(chemin);
}

/**
 * Un poste = une boutique (voir CLAUDE.md, même hypothèse que abonnementAdmin.ts) :
 * bloque la création si ce poste sert déjà à une boutique existante, pour ne
 * jamais mélanger deux boutiques dans le même SQLite local.
 */
export function creerBoutiqueLocale(params: {
  boutiqueNom: string;
  username: string;
  password: string;
  email: string;
}): Session {
  const dejaInstallee = unResultat<{ id: string }>("SELECT id FROM boutiques LIMIT 1");
  if (dejaInstallee) {
    throw new ErreurInscriptionLocale("Ce poste est déjà utilisé pour une boutique existante.");
  }

  const boutiqueId = randomUUID();
  const utilisateurIdLocal = randomUUID();
  const maintenant = new Date().toISOString();

  executer(
    `INSERT INTO boutiques
       (id, nom, adresse, telephone, email, devise, actif, date_expiration_abonnement, formule,
        synchro_autorisee, date_creation, date_modification, synchronise, supprime)
     VALUES (?, ?, '', '', ?, 'FCFA', 1, NULL, 'essentiel', 0, ?, ?, 0, 0)`,
    [boutiqueId, params.boutiqueNom, params.email, maintenant, maintenant],
  );
  sauvegarder();

  enregistrerEnAttente({
    boutiqueId,
    utilisateurIdLocal,
    boutiqueNom: params.boutiqueNom,
    adresse: "",
    telephone: "",
    email: params.email,
    devise: "FCFA",
    patronUsername: params.username,
    patronEmail: params.email,
    patronTelephone: "",
  });

  const session: Session = {
    accessToken: "",
    refreshToken: "",
    utilisateurId: utilisateurIdLocal,
    username: params.username,
    boutiqueId,
    boutiqueNom: params.boutiqueNom,
    role: "Patron",
    permissions: PERMISSIONS_PATRON,
    depotId: null,
    depotNom: null,
    synchroAutorisee: false,
  };
  ouvrirSessionLocale(params.username, params.password, session);

  return session;
}

export type ResultatCreationEnLigne = { statut: "enLigne"; session: Session } | { statut: "horsLigne"; session: Session };

/**
 * "Créer une boutique" en ligne, depuis l'Espace Admin (voir Inscription.tsx) :
 * enregistre directement le compte côté serveur (comme "Créer une boutique"
 * dans Django admin, voir comptes/admin.py::vue_creation_boutique) — le
 * Patron peut se connecter tout de suite, y compris depuis un autre appareil,
 * plutôt que l'ancien flux "demande en attente de validation par email".
 * Les identifiants admin déjà saisis pour franchir le verrou Espace Admin
 * suffisent : pas de ré-authentification, pas d'approbation séparée.
 *
 * Si le réseau n'est finalement pas disponible malgré ce choix, repli
 * automatique sur la création hors-ligne habituelle (voir creerBoutiqueLocale)
 * plutôt que de bloquer l'admin.
 */
export async function creerBoutiqueEnLigne(
  usernameAdmin: string,
  passwordAdmin: string,
  params: { boutiqueNom: string; username: string; password: string; email: string },
): Promise<ResultatCreationEnLigne> {
  const dejaInstallee = unResultat<{ id: string }>("SELECT id FROM boutiques LIMIT 1");
  if (dejaInstallee) {
    throw new ErreurInscriptionLocale("Ce poste est déjà utilisé pour une boutique existante.");
  }

  const boutiqueId = randomUUID();
  try {
    await appelerApi("/auth/enregistrer-boutique-locale/", {
      username: usernameAdmin,
      password: passwordAdmin,
      boutique_id: boutiqueId,
      boutique_nom: params.boutiqueNom,
      boutique_adresse: "",
      boutique_telephone: "",
      boutique_email: params.email,
      boutique_devise: "FCFA",
      patron_username: params.username,
      patron_password: params.password,
      patron_email: params.email,
      patron_telephone: "",
    });

    const maintenant = new Date().toISOString();
    executer(
      `INSERT INTO boutiques
         (id, nom, adresse, telephone, email, devise, actif, date_expiration_abonnement, formule,
          synchro_autorisee, date_creation, date_modification, synchronise, supprime)
       VALUES (?, ?, '', '', ?, 'FCFA', 1, NULL, 'essentiel', 0, ?, ?, 1, 0)`,
      [boutiqueId, params.boutiqueNom, params.email, maintenant, maintenant],
    );
    sauvegarder();

    // Vrais jetons JWT via une connexion réelle, plutôt qu'une session bricolée
    // avec des jetons vides : sans ça, toute requête authentifiée ultérieure
    // (rafraichirPermissions, synchro...) échoue en 401 sans erreur visible, et
    // "Vérifier l'activation" reste bloqué pour toujours même une fois
    // l'abonnement activé côté serveur.
    const session = await connexion(params.username, params.password);
    return { statut: "enLigne", session };
  } catch (erreur) {
    if (!estErreurReseau(erreur)) throw erreur;
    return { statut: "horsLigne", session: creerBoutiqueLocale(params) };
  }
}

/**
 * Remplace l'id local provisoire du Patron par le vrai id (AutoField) que le
 * serveur vient d'attribuer, partout où il a pu être utilisé comme référence
 * "utilisateur" (ventes, mouvements de stock, dépenses...) pendant la période
 * hors-ligne — sans ça, ces lignes déjà créées pointeraient vers un id que le
 * serveur ne connaît pas et échoueraient au premier push après activation.
 */
function reconcilierUtilisateurLocal(utilisateurIdLocal: string, utilisateurIdReel: string): void {
  for (const entree of REGISTRE_CLIENT) {
    const colonnes = colonnesDeLaTable(entree.tableLocale);
    for (const colonneFK of ["utilisateur_id", "utilisateur_source_id"]) {
      if (!colonnes.includes(colonneFK)) continue;
      executer(`UPDATE ${entree.tableLocale} SET ${colonneFK} = ? WHERE ${colonneFK} = ?`, [
        utilisateurIdReel,
        utilisateurIdLocal,
      ]);
    }
  }
  sauvegarder();
}

/**
 * "Activer en ligne" (voir Réglages > Synchronisation) : enregistre pour de
 * vrai, côté serveur, une boutique jusqu'ici uniquement locale — geste séparé
 * de la création, jamais un préalable. Le mot de passe du Patron est
 * redemandé ici (jamais conservé en clair depuis la création) : le serveur en
 * a besoin pour créer le vrai compte Django.
 */
export async function activerEnLigne(
  usernameAdmin: string,
  passwordAdmin: string,
  patronPassword: string,
  session: Session,
): Promise<Session> {
  const enAttente = lireBoutiqueLocaleEnAttente();
  if (!enAttente) throw new ErreurInscriptionLocale("Aucune boutique hors-ligne en attente sur ce poste.");

  const donnees = await appelerApi("/auth/enregistrer-boutique-locale/", {
    username: usernameAdmin,
    password: passwordAdmin,
    boutique_id: enAttente.boutiqueId,
    boutique_nom: enAttente.boutiqueNom,
    boutique_adresse: enAttente.adresse,
    boutique_telephone: enAttente.telephone,
    boutique_email: enAttente.email,
    boutique_devise: enAttente.devise,
    patron_username: enAttente.patronUsername,
    patron_password: patronPassword,
    patron_email: enAttente.patronEmail,
    patron_telephone: enAttente.patronTelephone,
  });

  const utilisateurIdReel = String(donnees.utilisateur_id);
  reconcilierUtilisateurLocal(enAttente.utilisateurIdLocal, utilisateurIdReel);
  effacerEnAttente();

  const sessionMiseAJour: Session = { ...session, utilisateurId: utilisateurIdReel };
  ouvrirSessionLocale(enAttente.patronUsername, patronPassword, sessionMiseAJour);
  return sessionMiseAJour;
}
