import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";

import { executer, tousLesResultats, unResultat } from "../../electron/db/helpers";
import {
  ErreurCommandeClient,
  annulerCommandeClient,
  creerCommandeClient,
  livrerCommandeClient,
  modifierCommandeClient,
  obtenirCommandeClient,
  reservations,
  verserAvanceCommande,
} from "../../electron/services/commandesClient";
import { soldeCompteClient } from "../../electron/services/comptesTiers";
import { genererAlertesDestockage } from "../../electron/services/notifications";
import { annulerVente } from "../../electron/services/ventes";
import { creerBaseDeTest } from "../setup";

const boutiqueId = randomUUID();
const depotId = randomUUID();
const clientId = randomUUID();
let ciment: string;
let clous: string;

function creerVariante(nom: string, prixAchat: number, prixVente: number, stock: number): string {
  const produitId = randomUUID();
  const varianteId = randomUUID();
  executer("INSERT INTO produits (id, boutique_id, nom) VALUES (?, ?, ?)", [produitId, boutiqueId, nom]);
  executer("INSERT INTO variantes (id, produit_id, prix_achat, prix_vente) VALUES (?, ?, ?, ?)", [
    varianteId,
    produitId,
    prixAchat,
    prixVente,
  ]);
  executer("INSERT INTO stocks (id, variante_id, depot_id, quantite) VALUES (?, ?, ?, ?)", [
    randomUUID(),
    varianteId,
    depotId,
    stock,
  ]);
  return varianteId;
}

function quantiteEnStock(varianteId: string): number {
  return Number(
    unResultat<{ q: number }>("SELECT quantite as q FROM stocks WHERE variante_id = ? AND depot_id = ?", [
      varianteId,
      depotId,
    ])!.q,
  );
}

function nouvelleCommande() {
  return creerCommandeClient({
    boutiqueId,
    clientId,
    depotId,
    utilisateurId: null,
    dateLivraisonPrevue: "2026-10-09",
    note: "Livrer au chantier",
    lignes: [
      { varianteId: ciment, quantite: 20, prixUnitaire: 5000 },
      { varianteId: clous, quantite: 5, prixUnitaire: 1200 },
    ],
  });
}

beforeEach(async () => {
  await creerBaseDeTest();
  executer("INSERT INTO depots (id, boutique_id, nom) VALUES (?, ?, ?)", [depotId, boutiqueId, "Magasin"]);
  executer("INSERT INTO clients (id, boutique_id, nom) VALUES (?, ?, ?)", [clientId, boutiqueId, "M. Traoré"]);
  ciment = creerVariante("Ciment", 4000, 4800, 30);
  clous = creerVariante("Clous", 800, 1200, 10);
});

