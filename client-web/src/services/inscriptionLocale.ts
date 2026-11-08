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

/** Essai gratuit de 15 jours à l'ouverture (même durée que comptes/services.py::DUREE_ESSAI). */
const DUREE_ESSAI_JOURS = 15;

function finEssai(): string {
  return new Date(Date.now() + DUREE_ESSAI_JOURS * 86_400_000).toISOString();
}

export class ErreurInscriptionLocale extends Error {}

/** Options choisies dans l'assistant « Créer une boutique » (sinon : essai gratuit, 100 % local, réseau non activé). */
export interface OptionsCreationBoutique {
  formule: string;
  /** Fin de la période choisie (payée, offerte ou essai) ; null = essai gratuit de 15 jours. */
  dateFin: string | null;
  nature?: "paiement" | "offert" | "essai";
  montant?: number;
  mode?: string;
  reference?: string;
  synchroAutorisee: boolean;
  reseauAutorise: boolean;
  /** Carte « 📱 Appli mobile » dans les Réglages de la boutique. */
  appliMobileAutorisee?: boolean;
}

/** Assistant « Créer une boutique » (Inscription.tsx). */
export interface ParametresCreationBoutique {
  boutiqueNom: string;
  telephone?: string;
  adresse?: string;
  devise?: string;
  username: string;
  password: string;
  email: string;
  patronTelephone?: string;
  prenom?: string;
  nom?: string;
  doitChanger?: boolean;
  options?: OptionsCreationBoutique;
}

/** Corps commun de /auth/enregistrer-boutique-locale/ (création en ligne et « Activer en ligne »). */
function corpsEnregistrement(boutiqueId: string, p: ParametresCreationBoutique): Record<string, unknown> {
  const o = p.options;
  return {
    boutique_id: boutiqueId,
    boutique_nom: p.boutiqueNom,
    boutique_adresse: p.adresse ?? "",
    boutique_telephone: p.telephone ?? "",
    boutique_email: p.email,
    boutique_devise: p.devise || "FCFA",
    patron_username: p.username,
    patron_password: p.password,
    patron_email: p.email,
    patron_telephone: p.patronTelephone ?? "",
    patron_first_name: p.prenom ?? "",
    patron_last_name: p.nom ?? "",
    patron_doit_changer: !!p.doitChanger,
    ...(o
      ? {
          formule: o.formule,
          synchro_autorisee: o.synchroAutorisee,
          reseau_autorise: o.reseauAutorise,
          appli_mobile_autorisee: !!o.appliMobileAutorisee,
          ...(o.dateFin
            ? {
                date_fin: o.dateFin,
                nature: o.nature ?? "offert",
                ...(o.nature === "paiement" ? { montant: o.montant ?? 0, mode: o.mode ?? "", reference: o.reference ?? "" } : {}),
              }
            : {}),
        }
      : {}),
  };
}

/** Ligne de la boutique sur cet appareil, avec ses options. */
async function ecrireBoutiqueLocale(boutiqueId: string, p: ParametresCreationBoutique, synchronise: 0 | 1): Promise<void> {
  const maintenantIso = maintenant();
  const o = p.options;
  await ecrireLigne("boutiques", {
    id: boutiqueId,
    nom: p.boutiqueNom,
    adresse: p.adresse ?? "",
    telephone: p.telephone ?? "",
    email: p.email,
    devise: p.devise || "FCFA",
    actif: 1,
    date_expiration_abonnement: o?.dateFin ?? finEssai(),
    formule: o?.formule ?? "essentiel",
    synchro_autorisee: o?.synchroAutorisee ? 1 : 0,
    reseau_autorise: o?.reseauAutorise ? 1 : 0,
    appli_mobile_autorisee: o?.appliMobileAutorisee ? 1 : 0,
    date_creation: maintenantIso,
    date_modification: maintenantIso,
    synchronise,
    supprime: 0,
    date_synchronisation: null,
  });
}

/** Assistant : l'identifiant du patron est-il libre ? null sans internet. */
export async function identifiantDisponible(usernameAdmin: string, passwordAdmin: string, identifiant: string): Promise<boolean | null> {
  try {
    const reponse = await apiFetch("/auth/identifiant-disponible/", {
      method: "POST",
      body: JSON.stringify({ username: usernameAdmin, password: passwordAdmin, identifiant }),
    });
    if (!reponse.ok) return null;
    return Boolean((await reponse.json())?.disponible);
  } catch {
    return null;
  }
}

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
  patronPrenom?: string;
  patronNom?: string;
  patronDoitChanger?: boolean;
  options?: OptionsCreationBoutique;
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
export async function creerBoutiqueLocale(params: ParametresCreationBoutique): Promise<Session> {
  const dejaInstallee = await listerTout("boutiques");
  if (dejaInstallee.length > 0) {
    throw new ErreurInscriptionLocale("Ce poste est déjà utilisé pour une boutique existante.");
  }

  const boutiqueId = crypto.randomUUID();
  const utilisateurIdLocal = crypto.randomUUID();
  await ecrireBoutiqueLocale(boutiqueId, params, 0);

  enregistrerEnAttente({
    boutiqueId,
    utilisateurIdLocal,
    boutiqueNom: params.boutiqueNom,
    adresse: params.adresse ?? "",
    telephone: params.telephone ?? "",
    email: params.email,
    devise: params.devise || "FCFA",
    patronUsername: params.username,
    patronEmail: params.email,
    patronTelephone: params.patronTelephone ?? "",
    patronPrenom: params.prenom ?? "",
    patronNom: params.nom ?? "",
    patronDoitChanger: !!params.doitChanger,
    options: params.options,
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
    synchroAutorisee: !!params.options?.synchroAutorisee,
    doitChangerMotDePasse: params.doitChanger || undefined,
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
  params: ParametresCreationBoutique,
): Promise<ResultatCreationEnLigne> {
  const dejaInstallee = await listerTout("boutiques");
  if (dejaInstallee.length > 0) {
    throw new ErreurInscriptionLocale("Ce poste est déjà utilisé pour une boutique existante.");
  }

  const boutiqueId = crypto.randomUUID();
  try {
    const reponse = await apiFetch("/auth/enregistrer-boutique-locale/", {
      method: "POST",
      body: JSON.stringify({ username: usernameAdmin, password: passwordAdmin, ...corpsEnregistrement(boutiqueId, params) }),
    });
    if (!reponse.ok) throw new ErreurApi(await extraireMessageErreur(reponse));
    const donnees = await reponse.json();

    const utilisateurId = String(donnees.utilisateur_id);
    await ecrireBoutiqueLocale(boutiqueId, params, 1);

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
      synchroAutorisee: !!params.options?.synchroAutorisee,
      doitChangerMotDePasse: params.doitChanger || undefined,
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
      ...corpsEnregistrement(enAttente.boutiqueId, {
        boutiqueNom: enAttente.boutiqueNom,
        adresse: enAttente.adresse,
        telephone: enAttente.telephone,
        devise: enAttente.devise,
        username: enAttente.patronUsername,
        password: patronPassword,
        email: enAttente.patronEmail,
        patronTelephone: enAttente.patronTelephone,
        prenom: enAttente.patronPrenom,
        nom: enAttente.patronNom,
        doitChanger: enAttente.patronDoitChanger,
        options: enAttente.options,
      }),
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
