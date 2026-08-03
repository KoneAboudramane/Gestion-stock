import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";

import { executer, unResultat } from "../../electron/db/helpers";
import { REGISTRE_CLIENT } from "../../electron/db/registre";
import { pousser, tirer, versDonneesServeur, versLigneLocale } from "../../electron/services/sync";
import type { Session } from "../../electron/services/auth";
import { creerBaseDeTest } from "../setup";

const SESSION_TEST = { accessToken: "jeton-test", boutiqueId: "b1" } as Session;

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("conversion ligne locale <-> donnees serveur", () => {
  it("round-trip sur catalogue.Variante (avec FK)", () => {
    const entree = REGISTRE_CLIENT.find((e) => e.table === "catalogue.Variante")!;
    const ligneLocale = {
      id: "v1",
      produit_id: "p1",
      reference: "REF1",
      code_barres: "123",
      prix_achat: 100,
      prix_vente: 150,
      seuil_alerte: 5,
      actif: 1,
      date_creation: "2026-01-01T00:00:00Z",
      date_modification: "2026-01-02T00:00:00Z",
      synchronise: 0,
      supprime: 0,
      date_synchronisation: null,
    };

    const donnees = versDonneesServeur(entree, ligneLocale);
    expect(donnees.produit).toBe("p1");
    expect(donnees.produit_id).toBeUndefined();
    expect(donnees.id).toBeUndefined();
    expect(donnees.synchronise).toBeUndefined();
    expect(donnees.reference).toBe("REF1");

    const donneesServeur = {
      id: "v1",
      produit: "p1",
      reference: "REF1",
      code_barres: "123",
      prix_achat: "100.00",
      prix_vente: "150.00",
      seuil_alerte: "5.00",
      actif: true,
      synchronise: true,
      supprime: false,
      date_creation: "2026-01-01T00:00:00Z",
      date_modification: "2026-01-02T00:00:00Z",
    };
    const ligneReconstruite = versLigneLocale(entree, donneesServeur);
    expect(ligneReconstruite.produit_id).toBe("p1");
    expect(ligneReconstruite.produit).toBeUndefined();
    expect(ligneReconstruite.actif).toBe(1);
    expect(ligneReconstruite.supprime).toBe(0);
  });

  it("ne confond pas reference_id (pas une FK) avec une vraie FK", () => {
    const entree = REGISTRE_CLIENT.find((e) => e.table === "stock.MouvementStock")!;
    const ligne = {
      id: "m1",
      variante_id: "v1",
      depot_id: "d1",
      type: "entree",
      quantite: 10,
      reference_type: "ventes.Vente",
      reference_id: "vente1",
      utilisateur_id: "u1",
    };
    const donnees = versDonneesServeur(entree, ligne);
    expect(donnees.variante).toBe("v1");
    expect(donnees.reference_id).toBe("vente1"); // pas converti en "reference"
    expect(donnees.reference).toBeUndefined();
  });
});

