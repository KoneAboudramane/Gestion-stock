// Miroir client de synchronisation/registre.py (Django, Étape 8) : même
// ordre (parent avant enfant, cahier des charges §9.2), mêmes tables.
// `champsFK` liste les noms de CHAMPS DJANGO (pas les colonnes locales) des
// relations de la table — nécessaire pour convertir dans les deux sens entre
// la ligne SQLite locale (colonnes `xxx_id`) et le JSON attendu par le
// serveur (clés `xxx`). Une simple convention "se termine par _id" ne suffit
// pas : `mouvements_stock.reference_id` n'est PAS une FK (UUID libre), donc
// absent de sa liste de champsFK bien que la colonne locale se nomme pareil.
export interface EntreeRegistreClient {
  table: string; // "catalogue.Produit"
  tableLocale: string; // "produits"
  champsFK: string[]; // noms de champs Django, ex. ["boutique", "categorie"]
  ajoutSeul?: boolean;
  /**
   * Filtre SQL (un seul `?` = boutiqueId) sélectionnant les lignes de cette
   * table appartenant à une boutique donnée — miroir client de
   * `chemin_boutique` (synchronisation/registre.py). Sert à ne pousser que
   * les données de la boutique de la session en cours : sans ce filtre, un
   * appareil ayant déjà servi à une autre boutique pousserait aussi les
   * lignes non synchronisées laissées par cette dernière, que le serveur
   * réattribuerait alors à tort à la boutique connectée (`traiter_push`
   * assigne toujours la boutique authentifiée à la création).
   */
  clauseBoutique: string;
}

