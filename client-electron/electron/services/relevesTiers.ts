/**
 * Relevé « Toutes les opérations » d'un client ou d'un fournisseur : tout ce
 * qu'il a fait avec la boutique, avec son effet sur sa position.
 *
 * Position d'un client = son porte-monnaie − son crédit dû
 *   (positive : à son crédit ; négative : il nous doit).
 * Position d'un fournisseur = son compte (avances, avoirs) − notre dette
 *   (positive : à notre crédit chez lui ; négative : nous lui devons).
 *
 * Module pur (aucun accès à la base), partagé à l'identique avec le client web
 * (client-web/src/services/relevesTiers.ts) : chaque client lit ses données
 * brutes puis appelle ces fonctions.
 */

export interface OperationTiers {
  id: string;
  date: string;
  operation: string;
  detail: string;
  /** Montant de l'opération (toujours positif). */
  montant: number;
  mode: string;
  /** Effet sur la position (+ en sa faveur / − en notre faveur), 0 si aucun. */
  effet: number;
}

const LIBELLES_MODE: Record<string, string> = {
  especes: "Espèces",
  mobile_money: "Mobile Money",
  credit: "Crédit",
  compte_client: "Compte",
  compte_fournisseur: "Compte",
  banque: "Banque",
  carte: "Carte",
  orange_money: "Orange Money",
  mtn_money: "MTN Money",
  moov_money: "Moov Money",
  wave: "Wave",
};

export function libelleModeReleve(mode: string, operateur = ""): string {
  if (!mode) return "—";
  if (mode === "mobile_money" && operateur) return LIBELLES_MODE[operateur] ?? operateur;
  return LIBELLES_MODE[mode] ?? mode;
}

function formater(n: number): string {
  return Math.round(n).toLocaleString("fr-FR").replace(/ | /g, " ");
}

function trier(operations: OperationTiers[]): OperationTiers[] {
  return operations.sort((a, b) => a.date.localeCompare(b.date));
}

// --- Client ---

export interface VenteBrute {
  id: string;
  numero: string;
  totalNet: number;
  statut: string;
  dateCreation: string;
  dateModification: string;
  paiements: { mode: string; operateur: string; montant: number }[];
}

export interface CreditBrut {
  id: string;
  venteId: string | null;
  montant: number;
}

export interface PaiementCreditBrut {
  id: string;
  creditId: string;
  venteNumero: string | null;
  montant: number;
  mode: string;
  dateCreation: string;
}

export interface MouvementBrut {
  id: string;
  type: string;
  montant: number;
  mode: string;
  operateur: string;
  motif: string;
  dateCreation: string;
}

export function assemblerReleveClient(
  ventes: VenteBrute[],
  credits: CreditBrut[],
  paiementsCredit: PaiementCreditBrut[],
  mouvementsCompte: MouvementBrut[],
): OperationTiers[] {
  const operations: OperationTiers[] = [];
  for (const v of ventes) {
    const part = (mode: string) => v.paiements.filter((p) => p.mode === mode).reduce((t, p) => t + Number(p.montant), 0);
    const credit = part("credit");
    const compte = part("compte_client");
    operations.push({
      id: `vente-${v.id}`,
      date: v.dateCreation,
      operation: "🛒 Achat",
      detail: v.numero,
      montant: Number(v.totalNet),
      mode: v.paiements.length
        ? v.paiements.map((p) => `${libelleModeReleve(p.mode, p.operateur)} ${formater(Number(p.montant))}`).join(" + ")
        : "—",
      effet: -(credit + compte),
    });
    if (v.statut === "annulee") {
      // Le crédit restant est effacé, l'argent du compte revient.
      const creditVente = credits.find((c) => c.venteId === v.id);
      const payeAvant = creditVente
        ? paiementsCredit
            .filter((p) => p.creditId === creditVente.id && p.dateCreation <= v.dateModification)
            .reduce((t, p) => t + Number(p.montant), 0)
        : 0;
      const restant = creditVente ? Math.max(0, Number(creditVente.montant) - payeAvant) : 0;
      operations.push({
        id: `vente-annulee-${v.id}`,
        date: v.dateModification,
        operation: "↺ Achat annulé",
        detail: v.numero,
        montant: Number(v.totalNet),
        mode: "—",
        effet: restant + compte,
      });
    }
  }
  for (const p of paiementsCredit) {
    operations.push({
      id: `reglement-${p.id}`,
      date: p.dateCreation,
      operation: "💳 Règlement de crédit",
      detail: p.venteNumero ?? "",
      montant: Number(p.montant),
      mode: libelleModeReleve(p.mode),
      // Payé avec son compte : le crédit baisse autant que le porte-monnaie.
      effet: p.mode === "compte_client" ? 0 : Number(p.montant),
    });
  }
  for (const m of mouvementsCompte) {
    if (m.type !== "depot" && m.type !== "rendu") continue; // les utilisations sont dans l'achat / le règlement
    operations.push({
      id: `compte-${m.id}`,
      date: m.dateCreation,
      operation: m.type === "depot" ? "⬇️ Dépôt sur le compte" : "↩️ Argent rendu",
      detail: m.motif,
      montant: Number(m.montant),
      mode: libelleModeReleve(m.mode, m.operateur),
      effet: m.type === "depot" ? Number(m.montant) : -Number(m.montant),
    });
  }
  return trier(operations);
}

