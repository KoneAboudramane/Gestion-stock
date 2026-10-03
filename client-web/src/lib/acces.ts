/**
 * Qui voit quel menu (barre latérale, accueil et la page elle-même).
 * Une zone absente d'ici est visible par tous : ses actions sensibles sont
 * protégées une à une dans la page (prix, annulation, gestion du stock…).
 * Plusieurs permissions pour une zone : l'une suffit.
 */
const PERMISSIONS_DES_ZONES: Record<string, string[]> = {
  caisse: ["vendre"],
  stock: ["consulter_stock"],
  achats: ["gerer_produits_stock_achats"],
  clients: ["gerer_clients"],
  // Comptes clients (gérer les clients) et comptes fournisseurs (gérer les achats).
  comptes: ["gerer_clients", "gerer_produits_stock_achats"],
  tresorerie: ["consulter_tresorerie"],
  depense: ["enregistrer_depense"],
  rapports: ["voir_rapports_complets"],
  comptabilite: ["consulter_comptabilite"],
};

export function zoneAccessible(zone: string, permissions: Record<string, boolean>): boolean {
  const requises = PERMISSIONS_DES_ZONES[zone];
  return !requises || requises.some((p) => !!permissions[p]);
}
