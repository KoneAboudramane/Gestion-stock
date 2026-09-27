import { randomUUID } from "node:crypto";

import { dansUneTransaction, executer, tousLesResultats, unResultat } from "../db/helpers";
import { sauvegarder } from "../db/index";
import { appliquerMouvement } from "./stock";
import { enregistrerMouvement } from "./tresorerie";

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
  /** Commande encore "commandee" dont au moins une ligne a déjà été livrée
   * — simple affichage (badge), pas un statut stocké. */
  partiellementRecue: boolean;
  /** Somme des quantités commandées / déjà reçues sur toutes les lignes
   * (colonne "Reste à recevoir" de l'onglet Réceptionner). */
  quantiteCommandee: number;
  quantiteRecue: number;
  /** Qui a passé la commande. */
  utilisateurId: string | null;
  /** Valeur des réceptions non annulées de la commande. */
  valeurRecue: number;
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

  return tousLesResultats<Omit<CommandeResume, "partiellementRecue"> & { partiellementRecue: number }>(
    `SELECT c.id as id, c.numero as numero, c.date_creation as dateCreation,
            f.nom as fournisseurNom, c.statut as statut, c.total as total,
            (c.statut = 'commandee' AND EXISTS (
               SELECT 1 FROM lignes_achat la
               WHERE la.commande_id = c.id AND la.supprime = 0 AND la.quantite_recue > 0
            )) as partiellementRecue,
            (SELECT COALESCE(SUM(la.quantite), 0) FROM lignes_achat la
             WHERE la.commande_id = c.id AND la.supprime = 0) as quantiteCommandee,
            (SELECT COALESCE(SUM(la.quantite_recue), 0) FROM lignes_achat la
             WHERE la.commande_id = c.id AND la.supprime = 0) as quantiteRecue,
            c.utilisateur_id as utilisateurId,
            (SELECT COALESCE(SUM(r.valeur_recue), 0) FROM receptions r
             WHERE r.commande_id = c.id AND r.supprime = 0 AND COALESCE(r.annulee, 0) = 0) as valeurRecue
     FROM commandes_achat c
     JOIN fournisseurs f ON f.id = c.fournisseur_id
     WHERE ${conditions.join(" AND ")}
     ORDER BY c.date_creation DESC
     LIMIT ?`,
    parametres,
  ).map((c) => ({
    ...c,
    partiellementRecue: Boolean(c.partiellementRecue),
    quantiteCommandee: Number(c.quantiteCommandee),
    quantiteRecue: Number(c.quantiteRecue),
    valeurRecue: Number(c.valeurRecue),
  }));
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
  quantiteRecue: number;
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
            va.prix_vente as prixVenteActuel, la.quantite_recue as quantiteRecue
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

  const dejaReceptionnee =
    (unResultat<{ n: number }>("SELECT COUNT(*) as n FROM lignes_achat WHERE commande_id = ? AND quantite_recue > 0", [
      id,
    ])?.n ?? 0) > 0;
  if (champs.statut === "annulee" && dejaReceptionnee) {
    throw new ErreurAchat("Cette commande a déjà été partiellement réceptionnée, elle ne peut plus être annulée.");
  }
  if (champs.lignes && dejaReceptionnee) {
    throw new ErreurAchat(
      "Cette commande a déjà été partiellement réceptionnée, ses lignes ne peuvent plus être modifiées.",
    );
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

export interface LigneReceptionEntree {
  varianteId: string;
  quantite: number;
  prixVente?: number;
}

export interface ParametresReception {
  commandeId: string;
  depotId: string;
  utilisateurId: string | null;
  montantDejaPaye?: number;
  lignes: LigneReceptionEntree[];
}

/**
 * Réceptionne tout ou partie d'une commande : `lignes` porte la quantité
 * effectivement livrée pour chaque variante (réception partielle possible sur
 * plusieurs livraisons). La commande ne repasse au statut "recue" que
 * lorsque toutes ses lignes ont atteint leur quantité commandée.
 */
export function receptionnerCommande(params: ParametresReception): string {
  const { commandeId, depotId, utilisateurId, montantDejaPaye = 0, lignes: lignesEntree } = params;
  const commande = unResultat<{ numero: string; statut: string; fournisseur_id: string }>(
    "SELECT numero, statut, fournisseur_id FROM commandes_achat WHERE id = ?",
    [commandeId],
  );
  if (!commande) throw new ErreurAchat("Commande introuvable.");
  if (commande.statut !== "commandee") {
    throw new ErreurAchat("Seule une commande au statut 'commandée' peut être réceptionnée.");
  }

  const aReceptionner = lignesEntree.filter((l) => l.quantite > 0);
  if (aReceptionner.length === 0) {
    throw new ErreurAchat("Indiquez au moins une quantité à réceptionner.");
  }

  const lignesCommande = tousLesResultats<{
    id: string;
    variante_id: string;
    quantite: number;
    quantite_recue: number;
    prix_achat: number;
  }>("SELECT id, variante_id, quantite, quantite_recue, prix_achat FROM lignes_achat WHERE commande_id = ?", [
    commandeId,
  ]);
  const ligneParVariante = new Map(lignesCommande.map((l) => [l.variante_id, l]));

  let valeurRecue = 0;
  for (const donnee of aReceptionner) {
    const ligne = ligneParVariante.get(donnee.varianteId);
    if (!ligne) throw new ErreurAchat("Cette variante ne fait pas partie de la commande.");
    const restant = Number(ligne.quantite) - Number(ligne.quantite_recue);
    if (donnee.quantite > restant) {
      throw new ErreurAchat("Quantité reçue supérieure à la quantité restante pour un article.");
    }
    valeurRecue += donnee.quantite * Number(ligne.prix_achat);
  }
  if (montantDejaPaye > valeurRecue) {
    throw new ErreurAchat("Le montant déjà payé ne peut pas dépasser la valeur reçue.");
  }

  const receptionId = randomUUID();

  dansUneTransaction(() => {
    const maintenant = new Date().toISOString();

    for (const donnee of aReceptionner) {
      const ligne = ligneParVariante.get(donnee.varianteId)!;
      const prixAchatReception = Number(ligne.prix_achat);
      let motif = `Réception ${commande.numero}`;

      if (donnee.prixVente !== undefined) {
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
          const nouveauPrixAchat =
            stockActuel > 0
              ? Math.round(
                  (stockActuel * ancienPrixAchat + donnee.quantite * prixAchatReception) / (stockActuel + donnee.quantite),
                )
              : prixAchatReception;

          if (donnee.prixVente < nouveauPrixAchat) {
            throw new ErreurAchat("Le prix de vente ne peut pas être inférieur au prix d'achat (CUMP).");
          }

          motif += ` (Prix achat : ${ancienPrixAchat} → ${nouveauPrixAchat} FCFA [CUMP], Prix vente : ${Number(variante.prix_vente)} → ${donnee.prixVente} FCFA)`;
          executer(
            "UPDATE variantes SET prix_achat = ?, prix_vente = ?, synchronise = 0, date_modification = ? WHERE id = ?",
            [nouveauPrixAchat, donnee.prixVente, maintenant, ligne.variante_id],
          );
        }
      }

      appliquerMouvement({
        varianteId: ligne.variante_id,
        depotId,
        type: "entree",
        quantite: donnee.quantite,
        motif,
        utilisateurId,
        // Référencé sur la réception (pas la commande) pour pouvoir
        // retrouver ce qui a été livré à chaque livraison, voir
        // listerReceptionsCommande.
        referenceType: "achats.Reception",
        referenceId: receptionId,
      });

      executer(
        "UPDATE lignes_achat SET quantite_recue = quantite_recue + ?, synchronise = 0, date_modification = ? WHERE id = ?",
        [donnee.quantite, maintenant, ligne.id],
      );
    }

    executer(
      `INSERT INTO receptions (id, commande_id, depot_id, utilisateur_id, valeur_recue, montant_paye, date_creation, date_modification)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [receptionId, commandeId, depotId, utilisateurId, valeurRecue, montantDejaPaye, maintenant, maintenant],
    );

    const solde = valeurRecue - montantDejaPaye;
    if (solde > 0) {
      executer(
        `INSERT INTO dettes_fournisseur
           (id, fournisseur_id, commande_id, reception_id, montant, montant_paye, solde, statut, date_creation, date_modification)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          randomUUID(),
          commande.fournisseur_id,
          commandeId,
          receptionId,
          valeurRecue,
          montantDejaPaye,
          solde,
          "en_cours",
          maintenant,
          maintenant,
        ],
      );
    }

    const totalementRecue = tousLesResultats<{ n: number }>(
      "SELECT COUNT(*) as n FROM lignes_achat WHERE commande_id = ? AND quantite_recue < quantite",
      [commandeId],
    )[0]?.n === 0;
    if (totalementRecue) {
      executer(
        "UPDATE commandes_achat SET statut = 'recue', synchronise = 0, date_modification = ? WHERE id = ?",
        [maintenant, commandeId],
      );
    }
  });

  sauvegarder();
  return receptionId;
}

