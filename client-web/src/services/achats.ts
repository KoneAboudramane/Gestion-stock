import { ouvrirBaseDeDonnees } from "../db";
import { ecrireLigne, maintenant, obtenirLigne, suiviSyncNeuf } from "../db/helpers";
import type {
  CommandeAchatLocale,
  DetteFournisseurLocale,
  FournisseurLocal,
  LigneAchatLocale,
  PaiementDetteFournisseurLocale,
  ReceptionLocale,
} from "../db/schema";
import { appliquerMouvement } from "./stock";
import { enregistrerMouvement } from "./tresorerie";

/**
 * Port navigateur de client-electron/electron/services/achats.ts : une
 * commande calcule ses sous-totaux/total à la saisie, une réception crée une
 * entrée de stock par ligne et une dette fournisseur si non payé.
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

export async function listerFournisseurs(boutiqueId: string): Promise<FournisseurResume[]> {
  const db = await ouvrirBaseDeDonnees();
  const fournisseurs = (await db.getAllFromIndex("fournisseurs", "boutique_id", boutiqueId)).filter((f) => !f.supprime);
  return fournisseurs
    .map((f) => ({ id: f.id, nom: f.nom, telephone: f.telephone, adresse: f.adresse, contact: f.contact }))
    .sort((a, b) => a.nom.localeCompare(b.nom));
}

/**
 * Port de client-electron/electron/services/achats.ts::obtenirDerniersFournisseurs :
 * pour chaque variante, le fournisseur de sa commande la plus récente (pour
 * pré-remplir "Commander" depuis une rupture). Pas d'index par variante_id sur
 * lignes_achat, donc on parcourt les commandes de la boutique triées par date
 * (même patron "itérer et filtrer en JS" que services/stock.ts).
 */
export async function obtenirDerniersFournisseurs(
  boutiqueId: string,
  varianteIds: string[],
): Promise<Record<string, { id: string; nom: string }>> {
  const resultat: Record<string, { id: string; nom: string }> = {};
  if (varianteIds.length === 0) return resultat;
  const idsRestants = new Set(varianteIds);

  const db = await ouvrirBaseDeDonnees();
  const commandes = (await db.getAllFromIndex("commandes_achat", "boutique_id", boutiqueId))
    .filter((c) => !c.supprime)
    .sort((a, b) => (a.date_creation < b.date_creation ? 1 : -1));

  for (const commande of commandes) {
    if (idsRestants.size === 0) break;
    const fournisseur = await obtenirLigne("fournisseurs", commande.fournisseur_id);
    if (!fournisseur) continue;
    const lignes = (await db.getAllFromIndex("lignes_achat", "commande_id", commande.id)).filter((l) => !l.supprime);
    for (const ligne of lignes) {
      if (!idsRestants.has(ligne.variante_id)) continue;
      resultat[ligne.variante_id] = { id: fournisseur.id, nom: fournisseur.nom };
      idsRestants.delete(ligne.variante_id);
    }
  }
  return resultat;
}

export async function creerFournisseur(
  boutiqueId: string,
  nom: string,
  telephone = "",
  adresse = "",
  contact = "",
): Promise<string> {
  if (!nom.trim()) throw new ErreurAchat("Le nom du fournisseur est obligatoire.");
  const id = crypto.randomUUID();
  const fournisseur: FournisseurLocal = {
    id,
    boutique_id: boutiqueId,
    nom: nom.trim(),
    telephone,
    adresse,
    contact,
    ...suiviSyncNeuf(),
  };
  await ecrireLigne("fournisseurs", fournisseur);
  return id;
}

export async function modifierFournisseur(
  id: string,
  champs: Partial<{ nom: string; telephone: string; adresse: string; contact: string }>,
): Promise<void> {
  const fournisseur = await obtenirLigne("fournisseurs", id);
  if (!fournisseur) throw new ErreurAchat("Fournisseur introuvable.");
  await ecrireLigne("fournisseurs", {
    ...fournisseur,
    nom: champs.nom ?? fournisseur.nom,
    telephone: champs.telephone ?? fournisseur.telephone,
    adresse: champs.adresse ?? fournisseur.adresse,
    contact: champs.contact ?? fournisseur.contact,
    date_modification: maintenant(),
    synchronise: 0,
  });
}

// --- Recherche d'articles pour la saisie d'une commande ---

