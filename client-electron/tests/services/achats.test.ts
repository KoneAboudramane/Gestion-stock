import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";

import { executer, unResultat } from "../../electron/db/helpers";
import {
  ErreurAchat,
  creerCommande,
  modifierCommande,
  obtenirDerniersFournisseurs,
  payerDette,
  receptionnerCommande,
} from "../../electron/services/achats";
import { creerBaseDeTest } from "../setup";

describe("achats.creerCommande (miroir de achats/services.py::creer_commande)", () => {
  const boutiqueId = randomUUID();
  const fournisseurId = randomUUID();
  let varianteId: string;

  beforeEach(async () => {
    await creerBaseDeTest();
    executer("INSERT INTO fournisseurs (id, boutique_id, nom) VALUES (?, ?, ?)", [
      fournisseurId,
      boutiqueId,
      "Grossiste Konan",
    ]);
    const produitId = randomUUID();
    varianteId = randomUUID();
    executer("INSERT INTO produits (id, boutique_id, nom) VALUES (?, ?, ?)", [produitId, boutiqueId, "Riz 25kg"]);
    executer("INSERT INTO variantes (id, produit_id, prix_achat, prix_vente) VALUES (?, ?, ?, ?)", [
      varianteId,
      produitId,
      10000,
      12500,
    ]);
  });

  it("calcule sous_total/total et génère un numéro CMD-...", () => {
    const resultat = creerCommande({
      boutiqueId,
      fournisseurId,
      utilisateurId: "1",
      statut: "commandee",
      lignes: [{ varianteId, quantite: 3, prixAchat: 10000 }],
    });

    expect(resultat.numero).toMatch(/^CMD-\d{8}-0001$/);
    expect(resultat.total).toBe(30000);

    const ligne = unResultat<{ sous_total: number }>(
      "SELECT sous_total FROM lignes_achat WHERE commande_id = ?",
      [resultat.id],
    );
    expect(Number(ligne!.sous_total)).toBe(30000);
  });

  it("refuse une commande sans ligne", () => {
    expect(() =>
      creerCommande({ boutiqueId, fournisseurId, utilisateurId: "1", statut: "commandee", lignes: [] }),
    ).toThrow(ErreurAchat);
  });
});

describe("achats.modifierCommande (miroir de achats/services.py::modifier_commande)", () => {
  const boutiqueId = randomUUID();
  const fournisseurId = randomUUID();
  let varianteId: string;

  beforeEach(async () => {
    await creerBaseDeTest();
    executer("INSERT INTO fournisseurs (id, boutique_id, nom) VALUES (?, ?, ?)", [
      fournisseurId,
      boutiqueId,
      "Grossiste Konan",
    ]);
    const produitId = randomUUID();
    varianteId = randomUUID();
    executer("INSERT INTO produits (id, boutique_id, nom) VALUES (?, ?, ?)", [produitId, boutiqueId, "Riz 25kg"]);
    executer("INSERT INTO variantes (id, produit_id, prix_achat, prix_vente) VALUES (?, ?, ?, ?)", [
      varianteId,
      produitId,
      10000,
      12500,
    ]);
  });

  it("refuse de modifier une commande déjà reçue ou annulée", () => {
    const commande = creerCommande({
      boutiqueId,
      fournisseurId,
      utilisateurId: "1",
      statut: "commandee",
      lignes: [{ varianteId, quantite: 1, prixAchat: 10000 }],
    });
    executer("UPDATE commandes_achat SET statut = 'recue' WHERE id = ?", [commande.id]);

    expect(() => modifierCommande(commande.id, { statut: "brouillon" })).toThrow(ErreurAchat);
  });
});