// --- Fournisseur ---

export interface CommandeBrute {
  id: string;
  numero: string;
  statut: string;
  total: number;
  dateCreation: string;
}

export interface ReceptionBrute {
  id: string;
  commandeNumero: string;
  valeurRecue: number;
  montantPaye: number;
  modePaiement: string;
  operateurPaiement: string;
  annulee: boolean;
  dateCreation: string;
  dateAnnulation: string | null;
}

export interface RetourBrut {
  id: string;
  commandeNumero: string;
  montant: number;
  avoir: number;
  /** L'avoir a été porté sur le compte (retours d'après le 30/09/2026). */
  avoirSurCompte: boolean;
  motif: string;
  dateCreation: string;
}

export interface PaiementDetteBrut {
  id: string;
  commandeNumero: string | null;
  montant: number;
  mode: string;
  annulee: boolean;
  dateCreation: string;
  dateAnnulation: string | null;
}

export function assemblerReleveFournisseur(
  commandes: CommandeBrute[],
  receptions: ReceptionBrute[],
  retours: RetourBrut[],
  paiementsDette: PaiementDetteBrut[],
  mouvementsCompte: MouvementBrut[],
): OperationTiers[] {
  const operations: OperationTiers[] = [];
  for (const c of commandes) {
    if (c.statut === "brouillon") continue;
    operations.push({
      id: `commande-${c.id}`,
      date: c.dateCreation,
      operation: c.statut === "annulee" ? "📝 Commande (annulée)" : "📝 Commande",
      detail: c.numero,
      montant: Number(c.total),
      mode: "—",
      effet: 0,
    });
  }
  for (const r of receptions) {
    const valeur = Number(r.valeurRecue);
    const paye = Number(r.montantPaye);
    const parCompte = r.modePaiement === "compte_fournisseur" ? paye : 0;
    operations.push({
      id: `reception-${r.id}`,
      date: r.dateCreation,
      operation: "📥 Réception",
      detail: r.commandeNumero,
      montant: valeur,
      mode:
        paye > 0
          ? `Payé ${formater(paye)}` +
            (r.modePaiement ? ` (${libelleModeReleve(r.modePaiement, r.operateurPaiement)})` : "") +
            (valeur - paye > 0 ? ` · reste ${formater(valeur - paye)}` : "")
          : "À payer",
      effet: -(valeur - paye) - parCompte,
    });
    if (r.annulee) {
      operations.push({
        id: `reception-annulee-${r.id}`,
        date: r.dateAnnulation ?? r.dateCreation,
        operation: "↺ Réception annulée",
        detail: r.commandeNumero,
        montant: valeur,
        mode: "—",
        effet: valeur - paye + parCompte,
      });
    }
  }
  for (const r of retours) {
    const avoir = Number(r.avoir);
    const deduit = Number(r.montant) - avoir;
    operations.push({
      id: `retour-${r.id}`,
      date: r.dateCreation,
      operation: "📦 Retour de marchandise",
      detail: [r.commandeNumero, r.motif].filter(Boolean).join(" · "),
      montant: Number(r.montant),
      mode: avoir > 0 ? `dont avoir ${formater(avoir)}` : "—",
      effet: deduit + (r.avoirSurCompte ? avoir : 0),
    });
  }
  for (const p of paiementsDette) {
    const effet = p.mode === "compte_fournisseur" ? 0 : Number(p.montant);
    operations.push({
      id: `paiement-${p.id}`,
      date: p.dateCreation,
      operation: "💰 Paiement de dette",
      detail: p.commandeNumero ?? "",
      montant: Number(p.montant),
      mode: libelleModeReleve(p.mode),
      effet,
    });
    if (p.annulee) {
      operations.push({
        id: `paiement-annule-${p.id}`,
        date: p.dateAnnulation ?? p.dateCreation,
        operation: "↺ Paiement annulé",
        detail: p.commandeNumero ?? "",
        montant: Number(p.montant),
        mode: libelleModeReleve(p.mode),
        effet: -effet,
      });
    }
  }
  for (const m of mouvementsCompte) {
    if (m.type !== "avance" && m.type !== "remboursement") continue; // le reste est dans réception / retour / paiement
    operations.push({
      id: `compte-${m.id}`,
      date: m.dateCreation,
      operation: m.type === "avance" ? "⬆️ Avance versée" : "↩️ Remboursement reçu",
      detail: m.motif,
      montant: Number(m.montant),
      mode: libelleModeReleve(m.mode, m.operateur),
      effet: m.type === "avance" ? Number(m.montant) : -Number(m.montant),
    });
  }
  return trier(operations);
}
