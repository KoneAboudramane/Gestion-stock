import { useEffect, useMemo, useState } from "react";
import type { CSSProperties } from "react";

import type { Session } from "../api";
import ChampMontant from "../components/ChampMontant";
import ModaleConfirmation from "../components/ModaleConfirmation";
import { formaterMontant } from "../lib/formatage";
import { listerDepots, type DepotResume } from "../services/catalogue";
import {
  creerCategorie,
  creerProduit,
  creerValeurAttribut,
  creerVariante,
  ErreurProduit,
  listerAttributs,
  listerCategories,
  listerValeursAttribut,
  modifierCategorie,
  modifierProduit,
  modifierVariante,
  obtenirProduit,
  prochaineReferenceProduit,
  supprimerCategorie,
  supprimerProduit,
  listerProduits as listerProduitsLocal,
  listerUnites,
  type ProduitDetail,
  type ProduitResume,
  type ReferenceNommee,
  type UniteResume,
  type ValeurAttributResume,
  type VarianteResume,
} from "../services/produits";
import { appliquerMouvement, ErreurStock } from "../services/stock";

/**
 * Port de client-electron/src/pages/Produits.tsx : gestion du catalogue
 * (produits, variantes, catégories, unités) — local d'abord (IndexedDB),
 * synchronisé en tâche de fond comme le reste de l'application (voir
 * services/produits.ts, miroir de electron/services/produits.ts).
 *
 * Variantes multi-attributs (Taille/Couleur...) + aperçu de référence
 * (2026-08-22, parité Electron) : LigneNouvelleVariante dans DetailProduit,
 * colonnes Code-barres/Attributs affichées seulement si au moins une variante
 * du produit les utilise (comme côté Electron), et referenceApercu dans
 * FormulaireProduitsGroupe.
 *
 * Non repris ici par rapport à l'Electron (à ajouter dans une phase ultérieure si
 * besoin) : historique des mouvements/ventes dans la fiche produit (onglets
 * "Historique des mouvements de stock" / "Historique des ventes").
 */

function FormulaireEditionProduit({
  produit,
  categories,
  unites,
  onAnnuler,
  onModifie,
}: {
  produit: ProduitDetail;
  categories: ReferenceNommee[];
  unites: UniteResume[];
  onAnnuler: () => void;
  onModifie: () => void;
}) {
  const [nom, setNom] = useState(produit.nom);
  const [categorieId, setCategorieId] = useState(produit.categorieId ?? "");
  const [uniteId, setUniteId] = useState(produit.uniteId ?? "");
  const [description, setDescription] = useState(produit.description);
  const [erreur, setErreur] = useState<string | null>(null);
  const [enCours, setEnCours] = useState(false);

  async function enregistrer() {
    setErreur(null);
    if (!nom.trim()) {
      setErreur("Le nom est requis.");
      return;
    }
    setEnCours(true);
    try {
      await modifierProduit(produit.id, {
        nom: nom.trim(),
        categorieId: categorieId || null,
        uniteId: uniteId || null,
        description,
      });
      onModifie();
    } catch (e) {
      setErreur(e instanceof ErreurProduit ? e.message : "Erreur inattendue.");
    } finally {
      setEnCours(false);
    }
  }

  return (
    <tr className="ligne-edition">
      <td>
        <input value={nom} onChange={(e) => setNom(e.target.value)} autoFocus />
      </td>
      <td>
        <select value={categorieId} onChange={(e) => setCategorieId(e.target.value)}>
          <option value=""></option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.nom}
            </option>
          ))}
        </select>
      </td>
      <td>
        <select value={uniteId} onChange={(e) => setUniteId(e.target.value)}>
          <option value=""></option>
          {unites.map((u) => (
            <option key={u.id} value={u.id}>
              {u.nom}
            </option>
          ))}
        </select>
      </td>
      <td>
        <textarea value={description} onChange={(e) => setDescription(e.target.value)} />
      </td>
      <td>
        {erreur && <div className="message-erreur">{erreur}</div>}
        <span className="actions-ligne">
          <button type="button" className="bouton-primaire" onClick={enregistrer} disabled={enCours}>
            {enCours ? "Enregistrement…" : "Enregistrer"}
          </button>
          <button type="button" className="lien" onClick={onAnnuler}>
            Annuler
          </button>
        </span>
      </td>
    </tr>
  );
}

function FormulaireAjoutStock({
  varianteId,
  depots,
  utilisateurId,
  onAnnuler,
  onAjoute,
}: {
  varianteId: string;
  depots: DepotResume[];
  utilisateurId: string | null;
  onAnnuler: () => void;
  onAjoute: () => void;
}) {
  const [depotId, setDepotId] = useState(depots[0]?.id ?? "");
  const [quantite, setQuantite] = useState("1");
  const [motif, setMotif] = useState("Stock initial");
  const [erreur, setErreur] = useState<string | null>(null);
  const [enCours, setEnCours] = useState(false);

  async function soumettre(evenement: React.FormEvent) {
    evenement.preventDefault();
    setErreur(null);
    if (!depotId) {
      setErreur("Choisissez un dépôt.");
      return;
    }
    const quantiteNombre = Number(quantite);
    if (!quantiteNombre || quantiteNombre <= 0) {
      setErreur("Quantité invalide.");
      return;
    }
    setEnCours(true);
    try {
      await appliquerMouvement({
        varianteId,
        depotId,
        type: "entree",
        quantite: quantiteNombre,
        motif,
        utilisateurId,
        referenceType: "catalogue.Variante",
        referenceId: varianteId,
      });
      onAjoute();
    } catch (e) {
      setErreur(e instanceof ErreurStock ? e.message : "Erreur inattendue.");
    } finally {
      setEnCours(false);
    }
  }

  return (
    <form onSubmit={soumettre} className="formulaire-inline formulaire-ajout-stock">
      {erreur && <div className="message-erreur">{erreur}</div>}
      <select value={depotId} onChange={(e) => setDepotId(e.target.value)}>
        {depots.map((d) => (
          <option key={d.id} value={d.id}>
            {d.nom}
          </option>
        ))}
      </select>
      <input type="number" min={0.01} step="any" value={quantite} onChange={(e) => setQuantite(e.target.value)} autoFocus />
      <input placeholder="Motif" value={motif} onChange={(e) => setMotif(e.target.value)} />
      <button type="submit" disabled={enCours}>
        {enCours ? "Ajout…" : "Ajouter"}
      </button>
      <button type="button" className="lien" onClick={onAnnuler}>
        Annuler
      </button>
    </form>
  );
}

