import { randomUUID } from "node:crypto";

import { dansUneTransaction, executer, tousLesResultats, unResultat } from "../db/helpers";
import { sauvegarder } from "../db/index";
import { appliquerMouvement } from "./stock";

/**
 * Miroir de achats/services.py + fournisseurs/models.py (Django, Étape 5) :
 * une commande calcule ses sous-totaux/total à la saisie, une réception crée
 * une entrée de stock par ligne et une dette fournisseur si non payé.
 */

export class ErreurAchat extends Error {}

export type StatutCommande = "brouillon" | "commandee" | "recue" | "annulee";
export type StatutDette = "en_cours" | "solde";

// --- Fournisseurs ---

export interface FournisseurResume {
  id: string;
  nom: string;
  telephone: string;
  adresse: string;
  contact: string;
}

export function listerFournisseurs(boutiqueId: string): FournisseurResume[] {
  return tousLesResultats<FournisseurResume>(
    "SELECT id, nom, telephone, adresse, contact FROM fournisseurs WHERE boutique_id = ? AND supprime = 0 ORDER BY nom",
    [boutiqueId],
  );
}

/**
 * Dernier fournisseur ayant livré chaque variante (via l'historique des
 * commandes) — sert à pré-remplir le fournisseur suggéré quand on commande
 * plusieurs produits en rupture d'un coup (l'utilisateur peut le changer).
 * Une variante jamais commandée n'apparaît pas dans le résultat.
 */
export function obtenirDerniersFournisseurs(
  boutiqueId: string,
  varianteIds: string[],
): Record<string, { id: string; nom: string }> {
  if (varianteIds.length === 0) return {};
  const placeholders = varianteIds.map(() => "?").join(", ");
  const lignes = tousLesResultats<{
    varianteId: string;
    fournisseurId: string;
    fournisseurNom: string;
    dateCreation: string;
  }>(
    `SELECT la.variante_id as varianteId, ca.fournisseur_id as fournisseurId, f.nom as fournisseurNom,
            ca.date_creation as dateCreation
     FROM lignes_achat la
     JOIN commandes_achat ca ON ca.id = la.commande_id
     JOIN fournisseurs f ON f.id = ca.fournisseur_id
     WHERE ca.boutique_id = ? AND la.variante_id IN (${placeholders}) AND ca.supprime = 0
     ORDER BY ca.date_creation DESC`,
    [boutiqueId, ...varianteIds],
  );

  const resultat: Record<string, { id: string; nom: string }> = {};
  for (const ligne of lignes) {
    // Trié du plus récent au plus ancien : la première occurrence par variante suffit.
    if (!resultat[ligne.varianteId]) {
      resultat[ligne.varianteId] = { id: ligne.fournisseurId, nom: ligne.fournisseurNom };
    }
  }
  return resultat;
}

