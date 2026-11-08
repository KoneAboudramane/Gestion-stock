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
  /** Essai gratuit enregistré sur le poste (à part de l'abonnement payé). */
  essaiFormule: string;
  essaiFin: string | null;
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
    essai_formule: string | null;
    essai_fin: string | null;
  }>(
    `SELECT id, nom, formule, date_expiration_abonnement, synchro_autorisee, reseau_autorise, appli_mobile_autorisee,
            essai_formule, essai_fin
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
    essaiFormule: ligne.essai_formule || "",
    essaiFin: ligne.essai_fin || null,
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
  /** Essai gratuit : date de fin absolue (null = arrêter l'essai) et sa formule. */
  essaiFin?: string | null;
  essaiFormule?: string;
  /** Option payante (une par envoi) : jusqu'à optionFin (date absolue), liée à l'abonnement, ou retirée. */
  optionCle?: "en_ligne" | "reseau" | "mobile";
  optionFin?: string | null;
  optionSuit?: boolean;
  optionRetirer?: boolean;
  optionNature?: "paiement" | "offert";
  optionMontant?: number;
  optionMode?: string;
  optionReference?: string;
  /** Option En ligne accordée sans paiement (exception) ; réseau / mobile : reseauAutorise / appliMobileAutorisee. */
  optionEnLigneOfferte?: boolean;
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
  if (champs.essaiFin !== undefined) {
    colonnes.push("essai_fin", "essai_formule");
    valeurs.push(champs.essaiFin, champs.essaiFin ? champs.essaiFormule ?? "" : "");
  }
  if (champs.optionCle) {
    const cle = champs.optionCle;
    colonnes.push(`option_${cle}_fin`, `option_${cle}_suit`);
    valeurs.push(champs.optionRetirer || champs.optionSuit ? null : champs.optionFin ?? null, champs.optionSuit && !champs.optionRetirer ? 1 : 0);
  }
  if (champs.optionEnLigneOfferte !== undefined) {
    colonnes.push("option_en_ligne_offerte");
    valeurs.push(champs.optionEnLigneOfferte ? 1 : 0);
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
  /** Droit au réseau en vigueur (Pro, option payée ou liée, exception) et son origine. */
  droit_reseau?: boolean;
  source_reseau?: "pro" | "payee" | "suit" | "exception" | null;
  fin_reseau?: string | null;
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
      ...(champs.essaiFin !== undefined
        ? { essai_fin: champs.essaiFin, ...(champs.essaiFin ? { essai_formule: champs.essaiFormule } : {}) }
        : {}),
      ...(champs.optionCle
        ? {
            option_cle: champs.optionCle,
            ...(champs.optionRetirer
              ? { option_retirer: true }
              : champs.optionSuit
                ? { option_suit: true }
                : { option_fin: champs.optionFin }),
            option_nature: champs.optionNature ?? "offert",
            ...(champs.optionMontant ? { option_montant: champs.optionMontant } : {}),
            ...(champs.optionMode ? { option_mode: champs.optionMode } : {}),
            ...(champs.optionReference ? { option_reference: champs.optionReference } : {}),
          }
        : {}),
      ...(champs.optionEnLigneOfferte !== undefined ? { option_en_ligne_offerte: champs.optionEnLigneOfferte } : {}),
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