export const REGISTRE_CLIENT: EntreeRegistreClient[] = [
  { table: "comptes.Boutique", tableLocale: "boutiques", champsFK: [], clauseBoutique: "id = ?" },
  {
    table: "catalogue.Categorie",
    tableLocale: "categories",
    champsFK: ["boutique", "categorie_parent"],
    clauseBoutique: "boutique_id = ?",
  },
  { table: "catalogue.Unite", tableLocale: "unites", champsFK: ["boutique"], clauseBoutique: "boutique_id = ?" },
  {
    table: "catalogue.Produit",
    tableLocale: "produits",
    champsFK: ["boutique", "categorie", "unite"],
    clauseBoutique: "boutique_id = ?",
  },
  { table: "catalogue.Attribut", tableLocale: "attributs", champsFK: ["boutique"], clauseBoutique: "boutique_id = ?" },
  {
    table: "catalogue.ValeurAttribut",
    tableLocale: "valeurs_attribut",
    champsFK: ["attribut"],
    clauseBoutique: "attribut_id IN (SELECT id FROM attributs WHERE boutique_id = ?)",
  },
  {
    table: "catalogue.Variante",
    tableLocale: "variantes",
    champsFK: ["produit"],
    clauseBoutique: "produit_id IN (SELECT id FROM produits WHERE boutique_id = ?)",
  },
  {
    table: "catalogue.VarianteValeur",
    tableLocale: "variante_valeurs",
    champsFK: ["variante", "valeur_attribut"],
    clauseBoutique:
      "variante_id IN (SELECT id FROM variantes WHERE produit_id IN (SELECT id FROM produits WHERE boutique_id = ?))",
  },
  { table: "stock.Depot", tableLocale: "depots", champsFK: ["boutique"], clauseBoutique: "boutique_id = ?" },
  { table: "clients.Client", tableLocale: "clients", champsFK: ["boutique"], clauseBoutique: "boutique_id = ?" },
  {
    table: "fournisseurs.Fournisseur",
    tableLocale: "fournisseurs",
    champsFK: ["boutique"],
    clauseBoutique: "boutique_id = ?",
  },
  {
    table: "ventes.Vente",
    tableLocale: "ventes",
    champsFK: ["boutique", "depot", "client", "utilisateur"],
    clauseBoutique: "boutique_id = ?",
  },
  {
    table: "achats.CommandeAchat",
    tableLocale: "commandes_achat",
    champsFK: ["boutique", "fournisseur", "utilisateur"],
    clauseBoutique: "boutique_id = ?",
  },
  {
    table: "ventes.LigneVente",
    tableLocale: "lignes_vente",
    champsFK: ["vente", "variante"],
    clauseBoutique: "vente_id IN (SELECT id FROM ventes WHERE boutique_id = ?)",
  },
  {
    table: "ventes.Paiement",
    tableLocale: "paiements",
    champsFK: ["vente"],
    clauseBoutique: "vente_id IN (SELECT id FROM ventes WHERE boutique_id = ?)",
  },
  {
    table: "achats.LigneAchat",
    tableLocale: "lignes_achat",
    champsFK: ["commande", "variante"],
    clauseBoutique: "commande_id IN (SELECT id FROM commandes_achat WHERE boutique_id = ?)",
  },
  {
    table: "achats.Reception",
    tableLocale: "receptions",
    champsFK: ["commande", "depot", "utilisateur"],
    clauseBoutique: "commande_id IN (SELECT id FROM commandes_achat WHERE boutique_id = ?)",
  },
  {
    table: "stock.MouvementStock",
    tableLocale: "mouvements_stock",
    champsFK: ["variante", "depot", "utilisateur"],
    ajoutSeul: true,
    clauseBoutique: "depot_id IN (SELECT id FROM depots WHERE boutique_id = ?)",
  },
  {
    table: "stock.TransfertStock",
    tableLocale: "transferts_stock",
    champsFK: ["variante", "depot_source", "depot_destination", "utilisateur"],
    ajoutSeul: true,
    clauseBoutique: "depot_source_id IN (SELECT id FROM depots WHERE boutique_id = ?)",
  },
  {
    table: "stock.Inventaire",
    tableLocale: "inventaires",
    champsFK: ["boutique", "depot", "utilisateur"],
    clauseBoutique: "boutique_id = ?",
  },
  {
    table: "stock.LigneInventaire",
    tableLocale: "lignes_inventaire",
    champsFK: ["inventaire", "variante"],
    clauseBoutique: "inventaire_id IN (SELECT id FROM inventaires WHERE boutique_id = ?)",
  },
  {
    table: "clients.Credit",
    tableLocale: "credits",
    champsFK: ["client", "vente"],
    clauseBoutique: "client_id IN (SELECT id FROM clients WHERE boutique_id = ?)",
  },
  {
    table: "clients.PaiementCredit",
    tableLocale: "paiements_credit",
    champsFK: ["credit"],
    clauseBoutique:
      "credit_id IN (SELECT id FROM credits WHERE client_id IN (SELECT id FROM clients WHERE boutique_id = ?))",
  },
  {
    table: "fournisseurs.DetteFournisseur",
    tableLocale: "dettes_fournisseur",
    champsFK: ["fournisseur", "commande"],
    clauseBoutique: "fournisseur_id IN (SELECT id FROM fournisseurs WHERE boutique_id = ?)",
  },
  {
    table: "paiements.TransactionMobileMoney",
    tableLocale: "transactions_mobile_money",
    champsFK: ["paiement"],
    clauseBoutique:
      "paiement_id IN (SELECT id FROM paiements WHERE vente_id IN (SELECT id FROM ventes WHERE boutique_id = ?))",
  },
  {
    table: "notifications.Notification",
    tableLocale: "notifications",
    champsFK: ["boutique", "depot"],
    clauseBoutique: "boutique_id = ?",
  },
  {
    table: "notifications.Message",
    tableLocale: "messages",
    champsFK: ["boutique", "depot", "utilisateur"],
    clauseBoutique: "boutique_id = ?",
  },
  {
    table: "configuration.Parametre",
    tableLocale: "parametres",
    champsFK: ["boutique"],
    clauseBoutique: "boutique_id = ?",
  },
];