export function creerFournisseur(
  boutiqueId: string,
  nom: string,
  telephone = "",
  adresse = "",
  contact = "",
): string {
  if (!nom.trim()) throw new ErreurAchat("Le nom du fournisseur est obligatoire.");
  const id = randomUUID();
  const maintenant = new Date().toISOString();
  executer(
    `INSERT INTO fournisseurs (id, boutique_id, nom, telephone, adresse, contact, date_creation, date_modification)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, boutiqueId, nom.trim(), telephone, adresse, contact, maintenant, maintenant],
  );
  sauvegarder();
  return id;
}

export function modifierFournisseur(
  id: string,
  champs: Partial<{ nom: string; telephone: string; adresse: string; contact: string }>,
): void {
  const colonnes = Object.keys(champs);
  if (colonnes.length === 0) return;
  const maintenant = new Date().toISOString();
  const valeurs = colonnes.map((c) => (champs as Record<string, string>)[c]);
  executer(
    `UPDATE fournisseurs SET ${colonnes.map((c) => `${c} = ?`).join(", ")}, synchronise = 0, date_modification = ?
     WHERE id = ?`,
    [...valeurs, maintenant, id],
  );
  sauvegarder();
}

// --- Numérotation ---

function genererNumeroCommande(boutiqueId: string): string {
  const isoJour = new Date().toISOString().slice(0, 10);
  const resultat = unResultat<{ n: number }>(
    "SELECT COUNT(*) as n FROM commandes_achat WHERE boutique_id = ? AND date_creation BETWEEN ? AND ?",
    [boutiqueId, `${isoJour}T00:00:00.000Z`, `${isoJour}T23:59:59.999Z`],
  );
  const compteur = (resultat ? Number(resultat.n) : 0) + 1;
  return `CMD-${isoJour.replace(/-/g, "")}-${String(compteur).padStart(4, "0")}`;
}

// --- Commandes ---

export interface CommandeResume {
  id: string;
  numero: string;
  dateCreation: string;
  fournisseurNom: string;
  statut: StatutCommande;
  total: number;
}

export function listerCommandes(
  boutiqueId: string,
  fournisseurId?: string,
  statut?: StatutCommande,
  terme = "",
  limite = 100,
): CommandeResume[] {
  const conditions = ["c.boutique_id = ?", "c.supprime = 0"];
  const parametres: (string | number)[] = [boutiqueId];
  if (fournisseurId) {
    conditions.push("c.fournisseur_id = ?");
    parametres.push(fournisseurId);
  }
  if (statut) {
    conditions.push("c.statut = ?");
    parametres.push(statut);
  }
  if (terme.trim()) {
    conditions.push("c.numero LIKE ?");
    parametres.push(`%${terme.trim()}%`);
  }
  parametres.push(limite);

  return tousLesResultats<CommandeResume>(
    `SELECT c.id as id, c.numero as numero, c.date_creation as dateCreation,
            f.nom as fournisseurNom, c.statut as statut, c.total as total
     FROM commandes_achat c
     JOIN fournisseurs f ON f.id = c.fournisseur_id
     WHERE ${conditions.join(" AND ")}
     ORDER BY c.date_creation DESC
     LIMIT ?`,
    parametres,
  );
}

export interface LigneAchatDetail {
  id: string;
  varianteId: string;
  produitNom: string;
  reference: string;
  quantite: number;
  prixAchat: number;
  sousTotal: number;
  prixVenteActuel: number;
}

export interface CommandeDetail {
  id: string;
  numero: string;
  dateCreation: string;
  fournisseurId: string;
  fournisseurNom: string;
  statut: StatutCommande;
  total: number;
  lignes: LigneAchatDetail[];
}

export function obtenirCommande(id: string): CommandeDetail | undefined {
  const commande = unResultat<Omit<CommandeDetail, "lignes">>(
    `SELECT c.id as id, c.numero as numero, c.date_creation as dateCreation,
            c.fournisseur_id as fournisseurId, f.nom as fournisseurNom,
            c.statut as statut, c.total as total
     FROM commandes_achat c
     JOIN fournisseurs f ON f.id = c.fournisseur_id
     WHERE c.id = ? AND c.supprime = 0`,
    [id],
  );
  if (!commande) return undefined;

  const lignes = tousLesResultats<LigneAchatDetail>(
    `SELECT la.id as id, la.variante_id as varianteId, p.nom as produitNom, va.reference as reference,
            la.quantite as quantite, la.prix_achat as prixAchat, la.sous_total as sousTotal,
            va.prix_vente as prixVenteActuel
     FROM lignes_achat la
     JOIN variantes va ON va.id = la.variante_id
     JOIN produits p ON p.id = va.produit_id
     WHERE la.commande_id = ? AND la.supprime = 0`,
    [id],
  );

  return { ...commande, lignes };
}

export interface LigneAchatEntree {
  varianteId: string;
  quantite: number;
  prixAchat: number;
}

export interface ParametresCommande {
  boutiqueId: string;
  fournisseurId: string;
  utilisateurId: string | null;
  statut: StatutCommande;
  lignes: LigneAchatEntree[];
}

function calculerLignesEtTotal(lignes: LigneAchatEntree[]): { lignes: (LigneAchatEntree & { sousTotal: number })[]; total: number } {
  let total = 0;
  const lignesCalculees = lignes.map((ligne) => {
    const sousTotal = Math.round(ligne.quantite * ligne.prixAchat);
    total += sousTotal;
    return { ...ligne, sousTotal };
  });
  return { lignes: lignesCalculees, total };
}

export function creerCommande(params: ParametresCommande): { id: string; numero: string; total: number } {
  const { boutiqueId, fournisseurId, utilisateurId, statut, lignes } = params;
  if (lignes.length === 0) {
    throw new ErreurAchat("Une commande doit contenir au moins une ligne.");
  }

  const { lignes: lignesCalculees, total } = calculerLignesEtTotal(lignes);

  const resultat = dansUneTransaction(() => {
    const numero = genererNumeroCommande(boutiqueId);
    const commandeId = randomUUID();
    const maintenant = new Date().toISOString();

    executer(
      `INSERT INTO commandes_achat
         (id, boutique_id, fournisseur_id, utilisateur_id, numero, statut, total, date_creation, date_modification)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [commandeId, boutiqueId, fournisseurId, utilisateurId, numero, statut, total, maintenant, maintenant],
    );

    for (const ligne of lignesCalculees) {
      executer(
        `INSERT INTO lignes_achat (id, commande_id, variante_id, quantite, prix_achat, sous_total, date_creation, date_modification)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [randomUUID(), commandeId, ligne.varianteId, ligne.quantite, ligne.prixAchat, ligne.sousTotal, maintenant, maintenant],
      );
    }

    return { id: commandeId, numero, total };
  });

  sauvegarder();
  return resultat;
}

export interface ParametresModifierCommande {
  fournisseurId?: string;
  statut?: StatutCommande;
  lignes?: LigneAchatEntree[];
}

export function modifierCommande(id: string, champs: ParametresModifierCommande): void {
  const commande = unResultat<{ statut: string }>("SELECT statut FROM commandes_achat WHERE id = ?", [id]);
  if (!commande) throw new ErreurAchat("Commande introuvable.");
  if (commande.statut === "recue" || commande.statut === "annulee") {
    throw new ErreurAchat("Cette commande ne peut plus être modifiée.");
  }

  dansUneTransaction(() => {
    const maintenant = new Date().toISOString();
    let total: number | undefined;
    if (champs.lignes) {
      const calcul = calculerLignesEtTotal(champs.lignes);
      total = calcul.total;
      executer("DELETE FROM lignes_achat WHERE commande_id = ?", [id]);
      for (const ligne of calcul.lignes) {
        executer(
          `INSERT INTO lignes_achat (id, commande_id, variante_id, quantite, prix_achat, sous_total, date_creation, date_modification)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [randomUUID(), id, ligne.varianteId, ligne.quantite, ligne.prixAchat, ligne.sousTotal, maintenant, maintenant],
        );
      }
    }

    const colonnes: string[] = [];
    const valeurs: (string | number)[] = [];
    if (champs.fournisseurId) {
      colonnes.push("fournisseur_id = ?");
      valeurs.push(champs.fournisseurId);
    }
    if (champs.statut) {
      colonnes.push("statut = ?");
      valeurs.push(champs.statut);
    }
    if (total !== undefined) {
      colonnes.push("total = ?");
      valeurs.push(total);
    }
    colonnes.push("synchronise = 0", "date_modification = ?");
    valeurs.push(maintenant);

    executer(`UPDATE commandes_achat SET ${colonnes.join(", ")} WHERE id = ?`, [...valeurs, id]);
  });

  sauvegarder();
}

