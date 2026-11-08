import fs from "node:fs";
import path from "node:path";
import { app } from "electron";

import { executer, unResultat } from "../db/helpers";
import { sauvegarder } from "../db/index";
import { appelerApi, estErreurReseau } from "./auth";

/**
 * Carte "Gérer abonnement" de l'Espace Admin (voir AccesCreationBoutique.tsx) :
 * agit toujours sur la boutique déjà installée sur ce poste (un poste = une
 * boutique, voir CLAUDE.md), jamais une recherche parmi plusieurs boutiques —
 * pensée pour le cas où l'exploitant est chez le commerçant sans internet
 * (voir soumettreAbonnement ci-dessous).
 */

export interface AbonnementBoutique {
  boutiqueId: string;
  boutiqueNom: string;
  formule: string;
  dateExpirationAbonnement: string | null;
  synchroAutorisee: boolean;
  reseauAutorise: boolean;
  appliMobileAutorisee: boolean;
}

export function obtenirBoutiqueLocale(): AbonnementBoutique | null {
  const ligne = unResultat<{
    id: string;
    nom: string;
    formule: string;
    date_expiration_abonnement: string | null;
    synchro_autorisee: number;
    reseau_autorise: number;
    appli_mobile_autorisee: number | null;
  }>(
    `SELECT id, nom, formule, date_expiration_abonnement, synchro_autorisee, reseau_autorise, appli_mobile_autorisee
     FROM boutiques LIMIT 1`,
  );
  if (!ligne) return null;
  return {
    boutiqueId: ligne.id,
    boutiqueNom: ligne.nom,
    formule: ligne.formule,
    dateExpirationAbonnement: ligne.date_expiration_abonnement,
    synchroAutorisee: Boolean(ligne.synchro_autorisee),
    reseauAutorise: Boolean(ligne.reseau_autorise),
    appliMobileAutorisee: Boolean(ligne.appli_mobile_autorisee),
  };
}

export interface ChampsAbonnement {
  formule?: string;
  dateExpirationAbonnement?: string | null;
  synchroAutorisee?: boolean;
  /** Réseau de la boutique (ordinateurs reliés sans internet). */
  reseauAutorise?: boolean;
  /** Carte « 📱 Appli mobile » dans les Réglages de la boutique. */
  appliMobileAutorisee?: boolean;
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
function appliquerLocalement(boutiqueId: string, champs: ChampsAbonnement): void {
  const colonnes: string[] = [];
  const valeurs: unknown[] = [];
  if (champs.formule !== undefined) {
    colonnes.push("formule");
    valeurs.push(champs.formule);
  }
  if (champs.dateExpirationAbonnement !== undefined) {
    colonnes.push("date_expiration_abonnement");
    valeurs.push(champs.dateExpirationAbonnement);
  }
  if (champs.synchroAutorisee !== undefined) {
    colonnes.push("synchro_autorisee");
    valeurs.push(champs.synchroAutorisee ? 1 : 0);
  }
  if (champs.reseauAutorise !== undefined) {
    colonnes.push("reseau_autorise");
    valeurs.push(champs.reseauAutorise ? 1 : 0);
  }
  if (champs.appliMobileAutorisee !== undefined) {
    colonnes.push("appli_mobile_autorisee");
    valeurs.push(champs.appliMobileAutorisee ? 1 : 0);
  }
  if (colonnes.length === 0) return;
  executer(`UPDATE boutiques SET ${colonnes.map((c) => `${c} = ?`).join(", ")} WHERE id = ?`, [
    ...(valeurs as never[]),
    boutiqueId,
  ]);
  sauvegarder();
}

// --- Modification en attente (écrite hors-ligne, à rejouer vers le serveur au retour du réseau) ---

export interface AbonnementEnAttente {
  boutiqueId: string;
  boutiqueNom: string;
  champs: ChampsAbonnement;
}

function cheminEnAttente(): string {
  return path.join(app.getPath("userData"), "abonnement-en-attente.json");
}

export function lireAbonnementEnAttente(): AbonnementEnAttente | null {
  const chemin = cheminEnAttente();
  if (!fs.existsSync(chemin)) return null;
  try {
    return JSON.parse(fs.readFileSync(chemin, "utf-8"));
  } catch {
    return null;
  }
}

function enregistrerEnAttente(entree: AbonnementEnAttente): void {
  fs.writeFileSync(cheminEnAttente(), JSON.stringify(entree, null, 2));
}

function effacerEnAttente(): void {
  const chemin = cheminEnAttente();
  if (fs.existsSync(chemin)) fs.unlinkSync(chemin);
}

export type ResultatAbonnement = { statut: "synchronise" } | { statut: "horsLigne" };

/**
 * Espace Admin → Gérer abonnement (comptes/views.py::AdminAbonnementBoutiqueView) :
 * détail complet lu sur le serveur, validation / rejet d'un paiement déclaré,
 * code d'activation hors ligne. Internet nécessaire (identifiants admin revérifiés).
 */
export async function detailAbonnementAdmin(
  username: string,
  password: string,
  boutiqueId: string,
  action?: "valider" | "rejeter" | "code",
  params: { demandeId?: string; motif?: string } = {},
): Promise<unknown> {
  return appelerApi("/auth/abonnement-boutique/", {
    username,
    password,
    boutique_id: boutiqueId,
    ...(action ? { action } : {}),
    ...(params.demandeId ? { demande_id: params.demandeId } : {}),
    ...(params.motif ? { motif: params.motif } : {}),
  });
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
  return appelerApi("/auth/reseau-boutique/", { username, password, boutique_id: boutiqueId, ...(action ? { action } : {}) });
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
    await appelerApi("/auth/appliquer-abonnement/", {
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
      ...(champs.nature ? { nature: champs.nature } : {}),
      ...(champs.montant ? { montant: champs.montant } : {}),
      ...(champs.mode ? { mode: champs.mode } : {}),
      ...(champs.reference ? { reference: champs.reference } : {}),
    });
    appliquerLocalement(boutiqueId, champs);
    effacerEnAttente();
    return { statut: "synchronise" };
  } catch (erreur) {
    if (!estErreurReseau(erreur)) throw erreur;
    appliquerLocalement(boutiqueId, champs);
    const precedente = lireAbonnementEnAttente();
    enregistrerEnAttente({
      boutiqueId,
      boutiqueNom,
      champs: precedente?.boutiqueId === boutiqueId ? { ...precedente.champs, ...champs } : champs,
    });
    return { statut: "horsLigne" };
  }
}
