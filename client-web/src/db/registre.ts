import type { GestionStockDB } from "./schema";

/**
 * Miroir de client-electron/electron/db/registre.ts — mêmes tables, même
 * ordre parent-avant-enfant, même conversion de champs (colonnes locales
 * `xxx_id` ↔ clés serveur `xxx` pour les FK).
 *
 * Contrairement à l'Electron (qui garde une clause SQL par table pour éviter
 * qu'un appareil ayant déjà servi une autre boutique ne pousse des données
 * orphelines), ce registre suppose une base IndexedDB dédiée à une seule
 * boutique par appareil/navigateur : un changement de compte réinitialise la
 * base locale (voir services/auth.ts) plutôt que de la partager entre boutiques.
 *
 * comptes.Utilisateur/Role sont absents : PK entière Django (AbstractUser),
 * incompatible avec ce mécanisme générique — appel API direct partout, y
 * compris sur le desktop (voir electron/services/comptes.ts).
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
  { table: "catalogue.Categorie", store: "categories", champsFK: ["boutique", "categorie_parent"] },
  { table: "catalogue.Unite", store: "unites", champsFK: ["boutique"] },
  { table: "catalogue.Produit", store: "produits", champsFK: ["boutique", "categorie", "unite"] },
  { table: "catalogue.Attribut", store: "attributs", champsFK: ["boutique"] },
  { table: "catalogue.ValeurAttribut", store: "valeurs_attribut", champsFK: ["attribut"] },
  {
    table: "catalogue.Variante",
    store: "variantes",
    champsFK: ["produit"],
    champsNumeriques: ["prix_achat", "prix_vente", "seuil_alerte"],
  },
  { table: "catalogue.VarianteValeur", store: "variante_valeurs", champsFK: ["variante", "valeur_attribut"] },
  { table: "stock.Depot", store: "depots", champsFK: ["boutique"] },
  { table: "clients.Client", store: "clients", champsFK: ["boutique"] },
  { table: "fournisseurs.Fournisseur", store: "fournisseurs", champsFK: ["boutique"] },
  {
    table: "ventes.Vente",
    store: "ventes",
    champsFK: ["boutique", "depot", "client", "utilisateur"],
    champsNumeriques: ["total_brut", "remise", "total_net"],
  },
  {
    table: "achats.CommandeAchat",
    store: "commandes_achat",
    champsFK: ["boutique", "fournisseur", "utilisateur"],
    champsNumeriques: ["total"],
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
    table: "achats.LigneAchat",
    store: "lignes_achat",
    champsFK: ["commande", "variante"],
    champsNumeriques: ["quantite", "prix_achat", "sous_total"],
  },
  {
    table: "achats.Reception",
    store: "receptions",
    champsFK: ["commande", "depot", "utilisateur"],
  },
  {
    table: "stock.MouvementStock",
    store: "mouvements_stock",
    champsFK: ["variante", "depot", "utilisateur"],
    ajoutSeul: true,
    champsNumeriques: ["quantite"],
  },
  {
    table: "stock.TransfertStock",
    store: "transferts_stock",
    champsFK: ["variante", "depot_source", "depot_destination", "utilisateur"],
    ajoutSeul: true,
    champsNumeriques: ["quantite"],
  },
  {
    table: "stock.Inventaire",
    store: "inventaires",
    champsFK: ["boutique", "depot", "utilisateur"],
  },
  {
    table: "stock.LigneInventaire",
    store: "lignes_inventaire",
    champsFK: ["inventaire", "variante"],
    champsNumeriques: ["qte_theorique", "qte_physique", "ecart"],
  },
  {
    table: "clients.Credit",
    store: "credits",
    champsFK: ["client", "vente"],
    champsNumeriques: ["montant", "montant_paye", "solde"],
  },
  {
    table: "clients.PaiementCredit",
    store: "paiements_credit",
    champsFK: ["credit"],
    champsNumeriques: ["montant"],
  },
  {
    table: "fournisseurs.DetteFournisseur",
    store: "dettes_fournisseur",
    champsFK: ["fournisseur", "commande"],
    champsNumeriques: ["montant", "montant_paye", "solde"],
  },
  {
    table: "fournisseurs.PaiementDetteFournisseur",
    store: "paiements_dette_fournisseur",
    champsFK: ["dette"],
    champsNumeriques: ["montant"],
  },
  {
    table: "tresorerie.Depense",
    store: "depenses",
    champsFK: ["depot", "utilisateur"],
    ajoutSeul: true,
    champsNumeriques: ["montant"],
  },
  {
    table: "tresorerie.Transfert",
    store: "transferts_caisse",
    champsFK: ["depot", "utilisateur_source", "utilisateur"],
    ajoutSeul: true,
    champsNumeriques: ["montant"],
  },
  {
    table: "tresorerie.ClotureCaisse",
    store: "clotures_caisse",
    champsFK: ["depot", "utilisateur"],
    ajoutSeul: true,
    champsNumeriques: ["solde_theorique", "solde_compte", "ecart"],
  },
  {
    table: "tresorerie.MouvementCaisse",
    store: "mouvements_caisse",
    champsFK: ["depot", "utilisateur"],
    ajoutSeul: true,
    champsNumeriques: ["montant"],
  },
  {
    table: "paiements.TransactionMobileMoney",
    store: "transactions_mobile_money",
    champsFK: ["paiement"],
    champsNumeriques: ["montant"],
  },
  {
    table: "notifications.Notification",
    store: "notifications",
    champsFK: ["boutique", "depot"],
  },
  {
    table: "notifications.Message",
    store: "messages",
    champsFK: ["boutique", "depot", "utilisateur"],
  },
  {
    table: "configuration.Parametre",
    store: "parametres",
    champsFK: ["boutique"],
  },
];