export interface LigneReceptionPrix {
  varianteId: string;
  prixVente: number;
}

export interface ParametresReception {
  commandeId: string;
  depotId: string;
  utilisateurId: string | null;
  montantDejaPaye?: number;
  lignesPrix?: LigneReceptionPrix[];
}

export function receptionnerCommande(params: ParametresReception): string {
  const { commandeId, depotId, utilisateurId, montantDejaPaye = 0, lignesPrix = [] } = params;
  const commande = unResultat<{ numero: string; statut: string; total: number; fournisseur_id: string }>(
    "SELECT numero, statut, total, fournisseur_id FROM commandes_achat WHERE id = ?",
    [commandeId],
  );
  if (!commande) throw new ErreurAchat("Commande introuvable.");
  if (commande.statut !== "commandee") {
    throw new ErreurAchat("Seule une commande au statut 'commandée' peut être réceptionnée.");
  }
  if (montantDejaPaye > Number(commande.total)) {
    throw new ErreurAchat("Le montant déjà payé ne peut pas dépasser le total de la commande.");
  }

  const prixVenteParVariante = new Map(lignesPrix.map((l) => [l.varianteId, l.prixVente]));
  const receptionId = randomUUID();

  dansUneTransaction(() => {
    const maintenant = new Date().toISOString();
    const lignes = tousLesResultats<{ variante_id: string; quantite: number; prix_achat: number }>(
      "SELECT variante_id, quantite, prix_achat FROM lignes_achat WHERE commande_id = ?",
      [commandeId],
    );
    for (const ligne of lignes) {
      const prixAchatReception = Number(ligne.prix_achat);
      const nouveauPrixVente = prixVenteParVariante.get(ligne.variante_id);
      let motif = `Réception ${commande.numero}`;

      if (nouveauPrixVente !== undefined) {
        const variante = unResultat<{ prix_achat: number; prix_vente: number }>(
          "SELECT prix_achat, prix_vente FROM variantes WHERE id = ?",
          [ligne.variante_id],
        );
        if (variante) {
          // CUMP (coût unitaire moyen pondéré) : on pondère le prix d'achat existant par le
          // stock encore présent plutôt que de l'écraser par le dernier prix reçu — sinon la
          // valorisation du stock et le bénéfice des ventes seraient faussés dès que le prix
          // d'achat varie d'une commande à l'autre. Sans stock restant, rien à pondérer : on
          // repart simplement du prix de cette réception.
          const stockActuel = Number(
            unResultat<{ total: number }>("SELECT COALESCE(SUM(quantite), 0) as total FROM stocks WHERE variante_id = ?", [
              ligne.variante_id,
            ])?.total ?? 0,
          );
          const ancienPrixAchat = Number(variante.prix_achat);
          const quantiteRecue = Number(ligne.quantite);
          const nouveauPrixAchat =
            stockActuel > 0
              ? Math.round(
                  (stockActuel * ancienPrixAchat + quantiteRecue * prixAchatReception) / (stockActuel + quantiteRecue),
                )
              : prixAchatReception;

          if (nouveauPrixVente < nouveauPrixAchat) {
            throw new ErreurAchat("Le prix de vente ne peut pas être inférieur au prix d'achat (CUMP).");
          }

          motif += ` (Prix achat : ${ancienPrixAchat} → ${nouveauPrixAchat} FCFA [CUMP], Prix vente : ${Number(variante.prix_vente)} → ${nouveauPrixVente} FCFA)`;
          executer(
            "UPDATE variantes SET prix_achat = ?, prix_vente = ?, synchronise = 0, date_modification = ? WHERE id = ?",
            [nouveauPrixAchat, nouveauPrixVente, maintenant, ligne.variante_id],
          );
        }
      }

      appliquerMouvement({
        varianteId: ligne.variante_id,
        depotId,
        type: "entree",
        quantite: Number(ligne.quantite),
        motif,
        utilisateurId,
        referenceType: "achats.CommandeAchat",
        referenceId: commandeId,
      });
    }

    executer(
      `INSERT INTO receptions (id, commande_id, depot_id, utilisateur_id, date_creation, date_modification)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [receptionId, commandeId, depotId, utilisateurId, maintenant, maintenant],
    );

    const total = Number(commande.total);
    const solde = total - montantDejaPaye;
    if (solde > 0) {
      executer(
        `INSERT INTO dettes_fournisseur
           (id, fournisseur_id, commande_id, montant, montant_paye, solde, statut, date_creation, date_modification)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [randomUUID(), commande.fournisseur_id, commandeId, total, montantDejaPaye, solde, "en_cours", maintenant, maintenant],
      );
    }

    executer(
      "UPDATE commandes_achat SET statut = 'recue', synchronise = 0, date_modification = ? WHERE id = ?",
      [maintenant, commandeId],
    );
  });

  sauvegarder();
  return receptionId;
}

