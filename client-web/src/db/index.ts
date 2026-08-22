import { openDB, type IDBPDatabase } from "idb";

import { GestionStockDB, NOM_BASE, VERSION_BASE } from "./schema";

let promesseBase: Promise<IDBPDatabase<GestionStockDB>> | null = null;

/** Ouvre (ou crée) la base IndexedDB locale. Un seul appel réel — les suivants réutilisent la même promesse. */
export function ouvrirBaseDeDonnees(): Promise<IDBPDatabase<GestionStockDB>> {
  if (!promesseBase) {
    promesseBase = openDB<GestionStockDB>(NOM_BASE, VERSION_BASE, {
      upgrade(db, oldVersion) {
        // v1 : périmètre Caisse (voir plan PWA Caisse hors-ligne).
        if (oldVersion < 1) {
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
        }

        // v2 : extension à toute l'application (voir plan "Étendre le hors-ligne
        // à toute l'application"). Additif uniquement — les stores v1 ne bougent pas.
        if (oldVersion < 2) {
          const categories = db.createObjectStore("categories", { keyPath: "id" });
          categories.createIndex("boutique_id", "boutique_id");
          categories.createIndex("synchronise", "synchronise");

          const unites = db.createObjectStore("unites", { keyPath: "id" });
          unites.createIndex("boutique_id", "boutique_id");
          unites.createIndex("synchronise", "synchronise");

          const attributs = db.createObjectStore("attributs", { keyPath: "id" });
          attributs.createIndex("boutique_id", "boutique_id");
          attributs.createIndex("synchronise", "synchronise");

          const valeursAttribut = db.createObjectStore("valeurs_attribut", { keyPath: "id" });
          valeursAttribut.createIndex("attribut_id", "attribut_id");
          valeursAttribut.createIndex("synchronise", "synchronise");

          const varianteValeurs = db.createObjectStore("variante_valeurs", { keyPath: "id" });
          varianteValeurs.createIndex("variante_id", "variante_id");
          varianteValeurs.createIndex("synchronise", "synchronise");

          const fournisseurs = db.createObjectStore("fournisseurs", { keyPath: "id" });
          fournisseurs.createIndex("boutique_id", "boutique_id");
          fournisseurs.createIndex("synchronise", "synchronise");

          db.createObjectStore("boutique_logo", { keyPath: "boutique_id" });

          const commandesAchat = db.createObjectStore("commandes_achat", { keyPath: "id" });
          commandesAchat.createIndex("boutique_id", "boutique_id");
          commandesAchat.createIndex("synchronise", "synchronise");

          const lignesAchat = db.createObjectStore("lignes_achat", { keyPath: "id" });
          lignesAchat.createIndex("commande_id", "commande_id");
          lignesAchat.createIndex("synchronise", "synchronise");

          const receptions = db.createObjectStore("receptions", { keyPath: "id" });
          receptions.createIndex("commande_id", "commande_id");
          receptions.createIndex("synchronise", "synchronise");

          const paiementsCredit = db.createObjectStore("paiements_credit", { keyPath: "id" });
          paiementsCredit.createIndex("credit_id", "credit_id");
          paiementsCredit.createIndex("synchronise", "synchronise");

          const dettesFournisseur = db.createObjectStore("dettes_fournisseur", { keyPath: "id" });
          dettesFournisseur.createIndex("fournisseur_id", "fournisseur_id");
          dettesFournisseur.createIndex("synchronise", "synchronise");

          const transfertsStock = db.createObjectStore("transferts_stock", { keyPath: "id" });
          transfertsStock.createIndex("variante_id", "variante_id");
          transfertsStock.createIndex("synchronise", "synchronise");

          const inventaires = db.createObjectStore("inventaires", { keyPath: "id" });
          inventaires.createIndex("boutique_id", "boutique_id");
          inventaires.createIndex("synchronise", "synchronise");

          const lignesInventaire = db.createObjectStore("lignes_inventaire", { keyPath: "id" });
          lignesInventaire.createIndex("inventaire_id", "inventaire_id");
          lignesInventaire.createIndex("synchronise", "synchronise");

          const parametres = db.createObjectStore("parametres", { keyPath: "id" });
          parametres.createIndex("boutique_id", "boutique_id");
          parametres.createIndex("synchronise", "synchronise");

          const transactionsMobileMoney = db.createObjectStore("transactions_mobile_money", { keyPath: "id" });
          transactionsMobileMoney.createIndex("paiement_id", "paiement_id");
          transactionsMobileMoney.createIndex("synchronise", "synchronise");

          const notifications = db.createObjectStore("notifications", { keyPath: "id" });
          notifications.createIndex("boutique_id", "boutique_id");
          notifications.createIndex("synchronise", "synchronise");

          const messages = db.createObjectStore("messages", { keyPath: "id" });
          messages.createIndex("boutique_id", "boutique_id");
          messages.createIndex("synchronise", "synchronise");
        }

        // v3 : Trésorerie (suivi de caisse, dépenses) — additif uniquement.
        if (oldVersion < 3) {
          const paiementsDetteFournisseur = db.createObjectStore("paiements_dette_fournisseur", { keyPath: "id" });
          paiementsDetteFournisseur.createIndex("dette_id", "dette_id");
          paiementsDetteFournisseur.createIndex("synchronise", "synchronise");

          const depenses = db.createObjectStore("depenses", { keyPath: "id" });
          depenses.createIndex("depot_id", "depot_id");
          depenses.createIndex("synchronise", "synchronise");

          const transfertsCaisse = db.createObjectStore("transferts_caisse", { keyPath: "id" });
          transfertsCaisse.createIndex("depot_id", "depot_id");
          transfertsCaisse.createIndex("synchronise", "synchronise");

          const cloturesCaisse = db.createObjectStore("clotures_caisse", { keyPath: "id" });
          cloturesCaisse.createIndex("depot_id", "depot_id");
          cloturesCaisse.createIndex("synchronise", "synchronise");

          const mouvementsCaisse = db.createObjectStore("mouvements_caisse", { keyPath: "id" });
          mouvementsCaisse.createIndex("depot_id", "depot_id");
          mouvementsCaisse.createIndex("synchronise", "synchronise");
        }
      },
    });
  }
  return promesseBase;
}