export interface LigneReceptionDetail {
  varianteId: string;
  produitNom: string;
  reference: string;
  quantite: number;
  /** Déjà renvoyé au fournisseur (retours). */
  quantiteRetournee: number;
}

export interface RetourFournisseurDetail {
  id: string;
  dateCreation: string;
  motif: string;
  montant: number;
  avoir: number;
  utilisateurId: string | null;
  lignes: { produitNom: string; quantite: number }[];
}

export interface ReceptionDetail {
  id: string;
  dateCreation: string;
  depotNom: string;
  valeurRecue: number;
  montantPaye: number;
  lignes: LigneReceptionDetail[];
  annulee: boolean;
  utilisateurId: string | null;
  retours: RetourFournisseurDetail[];
}

function lignesDesMouvements(referenceType: string, referenceId: string): Omit<LigneReceptionDetail, "quantiteRetournee">[] {
  return tousLesResultats<Omit<LigneReceptionDetail, "quantiteRetournee">>(
    `SELECT m.variante_id as varianteId, p.nom as produitNom, COALESCE(va.reference, '') as reference, SUM(m.quantite) as quantite
     FROM mouvements_stock m
     JOIN variantes va ON va.id = m.variante_id
     JOIN produits p ON p.id = va.produit_id
     WHERE m.reference_type = ? AND m.reference_id = ? AND m.type = 'entree' AND m.supprime = 0
     GROUP BY m.variante_id, p.nom, va.reference
     ORDER BY p.nom`,
    [referenceType, referenceId],
  );
}

