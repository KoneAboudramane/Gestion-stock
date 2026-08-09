import { openDB, type IDBPDatabase } from "idb";

import { GestionStockDB, NOM_BASE, VERSION_BASE } from "./schema";

let promesseBase: Promise<IDBPDatabase<GestionStockDB>> | null = null;

/** Ouvre (ou crée) la base IndexedDB locale. Un seul appel réel — les suivants réutilisent la même promesse. */
export function ouvrirBaseDeDonnees(): Promise<IDBPDatabase<GestionStockDB>> {
  if (!promesseBase) {
    promesseBase = openDB<GestionStockDB>(NOM_BASE, VERSION_BASE, {
      upgrade(db) {
        const boutiques = db.createObjectStore("boutiques", { keyPath: "id" });
        boutiques.createIndex("synchronise", "synchronise");

        const produits = db.createObjectStore("produits", { keyPath: "id" });
        produits.createIndex("boutique_id", "boutique_id");
        produits.createIndex("synchronise", "synchronise");

        const variantes = db.createObjectStore("variantes", { keyPath: "id" });
        variantes.createIndex("produit_id", "produit_id");
        variantes.createIndex("synchronise", "synchronise");

        const depots = db.createObjectStore("depots", { keyPath: "id" });
        depots.createIndex("boutique_id", "boutique_id");
        depots.createIndex("synchronise", "synchronise");

        const clients = db.createObjectStore("clients", { keyPath: "id" });
        clients.createIndex("boutique_id", "boutique_id");
        clients.createIndex("synchronise", "synchronise");

        const ventes = db.createObjectStore("ventes", { keyPath: "id" });
        ventes.createIndex("boutique_id", "boutique_id");
        ventes.createIndex("synchronise", "synchronise");

        const lignesVente = db.createObjectStore("lignes_vente", { keyPath: "id" });
        lignesVente.createIndex("vente_id", "vente_id");
        lignesVente.createIndex("synchronise", "synchronise");

        const paiements = db.createObjectStore("paiements", { keyPath: "id" });
        paiements.createIndex("vente_id", "vente_id");
        paiements.createIndex("synchronise", "synchronise");

        const credits = db.createObjectStore("credits", { keyPath: "id" });
        credits.createIndex("client_id", "client_id");
        credits.createIndex("synchronise", "synchronise");

        const mouvementsStock = db.createObjectStore("mouvements_stock", { keyPath: "id" });
        mouvementsStock.createIndex("variante_depot", ["variante_id", "depot_id"]);
        mouvementsStock.createIndex("synchronise", "synchronise");

        const stocks = db.createObjectStore("stocks", { keyPath: "id" });
        stocks.createIndex("variante_depot", ["variante_id", "depot_id"]);
      },
    });
  }
  return promesseBase;
}
