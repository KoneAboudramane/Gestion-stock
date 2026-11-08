import type { AbonnementDetail } from "../api/comptes";
import { estErreurReseau } from "../api/authHorsLigne";
import { ErreurApi, apiFetch, extraireMessageErreur } from "../api/transport";
import { ouvrirBaseDeDonnees } from "../db";
import { listerTout } from "../db/helpers";

/**
 * Port navigateur de client-electron/electron/services/abonnementAdmin.ts.
 * Carte "Gérer abonnement" de l'Espace Admin (voir AccesCreationBoutique.tsx) :
 * agit sur la boutique déjà installée sur ce poste (une seule par navigateur,
 * même hypothèse que côté Electron — un poste = une boutique, voir
 * CLAUDE.md), pensée pour le cas où l'exploitant est chez le commerçant sans
 * internet.
 */

export interface AbonnementBoutique {
  boutiqueId: string;
  boutiqueNom: string;
  formule: string;
  dateExpirationAbonnement: string | null;
  synchroAutorisee: boolean;
  reseauAutorise: boolean;
  appliMobileAutorisee: boolean;
  /** Essai gratuit enregistré sur l'appareil (à part de l'abonnement payé). */
  essaiFormule: string;
  essaiFin: string | null;
}

export async function obtenirBoutiqueInstallee(): Promise<AbonnementBoutique | null> {
  const boutiques = await listerTout("boutiques");
  const boutique = boutiques[0];
  if (!boutique) return null;
  return {
    boutiqueId: boutique.id,
    boutiqueNom: boutique.nom,
    formule: boutique.formule,
    dateExpirationAbonnement: boutique.date_expiration_abonnement,
    synchroAutorisee: Boolean(boutique.synchro_autorisee),
    reseauAutorise: Boolean(boutique.reseau_autorise),
    appliMobileAutorisee: Boolean(boutique.appli_mobile_autorisee),
    essaiFormule: boutique.essai_formule || "",
    essaiFin: boutique.essai_fin || null,
  };
}

export interface ChampsAbonnement {
  formule?: string;
  dateExpirationAbonnement?: string | null;
  synchroAutorisee?: boolean;
  /** Réseau de la boutique (ordinateurs reliés sans internet, application de bureau). */
  reseauAutorise?: boolean;
  /** Carte « 📱 Appli mobile » dans les Réglages de la boutique. */
  appliMobileAutorisee?: boolean;
  /** Essai gratuit : date de fin absolue (null = arrêter l'essai) et sa formule. */
  essaiFin?: string | null;
  essaiFormule?: string;
  /** Inscrits au registre des abonnements avec la nouvelle période (voir comptes/views.py::AppliquerAbonnementView). */
  nature?: "paiement" | "offert" | "ajustement";
  montant?: number;
  mode?: string;
  reference?: string;
}

/**
 * Écrit en local sans jamais passer par `synchronise = 0` : formule /
 * date_expiration_abonnement / synchro_autorisee sont des champs protégés
 * côté serveur (synchronisation/registre.py::champs_proteges) — un push
 * générique les ignorerait silencieusement. L'écriture serveur, quand elle a
 * lieu, passe exclusivement par soumettreAbonnement ci-dessous.
 */
async function appliquerLocalement(boutiqueId: string, champs: ChampsAbonnement): Promise<void> {
  const boutiques = await listerTout("boutiques");
  const boutique = boutiques.find((b) => b.id === boutiqueId);
  if (!boutique) return;
  const db = await ouvrirBaseDeDonnees();
  await db.put("boutiques", {
    ...boutique,
    formule: champs.formule !== undefined ? champs.formule : boutique.formule,
    date_expiration_abonnement:
      champs.dateExpirationAbonnement !== undefined ? champs.dateExpirationAbonnement : boutique.date_expiration_abonnement,
    synchro_autorisee:
      champs.synchroAutorisee !== undefined ? (champs.synchroAutorisee ? 1 : 0) : boutique.synchro_autorisee,
    reseau_autorise:
      champs.reseauAutorise !== undefined ? (champs.reseauAutorise ? 1 : 0) : boutique.reseau_autorise,
    appli_mobile_autorisee:
      champs.appliMobileAutorisee !== undefined ? (champs.appliMobileAutorisee ? 1 : 0) : boutique.appli_mobile_autorisee,
    ...(champs.essaiFin !== undefined
      ? { essai_fin: champs.essaiFin, essai_formule: champs.essaiFin ? champs.essaiFormule ?? "" : "" }
      : {}),
  });
}

// --- Modification en attente (écrite hors-ligne, à rejouer vers le serveur au retour du réseau) ---

export interface AbonnementEnAttente {
  boutiqueId: string;
  boutiqueNom: string;
  champs: ChampsAbonnement;
}

const CLE_EN_ATTENTE = "gestion-stock:abonnement-en-attente";

export function lireAbonnementEnAttente(): AbonnementEnAttente | null {
  try {
    const brut = localStorage.getItem(CLE_EN_ATTENTE);
    return brut ? (JSON.parse(brut) as AbonnementEnAttente) : null;
  } catch {
    return null;
  }
}

function enregistrerEnAttente(entree: AbonnementEnAttente): void {
  localStorage.setItem(CLE_EN_ATTENTE, JSON.stringify(entree));
}

function effacerEnAttente(): void {
  localStorage.removeItem(CLE_EN_ATTENTE);
}