/** Historique des réceptions d'une commande (une par livraison, voir
 * receptionnerCommande) — trié de la plus ancienne à la plus récente, avec
 * les articles livrés à chacune (lus dans les mouvements de stock). */
/** Complète une réception : quantités déjà retournées par article, retours
 * fournisseur faits sur cette réception. */
function completerReception<T extends { id: string; annulee: number | boolean }>(
  r: T,
  lignes: Omit<LigneReceptionDetail, "quantiteRetournee">[],
): Omit<T, "annulee"> & { annulee: boolean; lignes: LigneReceptionDetail[]; retours: RetourFournisseurDetail[] } {
  const retournees = dejaRetourne(r.id);
  const retours = tousLesResultats<Omit<RetourFournisseurDetail, "lignes">>(
    `SELECT id, date_creation as dateCreation, COALESCE(motif, '') as motif, montant, avoir, utilisateur_id as utilisateurId
     FROM retours_fournisseur WHERE reception_id = ? AND supprime = 0 ORDER BY date_creation ASC`,
    [r.id],
  ).map((retour) => ({
    ...retour,
    montant: Number(retour.montant),
    avoir: Number(retour.avoir),
    lignes: tousLesResultats<{ produitNom: string; quantite: number }>(
      `SELECT p.nom as produitNom, lr.quantite as quantite
       FROM lignes_retour_fournisseur lr
       JOIN variantes v ON v.id = lr.variante_id
       JOIN produits p ON p.id = v.produit_id
       WHERE lr.retour_id = ? AND lr.supprime = 0`,
      [retour.id],
    ).map((l) => ({ ...l, quantite: Number(l.quantite) })),
  }));
  return {
    ...r,
    annulee: Boolean(Number(r.annulee)),
    lignes: lignes.map((l) => ({ ...l, quantite: Number(l.quantite), quantiteRetournee: retournees.get(l.varianteId) ?? 0 })),
    retours,
  };
}