function LigneNouvelleVariante({
  produitId,
  session,
  afficherCodeBarres,
  afficherAttributs,
  peutVoirCout,
  nombreColonnes,
  onAnnuler,
  onCree,
}: {
  produitId: string;
  session: Session;
  afficherCodeBarres: boolean;
  afficherAttributs: boolean;
  peutVoirCout: boolean;
  nombreColonnes: number;
  onAnnuler: () => void;
  onCree: () => void;
}) {
  const peutModifierPrix = !!session.permissions.modifier_prix;

  const [attributs, setAttributs] = useState<ReferenceNommee[]>([]);
  const [valeursParAttribut, setValeursParAttribut] = useState<Record<string, ValeurAttributResume[]>>({});
  const [selection, setSelection] = useState<Record<string, string>>({});
  const [nouvelleValeur, setNouvelleValeur] = useState<Record<string, string>>({});
  const [codeBarres, setCodeBarres] = useState("");
  const [prixAchat, setPrixAchat] = useState("0");
  const [prixVente, setPrixVente] = useState("0");
  const [seuilAlerte, setSeuilAlerte] = useState("0");
  const [erreur, setErreur] = useState<string | null>(null);
  const [enCours, setEnCours] = useState(false);
  const sousPrixAchat = Number(prixVente) > 0 && Number(prixAchat) > 0 && Number(prixVente) < Number(prixAchat);

  useEffect(() => {
    listerAttributs(session.boutiqueId).then(async (liste) => {
      setAttributs(liste);
      const valeurs: Record<string, ValeurAttributResume[]> = {};
      for (const a of liste) {
        valeurs[a.id] = await listerValeursAttribut(a.id);
      }
      setValeursParAttribut(valeurs);
    });
  }, [session.boutiqueId]);

  async function ajouterValeur(attributId: string) {
    const valeur = (nouvelleValeur[attributId] || "").trim();
    if (!valeur) return;
    const id = await creerValeurAttribut(attributId, valeur);
    const liste = await listerValeursAttribut(attributId);
    setValeursParAttribut((actuel) => ({ ...actuel, [attributId]: liste }));
    setSelection((actuel) => ({ ...actuel, [attributId]: id }));
    setNouvelleValeur((actuel) => ({ ...actuel, [attributId]: "" }));
  }

  async function creer() {
    setErreur(null);
    setEnCours(true);
    try {
      const valeurAttributIds = Object.values(selection).filter(Boolean);
      await creerVariante({
        produitId,
        codeBarres,
        prixAchat: Number(prixAchat) || 0,
        prixVente: Number(prixVente) || 0,
        seuilAlerte: Number(seuilAlerte) || 0,
        valeurAttributIds,
      });
      onCree();
    } catch (e) {
      setErreur(e instanceof ErreurProduit ? e.message : "Erreur inattendue.");
    } finally {
      setEnCours(false);
    }
  }

  return (
    <>
      <tr className="ligne-edition">
        <td className="reference-auto">Auto</td>
        {afficherCodeBarres && (
          <td>
            <input value={codeBarres} onChange={(e) => setCodeBarres(e.target.value)} autoFocus />
          </td>
        )}
        {afficherAttributs && <td className="reference-auto">Auto</td>}
        {peutVoirCout && (
          <td>
            <ChampMontant value={prixAchat} disabled={!peutModifierPrix} onChange={setPrixAchat} />
          </td>
        )}
        <td>
          <ChampMontant
            className={sousPrixAchat ? "champ-invalide" : undefined}
            value={prixVente}
            disabled={!peutModifierPrix}
            onChange={setPrixVente}
          />
          {sousPrixAchat && (
            <span className="badge-rupture" title="Le prix de vente est inférieur au prix d'achat">
              ⚠
            </span>
          )}
        </td>
        <td>
          <input type="number" min={0} step="any" value={seuilAlerte} onChange={(e) => setSeuilAlerte(e.target.value)} />
        </td>
        <td className="reference-auto">0</td>
        <td className="colonne-actions-variante">
          {erreur && <div className="message-erreur">{erreur}</div>}
          <span className="actions-ligne">
            <button type="button" className="bouton-primaire" onClick={creer} disabled={enCours}>
              {enCours ? "Création…" : "Créer"}
            </button>
            <button type="button" className="lien" onClick={onAnnuler}>
              Annuler
            </button>
          </span>
        </td>
      </tr>
      {attributs.length > 0 && (
        <tr>
          <td colSpan={nombreColonnes}>
            {attributs.map((a) => (
              <div key={a.id} className="ligne-attribut">
                <label>
                  {a.nom}
                  <select
                    value={selection[a.id] || ""}
                    onChange={(e) => setSelection((s) => ({ ...s, [a.id]: e.target.value }))}
                  >
                    <option value=""></option>
                    {(valeursParAttribut[a.id] || []).map((v) => (
                      <option key={v.id} value={v.id}>
                        {v.valeur}
                      </option>
                    ))}
                  </select>
                </label>
                <input
                  placeholder={`Nouvelle valeur (${a.nom})`}
                  value={nouvelleValeur[a.id] || ""}
                  onChange={(e) => setNouvelleValeur((n) => ({ ...n, [a.id]: e.target.value }))}
                />
                <button type="button" className="bouton-primaire" onClick={() => ajouterValeur(a.id)}>
                  + Ajouter
                </button>
              </div>
            ))}
          </td>
        </tr>
      )}
    </>
  );
}