describe("achats.receptionnerCommande (miroir de achats/services.py::receptionner_commande)", () => {
  const boutiqueId = randomUUID();
  const fournisseurId = randomUUID();
  const depotId = randomUUID();
  let varianteId: string;

  beforeEach(async () => {
    await creerBaseDeTest();
    executer("INSERT INTO fournisseurs (id, boutique_id, nom) VALUES (?, ?, ?)", [
      fournisseurId,
      boutiqueId,
      "Grossiste Konan",
    ]);
    executer("INSERT INTO depots (id, boutique_id, nom) VALUES (?, ?, ?)", [depotId, boutiqueId, "Magasin"]);
    const produitId = randomUUID();
    varianteId = randomUUID();
    executer("INSERT INTO produits (id, boutique_id, nom) VALUES (?, ?, ?)", [produitId, boutiqueId, "Riz 25kg"]);
    executer("INSERT INTO variantes (id, produit_id, prix_achat, prix_vente) VALUES (?, ?, ?, ?)", [
      varianteId,
      produitId,
      10000,
      12500,
    ]);
  });

  function stockActuel(): number {
    const resultat = unResultat<{ quantite: number }>(
      "SELECT quantite FROM stocks WHERE variante_id = ? AND depot_id = ?",
      [varianteId, depotId],
    );
    return resultat ? Number(resultat.quantite) : 0;
  }

  it("incrémente le stock, crée une dette fournisseur avec le bon solde, passe la commande à 'recue'", () => {
    const commande = creerCommande({
      boutiqueId,
      fournisseurId,
      utilisateurId: "1",
      statut: "commandee",
      lignes: [{ varianteId, quantite: 5, prixAchat: 10000 }],
    });

    receptionnerCommande({ commandeId: commande.id, depotId, utilisateurId: "1", montantDejaPaye: 20000 });

    expect(stockActuel()).toBe(5);

    const dette = unResultat<{ montant: number; montant_paye: number; solde: number; statut: string }>(
      "SELECT montant, montant_paye, solde, statut FROM dettes_fournisseur WHERE commande_id = ?",
      [commande.id],
    );
    expect(Number(dette!.montant)).toBe(50000);
    expect(Number(dette!.montant_paye)).toBe(20000);
    expect(Number(dette!.solde)).toBe(30000);
    expect(dette!.statut).toBe("en_cours");

    const apres = unResultat<{ statut: string }>("SELECT statut FROM commandes_achat WHERE id = ?", [commande.id]);
    expect(apres!.statut).toBe("recue");
  });

  it("ne crée pas de dette si le montant payé couvre le total", () => {
    const commande = creerCommande({
      boutiqueId,
      fournisseurId,
      utilisateurId: "1",
      statut: "commandee",
      lignes: [{ varianteId, quantite: 2, prixAchat: 10000 }],
    });

    receptionnerCommande({ commandeId: commande.id, depotId, utilisateurId: "1", montantDejaPaye: 20000 });

    const dette = unResultat<{ solde: number; statut: string }>(
      "SELECT solde, statut FROM dettes_fournisseur WHERE commande_id = ?",
      [commande.id],
    );
    expect(dette).toBeUndefined();
  });

  it("refuse si la commande n'est pas au statut 'commandee'", () => {
    const commande = creerCommande({
      boutiqueId,
      fournisseurId,
      utilisateurId: "1",
      statut: "brouillon",
      lignes: [{ varianteId, quantite: 1, prixAchat: 10000 }],
    });

    expect(() => receptionnerCommande({ commandeId: commande.id, depotId, utilisateurId: "1" })).toThrow(
      ErreurAchat,
    );
  });

  it("refuse si le montant déjà payé dépasse le total", () => {
    const commande = creerCommande({
      boutiqueId,
      fournisseurId,
      utilisateurId: "1",
      statut: "commandee",
      lignes: [{ varianteId, quantite: 1, prixAchat: 10000 }],
    });

    expect(() =>
      receptionnerCommande({ commandeId: commande.id, depotId, utilisateurId: "1", montantDejaPaye: 999999 }),
    ).toThrow(ErreurAchat);
  });

  it("met à jour le prix d'achat et le prix de vente de la variante quand un prix est fourni", () => {
    const commande = creerCommande({
      boutiqueId,
      fournisseurId,
      utilisateurId: "1",
      statut: "commandee",
      lignes: [{ varianteId, quantite: 5, prixAchat: 11000 }],
    });

    receptionnerCommande({
      commandeId: commande.id,
      depotId,
      utilisateurId: "1",
      lignesPrix: [{ varianteId, prixVente: 14000 }],
    });

    const variante = unResultat<{ prix_achat: number; prix_vente: number }>(
      "SELECT prix_achat, prix_vente FROM variantes WHERE id = ?",
      [varianteId],
    );
    expect(Number(variante!.prix_achat)).toBe(11000);
    expect(Number(variante!.prix_vente)).toBe(14000);

    const mouvement = unResultat<{ motif: string }>(
      "SELECT motif FROM mouvements_stock WHERE variante_id = ? AND depot_id = ?",
      [varianteId, depotId],
    );
    expect(mouvement!.motif).toContain("Prix achat : 10000 → 11000");
    expect(mouvement!.motif).toContain("Prix vente : 12500 → 14000");
  });

  it("ne touche pas aux prix de la variante si aucun prix n'est fourni pour la ligne", () => {
    const commande = creerCommande({
      boutiqueId,
      fournisseurId,
      utilisateurId: "1",
      statut: "commandee",
      lignes: [{ varianteId, quantite: 5, prixAchat: 11000 }],
    });

    receptionnerCommande({ commandeId: commande.id, depotId, utilisateurId: "1" });

    const variante = unResultat<{ prix_achat: number; prix_vente: number }>(
      "SELECT prix_achat, prix_vente FROM variantes WHERE id = ?",
      [varianteId],
    );
    expect(Number(variante!.prix_achat)).toBe(10000);
    expect(Number(variante!.prix_vente)).toBe(12500);
  });

  it("refuse un prix de vente inférieur au prix d'achat de la ligne", () => {
    const commande = creerCommande({
      boutiqueId,
      fournisseurId,
      utilisateurId: "1",
      statut: "commandee",
      lignes: [{ varianteId, quantite: 5, prixAchat: 11000 }],
    });

    expect(() =>
      receptionnerCommande({
        commandeId: commande.id,
        depotId,
        utilisateurId: "1",
        lignesPrix: [{ varianteId, prixVente: 9000 }],
      }),
    ).toThrow(ErreurAchat);
  });
});

