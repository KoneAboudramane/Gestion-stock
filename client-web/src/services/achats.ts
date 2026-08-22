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
    resultat.push({
      id: c.id,
      numero: c.numero,
      dateCreation: c.date_creation,
      fournisseurId: c.fournisseur_id,
      fournisseurNom: fournisseur?.nom ?? "",
      statut: c.statut,
      total: c.total,
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
      ...suiviSyncNeuf(),
    };
    await db.put("lignes_achat", ligneAchat);
  }

  return { id: commandeId, numero, total };
}

export interface ParametresModifierCommande {
  fournisseurId?: string;
  statut?: StatutCommande;
}

export async function modifierCommande(id: string, champs: ParametresModifierCommande): Promise<void> {
  const commande = await obtenirLigne("commandes_achat", id);
  if (!commande) throw new ErreurAchat("Commande introuvable.");
  if (commande.statut === "recue" || commande.statut === "annulee") {
    throw new ErreurAchat("Cette commande ne peut plus être modifiée.");
  }
  await ecrireLigne("commandes_achat", {
    ...commande,
    fournisseur_id: champs.fournisseurId ?? commande.fournisseur_id,
    statut: champs.statut ?? commande.statut,
    date_modification: maintenant(),
    synchronise: 0,
  });
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

export async function receptionnerCommande(params: ParametresReception): Promise<string> {
  const { commandeId, depotId, utilisateurId, montantDejaPaye = 0, lignesPrix = [] } = params;
  const db = await ouvrirBaseDeDonnees();
  const commande = await db.get("commandes_achat", commandeId);
  if (!commande) throw new ErreurAchat("Commande introuvable.");
  if (commande.statut !== "commandee") {
    throw new ErreurAchat("Seule une commande au statut 'commandée' peut être réceptionnée.");
  }
  if (montantDejaPaye > commande.total) {
    throw new ErreurAchat("Le montant déjà payé ne peut pas dépasser le total de la commande.");
  }

  const prixVenteParVariante = new Map(lignesPrix.map((l) => [l.varianteId, l.prixVente]));
  const receptionId = crypto.randomUUID();
  const maintenantDate = maintenant();

  const lignes = (await db.getAllFromIndex("lignes_achat", "commande_id", commandeId)).filter((l) => !l.supprime);

  for (const ligne of lignes) {
    const prixAchatReception = ligne.prix_achat;
    const nouveauPrixVente = prixVenteParVariante.get(ligne.variante_id);
    let motif = `Réception ${commande.numero}`;

    if (nouveauPrixVente !== undefined) {
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
        const quantiteRecue = ligne.quantite;
        const nouveauPrixAchat =
          stockActuel > 0
            ? Math.round((stockActuel * ancienPrixAchat + quantiteRecue * prixAchatReception) / (stockActuel + quantiteRecue))
            : prixAchatReception;

        if (nouveauPrixVente < nouveauPrixAchat) {
          throw new ErreurAchat("Le prix de vente ne peut pas être inférieur au prix d'achat (CUMP).");
        }

        motif += ` (Prix achat : ${ancienPrixAchat} → ${nouveauPrixAchat} FCFA [CUMP], Prix vente : ${variante.prix_vente} → ${nouveauPrixVente} FCFA)`;
        await db.put("variantes", {
          ...variante,
          prix_achat: nouveauPrixAchat,
          prix_vente: nouveauPrixVente,
          synchronise: 0,
          date_modification: maintenantDate,
        });
      }
    }

    await appliquerMouvement({
      varianteId: ligne.variante_id,
      depotId,
      type: "entree",
      quantite: ligne.quantite,
      motif,
      utilisateurId,
      referenceType: "achats.CommandeAchat",
      referenceId: commandeId,
    });
  }

  const reception: ReceptionLocale = {
    id: receptionId,
    commande_id: commandeId,
    depot_id: depotId,
    utilisateur_id: utilisateurId,
    ...suiviSyncNeuf(),
  };
  await db.put("receptions", reception);

  const total = commande.total;
  const solde = total - montantDejaPaye;
  if (solde > 0) {
    const dette: DetteFournisseurLocale = {
      id: crypto.randomUUID(),
      fournisseur_id: commande.fournisseur_id,
      commande_id: commandeId,
      montant: total,
      montant_paye: montantDejaPaye,
      solde,
      statut: "en_cours",
      ...suiviSyncNeuf(),
    };
    await db.put("dettes_fournisseur", dette);
  }

  await db.put("commandes_achat", { ...commande, statut: "recue", synchronise: 0, date_modification: maintenantDate });

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