function LigneEditionVariante({
  index,
  variante,
  peutVoirCout,
  peutModifierPrix,
  afficherCodeBarres,
  afficherAttributs,
  onAnnuler,
  onModifie,
}: {
  index: number;
  variante: VarianteResume;
  peutVoirCout: boolean;
  peutModifierPrix: boolean;
  afficherCodeBarres: boolean;
  afficherAttributs: boolean;
  onAnnuler: () => void;
  onModifie: () => void;
}) {
  const [reference, setReference] = useState(variante.reference);
  const [codeBarres, setCodeBarres] = useState(variante.codeBarres);
  const [prixAchat, setPrixAchat] = useState(String(variante.prixAchat ?? 0));
  const [prixVente, setPrixVente] = useState(String(variante.prixVente));
  const [seuilAlerte, setSeuilAlerte] = useState(String(variante.seuilAlerte));
  const [erreur, setErreur] = useState<string | null>(null);
  const [enCours, setEnCours] = useState(false);
  const sousPrixAchat = Number(prixVente) > 0 && Number(prixAchat) > 0 && Number(prixVente) < Number(prixAchat);

  async function enregistrer() {
    setErreur(null);
    setEnCours(true);
    try {
      await modifierVariante(variante.id, {
        reference,
        codeBarres,
        prixAchat: Number(prixAchat) || 0,
        prixVente: Number(prixVente) || 0,
        seuilAlerte: Number(seuilAlerte) || 0,
      });
      onModifie();
    } catch (e) {
      setErreur(e instanceof ErreurProduit ? e.message : "Erreur inattendue.");
    } finally {
      setEnCours(false);
    }
  }

  return (
    <tr className="ligne-edition">
      <td>{index}</td>
      <td>
        <input value={reference} onChange={(e) => setReference(e.target.value)} autoFocus />
      </td>
      {afficherCodeBarres && (
        <td>
          <input value={codeBarres} onChange={(e) => setCodeBarres(e.target.value)} />
        </td>
      )}
      {afficherAttributs && <td>{variante.valeurs.join(", ") || ""}</td>}
      {peutVoirCout && (
        <td>
          <ChampMontant value={prixAchat} disabled={!peutModifierPrix} onChange={setPrixAchat} />
        </td>
      )}
      <td>
        <ChampMontant
          className={sousPrixAchat ? "champ-invalide" : undefined}
          value={prixVente}
          disabled={!peutModifierPrix}
          onChange={setPrixVente}
        />
        {sousPrixAchat && (
          <span className="badge-rupture" title="Le prix de vente est inférieur au prix d'achat">
            ⚠
          </span>
        )}
      </td>
      <td>
        <input type="number" min={0} step="any" value={seuilAlerte} onChange={(e) => setSeuilAlerte(e.target.value)} />
      </td>
      <td>{variante.quantiteStock}</td>
      <td className="colonne-actions-variante">
        {erreur && <div className="message-erreur">{erreur}</div>}
        <span className="actions-ligne">
          <button type="button" className="bouton-primaire" onClick={enregistrer} disabled={enCours}>
            {enCours ? "Enregistrement…" : "Enregistrer"}
          </button>
          <button type="button" className="lien" onClick={onAnnuler}>
            Annuler
          </button>
        </span>
      </td>
    </tr>
  );
}

