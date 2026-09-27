import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";

import { executer, unResultat } from "../../electron/db/helpers";
import {
  ErreurAchat,
  annulerReception,
  creerCommande,
  creerFournisseur,
  listerFournisseurs,
  modifierFournisseur,
  supprimerFournisseur,
  historiqueAchats,
  suiviCommande,
  listerCommandes,
  listerHistoriqueReceptions,
  listerReceptionsCommande,
  modifierCommande,
  obtenirDerniersFournisseurs,
  payerDette,
  receptionnerCommande,
  retournerAuFournisseur,
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

  it("autorise l'annulation d'une commande jamais réceptionnée", () => {
    const commande = creerCommande({
      boutiqueId,
      fournisseurId,
      utilisateurId: "1",
      statut: "commandee",
      lignes: [{ varianteId, quantite: 1, prixAchat: 10000 }],
    });

    expect(() => modifierCommande(commande.id, { statut: "annulee" })).not.toThrow();
    const apres = unResultat<{ statut: string }>("SELECT statut FROM commandes_achat WHERE id = ?", [commande.id]);
    expect(apres!.statut).toBe("annulee");
  });

  it("refuse l'annulation et la modification des lignes après une réception partielle", () => {
    const depotId = randomUUID();
    executer("INSERT INTO depots (id, boutique_id, nom) VALUES (?, ?, ?)", [depotId, boutiqueId, "Magasin"]);
    const commande = creerCommande({
      boutiqueId,
      fournisseurId,
      utilisateurId: "1",
      statut: "commandee",
      lignes: [{ varianteId, quantite: 10, prixAchat: 10000 }],
    });
    receptionnerCommande({ commandeId: commande.id, depotId, utilisateurId: "1", lignes: [{ varianteId, quantite: 3 }] });

    expect(() => modifierCommande(commande.id, { statut: "annulee" })).toThrow(ErreurAchat);
    expect(() =>
      modifierCommande(commande.id, { lignes: [{ varianteId, quantite: 20, prixAchat: 10000 }] }),
    ).toThrow(ErreurAchat);
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

    receptionnerCommande({
      commandeId: commande.id,
      depotId,
      utilisateurId: "1",
      montantDejaPaye: 20000,
      lignes: [{ varianteId, quantite: 5 }],
    });

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

    receptionnerCommande({
      commandeId: commande.id,
      depotId,
      utilisateurId: "1",
      montantDejaPaye: 20000,
      lignes: [{ varianteId, quantite: 2 }],
    });

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

    expect(() =>
      receptionnerCommande({ commandeId: commande.id, depotId, utilisateurId: "1", lignes: [{ varianteId, quantite: 1 }] }),
    ).toThrow(ErreurAchat);
  });

  it("refuse si le montant déjà payé dépasse la valeur reçue", () => {
    const commande = creerCommande({
      boutiqueId,
      fournisseurId,
      utilisateurId: "1",
      statut: "commandee",
      lignes: [{ varianteId, quantite: 1, prixAchat: 10000 }],
    });

    expect(() =>
      receptionnerCommande({
        commandeId: commande.id,
        depotId,
        utilisateurId: "1",
        montantDejaPaye: 999999,
        lignes: [{ varianteId, quantite: 1 }],
      }),
    ).toThrow(ErreurAchat);
  });

  it("réceptionne partiellement : la commande reste 'commandee' puis passe à 'recue' une fois le reste reçu", () => {
    const commande = creerCommande({
      boutiqueId,
      fournisseurId,
      utilisateurId: "1",
      statut: "commandee",
      lignes: [{ varianteId, quantite: 10, prixAchat: 10000 }],
    });

    receptionnerCommande({ commandeId: commande.id, depotId, utilisateurId: "1", lignes: [{ varianteId, quantite: 6 }] });

    expect(stockActuel()).toBe(6);
    let apres = unResultat<{ statut: string }>("SELECT statut FROM commandes_achat WHERE id = ?", [commande.id]);
    expect(apres!.statut).toBe("commandee");
    const ligne = unResultat<{ quantite_recue: number }>("SELECT quantite_recue FROM lignes_achat WHERE commande_id = ?", [
      commande.id,
    ]);
    expect(Number(ligne!.quantite_recue)).toBe(6);

    receptionnerCommande({ commandeId: commande.id, depotId, utilisateurId: "1", lignes: [{ varianteId, quantite: 4 }] });

    expect(stockActuel()).toBe(10);
    apres = unResultat<{ statut: string }>("SELECT statut FROM commandes_achat WHERE id = ?", [commande.id]);
    expect(apres!.statut).toBe("recue");
  });

  it("trace les articles livrés à chaque réception et signale la commande partiellement reçue", () => {
    const commande = creerCommande({
      boutiqueId,
      fournisseurId,
      utilisateurId: "1",
      statut: "commandee",
      lignes: [{ varianteId, quantite: 10, prixAchat: 10000 }],
    });
    expect(listerCommandes(boutiqueId)[0].partiellementRecue).toBe(false);

    receptionnerCommande({ commandeId: commande.id, depotId, utilisateurId: "1", lignes: [{ varianteId, quantite: 6 }] });
    expect(listerCommandes(boutiqueId)[0].partiellementRecue).toBe(true);
    expect(listerCommandes(boutiqueId)[0]).toMatchObject({ quantiteCommandee: 10, quantiteRecue: 6 });

    receptionnerCommande({ commandeId: commande.id, depotId, utilisateurId: "1", lignes: [{ varianteId, quantite: 4 }] });
    // Totalement reçue : c'est le statut "recue" qui s'affiche, plus le badge partiel.
    expect(listerCommandes(boutiqueId)[0].partiellementRecue).toBe(false);

    const receptions = listerReceptionsCommande(commande.id);
    expect(receptions).toHaveLength(2);
    expect(receptions.map((r) => r.lignes.map((l) => [l.produitNom, Number(l.quantite)]))).toEqual([
      [["Riz 25kg", 6]],
      [["Riz 25kg", 4]],
    ]);
  });

  it("liste toutes les réceptions de la boutique, les plus récentes d'abord, filtrables par numéro", () => {
    const premiere = creerCommande({
      boutiqueId,
      fournisseurId,
      utilisateurId: "1",
      statut: "commandee",
      lignes: [{ varianteId, quantite: 10, prixAchat: 10000 }],
    });
    const seconde = creerCommande({
      boutiqueId,
      fournisseurId,
      utilisateurId: "1",
      statut: "commandee",
      lignes: [{ varianteId, quantite: 3, prixAchat: 10000 }],
    });
    receptionnerCommande({ commandeId: premiere.id, depotId, utilisateurId: "1", lignes: [{ varianteId, quantite: 6 }] });
    receptionnerCommande({ commandeId: seconde.id, depotId, utilisateurId: "1", lignes: [{ varianteId, quantite: 3 }] });
    // Les deux réceptions peuvent tomber dans la même milliseconde : on fixe
    // l'ordre chronologique pour que le tri « plus récentes d'abord » soit testable.
    executer("UPDATE receptions SET date_creation = '2026-01-01T00:00:00.000Z' WHERE commande_id = ?", [premiere.id]);

    const historique = listerHistoriqueReceptions(boutiqueId);
    expect(historique).toHaveLength(2);
    expect(historique[0]).toMatchObject({ commandeNumero: seconde.numero, fournisseurNom: "Grossiste Konan", depotNom: "Magasin" });
    expect(historique.map((r) => Number(r.lignes[0].quantite))).toEqual([3, 6]);

    expect(listerHistoriqueReceptions(boutiqueId, undefined, premiere.numero)).toHaveLength(1);
    expect(listerHistoriqueReceptions(randomUUID())).toHaveLength(0);
  });

  it("annule une réception : stock, commande et dette reviennent en arrière", () => {
    const commande = creerCommande({
      boutiqueId,
      fournisseurId,
      utilisateurId: "1",
      statut: "commandee",
      lignes: [{ varianteId, quantite: 10, prixAchat: 10000 }],
    });
    const receptionId = receptionnerCommande({
      commandeId: commande.id,
      depotId,
      utilisateurId: "1",
      montantDejaPaye: 20000,
      lignes: [{ varianteId, quantite: 10 }],
    });
    const { montantARecuperer } = annulerReception(receptionId, "1");

    expect(montantARecuperer).toBe(20000);
    expect(stockActuel()).toBe(0);
    const apres = unResultat<{ statut: string }>("SELECT statut FROM commandes_achat WHERE id = ?", [commande.id]);
    expect(apres!.statut).toBe("commandee");
    const dette = unResultat<{ solde: number; statut: string }>(
      "SELECT solde, statut FROM dettes_fournisseur WHERE reception_id = ?",
      [receptionId],
    );
    expect({ solde: Number(dette!.solde), statut: dette!.statut }).toEqual({ solde: 0, statut: "solde" });
    expect(listerReceptionsCommande(commande.id)[0].annulee).toBe(true);
    expect(() => annulerReception(receptionId, "1")).toThrow(ErreurAchat);
  });

  it("retour fournisseur partiel : stock, dette puis avoir, limite des quantités", () => {
    const commande = creerCommande({
      boutiqueId,
      fournisseurId,
      utilisateurId: "1",
      statut: "commandee",
      lignes: [{ varianteId, quantite: 10, prixAchat: 10000 }],
    });
    const receptionId = receptionnerCommande({
      commandeId: commande.id,
      depotId,
      utilisateurId: "1",
      montantDejaPaye: 70000, // dette : 30 000
      lignes: [{ varianteId, quantite: 10 }],
    });
    const resultat = retournerAuFournisseur({
      receptionId,
      lignes: [{ varianteId, quantite: 4 }],
      motif: "Sacs percés",
      utilisateurId: "1",
    });

    expect(resultat).toEqual({ montant: 40000, avoir: 10000 });
    expect(stockActuel()).toBe(6);
    const [reception] = listerReceptionsCommande(commande.id);
    expect(reception.lignes[0].quantiteRetournee).toBe(4);
    expect(reception.retours[0]).toMatchObject({ motif: "Sacs percés", montant: 40000, avoir: 10000 });
    expect(() =>
      retournerAuFournisseur({ receptionId, lignes: [{ varianteId, quantite: 7 }], utilisateurId: "1" }),
    ).toThrow(ErreurAchat);
    // Une réception dont des articles ont été retournés ne s'annule plus.
    expect(() => annulerReception(receptionId, "1")).toThrow(ErreurAchat);
  });

  it("refuse de réceptionner plus que la quantité restante", () => {
    const commande = creerCommande({
      boutiqueId,
      fournisseurId,
      utilisateurId: "1",
      statut: "commandee",
      lignes: [{ varianteId, quantite: 10, prixAchat: 10000 }],
    });

    receptionnerCommande({ commandeId: commande.id, depotId, utilisateurId: "1", lignes: [{ varianteId, quantite: 6 }] });

    expect(() =>
      receptionnerCommande({ commandeId: commande.id, depotId, utilisateurId: "1", lignes: [{ varianteId, quantite: 5 }] }),
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
      lignes: [{ varianteId, quantite: 5, prixVente: 14000 }],
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

    receptionnerCommande({ commandeId: commande.id, depotId, utilisateurId: "1", lignes: [{ varianteId, quantite: 5 }] });

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
        lignes: [{ varianteId, quantite: 5, prixVente: 9000 }],
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

describe("achats.historiqueAchats (carte « Historique » d'Achats & fournisseurs)", () => {
  const boutiqueId = randomUUID();
  const fournisseurId = randomUUID();
  const depotId = randomUUID();
  let varianteId: string;

  beforeEach(async () => {
    await creerBaseDeTest();
    executer("INSERT INTO fournisseurs (id, boutique_id, nom) VALUES (?, ?, ?)", [fournisseurId, boutiqueId, "Grossiste Konan"]);
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

  it("réunit commandes (avec qui et combien reçu), réceptions, paiements des deux origines et retours", () => {
    const commande = creerCommande({
      boutiqueId,
      fournisseurId,
      utilisateurId: "u1",
      statut: "commandee",
      lignes: [{ varianteId, quantite: 5, prixAchat: 10000 }],
    });
    const receptionId = receptionnerCommande({
      commandeId: commande.id,
      depotId,
      utilisateurId: "u1",
      montantDejaPaye: 20000,
      lignes: [{ varianteId, quantite: 5 }],
    });
    const detteId = unResultat<{ id: string }>("SELECT id FROM dettes_fournisseur WHERE commande_id = ?", [commande.id])!.id;
    payerDette(detteId, 10000, "especes");
    retournerAuFournisseur({ receptionId, lignes: [{ varianteId, quantite: 1 }], motif: "Sac percé", utilisateurId: "u1" });

    const historique = historiqueAchats(boutiqueId);
    expect(historique.commandes).toHaveLength(1);
    expect(historique.commandes[0]).toMatchObject({ utilisateurId: "u1", valeurRecue: 50000 });
    expect(historique.receptions).toHaveLength(1);
    expect(historique.paiements.map((p) => [p.origine, p.montant]).sort()).toEqual([
      ["dette", 10000],
      ["reception", 20000],
    ]);
    expect(historique.retours).toHaveLength(1);
    expect(historique.retours[0]).toMatchObject({ quantite: 1, motif: "Sac percé", commandeNumero: commande.numero });
  });
});

describe("achats.suiviCommande (suivi des étapes d'une commande)", () => {
  const boutiqueId = randomUUID();
  const fournisseurId = randomUUID();
  const depotId = randomUUID();
  let varianteId: string;

  beforeEach(async () => {
    await creerBaseDeTest();
    executer("INSERT INTO fournisseurs (id, boutique_id, nom) VALUES (?, ?, ?)", [fournisseurId, boutiqueId, "Grossiste Konan"]);
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

  function parcoursComplet() {
    const commande = creerCommande({
      boutiqueId,
      fournisseurId,
      utilisateurId: "u1",
      statut: "brouillon",
      lignes: [{ varianteId, quantite: 5, prixAchat: 10000 }],
    });
    modifierCommande(commande.id, { statut: "commandee", utilisateurId: "u2" });
    const receptionId = receptionnerCommande({
      commandeId: commande.id,
      depotId,
      utilisateurId: "u2",
      montantDejaPaye: 20000,
      lignes: [{ varianteId, quantite: 3 }],
    });
    const detteId = unResultat<{ id: string }>("SELECT id FROM dettes_fournisseur WHERE commande_id = ?", [commande.id])!.id;
    payerDette(detteId, 5000, "especes", null, "u1");
    retournerAuFournisseur({ receptionId, lignes: [{ varianteId, quantite: 1 }], motif: "Sac percé", utilisateurId: "u1" });
    return commande.id;
  }

  it("note chaque étape avec la personne, le détail et le montant", () => {
    const suivi = suiviCommande(parcoursComplet());
    expect(suivi.map((e) => e.type)).toEqual(["creee", "commandee", "reception", "paiement", "paiement", "retour"]);
    expect(suivi.every((e) => !e.reconstitue)).toBe(true);
    expect(suivi.map((e) => e.utilisateurId)).toEqual(["u1", "u2", "u2", "u2", "u1", "u1"]);
    expect(suivi[2].detail).toBe("3 articles reçus au dépôt Magasin · reçue en partie");
    expect(suivi[4].detail).toBe("Règlement de dette · Espèces");
    expect(suivi.map((e) => e.montant)).toEqual([50000, 50000, 30000, 20000, 5000, 10000]);
  });

  it("reconstitue à l'affichage les étapes d'une commande antérieure au suivi, sans rien écrire", () => {
    const commandeId = parcoursComplet();
    executer("DELETE FROM evenements_commande WHERE commande_id = ?", [commandeId]);
    const suivi = suiviCommande(commandeId);
    expect(suivi.map((e) => e.type).sort()).toEqual(["creee", "paiement", "paiement", "reception", "retour"].sort());
    expect(suivi.every((e) => e.reconstitue)).toBe(true);
    expect(unResultat<{ n: number }>("SELECT COUNT(*) as n FROM evenements_commande", [])!.n).toBe(0);
  });
});

describe("fournisseurs : modifier / supprimer", () => {
  const boutiqueId = randomUUID();
  const depotId = randomUUID();
  let varianteId: string;

  beforeEach(async () => {
    await creerBaseDeTest();
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

  it("refuse un nom déjà pris (accents et majuscules ignorés), à la création comme au renommage", () => {
    creerFournisseur(boutiqueId, "Établissement Diarra");
    const autre = creerFournisseur(boutiqueId, "Grossiste Konan");
    expect(() => creerFournisseur(boutiqueId, " etablissement diarra ")).toThrow(/existe déjà/);
    expect(() => modifierFournisseur(autre, { nom: "ETABLISSEMENT DIARRA" })).toThrow(/existe déjà/);
    modifierFournisseur(autre, { nom: "Grossiste Konan", telephone: "0700" });
    expect(listerFournisseurs(boutiqueId).find((f) => f.id === autre)!.telephone).toBe("0700");
  });

  it("refuse de supprimer avec une commande en cours ou une dette à payer, puis le retire des listes", () => {
    const fournisseurId = creerFournisseur(boutiqueId, "Grossiste Konan");
    const commande = creerCommande({
      boutiqueId,
      fournisseurId,
      utilisateurId: "u1",
      statut: "commandee",
      lignes: [{ varianteId, quantite: 2, prixAchat: 10000 }],
    });
    expect(() => supprimerFournisseur(fournisseurId)).toThrow(/commande\(s\) en cours/);

    receptionnerCommande({ commandeId: commande.id, depotId, utilisateurId: "u1", lignes: [{ varianteId, quantite: 2 }] });
    expect(() => supprimerFournisseur(fournisseurId)).toThrow(/Il reste 20000 à payer/);

    const detteId = unResultat<{ id: string }>("SELECT id FROM dettes_fournisseur WHERE commande_id = ?", [commande.id])!.id;
    payerDette(detteId, 20000);
    supprimerFournisseur(fournisseurId);
    expect(listerFournisseurs(boutiqueId)).toHaveLength(0);
    // L'historique garde son nom.
    expect(listerCommandes(boutiqueId)[0].fournisseurNom).toBe("Grossiste Konan");
  });
});