// --- Dettes fournisseur ---

export interface DetteResume {
  id: string;
  fournisseurNom: string;
  commandeNumero: string | null;
  montant: number;
  montantPaye: number;
  solde: number;
  statut: StatutDette;
  dateCreation: string;
}

export function listerDettes(boutiqueId: string, fournisseurId?: string, statut?: StatutDette): DetteResume[] {
  const conditions = ["f.boutique_id = ?", "d.supprime = 0"];
  const parametres: string[] = [boutiqueId];
  if (fournisseurId) {
    conditions.push("d.fournisseur_id = ?");
    parametres.push(fournisseurId);
  }
  if (statut) {
    conditions.push("d.statut = ?");
    parametres.push(statut);
  }

  return tousLesResultats<DetteResume>(
    `SELECT d.id as id, f.nom as fournisseurNom, c.numero as commandeNumero,
            d.montant as montant, d.montant_paye as montantPaye, d.solde as solde,
            d.statut as statut, d.date_creation as dateCreation
     FROM dettes_fournisseur d
     JOIN fournisseurs f ON f.id = d.fournisseur_id
     LEFT JOIN commandes_achat c ON c.id = d.commande_id
     WHERE ${conditions.join(" AND ")}
     ORDER BY d.date_creation DESC`,
    parametres,
  );
}

export function payerDette(detteId: string, montant: number): void {
  const dette = unResultat<{ montant_paye: number; solde: number }>(
    "SELECT montant_paye, solde FROM dettes_fournisseur WHERE id = ?",
    [detteId],
  );
  if (!dette) throw new ErreurAchat("Dette introuvable.");
  if (montant <= 0) {
    throw new ErreurAchat("Le montant payé doit être strictement positif.");
  }
  if (montant > Number(dette.solde)) {
    throw new ErreurAchat("Le montant payé ne peut pas dépasser le solde restant.");
  }

  const nouveauMontantPaye = Number(dette.montant_paye) + montant;
  const nouveauSolde = Number(dette.solde) - montant;
  const maintenant = new Date().toISOString();

  executer(
    `UPDATE dettes_fournisseur SET montant_paye = ?, solde = ?, statut = ?, synchronise = 0, date_modification = ?
     WHERE id = ?`,
    [nouveauMontantPaye, nouveauSolde, nouveauSolde === 0 ? "solde" : "en_cours", maintenant, detteId],
  );
  sauvegarder();
}