function DetailProduit({
  produitId,
  session,
  categories,
  unites,
  depots,
  onFermer,
}: {
  produitId: string;
  session: Session;
  categories: ReferenceNommee[];
  unites: UniteResume[];
  depots: DepotResume[];
  onFermer: () => void;
}) {
  const peutGerer = !!session.permissions.gerer_produits_stock_achats;
  const peutVoirCout = !!session.permissions.voir_benefices_achat;
  const peutModifierPrix = !!session.permissions.modifier_prix;

  const [produit, setProduit] = useState<ProduitDetail | null>(null);
  const [modifierInfos, setModifierInfos] = useState(false);
  const [afficherFormVariante, setAfficherFormVariante] = useState(false);
  const [varianteEnEdition, setVarianteEnEdition] = useState<string | null>(null);
  const [varianteAjoutStock, setVarianteAjoutStock] = useState<string | null>(null);
  const [messageStock, setMessageStock] = useState<string | null>(null);

  async function rafraichir() {
    const resultat = await obtenirProduit(produitId);
    if (resultat) setProduit(resultat);
  }

  useEffect(() => {
    rafraichir();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [produitId]);

  const afficherCodeBarres = !!produit?.variantes.some((v) => v.codeBarres);
  const afficherAttributs = !!produit?.variantes.some((v) => v.valeurs.length > 0);
  const nombreColonnes =
    1 + // N°
    1 + // Référence
    (afficherCodeBarres ? 1 : 0) +
    (afficherAttributs ? 1 : 0) +
    (peutVoirCout ? 1 : 0) +
    1 + // Prix de vente
    1 + // Seuil
    1 + // Stock
    (peutGerer ? 1 : 0);

  return (
    <div className="fond-modale" onClick={onFermer}>
      <div className="modale-selection-produits" onClick={(e) => e.stopPropagation()}>
        <div className="modale-entete">
          <h3>{produit ? produit.nom : "Article"}</h3>
          <button type="button" className="lien bouton-retour" onClick={onFermer}>
            ← Retour
          </button>
        </div>
        <div className="modale-corps">
          {!produit ? (
            <p>Chargement…</p>
          ) : (
            <div className="detail-produit-modale-scroll">
              <h4>Informations</h4>
              <div className="zone-tableau-scroll zone-tableau-scroll-modale">
                <table className="tableau-catalogue">
                  <thead>
                    <tr>
                      <th>Désignation</th>
                      <th>Catégorie</th>
                      <th>Unité</th>
                      <th>Description</th>
                      {peutGerer && <th />}
                    </tr>
                  </thead>
                  <tbody>
                    {modifierInfos ? (
                      <FormulaireEditionProduit
                        produit={produit}
                        categories={categories}
                        unites={unites}
                        onAnnuler={() => setModifierInfos(false)}
                        onModifie={() => {
                          setModifierInfos(false);
                          rafraichir();
                        }}
                      />
                    ) : (
                      <tr>
                        <td>{produit.nom}</td>
                        <td>{produit.categorieNom || ""}</td>
                        <td>{produit.uniteNom || ""}</td>
                        <td>{produit.description || ""}</td>
                        {peutGerer && (
                          <td>
                            <button type="button" onClick={() => setModifierInfos(true)}>
                              Modifier
                            </button>
                          </td>
                        )}
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              <div className="entete-section-tableau">
                <h4>Variantes</h4>
                {peutGerer && !afficherFormVariante && (
                  <button type="button" className="bouton-ajouter-variante" onClick={() => setAfficherFormVariante(true)}>
                    + Ajouter une variante
                  </button>
                )}
              </div>
              {messageStock && <p className="note-aide">{messageStock}</p>}
              <div className="zone-tableau-scroll zone-tableau-scroll-modale">
                <table className="tableau-catalogue">
                  <thead>
                    <tr>
                      <th>N°</th>
                      <th>Référence</th>
                      {afficherCodeBarres && <th>Code-barres</th>}
                      {afficherAttributs && <th>Attributs</th>}
                      {peutVoirCout && <th>Prix d'achat</th>}
                      <th>Prix de vente</th>
                      <th>Seuil</th>
                      <th>Stock</th>
                      {peutGerer && <th className="colonne-actions-variante">Actions</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {produit.variantes.map((v, index) => {
                      if (varianteEnEdition === v.id) {
                        return (
                          <LigneEditionVariante
                            key={v.id}
                            index={index + 1}
                            variante={v}
                            peutVoirCout={peutVoirCout}
                            peutModifierPrix={peutModifierPrix}
                            afficherCodeBarres={afficherCodeBarres}
                            afficherAttributs={afficherAttributs}
                            onAnnuler={() => setVarianteEnEdition(null)}
                            onModifie={() => {
                              setVarianteEnEdition(null);
                              rafraichir();
                            }}
                          />
                        );
                      }
                      return (
                        <tr key={v.id}>
                          <td>{index + 1}</td>
                          <td>{v.reference || ""}</td>
                          {afficherCodeBarres && <td>{v.codeBarres || ""}</td>}
                          {afficherAttributs && <td>{v.valeurs.join(", ") || ""}</td>}
                          {peutVoirCout && <td>{formaterMontant(v.prixAchat ?? 0)}</td>}
                          <td>{formaterMontant(v.prixVente)}</td>
                          <td>{v.seuilAlerte}</td>
                          <td>
                            {v.quantiteStock <= v.seuilAlerte ? (
                              <span className="badge-rupture">{v.quantiteStock}</span>
                            ) : (
                              v.quantiteStock
                            )}
                          </td>
                          {peutGerer && (
                            <td className="colonne-actions-variante">
                              <span className="actions-ligne">
                                <button type="button" onClick={() => setVarianteEnEdition(v.id)}>
                                  Modifier
                                </button>
                                <button
                                  type="button"
                                  className="bouton-ajouter-stock-ligne"
                                  onClick={() => setVarianteAjoutStock(v.id)}
                                >
                                  + Ajouter du stock
                                </button>
                              </span>
                            </td>
                          )}
                        </tr>
                      );
                    })}
                    {afficherFormVariante && (
                      <LigneNouvelleVariante
                        produitId={produit.id}
                        session={session}
                        afficherCodeBarres={afficherCodeBarres}
                        afficherAttributs={afficherAttributs}
                        peutVoirCout={peutVoirCout}
                        nombreColonnes={nombreColonnes}
                        onAnnuler={() => setAfficherFormVariante(false)}
                        onCree={() => {
                          setAfficherFormVariante(false);
                          rafraichir();
                        }}
                      />
                    )}
                    {varianteAjoutStock &&
                      produit.variantes.some((v) => v.id === varianteAjoutStock) && (
                        <tr>
                          <td colSpan={nombreColonnes}>
                            <FormulaireAjoutStock
                              varianteId={varianteAjoutStock}
                              depots={depots}
                              utilisateurId={session.utilisateurId}
                              onAnnuler={() => setVarianteAjoutStock(null)}
                              onAjoute={() => {
                                setVarianteAjoutStock(null);
                                setMessageStock("Stock ajouté.");
                                rafraichir();
                              }}
                            />
                          </td>
                        </tr>
                      )}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

interface LigneProduitGroupe {
  id: string;
  nom: string;
  categorieId: string;
  categorieNom: string;
  uniteId: string;
  uniteNom: string;
  codeBarres: string;
  prixAchat: string;
  prixVente: string;
  seuilAlerte: string;
  quantiteInitiale: string;
}

/**
 * Création groupée (plusieurs articles en une fois), port de
 * client-electron/src/pages/Produits.tsx::FormulaireProduitsGroupe. La version
 * précédente (un seul article par ouverture du formulaire) laissait la moitié
 * inférieure du modal vide — les modals de l'app ont une hauteur fixe (88vh,
 * volontairement identique quel que soit le contenu, voir mémoire projet
 * "dimension_modals_fixe"), donc c'est le contenu qui doit remplir l'espace,
 * pas le modal qui doit rétrécir.
 */
function FormulaireProduitsGroupe({
  session,
  categories,
  unites,
  depots,
  onAnnuler,
  onCree,
}: {
  session: Session;
  categories: ReferenceNommee[];
  unites: UniteResume[];
  depots: DepotResume[];
  onAnnuler: () => void;
  onCree: () => void;
}) {
  const peutModifierPrix = !!session.permissions.modifier_prix;

  const [depotId, setDepotId] = useState("");

  const [nom, setNom] = useState("");
  const [categorieId, setCategorieId] = useState("");
  const [uniteId, setUniteId] = useState("");
  const [codeBarres, setCodeBarres] = useState("");
  const [prixAchat, setPrixAchat] = useState("0");
  const [prixVente, setPrixVente] = useState("0");
  const [seuilAlerte, setSeuilAlerte] = useState("0");
  const [quantiteInitiale, setQuantiteInitiale] = useState("0");

  const [lignes, setLignes] = useState<LigneProduitGroupe[]>([]);
  const [erreur, setErreur] = useState<string | null>(null);
  const [enCours, setEnCours] = useState(false);
  const [prochaineRefBase, setProchaineRefBase] = useState<number | null>(null);
  const sousPrixAchat = Number(prixVente) > 0 && Number(prixAchat) > 0 && Number(prixVente) < Number(prixAchat);

  useEffect(() => {
    prochaineReferenceProduit(session.boutiqueId).then((ref) => {
      const n = Number(ref.replace(/^REF-/, ""));
      setProchaineRefBase(Number.isFinite(n) ? n : null);
    });
  }, [session.boutiqueId]);

  function referenceApercu(index: number): string {
    if (prochaineRefBase === null) return "Auto";
    return `REF-${String(prochaineRefBase + index).padStart(6, "0")}`;
  }

  function ajouterProduit() {
    if (!nom.trim()) return;
    setLignes((actuel) => [
      ...actuel,
      {
        id: crypto.randomUUID(),
        nom: nom.trim(),
        categorieId,
        categorieNom: categories.find((c) => c.id === categorieId)?.nom ?? "",
        uniteId,
        uniteNom: unites.find((u) => u.id === uniteId)?.nom ?? "",
        codeBarres,
        prixAchat,
        prixVente,
        seuilAlerte,
        quantiteInitiale,
      },
    ]);
    setNom("");
    setCategorieId("");
    setUniteId("");
    setCodeBarres("");
    setPrixAchat("0");
    setPrixVente("0");
    setSeuilAlerte("0");
    setQuantiteInitiale("0");
  }

  function surEntree(evenement: React.KeyboardEvent) {
    if (evenement.key === "Enter") {
      evenement.preventDefault();
      ajouterProduit();
    }
  }

  function retirerLigne(id: string) {
    setLignes((actuel) => actuel.filter((l) => l.id !== id));
  }

  async function soumettre(evenement: React.FormEvent) {
    evenement.preventDefault();
    setErreur(null);
    if (lignes.length === 0) {
      setErreur("Ajoutez au moins un article à la liste.");
      return;
    }
    setEnCours(true);
    try {
      for (const ligne of lignes) {
        let cree;
        try {
          cree = await creerProduit({
            boutiqueId: session.boutiqueId,
            nom: ligne.nom,
            categorieId: ligne.categorieId || null,
            uniteId: ligne.uniteId || null,
            reference: "",
            codeBarres: ligne.codeBarres,
            prixAchat: Number(ligne.prixAchat) || 0,
            prixVente: Number(ligne.prixVente) || 0,
            seuilAlerte: Number(ligne.seuilAlerte) || 0,
          });
        } catch (e) {
          setErreur(`"${ligne.nom}" : ${e instanceof ErreurProduit ? e.message : "erreur inattendue."}`);
          return;
        }
        const quantiteNombre = Number(ligne.quantiteInitiale) || 0;
        if (depotId && quantiteNombre > 0) {
          try {
            await appliquerMouvement({
              varianteId: cree.varianteId,
              depotId,
              type: "entree",
              quantite: quantiteNombre,
              motif: "Stock initial",
              utilisateurId: session.utilisateurId,
              referenceType: "catalogue.Variante",
              referenceId: cree.varianteId,
            });
          } catch (e) {
            setErreur(`"${ligne.nom}" créé, mais le stock initial a échoué : ${e instanceof ErreurStock ? e.message : "erreur inattendue."}`);
            return;
          }
        }
      }
      onCree();
    } finally {
      setEnCours(false);
    }
  }

  return (
    <form onSubmit={soumettre} className="formulaire-produits-groupe">
      <div className="modale-entete entete-fixe">
        <h3>Nouvel article</h3>
        <div className="actions-formulaire">
          <button type="button" onClick={onAnnuler}>
            Annuler
          </button>
          <button type="submit" disabled={enCours}>
            {enCours ? "Enregistrement…" : `Enregistrer la liste (${lignes.length})`}
          </button>
        </div>
      </div>
      {erreur && <div className="message-erreur">{erreur}</div>}

      <div className="colonnes-produits-groupe">
        <div className="colonne-ajout-produit">
          {!depotId ? (
            <label className="champ-depot-groupe">
              Dépôt (pour le stock initial, optionnel)
              <select value={depotId} onChange={(e) => setDepotId(e.target.value)}>
                <option value=""></option>
                {depots.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.nom}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <p className="note-aide">
              Dépôt (stock initial) : <strong>{depots.find((d) => d.id === depotId)?.nom}</strong>{" "}
              <button type="button" className="lien" onClick={() => setDepotId("")}>
                changer
              </button>
            </p>
          )}

          <div className="grille-champs ajout-produit-groupe">
            <label>
              Désignation
              <input value={nom} onChange={(e) => setNom(e.target.value)} onKeyDown={surEntree} autoFocus />
            </label>
            <label>
              Catégorie
              <select value={categorieId} onChange={(e) => setCategorieId(e.target.value)} onKeyDown={surEntree}>
                <option value=""></option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.nom}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Unité
              <select value={uniteId} onChange={(e) => setUniteId(e.target.value)} onKeyDown={surEntree}>
                <option value=""></option>
                {unites.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.nom}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Code-barres
              <input value={codeBarres} onChange={(e) => setCodeBarres(e.target.value)} onKeyDown={surEntree} />
            </label>
            <label>
              Prix d'achat
              <ChampMontant value={prixAchat} disabled={!peutModifierPrix} onChange={setPrixAchat} onKeyDown={surEntree} />
            </label>
            <label>
              Prix de vente{" "}
              {sousPrixAchat && (
                <span className="badge-rupture" title="Le prix de vente est inférieur au prix d'achat">
                  ⚠
                </span>
              )}
              <ChampMontant
                className={sousPrixAchat ? "champ-invalide" : undefined}
                value={prixVente}
                disabled={!peutModifierPrix}
                onChange={setPrixVente}
                onKeyDown={surEntree}
              />
            </label>
            <label>
              Seuil d'alerte
              <input
                type="number"
                min={0}
                step="any"
                value={seuilAlerte}
                onChange={(e) => setSeuilAlerte(e.target.value)}
                onKeyDown={surEntree}
              />
            </label>
            <label>
              Qté initiale
              <input
                type="number"
                min={0}
                step="any"
                value={quantiteInitiale}
                onChange={(e) => setQuantiteInitiale(e.target.value)}
                onKeyDown={surEntree}
              />
            </label>
            <button type="button" className="bouton-ajouter-produit-groupe" onClick={ajouterProduit}>
              + Ajouter à la liste
            </button>
          </div>
        </div>

        <div className="colonne-liste-produits">
          <div className="zone-tableau-scroll tableau-produits-groupe-scroll">
            <table className="tableau-catalogue">
              <thead>
                <tr>
                  <th className="colonne-numero-groupe">N°</th>
                  <th>Référence</th>
                  <th className="col-designation-groupe">Désignation</th>
                  <th>Catégorie</th>
                  <th>Unité</th>
                  <th>Code-barres</th>
                  <th>Prix d'achat</th>
                  <th>Prix de vente</th>
                  <th>Seuil</th>
                  <th>Qté initiale</th>
                  <th className="colonne-numero-groupe" />
                </tr>
              </thead>
              <tbody>
                {lignes.map((l, index) => (
                  <tr key={l.id}>
                    <td className="colonne-numero-groupe">{index + 1}</td>
                    <td className="reference-auto">{referenceApercu(index)}</td>
                    <td className="col-designation-groupe">{l.nom}</td>
                    <td>{l.categorieNom}</td>
                    <td>{l.uniteNom}</td>
                    <td>{l.codeBarres || ""}</td>
                    <td>{formaterMontant(l.prixAchat)}</td>
                    <td>{formaterMontant(l.prixVente)}</td>
                    <td>{l.seuilAlerte}</td>
                    <td>{l.quantiteInitiale}</td>
                    <td className="colonne-numero-groupe">
                      <button
                        type="button"
                        className="bouton-retirer-ligne-groupe"
                        title="Retirer de la liste"
                        onClick={() => retirerLigne(l.id)}
                      >
                        ✕
                      </button>
                    </td>
                  </tr>
                ))}
                {/* Lignes vides pour que le tableau soit déjà tracé (grille visible,
                    au moins 10 lignes) avant même le premier article ajouté. */}
                {Array.from({ length: Math.max(0, 10 - lignes.length) }).map((_, i) => (
                  <tr key={`vide-${i}`} className="ligne-groupe-vide">
                    <td className="colonne-numero-groupe">&nbsp;</td>
                    <td>&nbsp;</td>
                    <td className="col-designation-groupe">&nbsp;</td>
                    <td>&nbsp;</td>
                    <td>&nbsp;</td>
                    <td>&nbsp;</td>
                    <td>&nbsp;</td>
                    <td>&nbsp;</td>
                    <td>&nbsp;</td>
                    <td>&nbsp;</td>
                    <td className="colonne-numero-groupe">&nbsp;</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </form>
  );
}

type ColonneTriProduit = "nom" | "prixVente" | "enStock";

/**
 * Ronds défilants du fond (même patron que Accueil.tsx) : tailles/vitesses/
 * délais variés, trajectoire propre à chacun (départ → arrivée en vw/vh),
 * couleur --cercle-N (index.css — cycle des teintes sémantiques par défaut,
 * réassorti à l'identité propre de certains thèmes comme Orange).
 */
const CERCLES_FOND = [
  { taille: 90, couleur: "var(--cercle-1)", duree: 26, delai: -4, depart: ["-15vw", "10vh"], arrivee: ["115vw", "60vh"] },
  { taille: 60, couleur: "var(--cercle-2)", duree: 22, delai: -15, depart: ["115vw", "70vh"], arrivee: ["-15vw", "15vh"] },
  { taille: 120, couleur: "var(--cercle-3)", duree: 32, delai: -9, depart: ["20vw", "115vh"], arrivee: ["75vw", "-20vh"] },
  { taille: 50, couleur: "var(--cercle-4)", duree: 24, delai: -2, depart: ["70vw", "-15vh"], arrivee: ["15vw", "115vh"] },
  { taille: 75, couleur: "var(--cercle-5)", duree: 28, delai: -20, depart: ["-15vw", "90vh"], arrivee: ["110vw", "20vh"] },
  { taille: 100, couleur: "var(--cercle-6)", duree: 30, delai: -12, depart: ["110vw", "25vh"], arrivee: ["-15vw", "85vh"] },
  { taille: 40, couleur: "var(--cercle-1)", duree: 20, delai: -7, depart: ["40vw", "-15vh"], arrivee: ["85vw", "115vh"] },
  { taille: 65, couleur: "var(--cercle-3)", duree: 25, delai: -16, depart: ["105vw", "45vh"], arrivee: ["-10vw", "55vh"] },
  { taille: 85, couleur: "var(--cercle-4)", duree: 34, delai: -5, depart: ["85vw", "110vh"], arrivee: ["10vw", "-15vh"] },
  { taille: 55, couleur: "var(--cercle-6)", duree: 23, delai: -10, depart: ["-10vw", "35vh"], arrivee: ["105vw", "90vh"] },
] as const;

const SECTIONS = [
  { cle: "produits", label: "Articles", icone: "🏷️" },
  { cle: "categories", label: "Catégories", icone: "🗂️" },
] as const;

type Section = (typeof SECTIONS)[number]["cle"];

function EnteteModale({ titre, onFermer }: { titre: string; onFermer: () => void }) {
  return (
    <div className="modale-entete">
      <h3>{titre}</h3>
      <button type="button" className="lien bouton-retour" onClick={onFermer}>
        ← Retour
      </button>
    </div>
  );
}

function OngletProduits({ session }: { session: Session }) {
  const peutGerer = !!session.permissions.gerer_produits_stock_achats;
  const peutVoirCout = !!session.permissions.voir_benefices_achat;

  const [vue, setVue] = useState<"liste" | "nouveau">("liste");
  const [produits, setProduits] = useState<ProduitResume[]>([]);
  const [categories, setCategories] = useState<ReferenceNommee[]>([]);
  const [unites, setUnites] = useState<UniteResume[]>([]);
  const [depots, setDepots] = useState<DepotResume[]>([]);
  const [terme, setTerme] = useState("");
  const [produitSelectionneId, setProduitSelectionneId] = useState<string | null>(null);
  const [tri, setTri] = useState<{ colonne: ColonneTriProduit; direction: "asc" | "desc" }>({
    colonne: "nom",
    direction: "asc",
  });
  const [produitASupprimerId, setProduitASupprimerId] = useState<string | null>(null);

  async function rafraichirListe() {
    setProduits(await listerProduitsLocal(session.boutiqueId));
  }

  useEffect(() => {
    rafraichirListe();
    listerCategories(session.boutiqueId).then(setCategories);
    listerUnites(session.boutiqueId).then(setUnites);
    if (peutGerer) listerDepots(session.boutiqueId).then(setDepots);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function basculerTri(colonne: ColonneTriProduit) {
    setTri((actuel) =>
      actuel.colonne === colonne ? { colonne, direction: actuel.direction === "asc" ? "desc" : "asc" } : { colonne, direction: "asc" },
    );
  }

  const termeNormalise = terme.trim().toLowerCase();
  const produitsFiltres = termeNormalise
    ? produits.filter((p) => p.nom.toLowerCase().includes(termeNormalise) || p.reference.toLowerCase().includes(termeNormalise))
    : produits;

  const produitsTries = useMemo(() => {
    const copie = [...produitsFiltres];
    copie.sort((a, b) => {
      let comparaison = 0;
      if (tri.colonne === "nom") comparaison = a.nom.localeCompare(b.nom);
      else if (tri.colonne === "prixVente") comparaison = (a.prixVente ?? 0) - (b.prixVente ?? 0);
      else if (tri.colonne === "enStock") comparaison = Number(a.enStock) - Number(b.enStock);
      return tri.direction === "asc" ? comparaison : -comparaison;
    });
    return copie;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [produitsFiltres, tri]);

  function icone(colonne: ColonneTriProduit) {
    if (tri.colonne !== colonne) return null;
    return tri.direction === "asc" ? " ▲" : " ▼";
  }

  async function supprimer(id: string) {
    await supprimerProduit(id);
    setProduitASupprimerId(null);
    rafraichirListe();
  }

  async function basculerActif(p: ProduitResume) {
    await modifierProduit(p.id, { actif: !p.actif });
    rafraichirListe();
  }

  return (
    <>
      {vue === "nouveau" && (
        <div className="fond-modale" onClick={() => setVue("liste")}>
          <div className="modale-selection-produits" onClick={(e) => e.stopPropagation()}>
            <FormulaireProduitsGroupe
              session={session}
              categories={categories}
              unites={unites}
              depots={depots}
              onAnnuler={() => setVue("liste")}
              onCree={() => {
                setVue("liste");
                rafraichirListe();
              }}
            />
          </div>
        </div>
      )}
      {produitSelectionneId && (
        <DetailProduit
          produitId={produitSelectionneId}
          session={session}
          categories={categories}
          unites={unites}
          depots={depots}
          onFermer={() => {
            setProduitSelectionneId(null);
            rafraichirListe();
          }}
        />
      )}
      {produitASupprimerId && (
        <ModaleConfirmation
          titre="Supprimer cet article ?"
          description="Cette action est irréversible."
          labelConfirmer="Supprimer"
          dangereux
          onAnnuler={() => setProduitASupprimerId(null)}
          onConfirmer={() => supprimer(produitASupprimerId)}
        />
      )}
      <div>
        <div className="barre-actions barre-actions-fixe barre-actions-avec-onglets">
          <input className="champ-recherche" placeholder="Rechercher un article…" value={terme} onChange={(e) => setTerme(e.target.value)} />
          {peutGerer && (
            <span className="actions-ligne">
              <button type="button" className="bouton-ajouter-variante" onClick={() => setVue("nouveau")}>
                + Nouvel article
              </button>
            </span>
          )}
        </div>
        <div className="zone-tableau-scroll">
          <table className="tableau-catalogue">
            <thead>
              <tr>
                <th>N°</th>
                <th>Référence</th>
                <th className="th-triable" onClick={() => basculerTri("nom")}>
                  Désignation{icone("nom")}
                </th>
                <th className="colonne-categorie-articles">Catégorie</th>
                {peutVoirCout && <th>Prix d'achat</th>}
                <th className="th-triable" onClick={() => basculerTri("prixVente")}>
                  Prix de vente{icone("prixVente")}
                </th>
                <th className="th-triable" onClick={() => basculerTri("enStock")}>
                  Stock{icone("enStock")}
                </th>
                {peutGerer && <th>Actions</th>}
              </tr>
            </thead>
            <tbody>
              {produitsTries.map((p, index) => (
                <tr key={p.id} onClick={() => setProduitSelectionneId(p.id)}>
                  <td>{index + 1}</td>
                  <td>{p.reference || ""}</td>
                  <td>{p.nom}</td>
                  <td className="colonne-categorie-articles">{p.categorieNom ?? ""}</td>
                  {peutVoirCout && <td>{p.prixAchat !== null ? formaterMontant(p.prixAchat) : ""}</td>}
                  <td>{p.prixVente !== null ? formaterMontant(p.prixVente) : ""}</td>
                  <td>{p.enStock ? "En stock" : <span className="badge-rupture">Rupture</span>}</td>
                  {peutGerer && (
                    <td onClick={(e) => e.stopPropagation()}>
                      <span className="actions-ligne">
                        <button type="button" className="lien-icone" title="Modifier" onClick={() => setProduitSelectionneId(p.id)}>
                          ✎
                        </button>
                        <button
                          type="button"
                          className="lien-icone lien-icone-danger"
                          title="Supprimer"
                          onClick={() => setProduitASupprimerId(p.id)}
                        >
                          ×
                        </button>
                        <button type="button" className={`bouton-statut-produit ${p.actif ? "actif" : "inactif"}`} onClick={() => basculerActif(p)}>
                          {p.actif ? "Actif" : "Inactif"}
                        </button>
                      </span>
                    </td>
                  )}
                </tr>
              ))}
              {produitsTries.length === 0 && (
                <tr>
                  <td colSpan={5 + (peutVoirCout ? 1 : 0) + (peutGerer ? 1 : 0)} className="liste-vide">
                    Aucun article.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}

function OngletCategories({ session }: { session: Session }) {
  const peutGerer = !!session.permissions.gerer_produits_stock_achats;
  const [categories, setCategories] = useState<ReferenceNommee[]>([]);
  const [nom, setNom] = useState("");
  const [erreur, setErreur] = useState<string | null>(null);
  const [enEditionId, setEnEditionId] = useState<string | null>(null);
  const [nomEdition, setNomEdition] = useState("");
  const [confirmationSuppressionId, setConfirmationSuppressionId] = useState<string | null>(null);

  async function rafraichir() {
    setCategories(await listerCategories(session.boutiqueId));
  }
  useEffect(() => {
    rafraichir();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function ajouter(evenement: React.FormEvent) {
    evenement.preventDefault();
    if (!nom.trim()) return;
    try {
      await creerCategorie(session.boutiqueId, nom.trim());
      setNom("");
      setErreur(null);
      rafraichir();
    } catch (e) {
      setErreur(e instanceof ErreurProduit ? e.message : "Erreur inattendue.");
    }
  }

  function commencerEdition(c: ReferenceNommee) {
    setEnEditionId(c.id);
    setNomEdition(c.nom);
  }

  async function enregistrerEdition(id: string) {
    if (!nomEdition.trim()) return;
    try {
      await modifierCategorie(id, nomEdition.trim());
      setEnEditionId(null);
      rafraichir();
    } catch (e) {
      setErreur(e instanceof ErreurProduit ? e.message : "Erreur inattendue.");
    }
  }

  async function supprimer(id: string) {
    try {
      await supprimerCategorie(id);
      setConfirmationSuppressionId(null);
      rafraichir();
    } catch (e) {
      setConfirmationSuppressionId(null);
      setErreur(e instanceof ErreurProduit ? e.message : "Erreur inattendue.");
    }
  }

  return (
    <div className="reglage-catalogue">
      <div className="barre-actions barre-actions-fixe barre-actions-avec-onglets">
        {peutGerer && (
          <form onSubmit={ajouter} className="formulaire-inline">
            <input placeholder="Nouvelle catégorie" value={nom} onChange={(e) => setNom(e.target.value)} />
            <button type="submit">Ajouter</button>
          </form>
        )}
      </div>
      {erreur && <div className="message-erreur">{erreur}</div>}
      <ul className="liste-simple">
        {categories.map((c) =>
          enEditionId === c.id ? (
            <li key={c.id} className="ligne-liste-simple">
              <input value={nomEdition} onChange={(e) => setNomEdition(e.target.value)} />
              <div className="actions-ligne-simple">
                <button type="button" onClick={() => setEnEditionId(null)}>
                  Annuler
                </button>
                <button type="button" className="bouton-primaire" onClick={() => enregistrerEdition(c.id)}>
                  Enregistrer
                </button>
              </div>
            </li>
          ) : (
            <li key={c.id} className="ligne-liste-simple">
              <span>{c.nom}</span>
              {peutGerer && (
                <div className="actions-ligne-simple">
                  <button type="button" className="lien-icone" title="Modifier" onClick={() => commencerEdition(c)}>
                    ✎
                  </button>
                  <button
                    type="button"
                    className="lien-icone lien-icone-danger"
                    title="Supprimer"
                    onClick={() => setConfirmationSuppressionId(c.id)}
                  >
                    ×
                  </button>
                </div>
              )}
            </li>
          ),
        )}
        {categories.length === 0 && <li className="liste-vide">Aucune catégorie.</li>}
      </ul>
      {confirmationSuppressionId && (
        <ModaleConfirmation
          titre="Supprimer cette catégorie ?"
          labelConfirmer="Supprimer"
          dangereux
          onAnnuler={() => setConfirmationSuppressionId(null)}
          onConfirmer={() => supprimer(confirmationSuppressionId)}
        />
      )}
    </div>
  );
}

function ModaleProduits({ session, onFermer }: { session: Session; onFermer: () => void }) {
  return (
    <div className="fond-modale" onClick={onFermer}>
      <div className="modale-selection-produits" onClick={(e) => e.stopPropagation()}>
        <EnteteModale titre="Articles" onFermer={onFermer} />
        <div className="modale-corps">
          <OngletProduits session={session} />
        </div>
      </div>
    </div>
  );
}

function ModaleCategories({ session, onFermer }: { session: Session; onFermer: () => void }) {
  return (
    <div className="fond-modale" onClick={onFermer}>
      <div className="modale-selection-produits" onClick={(e) => e.stopPropagation()}>
        <EnteteModale titre="Catégories" onFermer={onFermer} />
        <div className="modale-corps">
          <OngletCategories session={session} />
        </div>
      </div>
    </div>
  );
}

export default function Produits({ session }: { session: Session }) {
  const [sectionOuverte, setSectionOuverte] = useState<Section | null>(null);

  return (
    <div className="page-produits page-accueil">
      {CERCLES_FOND.map((c, i) => (
        <span
          key={i}
          aria-hidden="true"
          className="cercle-fond"
          style={
            {
              width: c.taille,
              height: c.taille,
              background: c.couleur,
              animationDuration: `${c.duree}s`,
              animationDelay: `${c.delai}s`,
              "--depart-x": c.depart[0],
              "--depart-y": c.depart[1],
              "--arrivee-x": c.arrivee[0],
              "--arrivee-y": c.arrivee[1],
            } as CSSProperties
          }
        />
      ))}
      <div className="grille-documents-comptables">
        {SECTIONS.map((s) => (
          <button
            key={s.cle}
            type="button"
            className="carte-document-comptable"
            onClick={() => setSectionOuverte(s.cle)}
          >
            <span className="icone-document-comptable">{s.icone}</span>
            {s.label}
          </button>
        ))}
      </div>
      {sectionOuverte === "produits" && (
        <ModaleProduits session={session} onFermer={() => setSectionOuverte(null)} />
      )}
      {sectionOuverte === "categories" && (
        <ModaleCategories session={session} onFermer={() => setSectionOuverte(null)} />
      )}
    </div>
  );
}