export interface VarianteAchat {
  id: string;
  produitId: string;
  produitNom: string;
  reference: string;
  prixAchat: number;
}

export async function rechercherVariantesAchat(boutiqueId: string, terme: string): Promise<VarianteAchat[]> {
  const termeNormalise = terme.trim().toLowerCase();
  if (!termeNormalise) return [];
  const db = await ouvrirBaseDeDonnees();
  const produits = (await db.getAllFromIndex("produits", "boutique_id", boutiqueId)).filter(
    (p) => !p.supprime && p.nom.toLowerCase().includes(termeNormalise),
  );
  const resultat: VarianteAchat[] = [];
  for (const p of produits) {
    const variantes = (await db.getAllFromIndex("variantes", "produit_id", p.id)).filter((v) => !v.supprime);
    for (const v of variantes) {
      resultat.push({ id: v.id, produitId: p.id, produitNom: p.nom, reference: v.reference, prixAchat: v.prix_achat });
    }
  }
  return resultat;
}

// --- Numérotation ---

async function genererNumeroCommande(boutiqueId: string): Promise<string> {
  const db = await ouvrirBaseDeDonnees();
  const isoJour = new Date().toISOString().slice(0, 10);
  const commandesDuJour = (await db.getAllFromIndex("commandes_achat", "boutique_id", boutiqueId)).filter((c) =>
    c.date_creation.startsWith(isoJour),
  );
  const compteur = commandesDuJour.length + 1;
  return `CMD-${isoJour.replace(/-/g, "")}-${String(compteur).padStart(4, "0")}`;
}

// --- Commandes ---

export interface CommandeResume {
  id: string;
  numero: string;
  dateCreation: string;
  fournisseurId: string;
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
}