export type ResultatAbonnement = { statut: "synchronise" } | { statut: "horsLigne" };

/** Espace Admin → Gérer abonnement (comptes/views.py::AdminAbonnementBoutiqueView). */
export type AbonnementDetailAdmin = Omit<AbonnementDetail, "demandes"> & {
  demandes: (AbonnementDetail["demandes"][number] & { id?: string })[];
  boutique: {
    id: string;
    nom: string;
    formule: string;
    date_expiration_abonnement: string | null;
    synchro_autorisee: boolean;
    reseau_autorise: boolean;
    appli_mobile_autorisee?: boolean;
    essai_formule?: string;
    essai_fin?: string | null;
    actif: boolean;
  };
  paiements_en_attente: number;
  code: string | null;
};

/** Détail lu sur le serveur ; valider / rejeter un paiement déclaré ; code d'activation (internet nécessaire). */
export async function detailAbonnementAdmin(
  username: string,
  password: string,
  boutiqueId: string,
  action?: "valider" | "rejeter" | "code",
  params: { demandeId?: string; motif?: string } = {},
): Promise<{ succes: true; resultat: AbonnementDetailAdmin } | { succes: false; message: string }> {
  try {
    const reponse = await apiFetch("/auth/abonnement-boutique/", {
      method: "POST",
      body: JSON.stringify({
        username,
        password,
        boutique_id: boutiqueId,
        ...(action ? { action } : {}),
        ...(params.demandeId ? { demande_id: params.demandeId } : {}),
        ...(params.motif ? { motif: params.motif } : {}),
      }),
    });
    if (!reponse.ok) throw new ErreurApi(await extraireMessageErreur(reponse));
    return { succes: true, resultat: await reponse.json() };
  } catch (e) {
    return { succes: false, message: e instanceof Error ? e.message : "Serveur injoignable." };
  }
}

/** Espace Admin → Réseau de la boutique (comptes/views.py::AdminReseauBoutiqueView). */
export interface EtatReseauAdmin {
  reseau_autorise: boolean;
  demandes: {
    date: string;
    demandeur: string;
    note: string;
    statut: "en_attente" | "acceptee" | "refusee";
    statut_libelle: string;
    date_traitement: string | null;
  }[];
}

export async function etatReseauAdmin(
  username: string,
  password: string,
  boutiqueId: string,
  action?: "refuser",
): Promise<EtatReseauAdmin> {
  const reponse = await apiFetch("/auth/reseau-boutique/", {
    method: "POST",
    body: JSON.stringify({ username, password, boutique_id: boutiqueId, ...(action ? { action } : {}) }),
  });
  if (!reponse.ok) throw new ErreurApi(await extraireMessageErreur(reponse));
  return reponse.json();
}

/**
 * Tente toujours le serveur d'abord (identifiants admin revérifiés là-bas,
 * voir comptes/views.py::AppliquerAbonnementView) et n'écrit "en attente"
 * localement que si le réseau est réellement indisponible — le mot de passe
 * admin n'est jamais conservé sur le poste entre les deux étapes : au retour
 * de connexion, Réglages > Synchronisation demande de le ressaisir pour
 * pousser la modification en attente (voir lireAbonnementEnAttente).
 */
export async function soumettreAbonnement(
  username: string,
  password: string,
  boutiqueId: string,
  boutiqueNom: string,
  champs: ChampsAbonnement,
): Promise<ResultatAbonnement> {
  try {
    const reponse = await apiFetch("/auth/appliquer-abonnement/", {
      method: "POST",
      body: JSON.stringify({
        username,
        password,
        boutique_id: boutiqueId,
        ...(champs.formule !== undefined ? { formule: champs.formule } : {}),
        ...(champs.dateExpirationAbonnement !== undefined
          ? { date_expiration_abonnement: champs.dateExpirationAbonnement }
          : {}),
        ...(champs.synchroAutorisee !== undefined ? { synchro_autorisee: champs.synchroAutorisee } : {}),
        ...(champs.reseauAutorise !== undefined ? { reseau_autorise: champs.reseauAutorise } : {}),
        ...(champs.appliMobileAutorisee !== undefined ? { appli_mobile_autorisee: champs.appliMobileAutorisee } : {}),
        ...(champs.essaiFin !== undefined
          ? { essai_fin: champs.essaiFin, ...(champs.essaiFin ? { essai_formule: champs.essaiFormule } : {}) }
          : {}),
        ...(champs.nature ? { nature: champs.nature } : {}),
        ...(champs.montant ? { montant: champs.montant } : {}),
        ...(champs.mode ? { mode: champs.mode } : {}),
        ...(champs.reference ? { reference: champs.reference } : {}),
      }),
    });
    if (!reponse.ok) throw new ErreurApi(await extraireMessageErreur(reponse));
    await appliquerLocalement(boutiqueId, champs);
    effacerEnAttente();
    return { statut: "synchronise" };
  } catch (erreur) {
    if (!estErreurReseau(erreur)) throw erreur;
    await appliquerLocalement(boutiqueId, champs);
    const precedente = lireAbonnementEnAttente();
    enregistrerEnAttente({
      boutiqueId,
      boutiqueNom,
      champs: precedente?.boutiqueId === boutiqueId ? { ...precedente.champs, ...champs } : champs,
    });
    return { statut: "horsLigne" };
  }
}
