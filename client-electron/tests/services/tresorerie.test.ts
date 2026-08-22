import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";

import { executer, unResultat } from "../../electron/db/helpers";
import { payerDette } from "../../electron/services/achats";
import { rembourserCredit } from "../../electron/services/clients";
import {
  ErreurTresorerie,
  ajusterCaisse,
  cloturerCaisse,
  effectuerRetrait,
  effectuerTransfert,
  enregistrerApport,
  enregistrerDepense,
  listerMouvements,
  soldeCaisse,
  soldeMobileMoneyDisponible,
} from "../../electron/services/tresorerie";
import { annulerVente, creerVente } from "../../electron/services/ventes";
import { creerBaseDeTest } from "../setup";

describe("tresorerie (miroir de tresorerie/services.py)", () => {
  const boutiqueId = randomUUID();
  const depotId = randomUUID();
  const utilisateurId = randomUUID();
  let varianteId: string;

  beforeEach(async () => {
    await creerBaseDeTest();
    const produitId = randomUUID();
    varianteId = randomUUID();
    executer("INSERT INTO produits (id, boutique_id, nom) VALUES (?, ?, ?)", [produitId, boutiqueId, "Savon"]);
    executer(
      "INSERT INTO variantes (id, produit_id, prix_achat, prix_vente, seuil_alerte) VALUES (?, ?, ?, ?, ?)",
      [varianteId, produitId, 200, 350, 5],
    );
    executer("INSERT INTO depots (id, boutique_id, nom) VALUES (?, ?, ?)", [depotId, boutiqueId, "Dépôt test"]);
    executer("INSERT INTO stocks (id, variante_id, depot_id, quantite) VALUES (?, ?, ?, ?)", [
      randomUUID(),
      varianteId,
      depotId,
      20,
    ]);
  });

  it("une vente en espèces crée une entrée de caisse", () => {
    const vente = creerVente({
      boutiqueId,
      depotId,
      utilisateurId,
      statut: "payee",
      lignes: [{ varianteId, quantite: 1 }],
      paiements: [{ mode: "especes", montant: 350 }],
    });

    expect(soldeCaisse(depotId)).toBe(350);
    const mouvements = listerMouvements(depotId);
    expect(mouvements).toHaveLength(1);
    expect(mouvements[0].categorie).toBe("vente_especes");

    // Annulation : sortie compensatoire, solde revient à 0.
    annulerVente(vente.id, utilisateurId);
    expect(soldeCaisse(depotId)).toBe(0);
    expect(listerMouvements(depotId)).toHaveLength(2);
  });

  it("une vente en mobile money ne touche pas la caisse mais alimente le solde mobile money", () => {
    creerVente({
      boutiqueId,
      depotId,
      utilisateurId,
      statut: "payee",
      lignes: [{ varianteId, quantite: 1 }],
      paiements: [{ mode: "mobile_money", operateur: "orange_money", montant: 350 }],
    });

    expect(soldeCaisse(depotId)).toBe(0);
    expect(soldeMobileMoneyDisponible(boutiqueId, utilisateurId, "orange_money")).toBe(350);
  });

  it("enregistrerDepense crée une sortie et refuse un montant négatif", () => {
    enregistrerDepense(depotId, "transport", 50, "Taxi", utilisateurId);
    expect(soldeCaisse(depotId)).toBe(-50);
    expect(() => enregistrerDepense(depotId, "transport", 0)).toThrow(ErreurTresorerie);
    expect(() => enregistrerDepense(depotId, "transport", -10)).toThrow(ErreurTresorerie);
  });

  it("effectuerRetrait, enregistrerApport et ajusterCaisse font varier le solde correctement", () => {
    enregistrerApport(depotId, 1000, "Fond de départ", utilisateurId);
    expect(soldeCaisse(depotId)).toBe(1000);

    effectuerRetrait(depotId, 300, "Versement banque", utilisateurId);
    expect(soldeCaisse(depotId)).toBe(700);

    ajusterCaisse(depotId, -50, "Correction erreur de caisse", utilisateurId);
    expect(soldeCaisse(depotId)).toBe(650);

    expect(() => ajusterCaisse(depotId, 0, "invalide")).toThrow(ErreurTresorerie);
  });

  it("effectuerTransfert refuse un montant supérieur au solde mobile money disponible", () => {
    creerVente({
      boutiqueId,
      depotId,
      utilisateurId,
      statut: "payee",
      lignes: [{ varianteId, quantite: 1 }],
      paiements: [{ mode: "mobile_money", operateur: "wave", montant: 350 }],
    });

    expect(() =>
      effectuerTransfert({
        boutiqueId,
        depotId,
        utilisateurSourceId: utilisateurId,
        operateur: "wave",
        montant: 400,
        utilisateurId,
      }),
    ).toThrow(ErreurTresorerie);

    effectuerTransfert({
      boutiqueId,
      depotId,
      utilisateurSourceId: utilisateurId,
      operateur: "wave",
      montant: 350,
      utilisateurId,
    });
    expect(soldeCaisse(depotId)).toBe(350);
    expect(soldeMobileMoneyDisponible(boutiqueId, utilisateurId, "wave")).toBe(0);
  });

  it("cloturerCaisse fige le solde théorique et calcule l'écart", () => {
    enregistrerApport(depotId, 500, "", utilisateurId);
    const clotureId = cloturerCaisse(depotId, 480, utilisateurId);
    const cloture = unResultat<{ solde_theorique: number; solde_compte: number; ecart: number }>(
      "SELECT solde_theorique, solde_compte, ecart FROM clotures_caisse WHERE id = ?",
      [clotureId],
    );
    expect(Number(cloture!.solde_theorique)).toBe(500);
    expect(Number(cloture!.solde_compte)).toBe(480);
    expect(Number(cloture!.ecart)).toBe(-20);
  });

  it("rembourserCredit en espèces avec un dépôt crée une entrée de caisse ; sans dépôt, aucune", () => {
    const clientId = randomUUID();
    executer("INSERT INTO clients (id, boutique_id, nom) VALUES (?, ?, ?)", [clientId, boutiqueId, "Mme Test"]);
    const creditId = randomUUID();
    executer(
      "INSERT INTO credits (id, client_id, montant, montant_paye, solde, statut) VALUES (?, ?, ?, ?, ?, ?)",
      [creditId, clientId, 1000, 0, 1000, "en_cours"],
    );

    rembourserCredit(creditId, 400, "especes", depotId, utilisateurId);
    expect(soldeCaisse(depotId)).toBe(400);

    rembourserCredit(creditId, 100, "mobile_money", depotId, utilisateurId);
    expect(soldeCaisse(depotId)).toBe(400); // mode non-espèces : pas de mouvement caisse
  });

  it("payerDette en espèces crée une ligne de paiement et une sortie de caisse", () => {
    const fournisseurId = randomUUID();
    executer("INSERT INTO fournisseurs (id, boutique_id, nom) VALUES (?, ?, ?)", [
      fournisseurId,
      boutiqueId,
      "Fournisseur test",
    ]);
    const detteId = randomUUID();
    executer(
      "INSERT INTO dettes_fournisseur (id, fournisseur_id, montant, montant_paye, solde, statut) VALUES (?, ?, ?, ?, ?, ?)",
      [detteId, fournisseurId, 1000, 0, 1000, "en_cours"],
    );

    payerDette(detteId, 250, "especes", depotId, utilisateurId);

    const paiement = unResultat<{ montant: number; mode: string }>(
      "SELECT montant, mode FROM paiements_dette_fournisseur WHERE dette_id = ?",
      [detteId],
    );
    expect(Number(paiement!.montant)).toBe(250);
    expect(soldeCaisse(depotId)).toBe(-250);

    const dette = unResultat<{ solde: number }>("SELECT solde FROM dettes_fournisseur WHERE id = ?", [detteId]);
    expect(Number(dette!.solde)).toBe(750);
  });
});