export function listerReceptionsCommande(commandeId: string): ReceptionDetail[] {
  const receptions = tousLesResultats<
    Omit<ReceptionDetail, "lignes" | "annulee" | "retours"> & { annulee: number }
  >(
    `SELECT r.id as id, r.date_creation as dateCreation, d.nom as depotNom,
            r.valeur_recue as valeurRecue, r.montant_paye as montantPaye,
            COALESCE(r.annulee, 0) as annulee, r.utilisateur_id as utilisateurId
     FROM receptions r
     JOIN depots d ON d.id = r.depot_id
     WHERE r.commande_id = ? AND r.supprime = 0
     ORDER BY r.date_creation ASC`,
    [commandeId],
  );
  return receptions.map((r) => {
    let lignes = lignesDesMouvements("achats.Reception", r.id);
    // Anciennes réceptions : les mouvements étaient référencés sur la
    // commande. Tant qu'il n'y a qu'une réception, ils lui reviennent tous.
    if (lignes.length === 0 && receptions.length === 1) {
      lignes = lignesDesMouvements("achats.CommandeAchat", commandeId);
    }
    return completerReception(r, lignes);
  });
}

export interface ReceptionHistorique extends ReceptionDetail {
  commandeId: string;
  commandeNumero: string;
  fournisseurNom: string;
}

/** Toutes les réceptions de la boutique, toutes commandes confondues (modale
 * "Historique des réceptions"), de la plus récente à la plus ancienne. */
export function listerHistoriqueReceptions(
  boutiqueId: string,
  fournisseurId?: string,
  terme = "",
  limite = 200,
): ReceptionHistorique[] {
  const conditions = ["c.boutique_id = ?", "r.supprime = 0", "c.supprime = 0"];
  const parametres: (string | number)[] = [boutiqueId];
  if (fournisseurId) {
    conditions.push("c.fournisseur_id = ?");
    parametres.push(fournisseurId);
  }
  if (terme.trim()) {
    conditions.push("c.numero LIKE ?");
    parametres.push(`%${terme.trim()}%`);
  }
  parametres.push(limite);

  const receptions = tousLesResultats<
    Omit<ReceptionHistorique, "lignes" | "annulee" | "retours"> & { nbReceptions: number; annulee: number }
  >(
    `SELECT r.id as id, r.date_creation as dateCreation, d.nom as depotNom,
            r.valeur_recue as valeurRecue, r.montant_paye as montantPaye,
            COALESCE(r.annulee, 0) as annulee, r.utilisateur_id as utilisateurId,
            c.id as commandeId, c.numero as commandeNumero, f.nom as fournisseurNom,
            (SELECT COUNT(*) FROM receptions r2 WHERE r2.commande_id = c.id AND r2.supprime = 0) as nbReceptions
     FROM receptions r
     JOIN commandes_achat c ON c.id = r.commande_id
     JOIN fournisseurs f ON f.id = c.fournisseur_id
     JOIN depots d ON d.id = r.depot_id
     WHERE ${conditions.join(" AND ")}
     ORDER BY r.date_creation DESC
     LIMIT ?`,
    parametres,
  );
  return receptions.map(({ nbReceptions, ...r }) => {
    let lignes = lignesDesMouvements("achats.Reception", r.id);
    // Même repli que listerReceptionsCommande pour les anciennes réceptions.
    if (lignes.length === 0 && Number(nbReceptions) === 1) {
      lignes = lignesDesMouvements("achats.CommandeAchat", r.commandeId);
    }
    return completerReception(r, lignes);
  });
}

export interface PaiementFournisseurHistorique {
  id: string;
  dateCreation: string;
  fournisseurNom: string;
  commandeId: string | null;
  commandeNumero: string | null;
  montant: number;
  mode: string;
  /** Payé sur place à la réception, ou règlement d'une dette ensuite. */
  origine: "reception" | "dette";
  /** Paiement fait à une réception annulée depuis (hors totaux). */
  annulee: boolean;
}

export interface RetourFournisseurHistorique {
  id: string;
  dateCreation: string;
  commandeId: string;
  commandeNumero: string;
  fournisseurNom: string;
  depotNom: string;
  motif: string;
  montant: number;
  avoir: number;
  /** Quantité totale renvoyée. */
  quantite: number;
  utilisateurId: string | null;
}

/** Tout l'historique des achats de la boutique (carte « Historique » d'Achats & fournisseurs). */
export interface HistoriqueAchats {
  commandes: CommandeResume[];
  receptions: ReceptionHistorique[];
  paiements: PaiementFournisseurHistorique[];
  retours: RetourFournisseurHistorique[];
}

