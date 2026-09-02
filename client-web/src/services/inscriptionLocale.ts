import type { Session } from "../api/auth";
import { ouvrirSessionLocale } from "../api/auth";
import { estErreurReseau } from "../api/authHorsLigne";
import { ErreurApi, apiFetch, extraireMessageErreur } from "../api/transport";
import { ecrireLigne, listerTout, maintenant } from "../db/helpers";
import { REGISTRE_CLIENT } from "../db/registre";

/**
 * Port navigateur de client-electron/electron/services/inscriptionLocale.ts.
 * "Créer une boutique" hors-ligne, depuis l'Espace Admin (voir Inscription.tsx) :
 * contrairement à l'ancien flux (DemandeInscription, en attente de validation
 * par email), la boutique est créée directement en local — utilisable tout de
 * suite, exactement comme n'importe quelle boutique déjà installée (voir
 * CLAUDE.md : IndexedDB local = source de vérité). "Activer en ligne" plus
 * tard (voir activerEnLigne ci-dessous) est un geste séparé, jamais un préalable.
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

// Doit rester identique à la constante dupliquée dans api/auth.ts (même
// clé localStorage, lue là-bas pour savoir si la connexion doit rester
// locale — évite un import circulaire entre les deux modules).
const CLE_EN_ATTENTE = "gestion-stock:boutique-locale-en-attente";

export function lireBoutiqueLocaleEnAttente(): BoutiqueLocaleEnAttente | null {
  try {
    const brut = localStorage.getItem(CLE_EN_ATTENTE);
    return brut ? (JSON.parse(brut) as BoutiqueLocaleEnAttente) : null;
  } catch {
    return null;
  }
}

function enregistrerEnAttente(entree: BoutiqueLocaleEnAttente): void {
  localStorage.setItem(CLE_EN_ATTENTE, JSON.stringify(entree));
}

function effacerEnAttente(): void {
  localStorage.removeItem(CLE_EN_ATTENTE);
}

/**
 * Un poste = une boutique (voir CLAUDE.md, même hypothèse que
 * services/abonnementAdmin.ts) : bloque la création si ce navigateur sert
 * déjà à une boutique existante, pour ne jamais mélanger deux boutiques dans
 * la même base locale.
 */
export async function creerBoutiqueLocale(params: {
  boutiqueNom: string;
  username: string;
  password: string;
  email: string;
}): Promise<Session> {
  const dejaInstallee = await listerTout("boutiques");
  if (dejaInstallee.length > 0) {
    throw new ErreurInscriptionLocale("Ce poste est déjà utilisé pour une boutique existante.");
  }

  const boutiqueId = crypto.randomUUID();
  const utilisateurIdLocal = crypto.randomUUID();
  const maintenantIso = maintenant();

  await ecrireLigne("boutiques", {
    id: boutiqueId,
    nom: params.boutiqueNom,
    adresse: "",
    telephone: "",
    email: params.email,
    devise: "FCFA",
    actif: 1,
    date_expiration_abonnement: null,
    formule: "essentiel",
    synchro_autorisee: 0,
    date_creation: maintenantIso,
    date_modification: maintenantIso,
    synchronise: 0,
    supprime: 0,
    date_synchronisation: null,
  });

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
  await ouvrirSessionLocale(params.username, params.password, session);

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
  const dejaInstallee = await listerTout("boutiques");
  if (dejaInstallee.length > 0) {
    throw new ErreurInscriptionLocale("Ce poste est déjà utilisé pour une boutique existante.");
  }

  const boutiqueId = crypto.randomUUID();
  try {
    const reponse = await apiFetch("/auth/enregistrer-boutique-locale/", {
      method: "POST",
      body: JSON.stringify({
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
      }),
    });
    if (!reponse.ok) throw new ErreurApi(await extraireMessageErreur(reponse));
    const donnees = await reponse.json();

    const utilisateurId = String(donnees.utilisateur_id);
    const maintenantIso = maintenant();
    await ecrireLigne("boutiques", {
      id: boutiqueId,
      nom: params.boutiqueNom,
      adresse: "",
      telephone: "",
      email: params.email,
      devise: "FCFA",
      actif: 1,
      date_expiration_abonnement: null,
      formule: "essentiel",
      synchro_autorisee: 0,
      date_creation: maintenantIso,
      date_modification: maintenantIso,
      synchronise: 1,
      supprime: 0,
      date_synchronisation: null,
    });

    const session: Session = {
      accessToken: "",
      refreshToken: "",
      utilisateurId,
      username: params.username,
      boutiqueId,
      boutiqueNom: params.boutiqueNom,
      role: "Patron",
      permissions: PERMISSIONS_PATRON,
      depotId: null,
      depotNom: null,
      synchroAutorisee: false,
    };
    await ouvrirSessionLocale(params.username, params.password, session);
    return { statut: "enLigne", session };
  } catch (erreur) {
    if (!estErreurReseau(erreur)) throw erreur;
    return { statut: "horsLigne", session: await creerBoutiqueLocale(params) };
  }
}

/**
 * Remplace l'id local provisoire du Patron par le vrai id (AutoField) que le
 * serveur vient d'attribuer, partout où il a pu être utilisé comme référence
 * "utilisateur" (ventes, mouvements de stock, dépenses...) pendant la période
 * hors-ligne — sans ça, ces lignes déjà créées pointeraient vers un id que le
 * serveur ne connaît pas et échoueraient au premier push après activation.
 */
async function reconcilierUtilisateurLocal(utilisateurIdLocal: string, utilisateurIdReel: string): Promise<void> {
  for (const entree of REGISTRE_CLIENT) {
    if (!entree.champsFK.includes("utilisateur") && !entree.champsFK.includes("utilisateur_source")) continue;
    const lignes = (await listerTout(entree.store)) as Record<string, unknown>[];
    for (const ligne of lignes) {
      let modifie = false;
      const copie = { ...ligne };
      if (copie.utilisateur_id === utilisateurIdLocal) {
        copie.utilisateur_id = utilisateurIdReel;
        modifie = true;
      }
      if (copie.utilisateur_source_id === utilisateurIdLocal) {
        copie.utilisateur_source_id = utilisateurIdReel;
        modifie = true;
      }
      if (modifie) await ecrireLigne(entree.store, copie as never);
    }
  }
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

  const reponse = await apiFetch("/auth/enregistrer-boutique-locale/", {
    method: "POST",
    body: JSON.stringify({
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
    }),
  });
  if (!reponse.ok) throw new ErreurApi(await extraireMessageErreur(reponse));
  const donnees = await reponse.json();

  const utilisateurIdReel = String(donnees.utilisateur_id);
  await reconcilierUtilisateurLocal(enAttente.utilisateurIdLocal, utilisateurIdReel);
  effacerEnAttente();

  const sessionMiseAJour: Session = { ...session, utilisateurId: utilisateurIdReel };
  await ouvrirSessionLocale(enAttente.patronUsername, patronPassword, sessionMiseAJour);
  return sessionMiseAJour;
}