describe("pousser", () => {
  beforeEach(async () => {
    await creerBaseDeTest();
  });

  it("construit le bon payload et ne marque synchronise=1 que sur les succès", async () => {
    executer("INSERT INTO categories (id, boutique_id, nom, synchronise, supprime) VALUES (?, ?, ?, 0, 0)", [
      "c1",
      "b1",
      "Cat A",
    ]);
    executer("INSERT INTO clients (id, boutique_id, nom, synchronise, supprime) VALUES (?, ?, ?, 0, 0)", [
      "cl1",
      "b1",
      "Client A",
    ]);

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        resultats: [
          { table: "catalogue.Categorie", enregistrement_id: "c1", statut: "synchronise" },
          { table: "clients.Client", enregistrement_id: "cl1", statut: "conflit" },
        ],
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await pousser(SESSION_TEST, "appareil-test");

    expect(fetchMock).toHaveBeenCalledOnce();
    const options = fetchMock.mock.calls[0][1] as RequestInit;
    const corps = JSON.parse(options.body as string);
    expect(corps.appareil).toBe("appareil-test");
    expect(corps.changements).toHaveLength(2);

    const categorie = unResultat<{ synchronise: number }>("SELECT synchronise FROM categories WHERE id = ?", ["c1"]);
    expect(Number(categorie!.synchronise)).toBe(1);
    const client = unResultat<{ synchronise: number }>("SELECT synchronise FROM clients WHERE id = ?", ["cl1"]);
    expect(Number(client!.synchronise)).toBe(0);
  });

  it("ne pousse pas les lignes non synchronisées d'une autre boutique laissées sur ce même appareil", async () => {
    executer("INSERT INTO categories (id, boutique_id, nom, synchronise, supprime) VALUES (?, ?, ?, 0, 0)", [
      "c1",
      "b1",
      "Cat de b1",
    ]);
    // Boutique b2 : jamais celle de la session en cours (SESSION_TEST.boutiqueId === "b1"),
    // mais des lignes non synchronisées traînent localement (ex. compte précédemment
    // utilisé sur ce poste). Elles ne doivent jamais être poussées sous l'identité de b1.
    executer("INSERT INTO categories (id, boutique_id, nom, synchronise, supprime) VALUES (?, ?, ?, 0, 0)", [
      "c2",
      "b2",
      "Cat de b2",
    ]);

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        resultats: [{ table: "catalogue.Categorie", enregistrement_id: "c1", statut: "synchronise" }],
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await pousser(SESSION_TEST, "appareil-test");

    const options = fetchMock.mock.calls[0][1] as RequestInit;
    const corps = JSON.parse(options.body as string);
    expect(corps.changements).toHaveLength(1);
    expect(corps.changements[0].enregistrement_id).toBe("c1");

    const c2 = unResultat<{ synchronise: number }>("SELECT synchronise FROM categories WHERE id = ?", ["c2"]);
    expect(Number(c2!.synchronise)).toBe(0);
  });
});

describe("tirer", () => {
  beforeEach(async () => {
    await creerBaseDeTest();
  });

  it("upsert les enregistrements reçus, y compris une mise à jour et une suppression", async () => {
    executer("INSERT INTO categories (id, boutique_id, nom) VALUES (?, ?, ?)", ["c1", "b1", "Ancien nom"]);

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        maintenant: "2026-01-03T00:00:00Z",
        tables: [
          {
            table: "catalogue.Categorie",
            enregistrements: [
              {
                id: "c1",
                boutique: "b1",
                nom: "Nom mis à jour",
                categorie_parent: null,
                synchronise: true,
                supprime: false,
                date_creation: "2026-01-01T00:00:00Z",
                date_modification: "2026-01-03T00:00:00Z",
              },
              {
                id: "c2",
                boutique: "b1",
                nom: "Catégorie supprimée ailleurs",
                categorie_parent: null,
                synchronise: true,
                supprime: true,
                date_creation: "2026-01-01T00:00:00Z",
                date_modification: "2026-01-03T00:00:00Z",
              },
            ],
          },
        ],
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const curseur = await tirer(SESSION_TEST, null);
    expect(curseur).toBe("2026-01-03T00:00:00Z");

    const c1 = unResultat<{ nom: string }>("SELECT nom FROM categories WHERE id = ?", ["c1"]);
    expect(c1!.nom).toBe("Nom mis à jour");
    const c2 = unResultat<{ supprime: number }>("SELECT supprime FROM categories WHERE id = ?", ["c2"]);
    expect(Number(c2!.supprime)).toBe(1);
  });

  it("un pull de mouvements_stock recalcule le stock local", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        maintenant: "2026-01-03T00:00:00Z",
        tables: [
          {
            table: "stock.MouvementStock",
            enregistrements: [
              {
                id: "m1",
                variante: "v1",
                depot: "d1",
                type: "entree",
                quantite: "10.00",
                motif: "",
                reference_type: "",
                reference_id: null,
                utilisateur: null,
                synchronise: true,
                supprime: false,
                date_creation: "2026-01-01T00:00:00Z",
                date_modification: "2026-01-01T00:00:00Z",
              },
            ],
          },
        ],
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await tirer(SESSION_TEST, null);

    const stock = unResultat<{ quantite: number }>(
      "SELECT quantite FROM stocks WHERE variante_id = ? AND depot_id = ?",
      ["v1", "d1"],
    );
    expect(Number(stock!.quantite)).toBe(10);
  });
});