export async function listerCommandes(
  boutiqueId: string,
  fournisseurId?: string,
  statut?: StatutCommande,
  terme = "",
): Promise<CommandeResume[]> {
  const db = await ouvrirBaseDeDonnees();
  const commandes = (await db.getAllFromIndex("commandes_achat", "boutique_id", boutiqueId)).filter((c) => !c.supprime);

  const resultat: CommandeResume[] = [];
  for (const c of commandes) {
    const fournisseur = await db.get("fournisseurs", c.fournisseur_id);
    const lignes = (await db.getAllFromIndex("lignes_achat", "commande_id", c.id)).filter((l) => !l.supprime);
    const quantiteCommandee = lignes.reduce((total, l) => total + l.quantite, 0);
    const quantiteRecue = lignes.reduce((total, l) => total + (l.quantite_recue ?? 0), 0);
    const partiellementRecue = c.statut === "commandee" && quantiteRecue > 0;
    resultat.push({
      id: c.id,
      numero: c.numero,
      dateCreation: c.date_creation,
      fournisseurId: c.fournisseur_id,
      fournisseurNom: fournisseur?.nom ?? "",
      statut: c.statut,
      total: c.total,
      partiellementRecue,
      quantiteCommandee,
      quantiteRecue,
    });
  }

  let filtres = resultat;
  if (fournisseurId) filtres = filtres.filter((c) => c.fournisseurId === fournisseurId);
  if (statut) filtres = filtres.filter((c) => c.statut === statut);
  if (terme.trim()) {
    const t = terme.trim().toLowerCase();
    filtres = filtres.filter((c) => c.numero.toLowerCase().includes(t));
  }
  return filtres.sort((a, b) => b.dateCreation.localeCompare(a.dateCreation));
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

export async function obtenirCommande(id: string): Promise<CommandeDetail | undefined> {
  const db = await ouvrirBaseDeDonnees();
  const c = await db.get("commandes_achat", id);
  if (!c || c.supprime) return undefined;
  const fournisseur = await db.get("fournisseurs", c.fournisseur_id);

  const lignesRaw = (await db.getAllFromIndex("lignes_achat", "commande_id", id)).filter((l) => !l.supprime);
  const lignes: LigneAchatDetail[] = [];
  for (const l of lignesRaw) {
    const variante = await db.get("variantes", l.variante_id);
    const produit = variante ? await db.get("produits", variante.produit_id) : undefined;
    lignes.push({
      id: l.id,
      varianteId: l.variante_id,
      produitNom: produit?.nom ?? "",
      reference: variante?.reference ?? "",
      quantite: l.quantite,
      prixAchat: l.prix_achat,
      sousTotal: l.sous_total,
      prixVenteActuel: variante?.prix_vente ?? 0,
      quantiteRecue: l.quantite_recue ?? 0,
    });
  }

  return {
    id: c.id,
    numero: c.numero,
    dateCreation: c.date_creation,
    fournisseurId: c.fournisseur_id,
    fournisseurNom: fournisseur?.nom ?? "",
    statut: c.statut,
    total: c.total,
    lignes,
  };
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

export async function creerCommande(params: ParametresCommande): Promise<{ id: string; numero: string; total: number }> {
  const { boutiqueId, fournisseurId, utilisateurId, statut, lignes } = params;
  if (lignes.length === 0) {
    throw new ErreurAchat("Une commande doit contenir au moins une ligne.");
  }

  const { lignes: lignesCalculees, total } = calculerLignesEtTotal(lignes);
  const db = await ouvrirBaseDeDonnees();
  const numero = await genererNumeroCommande(boutiqueId);
  const commandeId = crypto.randomUUID();

  const commande: CommandeAchatLocale = {
    id: commandeId,
    boutique_id: boutiqueId,
    fournisseur_id: fournisseurId,
    utilisateur_id: utilisateurId,
    numero,
    statut,
    total,
    ...suiviSyncNeuf(),
  };
  await db.put("commandes_achat", commande);

  for (const ligne of lignesCalculees) {
    const ligneAchat: LigneAchatLocale = {
      id: crypto.randomUUID(),
      commande_id: commandeId,
      variante_id: ligne.varianteId,
      quantite: ligne.quantite,
      prix_achat: ligne.prixAchat,
      sous_total: ligne.sousTotal,
      quantite_recue: 0,
      ...suiviSyncNeuf(),
    };
    await db.put("lignes_achat", ligneAchat);
  }

  return { id: commandeId, numero, total };
}

export interface ParametresModifierCommande {
  fournisseurId?: string;
  statut?: StatutCommande;
  lignes?: LigneAchatEntree[];
}

export async function modifierCommande(id: string, champs: ParametresModifierCommande): Promise<void> {
  const db = await ouvrirBaseDeDonnees();
  const commande = await obtenirLigne("commandes_achat", id);
  if (!commande) throw new ErreurAchat("Commande introuvable.");
  if (commande.statut === "recue" || commande.statut === "annulee") {
    throw new ErreurAchat("Cette commande ne peut plus être modifiée.");
  }

  const lignesActuelles = (await db.getAllFromIndex("lignes_achat", "commande_id", id)).filter((l) => !l.supprime);
  const dejaReceptionnee = lignesActuelles.some((l) => (l.quantite_recue ?? 0) > 0);
  if (champs.statut === "annulee" && dejaReceptionnee) {
    throw new ErreurAchat("Cette commande a déjà été partiellement réceptionnée, elle ne peut plus être annulée.");
  }
  if (champs.lignes && dejaReceptionnee) {
    throw new ErreurAchat(
      "Cette commande a déjà été partiellement réceptionnée, ses lignes ne peuvent plus être modifiées.",
    );
  }

  const heure = maintenant();
  let total = commande.total;
  if (champs.lignes) {
    const calcul = calculerLignesEtTotal(champs.lignes);
    total = calcul.total;
    for (const ligne of lignesActuelles) {
      await db.put("lignes_achat", { ...ligne, supprime: 1, synchronise: 0, date_modification: heure });
    }
    for (const ligne of calcul.lignes) {
      const ligneAchat: LigneAchatLocale = {
        id: crypto.randomUUID(),
        commande_id: id,
        variante_id: ligne.varianteId,
        quantite: ligne.quantite,
        prix_achat: ligne.prixAchat,
        sous_total: ligne.sousTotal,
        quantite_recue: 0,
        ...suiviSyncNeuf(),
      };
      await db.put("lignes_achat", ligneAchat);
    }
  }

  await ecrireLigne("commandes_achat", {
    ...commande,
    fournisseur_id: champs.fournisseurId ?? commande.fournisseur_id,
    statut: champs.statut ?? commande.statut,
    total,
    date_modification: heure,
    synchronise: 0,
  });
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
export async function receptionnerCommande(params: ParametresReception): Promise<string> {
  const { commandeId, depotId, utilisateurId, montantDejaPaye = 0, lignes: lignesEntree } = params;
  const db = await ouvrirBaseDeDonnees();
  const commande = await db.get("commandes_achat", commandeId);
  if (!commande) throw new ErreurAchat("Commande introuvable.");
  if (commande.statut !== "commandee") {
    throw new ErreurAchat("Seule une commande au statut 'commandée' peut être réceptionnée.");
  }

  const aReceptionner = lignesEntree.filter((l) => l.quantite > 0);
  if (aReceptionner.length === 0) {
    throw new ErreurAchat("Indiquez au moins une quantité à réceptionner.");
  }

  const lignesCommande = (await db.getAllFromIndex("lignes_achat", "commande_id", commandeId)).filter(
    (l) => !l.supprime,
  );
  const ligneParVariante = new Map(lignesCommande.map((l) => [l.variante_id, l]));

  let valeurRecue = 0;
  for (const donnee of aReceptionner) {
    const ligne = ligneParVariante.get(donnee.varianteId);
    if (!ligne) throw new ErreurAchat("Cette variante ne fait pas partie de la commande.");
    const restant = ligne.quantite - (ligne.quantite_recue ?? 0);
    if (donnee.quantite > restant) {
      throw new ErreurAchat("Quantité reçue supérieure à la quantité restante pour un article.");
    }
    valeurRecue += donnee.quantite * ligne.prix_achat;
  }
  if (montantDejaPaye > valeurRecue) {
    throw new ErreurAchat("Le montant déjà payé ne peut pas dépasser la valeur reçue.");
  }

  const receptionId = crypto.randomUUID();
  const maintenantDate = maintenant();

  for (const donnee of aReceptionner) {
    const ligne = ligneParVariante.get(donnee.varianteId)!;
    const prixAchatReception = ligne.prix_achat;
    let motif = `Réception ${commande.numero}`;

    if (donnee.prixVente !== undefined) {
      const variante = await db.get("variantes", ligne.variante_id);
      if (variante) {
        // CUMP (coût unitaire moyen pondéré) : on pondère le prix d'achat existant par le
        // stock encore présent plutôt que de l'écraser par le dernier prix reçu — sinon la
        // valorisation du stock et le bénéfice des ventes seraient faussés dès que le prix
        // d'achat varie d'une commande à l'autre. Sans stock restant, rien à pondérer : on
        // repart simplement du prix de cette réception.
        const stocks = await db.getAllFromIndex(
          "stocks",
          "variante_depot",
          IDBKeyRange.bound([ligne.variante_id, ""], [ligne.variante_id, "￿"]),
        );
        const stockActuel = stocks.reduce((somme, s) => somme + s.quantite, 0);
        const ancienPrixAchat = variante.prix_achat;
        const nouveauPrixAchat =
          stockActuel > 0
            ? Math.round(
                (stockActuel * ancienPrixAchat + donnee.quantite * prixAchatReception) / (stockActuel + donnee.quantite),
              )
            : prixAchatReception;

        if (donnee.prixVente < nouveauPrixAchat) {
          throw new ErreurAchat("Le prix de vente ne peut pas être inférieur au prix d'achat (CUMP).");
        }

        motif += ` (Prix achat : ${ancienPrixAchat} → ${nouveauPrixAchat} FCFA [CUMP], Prix vente : ${variante.prix_vente} → ${donnee.prixVente} FCFA)`;
        await db.put("variantes", {
          ...variante,
          prix_achat: nouveauPrixAchat,
          prix_vente: donnee.prixVente,
          synchronise: 0,
          date_modification: maintenantDate,
        });
      }
    }

    await appliquerMouvement({
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

    await db.put("lignes_achat", {
      ...ligne,
      quantite_recue: (ligne.quantite_recue ?? 0) + donnee.quantite,
      synchronise: 0,
      date_modification: maintenantDate,
    });
  }

  const reception: ReceptionLocale = {
    id: receptionId,
    commande_id: commandeId,
    depot_id: depotId,
    utilisateur_id: utilisateurId,
    valeur_recue: valeurRecue,
    montant_paye: montantDejaPaye,
    ...suiviSyncNeuf(),
  };
  await db.put("receptions", reception);

  const solde = valeurRecue - montantDejaPaye;
  if (solde > 0) {
    const dette: DetteFournisseurLocale = {
      id: crypto.randomUUID(),
      fournisseur_id: commande.fournisseur_id,
      commande_id: commandeId,
      montant: valeurRecue,
      montant_paye: montantDejaPaye,
      solde,
      statut: "en_cours",
      ...suiviSyncNeuf(),
    };
    await db.put("dettes_fournisseur", dette);
  }

  const lignesApres = (await db.getAllFromIndex("lignes_achat", "commande_id", commandeId)).filter((l) => !l.supprime);
  const totalementRecue = lignesApres.every((l) => (l.quantite_recue ?? 0) >= l.quantite);
  if (totalementRecue) {
    await db.put("commandes_achat", { ...commande, statut: "recue", synchronise: 0, date_modification: maintenantDate });
  }

  return receptionId;
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

export async function listerDettes(boutiqueId: string, fournisseurId?: string, statut?: StatutDette): Promise<DetteResume[]> {
  const db = await ouvrirBaseDeDonnees();
  const fournisseurs = await db.getAllFromIndex("fournisseurs", "boutique_id", boutiqueId);
  const fournisseursParId = new Map(fournisseurs.map((f) => [f.id, f]));

  let dettes = fournisseurId
    ? await db.getAllFromIndex("dettes_fournisseur", "fournisseur_id", fournisseurId)
    : (await db.getAll("dettes_fournisseur")).filter((d) => fournisseursParId.has(d.fournisseur_id));
  dettes = dettes.filter((d) => !d.supprime);
  if (statut) dettes = dettes.filter((d) => d.statut === statut);

  const resultat: DetteResume[] = [];
  for (const d of dettes) {
    const fournisseur = fournisseursParId.get(d.fournisseur_id);
    const commande = d.commande_id ? await db.get("commandes_achat", d.commande_id) : undefined;
    resultat.push({
      id: d.id,
      fournisseurNom: fournisseur?.nom ?? "",
      commandeId: d.commande_id ?? null,
      commandeNumero: commande?.numero ?? null,
      montant: d.montant,
      montantPaye: d.montant_paye,
      solde: d.solde,
      statut: d.statut,
      dateCreation: d.date_creation,
    });
  }
  return resultat.sort((a, b) => b.dateCreation.localeCompare(a.dateCreation));
}

export interface LigneReceptionDetail {
  produitNom: string;
  reference: string;
  quantite: number;
}

export interface ReceptionDetail {
  id: string;
  dateCreation: string;
  depotNom: string;
  valeurRecue: number;
  montantPaye: number;
  lignes: LigneReceptionDetail[];
}

/** Historique des réceptions d'une commande (une par livraison, voir
 * receptionnerCommande) — trié de la plus ancienne à la plus récente, avec
 * les articles livrés à chacune (lus dans les mouvements de stock). */
export async function listerReceptionsCommande(commandeId: string): Promise<ReceptionDetail[]> {
  const db = await ouvrirBaseDeDonnees();
  const receptions = (await db.getAllFromIndex("receptions", "commande_id", commandeId)).filter((r) => !r.supprime);
  const variantesCommande = [
    ...new Set(
      (await db.getAllFromIndex("lignes_achat", "commande_id", commandeId)).filter((l) => !l.supprime).map((l) => l.variante_id),
    ),
  ];

  async function lignesDesMouvements(
    depotId: string,
    referenceType: string,
    referenceId: string,
  ): Promise<LigneReceptionDetail[]> {
    const lignes: LigneReceptionDetail[] = [];
    for (const varianteId of variantesCommande) {
      const quantite = (await db.getAllFromIndex("mouvements_stock", "variante_depot", [varianteId, depotId]))
        .filter(
          (m) => !m.supprime && m.type === "entree" && m.reference_type === referenceType && m.reference_id === referenceId,
        )
        .reduce((total, m) => total + m.quantite, 0);
      if (quantite === 0) continue;
      const variante = await db.get("variantes", varianteId);
      const produit = variante ? await db.get("produits", variante.produit_id) : undefined;
      lignes.push({ produitNom: produit?.nom ?? "", reference: variante?.reference ?? "", quantite });
    }
    return lignes.sort((a, b) => a.produitNom.localeCompare(b.produitNom));
  }

  const resultat: ReceptionDetail[] = [];
  for (const r of receptions) {
    const depot = await db.get("depots", r.depot_id);
    let lignes = await lignesDesMouvements(r.depot_id, "achats.Reception", r.id);
    // Anciennes réceptions : les mouvements étaient référencés sur la
    // commande. Tant qu'il n'y a qu'une réception, ils lui reviennent tous.
    if (lignes.length === 0 && receptions.length === 1) {
      lignes = await lignesDesMouvements(r.depot_id, "achats.CommandeAchat", commandeId);
    }
    resultat.push({
      id: r.id,
      dateCreation: r.date_creation,
      depotNom: depot?.nom ?? "",
      valeurRecue: r.valeur_recue,
      montantPaye: r.montant_paye,
      lignes,
    });
  }
  return resultat.sort((a, b) => a.dateCreation.localeCompare(b.dateCreation));
}

export interface ReceptionHistorique extends ReceptionDetail {
  commandeId: string;
  commandeNumero: string;
  fournisseurNom: string;
}

/** Toutes les réceptions de la boutique, toutes commandes confondues (modale
 * "Historique des réceptions"), de la plus récente à la plus ancienne. */
export async function listerHistoriqueReceptions(
  boutiqueId: string,
  fournisseurId?: string,
  terme = "",
  limite = 200,
): Promise<ReceptionHistorique[]> {
  const db = await ouvrirBaseDeDonnees();
  let commandes = (await db.getAllFromIndex("commandes_achat", "boutique_id", boutiqueId)).filter((c) => !c.supprime);
  if (fournisseurId) commandes = commandes.filter((c) => c.fournisseur_id === fournisseurId);
  if (terme.trim()) {
    const t = terme.trim().toLowerCase();
    commandes = commandes.filter((c) => c.numero.toLowerCase().includes(t));
  }

  const resultat: ReceptionHistorique[] = [];
  for (const c of commandes) {
    const receptions = await listerReceptionsCommande(c.id);
    if (receptions.length === 0) continue;
    const fournisseur = await db.get("fournisseurs", c.fournisseur_id);
    for (const r of receptions) {
      resultat.push({ ...r, commandeId: c.id, commandeNumero: c.numero, fournisseurNom: fournisseur?.nom ?? "" });
    }
  }
  return resultat.sort((a, b) => b.dateCreation.localeCompare(a.dateCreation)).slice(0, limite);
}

export interface PaiementDetteDetail {
  id: string;
  montant: number;
  mode: string;
  dateCreation: string;
}

export async function listerPaiementsDette(detteId: string): Promise<PaiementDetteDetail[]> {
  const db = await ouvrirBaseDeDonnees();
  const paiements = (await db.getAllFromIndex("paiements_dette_fournisseur", "dette_id", detteId)).filter(
    (p) => !p.supprime,
  );
  return paiements
    .map((p) => ({ id: p.id, montant: p.montant, mode: p.mode, dateCreation: p.date_creation }))
    .sort((a, b) => b.dateCreation.localeCompare(a.dateCreation));
}

export async function payerDette(
  detteId: string,
  montant: number,
  mode = "",
  depotId: string | null = null,
  utilisateurId: string | null = null,
): Promise<void> {
  const db = await ouvrirBaseDeDonnees();
  const dette = await db.get("dettes_fournisseur", detteId);
  if (!dette) throw new ErreurAchat("Dette introuvable.");
  if (montant <= 0) {
    throw new ErreurAchat("Le montant payé doit être strictement positif.");
  }
  if (montant > dette.solde) {
    throw new ErreurAchat("Le montant payé ne peut pas dépasser le solde restant.");
  }

  const paiementId = crypto.randomUUID();
  const paiement: PaiementDetteFournisseurLocale = {
    id: paiementId,
    dette_id: detteId,
    montant,
    mode,
    ...suiviSyncNeuf(),
  };
  await db.put("paiements_dette_fournisseur", paiement);

  const nouveauMontantPaye = dette.montant_paye + montant;
  const nouveauSolde = dette.solde - montant;
  await db.put("dettes_fournisseur", {
    ...dette,
    montant_paye: nouveauMontantPaye,
    solde: nouveauSolde,
    statut: nouveauSolde === 0 ? "solde" : "en_cours",
    synchronise: 0,
    date_modification: maintenant(),
  });

  if (mode === "especes" && depotId) {
    const fournisseur = await db.get("fournisseurs", dette.fournisseur_id);
    await enregistrerMouvement({
      depotId,
      type: "sortie",
      categorie: "paiement_dette_fournisseur",
      montant,
      motif: `Paiement dette ${fournisseur?.nom ?? ""}`,
      utilisateurId,
      referenceType: "fournisseurs.PaiementDetteFournisseur",
      referenceId: paiementId,
    });
  }
}