/** Sans limite de nombre : l'écran filtre ensuite par période, fournisseur et numéro. */
export function historiqueAchats(boutiqueId: string): HistoriqueAchats {
  const commandes = listerCommandes(boutiqueId, undefined, undefined, "", 1_000_000);
  const receptions = listerHistoriqueReceptions(boutiqueId, undefined, "", 1_000_000);
  const reglements = tousLesResultats<Omit<PaiementFournisseurHistorique, "origine" | "annulee">>(
    `SELECT p.id as id, p.date_creation as dateCreation, f.nom as fournisseurNom,
            d.commande_id as commandeId, c.numero as commandeNumero, p.montant as montant,
            COALESCE(p.mode, '') as mode
     FROM paiements_dette_fournisseur p
     JOIN dettes_fournisseur d ON d.id = p.dette_id
     JOIN fournisseurs f ON f.id = d.fournisseur_id
     LEFT JOIN commandes_achat c ON c.id = d.commande_id
     WHERE f.boutique_id = ? AND p.supprime = 0 AND d.supprime = 0`,
    [boutiqueId],
  );
  const paiements: PaiementFournisseurHistorique[] = [
    ...receptions
      .filter((r) => r.montantPaye > 0)
      .map((r) => ({
        id: `reception-${r.id}`,
        dateCreation: r.dateCreation,
        fournisseurNom: r.fournisseurNom,
        commandeId: r.commandeId,
        commandeNumero: r.commandeNumero,
        montant: r.montantPaye,
        mode: "",
        origine: "reception" as const,
        annulee: r.annulee,
      })),
    ...reglements.map((p) => ({ ...p, montant: Number(p.montant), origine: "dette" as const, annulee: false })),
  ].sort((a, b) => b.dateCreation.localeCompare(a.dateCreation));
  const retours = tousLesResultats<RetourFournisseurHistorique>(
    `SELECT rf.id as id, rf.date_creation as dateCreation, c.id as commandeId, c.numero as commandeNumero,
            f.nom as fournisseurNom, d.nom as depotNom, COALESCE(rf.motif, '') as motif,
            rf.montant as montant, rf.avoir as avoir, rf.utilisateur_id as utilisateurId,
            (SELECT COALESCE(SUM(l.quantite), 0) FROM lignes_retour_fournisseur l
             WHERE l.retour_id = rf.id AND l.supprime = 0) as quantite
     FROM retours_fournisseur rf
     JOIN commandes_achat c ON c.id = rf.commande_id
     JOIN fournisseurs f ON f.id = c.fournisseur_id
     JOIN depots d ON d.id = rf.depot_id
     WHERE c.boutique_id = ? AND rf.supprime = 0
     ORDER BY rf.date_creation DESC`,
    [boutiqueId],
  ).map((r) => ({ ...r, montant: Number(r.montant), avoir: Number(r.avoir), quantite: Number(r.quantite) }));
  return { commandes, receptions, paiements, retours };
}

// --- Annulation de réception et retour fournisseur (miroir de achats/services.py) ---

/** Quantités livrées à cette réception, par variante (lues dans ses mouvements d'entrée). */
function lignesRecues(receptionId: string): Map<string, number> {
  const quantites = new Map<string, number>();
  for (const m of tousLesResultats<{ variante_id: string; quantite: number }>(
    "SELECT variante_id, quantite FROM mouvements_stock WHERE reference_type = 'achats.Reception' AND reference_id = ? AND type = 'entree' AND supprime = 0",
    [receptionId],
  )) {
    quantites.set(m.variante_id, (quantites.get(m.variante_id) ?? 0) + Number(m.quantite));
  }
  return quantites;
}

function dejaRetourne(receptionId: string): Map<string, number> {
  const quantites = new Map<string, number>();
  for (const l of tousLesResultats<{ variante_id: string; quantite: number }>(
    `SELECT lr.variante_id, lr.quantite FROM lignes_retour_fournisseur lr
     JOIN retours_fournisseur r ON r.id = lr.retour_id
     WHERE r.reception_id = ? AND lr.supprime = 0 AND r.supprime = 0`,
    [receptionId],
  )) {
    quantites.set(l.variante_id, (quantites.get(l.variante_id) ?? 0) + Number(l.quantite));
  }
  return quantites;
}

interface DetteReception {
  id: string;
  montant: number;
  montant_paye: number;
  solde: number;
}

