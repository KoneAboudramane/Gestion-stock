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
  };
}

export interface ChampsAbonnement {
  formule?: string;
  dateExpirationAbonnement?: string | null;
  synchroAutorisee?: boolean;
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
      }),
    });
    if (!reponse.ok) throw new ErreurApi(await extraireMessageErreur(reponse));
    await appliquerLocalement(boutiqueId, champs);
    effacerEnAttente();
    return { statut: "synchronise" };
  } catch (erreur) {
    if (!estErreurReseau(erreur)) throw erreur;
    await appliquerLocalement(boutiqueId, champs);
    enregistrerEnAttente({ boutiqueId, boutiqueNom, champs });
    return { statut: "horsLigne" };
  }
}
