import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";

import { executer, tousLesResultats } from "../../electron/db/helpers";
import {
  enregistrerReleveDormants,
  listerRelevesDormants,
  produitsDormants,
  sortiesDormance,
} from "../../electron/services/rapports";
import { appliquerMouvement, declarerPerte, demarrerDestockage } from "../../electron/services/stock";
import { genererAlertesDestockage } from "../../electron/services/notifications";
import { creerVente } from "../../electron/services/ventes";
import { creerBaseDeTest } from "../setup";

describe("rapports.produitsDormants", () => {
  const boutiqueId = randomUUID();
  const depotId = randomUUID();

  function il_y_a(jours: number): string {
    return new Date(Date.now() - jours * 86_400_000).toISOString();
  }

  /** Crée un article avec du stock entré il y a `joursEntree` jours. */
  function creerArticle(nom: string, quantite: number, joursEntree: number, prixAchat = 1000): string {
    const produitId = randomUUID();
    const varianteId = randomUUID();
    executer("INSERT INTO produits (id, boutique_id, nom) VALUES (?, ?, ?)", [produitId, boutiqueId, nom]);
    executer("INSERT INTO variantes (id, produit_id, prix_achat, prix_vente) VALUES (?, ?, ?, ?)", [
      varianteId,
      produitId,
      prixAchat,
      prixAchat * 2,
    ]);
    const mouvementId = appliquerMouvement({ varianteId, depotId, type: "entree", quantite });
    executer("UPDATE mouvements_stock SET date_creation = ? WHERE id = ?", [il_y_a(joursEntree), mouvementId]);
    return varianteId;
  }

  function vendreIlYA(varianteId: string, joursVente: number, prix: number) {
    const vente = creerVente({
      boutiqueId,
      depotId,
      utilisateurId: "1",
      statut: "payee",
      lignes: [{ varianteId, quantite: 1 }],
      paiements: [{ mode: "especes", montant: prix }],
    });
    executer("UPDATE ventes SET date_creation = ? WHERE id = ?", [il_y_a(joursVente), vente.id]);
  }

  beforeEach(async () => {
    await creerBaseDeTest();
    executer("INSERT INTO depots (id, boutique_id, nom) VALUES (?, ?, ?)", [depotId, boutiqueId, "Magasin"]);
  });

  it("liste les articles sans vente depuis X jours, triés par argent immobilisé", () => {
    const jamaisVendu = creerArticle("Jamais vendu", 10, 100, 500); // 5 000 immobilisés
    const venduIlYALongtemps = creerArticle("Vendu il y a longtemps", 20, 200, 1000); // 19 000 après vente
    vendreIlYA(venduIlYALongtemps, 90, 2000);
    const venduRecemment = creerArticle("Vendu récemment", 5, 200);
    vendreIlYA(venduRecemment, 3, 2000);
    creerArticle("Entré hier", 5, 1);

    const dormants = produitsDormants(boutiqueId, 60);
    expect(dormants.map((d) => d.produitNom)).toEqual(["Vendu il y a longtemps", "Jamais vendu"]);
    expect(dormants[0]).toMatchObject({ varianteId: venduIlYALongtemps, quantiteStock: 19, valeurImmobilisee: 19000 });
    expect(dormants[0].joursSansVente).toBeGreaterThanOrEqual(90);
    expect(dormants[1]).toMatchObject({ varianteId: jamaisVendu, derniereVente: null, valeurImmobilisee: 5000 });
  });

  it("n'inclut pas un article sans stock et signale ceux déjà en déstockage", () => {
    const sansStock = creerArticle("Sans stock", 1, 100);
    vendreIlYA(sansStock, 80, 2000);
    const enDestockage = creerArticle("En déstockage", 3, 100);
    demarrerDestockage({ varianteId: enDestockage, prixDestockage: 1500, utilisateurId: null });

    const dormants = produitsDormants(boutiqueId, 30);
    expect(dormants.map((d) => d.varianteId)).toEqual([enDestockage]);
    expect(dormants[0].enDestockage).toBe(true);
  });

  it("sorties de dormance : revente après une longue pause, perte et déstockage", () => {
    const revendu = creerArticle("Revendu", 5, 120);
    vendreIlYA(revendu, 100, 2000); // 20 jours après l'entrée : pas dormant
    vendreIlYA(revendu, 10, 2000); // 90 jours après la vente précédente : sortie « revendu »

    const perdu = creerArticle("Perdu", 5, 100);
    declarerPerte({ varianteId: perdu, depotId, quantite: 2, motif: "perime", utilisateurId: null });

    const destocke = creerArticle("Déstocké", 5, 100);
    demarrerDestockage({ varianteId: destocke, prixDestockage: 1500, utilisateurId: null });
    vendreIlYA(destocke, 0, 1500); // vente en déstockage : déjà dans le bilan, pas une « revente »

    const sorties = sortiesDormance(boutiqueId, 60);
    const parArticle = Object.fromEntries(sorties.map((s) => [s.produitNom, s]));
    expect(sorties).toHaveLength(3);
    expect(parArticle["Revendu"]).toMatchObject({ action: "revendu", quantite: 1, montant: 2000 });
    expect(parArticle["Revendu"].joursSansVente).toBeGreaterThanOrEqual(89);
    expect(parArticle["Perdu"]).toMatchObject({ action: "perte", motif: "perime", quantite: 2 });
    expect(parArticle["Déstocké"]).toMatchObject({ action: "destockage", quantite: 1, montant: 1500 });

    expect(sortiesDormance(boutiqueId, 180)).toHaveLength(0);
  });

  it("relevé quotidien : un seul par jour, avec l'argent qui dort", () => {
    creerArticle("Jamais vendu", 10, 100, 500);
    enregistrerReleveDormants(boutiqueId);
    enregistrerReleveDormants(boutiqueId);
    const releves = listerRelevesDormants(boutiqueId);
    expect(releves).toHaveLength(1);
    expect(releves[0]).toMatchObject({ nombreArticles: 1, valeurImmobilisee: 5000 });
  });

  it("alertes : produits dormants au plus une fois par semaine, fin prochaine d'un déstockage", () => {
    creerArticle("Jamais vendu", 10, 100, 500);
    const enDestockage = creerArticle("Pull", 4, 100, 3000);
    const demain = new Date(Date.now() + 86_400_000);
    const dateFin = `${demain.getFullYear()}-${String(demain.getMonth() + 1).padStart(2, "0")}-${String(demain.getDate()).padStart(2, "0")}`;
    demarrerDestockage({ varianteId: enDestockage, prixDestockage: 4000, dateFin, utilisateurId: null });

    expect(genererAlertesDestockage(boutiqueId)).toHaveLength(2);
    const messages = tousLesResultats<{ type: string; message: string; depot_id: string | null }>(
      "SELECT type, message, depot_id FROM notifications ORDER BY type",
    );
    expect(messages.map((m) => m.type)).toEqual(["alerte_dormants", "fin_destockage"]);
    // L'article déjà en déstockage n'est pas compté parmi les dormants à traiter.
    expect(messages[0].message).toContain("1 produit sans vente depuis 60 jours");
    expect(messages.every((m) => m.depot_id === null)).toBe(true);

    // Rappel : pas de doublon dans la semaine, ni pour le même déstockage.
    expect(genererAlertesDestockage(boutiqueId)).toHaveLength(0);
  });
});