/** Dette créée par cette réception (lien direct, ou pour une réception ancienne :
 * la dette de la commande de même montant, sans lien). */
function detteDeLaReception(reception: { id: string; commande_id: string; valeur_recue: number }): DetteReception | undefined {
  return (
    unResultat<DetteReception>(
      "SELECT id, montant, montant_paye, solde FROM dettes_fournisseur WHERE reception_id = ? AND supprime = 0",
      [reception.id],
    ) ??
    unResultat<DetteReception>(
      `SELECT id, montant, montant_paye, solde FROM dettes_fournisseur
       WHERE commande_id = ? AND (reception_id IS NULL OR reception_id = '') AND montant = ? AND supprime = 0
       ORDER BY date_creation LIMIT 1`,
      [reception.commande_id, Number(reception.valeur_recue)],
    )
  );
}

/** Sortie de marchandise renvoyée : le coût moyen est recalculé à l'envers. */
function retirerDuStockEtDuCump(
  varianteId: string,
  depotId: string,
  quantite: number,
  prixAchat: number,
  motif: string,
  utilisateurId: string | null,
  referenceType: string,
  referenceId: string,
): void {
  const stockDepot = Number(
    unResultat<{ quantite: number }>("SELECT quantite FROM stocks WHERE variante_id = ? AND depot_id = ?", [
      varianteId,
      depotId,
    ])?.quantite ?? 0,
  );
  if (stockDepot < quantite) {
    const nom = unResultat<{ nom: string }>(
      "SELECT p.nom as nom FROM variantes v JOIN produits p ON p.id = v.produit_id WHERE v.id = ?",
      [varianteId],
    )?.nom;
    throw new ErreurAchat(`${nom ?? "Article"} : plus assez de stock dans ce dépôt (déjà vendu ?).`);
  }
  const stockTotal = Number(
    unResultat<{ total: number }>("SELECT COALESCE(SUM(quantite), 0) as total FROM stocks WHERE variante_id = ?", [varianteId])
      ?.total ?? 0,
  );
  const reste = stockTotal - quantite;
  if (reste > 0) {
    const cump = Number(unResultat<{ prix_achat: number }>("SELECT prix_achat FROM variantes WHERE id = ?", [varianteId])?.prix_achat ?? 0);
    const nouveauCump = Math.round((stockTotal * cump - quantite * prixAchat) / reste);
    if (nouveauCump > 0) {
      executer("UPDATE variantes SET prix_achat = ?, synchronise = 0, date_modification = ? WHERE id = ?", [
        nouveauCump,
        new Date().toISOString(),
        varianteId,
      ]);
    }
  }
  appliquerMouvement({ varianteId, depotId, type: "sortie", quantite, motif, utilisateurId, referenceType, referenceId });
}

/**
 * Réception saisie par erreur : la marchandise ressort, la commande attend de
 * nouveau ces quantités, la dette de la réception est soldée à zéro. Refusée
 * si la marchandise n'est plus en stock ou si la dette a déjà reçu un
 * règlement après la réception. Renvoie le montant payé sur place à récupérer.
 */