describe("commandes clients", () => {
  it("la commande fige les prix, ne touche pas au stock et réserve le restant", () => {
    const { id, numero, total } = nouvelleCommande();

    expect(numero).toMatch(/^CMC-\d{8}-[A-Z0-9]+-0001$/);
    expect(total).toBe(20 * 5000 + 5 * 1200);
    expect(quantiteEnStock(ciment)).toBe(30);
    const reserve = reservations(boutiqueId, depotId).find((r) => r.varianteId === ciment)!;
    expect(reserve.quantite).toBe(20);
    expect(reserve.commandes).toEqual([{ numero, clientNom: "M. Traoré", quantite: 20 }]);
    expect(obtenirCommandeClient(id)!.statut).toBe("en_attente");
  });

  it("avance sur le porte-monnaie, livraison partielle puis complète au prix de la commande", () => {
    const { id } = nouvelleCommande();
    verserAvanceCommande(id, { montant: 30000, mode: "especes", utilisateurId: null });
    expect(soldeCompteClient(clientId)).toBe(30000);
    expect(obtenirCommandeClient(id)!.avance).toBe(30000);

    // Première livraison : 10 sacs, payés avec l'avance puis en espèces.
    const vente = livrerCommandeClient({
      commandeId: id,
      utilisateurId: null,
      lignes: [{ varianteId: ciment, quantite: 10 }],
      paiements: [
        { mode: "compte_client", montant: 30000 },
        { mode: "especes", montant: 20000 },
      ],
    });
    expect(vente.totalNet).toBe(50000);
    expect(quantiteEnStock(ciment)).toBe(20);
    expect(soldeCompteClient(clientId)).toBe(0);
    let detail = obtenirCommandeClient(id)!;
    expect(detail.statut).toBe("partielle");
    expect(detail.livraisons.map((l) => l.numero)).toEqual([vente.numero]);
    expect(reservations(boutiqueId, depotId).find((r) => r.varianteId === ciment)!.quantite).toBe(10);

    // Reste : 10 sacs + 5 clous, à crédit.
    livrerCommandeClient({
      commandeId: id,
      utilisateurId: null,
      lignes: [
        { varianteId: ciment, quantite: 10 },
        { varianteId: clous, quantite: 5 },
      ],
      paiements: [{ mode: "credit", montant: 56000 }],
    });
    detail = obtenirCommandeClient(id)!;
    expect(detail.statut).toBe("livree");
    expect(reservations(boutiqueId, depotId)).toEqual([]);
    expect(() =>
      livrerCommandeClient({ commandeId: id, utilisateurId: null, lignes: [{ varianteId: ciment, quantite: 1 }], paiements: [] }),
    ).toThrow(ErreurCommandeClient);
  });

  it("refuse de livrer plus que le restant", () => {
    const { id } = nouvelleCommande();
    expect(() =>
      livrerCommandeClient({
        commandeId: id,
        utilisateurId: null,
        lignes: [{ varianteId: ciment, quantite: 21 }],
        paiements: [{ mode: "especes", montant: 105000 }],
      }),
    ).toThrow(ErreurCommandeClient);
  });

  it("annuler la vente d'une livraison remet les quantités à livrer", () => {
    const { id } = nouvelleCommande();
    const vente = livrerCommandeClient({
      commandeId: id,
      utilisateurId: null,
      lignes: [{ varianteId: ciment, quantite: 20 }],
      paiements: [{ mode: "especes", montant: 100000 }],
    });
    expect(obtenirCommandeClient(id)!.statut).toBe("partielle");

    annulerVente(vente.id, null);
    const detail = obtenirCommandeClient(id)!;
    expect(detail.statut).toBe("en_attente");
    expect(detail.lignes.find((l) => l.varianteId === ciment)!.quantiteLivree).toBe(0);
    expect(quantiteEnStock(ciment)).toBe(30);
  });

  it("modification : pas en dessous du livré, ligne livrée non retirable", () => {
    const { id } = nouvelleCommande();
    livrerCommandeClient({
      commandeId: id,
      utilisateurId: null,
      lignes: [{ varianteId: ciment, quantite: 5 }],
      paiements: [{ mode: "especes", montant: 25000 }],
    });
    expect(() =>
      modifierCommandeClient(id, { lignes: [{ varianteId: ciment, quantite: 4, prixUnitaire: 5000 }] }),
    ).toThrow(ErreurCommandeClient);
    expect(() => modifierCommandeClient(id, { lignes: [{ varianteId: clous, quantite: 5, prixUnitaire: 1200 }] })).toThrow(
      ErreurCommandeClient,
    );

    // Ciment ramené à ce qui est livré, clous retirés : la commande est complète.
    modifierCommandeClient(id, { lignes: [{ varianteId: ciment, quantite: 5, prixUnitaire: 9999 }] });
    const detail = obtenirCommandeClient(id)!;
    expect(detail.statut).toBe("livree");
    expect(detail.lignes).toHaveLength(1);
    expect(detail.lignes[0].prixUnitaire).toBe(5000);
    expect(detail.total).toBe(25000);
  });

  it("annulation : plus de réservation, l'avance reste sur le compte du client", () => {
    const { id } = nouvelleCommande();
    verserAvanceCommande(id, { montant: 10000, mode: "especes", utilisateurId: null });
    annulerCommandeClient(id);

    expect(obtenirCommandeClient(id)!.statut).toBe("annulee");
    expect(reservations(boutiqueId)).toEqual([]);
    expect(soldeCompteClient(clientId)).toBe(10000);
    expect(() => verserAvanceCommande(id, { montant: 5000, mode: "especes", utilisateurId: null })).toThrow(
      ErreurCommandeClient,
    );
  });

  it("alerte une seule fois une commande en retard de livraison", () => {
    executer("INSERT INTO boutiques (id, nom) VALUES (?, ?)", [boutiqueId, "Quincaillerie"]);
    const { id } = nouvelleCommande();
    const hier = new Date();
    hier.setDate(hier.getDate() - 1);
    const jour = `${hier.getFullYear()}-${String(hier.getMonth() + 1).padStart(2, "0")}-${String(hier.getDate()).padStart(2, "0")}`;
    modifierCommandeClient(id, { dateLivraisonPrevue: jour });

    genererAlertesDestockage(boutiqueId);
    genererAlertesDestockage(boutiqueId);
    const alertes = tousLesResultats<{ type: string; message: string }>(
      "SELECT type, message FROM notifications WHERE reference_id = ?",
      [id],
    );
    expect(alertes).toHaveLength(1);
    expect(alertes[0].type).toBe("commande_retard");
    expect(alertes[0].message).toContain("M. Traoré");
  });
});