describe("achats.payerDette (miroir de achats/services.py::payer_dette)", () => {
  const fournisseurId = randomUUID();
  let detteId: string;

  beforeEach(async () => {
    await creerBaseDeTest();
    executer("INSERT INTO fournisseurs (id, boutique_id, nom) VALUES (?, ?, ?)", [
      fournisseurId,
      "b1",
      "Grossiste Konan",
    ]);
    detteId = randomUUID();
    executer(
      "INSERT INTO dettes_fournisseur (id, fournisseur_id, montant, montant_paye, solde, statut) VALUES (?, ?, ?, ?, ?, ?)",
      [detteId, fournisseurId, 50000, 0, 50000, "en_cours"],
    );
  });

  it("décrémente le solde et passe le statut à 'solde' quand il atteint 0", () => {
    payerDette(detteId, 30000);
    let dette = unResultat<{ solde: number; statut: string }>(
      "SELECT solde, statut FROM dettes_fournisseur WHERE id = ?",
      [detteId],
    );
    expect(Number(dette!.solde)).toBe(20000);
    expect(dette!.statut).toBe("en_cours");

    payerDette(detteId, 20000);
    dette = unResultat<{ solde: number; statut: string }>(
      "SELECT solde, statut FROM dettes_fournisseur WHERE id = ?",
      [detteId],
    );
    expect(Number(dette!.solde)).toBe(0);
    expect(dette!.statut).toBe("solde");
  });

  it("refuse un montant négatif ou nul", () => {
    expect(() => payerDette(detteId, 0)).toThrow(ErreurAchat);
    expect(() => payerDette(detteId, -100)).toThrow(ErreurAchat);
  });

  it("refuse un montant supérieur au solde restant", () => {
    expect(() => payerDette(detteId, 999999)).toThrow(ErreurAchat);
  });
});

describe("achats.obtenirDerniersFournisseurs", () => {
  const boutiqueId = randomUUID();
  let varianteId: string;
  let ancienFournisseurId: string;
  let recentFournisseurId: string;

  beforeEach(async () => {
    await creerBaseDeTest();
    const produitId = randomUUID();
    varianteId = randomUUID();
    executer("INSERT INTO produits (id, boutique_id, nom) VALUES (?, ?, ?)", [produitId, boutiqueId, "Riz 25kg"]);
    executer("INSERT INTO variantes (id, produit_id, prix_achat, prix_vente) VALUES (?, ?, ?, ?)", [
      varianteId,
      produitId,
      10000,
      12500,
    ]);
    ancienFournisseurId = randomUUID();
    recentFournisseurId = randomUUID();
    executer("INSERT INTO fournisseurs (id, boutique_id, nom) VALUES (?, ?, ?)", [
      ancienFournisseurId,
      boutiqueId,
      "Ancien Grossiste",
    ]);
    executer("INSERT INTO fournisseurs (id, boutique_id, nom) VALUES (?, ?, ?)", [
      recentFournisseurId,
      boutiqueId,
      "Nouveau Grossiste",
    ]);
  });

  it("retourne le fournisseur de la commande la plus récente pour chaque variante", () => {
    const ancienneCommande = creerCommande({
      boutiqueId,
      fournisseurId: ancienFournisseurId,
      utilisateurId: "1",
      statut: "commandee",
      lignes: [{ varianteId, quantite: 1, prixAchat: 10000 }],
    });
    // La commande la plus récente doit l'emporter : date_creation avancée manuellement.
    executer("UPDATE commandes_achat SET date_creation = ? WHERE id = ?", [
      "2020-01-01T00:00:00.000Z",
      ancienneCommande.id,
    ]);
    const recenteCommande = creerCommande({
      boutiqueId,
      fournisseurId: recentFournisseurId,
      utilisateurId: "1",
      statut: "commandee",
      lignes: [{ varianteId, quantite: 1, prixAchat: 10000 }],
    });
    executer("UPDATE commandes_achat SET date_creation = ? WHERE id = ?", [
      "2026-01-01T00:00:00.000Z",
      recenteCommande.id,
    ]);

    const resultat = obtenirDerniersFournisseurs(boutiqueId, [varianteId]);
    expect(resultat[varianteId]).toEqual({ id: recentFournisseurId, nom: "Nouveau Grossiste" });
  });

  it("n'inclut pas les variantes jamais commandées", () => {
    const autreVarianteId = randomUUID();
    const resultat = obtenirDerniersFournisseurs(boutiqueId, [varianteId, autreVarianteId]);
    expect(resultat[autreVarianteId]).toBeUndefined();
  });

  it("retourne un objet vide si aucune variante n'est demandée", () => {
    expect(obtenirDerniersFournisseurs(boutiqueId, [])).toEqual({});
  });
});