export function annulerReception(receptionId: string, utilisateurId: string | null): { montantARecuperer: number } {
  const reception = unResultat<{ id: string; commande_id: string; depot_id: string; valeur_recue: number; montant_paye: number; annulee: number }>(
    "SELECT id, commande_id, depot_id, valeur_recue, montant_paye, COALESCE(annulee, 0) as annulee FROM receptions WHERE id = ?",
    [receptionId],
  );
  if (!reception) throw new ErreurAchat("Réception introuvable.");
  if (Number(reception.annulee)) throw new ErreurAchat("Cette réception est déjà annulée.");
  const quantites = lignesRecues(receptionId);
  if (quantites.size === 0) {
    throw new ErreurAchat("Réception trop ancienne : ses articles ne sont pas tracés, annulation impossible.");
  }
  if (dejaRetourne(receptionId).size > 0) {
    throw new ErreurAchat("Des articles de cette réception ont déjà été retournés au fournisseur.");
  }
  const dette = detteDeLaReception(reception);
  if (dette && Number(dette.montant_paye) > Number(reception.montant_paye)) {
    throw new ErreurAchat("Un règlement a déjà été fait sur la dette de cette réception : annulation impossible.");
  }
  const commande = unResultat<{ numero: string; statut: string }>("SELECT numero, statut FROM commandes_achat WHERE id = ?", [
    reception.commande_id,
  ])!;

  dansUneTransaction(() => {
    const maintenant = new Date().toISOString();
    for (const [varianteId, quantite] of quantites) {
      const ligne = unResultat<{ id: string; prix_achat: number; quantite_recue: number }>(
        "SELECT id, prix_achat, quantite_recue FROM lignes_achat WHERE commande_id = ? AND variante_id = ? AND supprime = 0",
        [reception.commande_id, varianteId],
      )!;
      retirerDuStockEtDuCump(
        varianteId,
        reception.depot_id,
        quantite,
        Number(ligne.prix_achat),
        `Annulation réception ${commande.numero}`,
        utilisateurId,
        "achats.Reception",
        receptionId,
      );
      executer("UPDATE lignes_achat SET quantite_recue = ?, synchronise = 0, date_modification = ? WHERE id = ?", [
        Math.max(0, Number(ligne.quantite_recue) - quantite),
        maintenant,
        ligne.id,
      ]);
    }
    if (dette) {
      executer(
        "UPDATE dettes_fournisseur SET montant = montant_paye, solde = 0, statut = 'solde', synchronise = 0, date_modification = ? WHERE id = ?",
        [maintenant, dette.id],
      );
    }
    if (commande.statut === "recue") {
      executer("UPDATE commandes_achat SET statut = 'commandee', synchronise = 0, date_modification = ? WHERE id = ?", [
        maintenant,
        reception.commande_id,
      ]);
    }
    executer("UPDATE receptions SET annulee = 1, date_annulation = ?, synchronise = 0, date_modification = ? WHERE id = ?", [
      maintenant,
      maintenant,
      receptionId,
    ]);
  });
  sauvegarder();
  return { montantARecuperer: Number(reception.montant_paye) };
}

export interface ParametresRetourFournisseur {
  receptionId: string;
  lignes: { varianteId: string; quantite: number }[];
  motif?: string;
  utilisateurId: string | null;
}

/**
 * Renvoie une partie des articles d'une réception. La dette de la réception
 * baisse du montant retourné (au prix d'achat de la commande) ; ce qui dépasse
 * son solde devient un avoir à récupérer auprès du fournisseur.
 */
