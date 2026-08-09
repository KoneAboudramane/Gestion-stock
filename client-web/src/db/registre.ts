import type { GestionStockDB } from "./schema";

/**
 * Miroir (sous-ensemble Caisse) de client-electron/electron/db/registre.ts —
 * mêmes tables, même ordre parent-avant-enfant, même conversion de champs
 * (colonnes locales `xxx_id` ↔ clés serveur `xxx` pour les FK).
 *
 * Contrairement à l'Electron (qui garde une clause SQL par table pour éviter
 * qu'un appareil ayant déjà servi une autre boutique ne pousse des données
 * orphelines), ce registre suppose une base IndexedDB dédiée à une seule
 * boutique par appareil/navigateur : un changement de compte réinitialise la
 * base locale (voir services/auth.ts) plutôt que de la partager entre boutiques.
 */
export interface EntreeRegistreClient {
  table: string; // "catalogue.Produit"
  store: keyof GestionStockDB & string;
  champsFK: string[];
  ajoutSeul?: boolean;
  /**
   * Champs Django DecimalField (clés serveur, avant renommage FK) : DRF les
   * sérialise en JSON comme des CHAÎNES (ex. "15.00"), pas des nombres — sans
   * conversion explicite au pull, un calcul comme `0 + "15.00"` fait de la
   * concaténation ("015.00") au lieu d'une addition. formaterMontant() convertit
   * à l'affichage donc le bug est invisible sur un prix isolé, mais casse tout
   * calcul brut (recalcul de stock, totaux, comparaisons prix).
   */
  champsNumeriques?: string[];
}

export const REGISTRE_CLIENT: EntreeRegistreClient[] = [
  { table: "comptes.Boutique", store: "boutiques", champsFK: [] },
  { table: "catalogue.Produit", store: "produits", champsFK: ["boutique", "categorie", "unite"] },
  {
    table: "catalogue.Variante",
    store: "variantes",
    champsFK: ["produit"],
    champsNumeriques: ["prix_achat", "prix_vente", "seuil_alerte"],
  },
  { table: "stock.Depot", store: "depots", champsFK: ["boutique"] },
  { table: "clients.Client", store: "clients", champsFK: ["boutique"] },
  {
    table: "ventes.Vente",
    store: "ventes",
    champsFK: ["boutique", "depot", "client", "utilisateur"],
    champsNumeriques: ["total_brut", "remise", "total_net"],
  },
  {
    table: "ventes.LigneVente",
    store: "lignes_vente",
    champsFK: ["vente", "variante"],
    champsNumeriques: ["quantite", "prix_unitaire", "cout_unitaire", "remise", "sous_total"],
  },
  {
    table: "ventes.Paiement",
    store: "paiements",
    champsFK: ["vente"],
    champsNumeriques: ["montant"],
  },
  {
    table: "stock.MouvementStock",
    store: "mouvements_stock",
    champsFK: ["variante", "depot", "utilisateur"],
    ajoutSeul: true,
    champsNumeriques: ["quantite"],
  },
  {
    table: "clients.Credit",
    store: "credits",
    champsFK: ["client", "vente"],
    champsNumeriques: ["montant", "montant_paye", "solde"],
  },
];