export function retournerAuFournisseur(params: ParametresRetourFournisseur): { montant: number; avoir: number } {
  const { receptionId, utilisateurId } = params;
  const reception = unResultat<{ id: string; commande_id: string; depot_id: string; valeur_recue: number; annulee: number }>(
    "SELECT id, commande_id, depot_id, valeur_recue, COALESCE(annulee, 0) as annulee FROM receptions WHERE id = ?",
    [receptionId],
  );
  if (!reception) throw new ErreurAchat("Réception introuvable.");
  if (Number(reception.annulee)) throw new ErreurAchat("Cette réception est annulée.");
  const lignes = params.lignes.filter((l) => l.quantite > 0);
  if (lignes.length === 0) throw new ErreurAchat("Indiquez au moins une quantité à retourner.");
  const recues = lignesRecues(receptionId);
  const retournees = dejaRetourne(receptionId);
  const commande = unResultat<{ numero: string }>("SELECT numero FROM commandes_achat WHERE id = ?", [reception.commande_id])!;

  const resultat = dansUneTransaction(() => {
    const maintenant = new Date().toISOString();
    const retourId = randomUUID();
    executer(
      `INSERT INTO retours_fournisseur
         (id, commande_id, reception_id, depot_id, motif, montant, avoir, utilisateur_id, date_creation, date_modification)
       VALUES (?, ?, ?, ?, ?, 0, 0, ?, ?, ?)`,
      [retourId, reception.commande_id, receptionId, reception.depot_id, (params.motif ?? "").trim(), utilisateurId, maintenant, maintenant],
    );
    let montant = 0;
    for (const donnee of lignes) {
      const ligne = unResultat<{ prix_achat: number }>(
        "SELECT prix_achat FROM lignes_achat WHERE commande_id = ? AND variante_id = ? AND supprime = 0",
        [reception.commande_id, donnee.varianteId],
      );
      const disponible = (recues.get(donnee.varianteId) ?? 0) - (retournees.get(donnee.varianteId) ?? 0);
      if (!ligne || donnee.quantite > disponible) {
        throw new ErreurAchat("On ne peut pas retourner plus que ce qui a été reçu.");
      }
      retirerDuStockEtDuCump(
        donnee.varianteId,
        reception.depot_id,
        donnee.quantite,
        Number(ligne.prix_achat),
        `Retour fournisseur ${commande.numero}`,
        utilisateurId,
        "achats.RetourFournisseur",
        retourId,
      );
      const sousTotal = Math.round(donnee.quantite * Number(ligne.prix_achat));
      executer(
        `INSERT INTO lignes_retour_fournisseur
           (id, retour_id, variante_id, quantite, prix_achat, sous_total, date_creation, date_modification)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [randomUUID(), retourId, donnee.varianteId, donnee.quantite, Number(ligne.prix_achat), sousTotal, maintenant, maintenant],
      );
      montant += sousTotal;
    }
    const dette = detteDeLaReception(reception);
    const deduit = dette ? Math.min(montant, Number(dette.solde)) : 0;
    if (dette && deduit > 0) {
      const nouveauSolde = Number(dette.solde) - deduit;
      executer(
        `UPDATE dettes_fournisseur SET montant = montant - ?, solde = ?, statut = ?, synchronise = 0, date_modification = ?
         WHERE id = ?`,
        [deduit, nouveauSolde, nouveauSolde <= 0 ? "solde" : "en_cours", maintenant, dette.id],
      );
    }
    executer("UPDATE retours_fournisseur SET montant = ?, avoir = ? WHERE id = ?", [montant, montant - deduit, retourId]);
    return { montant, avoir: montant - deduit };
  });
  sauvegarder();
  return resultat;
}

// --- Dettes fournisseur ---

export interface DetteResume {
  id: string;
  fournisseurNom: string;
  commandeId: string | null;
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
    `SELECT d.id as id, f.nom as fournisseurNom, d.commande_id as commandeId, c.numero as commandeNumero,
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

export interface PaiementDetteDetail {
  id: string;
  montant: number;
  mode: string;
  dateCreation: string;
}

export function listerPaiementsDette(detteId: string): PaiementDetteDetail[] {
  return tousLesResultats<PaiementDetteDetail>(
    "SELECT id, montant, mode, date_creation as dateCreation FROM paiements_dette_fournisseur WHERE dette_id = ? AND supprime = 0 ORDER BY date_creation DESC",
    [detteId],
  );
}

export function payerDette(
  detteId: string,
  montant: number,
  mode = "",
  depotId: string | null = null,
  utilisateurId: string | null = null,
): void {
  const dette = unResultat<{ montant_paye: number; solde: number; fournisseur_nom: string }>(
    `SELECT d.montant_paye as montant_paye, d.solde as solde, f.nom as fournisseur_nom
     FROM dettes_fournisseur d JOIN fournisseurs f ON f.id = d.fournisseur_id WHERE d.id = ?`,
    [detteId],
  );
  if (!dette) throw new ErreurAchat("Dette introuvable.");
  if (montant <= 0) {
    throw new ErreurAchat("Le montant payé doit être strictement positif.");
  }
  if (montant > Number(dette.solde)) {
    throw new ErreurAchat("Le montant payé ne peut pas dépasser le solde restant.");
  }

  dansUneTransaction(() => {
    const maintenant = new Date().toISOString();
    const paiementId = randomUUID();
    executer(
      `INSERT INTO paiements_dette_fournisseur (id, dette_id, montant, mode, date_creation, date_modification)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [paiementId, detteId, montant, mode, maintenant, maintenant],
    );

    const nouveauMontantPaye = Number(dette.montant_paye) + montant;
    const nouveauSolde = Number(dette.solde) - montant;
    executer(
      `UPDATE dettes_fournisseur SET montant_paye = ?, solde = ?, statut = ?, synchronise = 0, date_modification = ?
       WHERE id = ?`,
      [nouveauMontantPaye, nouveauSolde, nouveauSolde === 0 ? "solde" : "en_cours", maintenant, detteId],
    );

    if (mode === "especes" && depotId) {
      enregistrerMouvement({
        depotId,
        type: "sortie",
        categorie: "paiement_dette_fournisseur",
        montant,
        motif: `Paiement dette ${dette.fournisseur_nom}`,
        utilisateurId,
        referenceType: "fournisseurs.PaiementDetteFournisseur",
        referenceId: paiementId,
      });
    }
  });

  sauvegarder();
}
