import { Fragment, useEffect, useMemo, useState } from "react";

import { api } from "../api/client";
import type {
  DepotResume,
  LigneVenteHistorique,
  MouvementResume,
  ProduitDetail,
  ProduitResume,
  ReferenceNommee,
  Session,
  UniteResume,
  ValeurAttributResume,
  VarianteDetail,
} from "../api/client";
import ChampMontant from "../components/ChampMontant";
import ModaleConfirmation from "../components/ModaleConfirmation";
import { formaterMontant } from "../lib/formatage";
import { libelleStatutVente } from "../lib/libelles";

// --- Onglet Produits : liste, formulaire de création, fiche détail ---

function FormulaireEditionProduit({
  produitId,
  session,
  onAnnuler,
  onModifie,
}: {
  produitId: string;
  session: Session;
  onAnnuler: () => void;
  onModifie: () => void;
}) {
  const [produit, setProduit] = useState<ProduitDetail | null>(null);
  const [categories, setCategories] = useState<ReferenceNommee[]>([]);
  const [unites, setUnites] = useState<UniteResume[]>([]);
  const [nom, setNom] = useState("");
  const [categorieId, setCategorieId] = useState("");
  const [uniteId, setUniteId] = useState("");
  const [description, setDescription] = useState("");
  const [erreur, setErreur] = useState<string | null>(null);
  const [enCours, setEnCours] = useState(false);

  useEffect(() => {
    api.categories.lister(session.boutiqueId).then(setCategories);
    api.unites.lister(session.boutiqueId).then(setUnites);
    api.produits.obtenir(produitId).then((p) => {
      if (!p) return;
      setProduit(p);
      setNom(p.nom);
      setCategorieId(p.categorieId ?? "");
      setUniteId(p.uniteId ?? "");
      setDescription(p.description);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [produitId, session.boutiqueId]);

  async function enregistrer() {
    setErreur(null);
    if (!nom.trim()) {
      setErreur("Le nom est requis.");
      return;
    }
    setEnCours(true);
    try {
      const resultat = await api.produits.modifier(produitId, {
        nom: nom.trim(),
        categorieId: categorieId || null,
        uniteId: uniteId || null,
        description,
      });
      if (resultat.succes) onModifie();
      else setErreur(resultat.message);
    } finally {
      setEnCours(false);
    }
  }

  if (!produit) {
    return (
      <tr>
        <td colSpan={5}>Chargement…</td>
      </tr>
    );
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
    api.attributs.lister(session.boutiqueId).then(async (liste) => {
      setAttributs(liste);
      const valeurs: Record<string, ValeurAttributResume[]> = {};
      for (const a of liste) {
        valeurs[a.id] = await api.attributs.listerValeurs(a.id);
      }
      setValeursParAttribut(valeurs);
    });
  }, [session.boutiqueId]);

  async function ajouterValeur(attributId: string) {
    const valeur = (nouvelleValeur[attributId] || "").trim();
    if (!valeur) return;
    const resultat = await api.attributs.creerValeur(attributId, valeur);
    if (resultat.succes) {
      const liste = await api.attributs.listerValeurs(attributId);
      setValeursParAttribut((actuel) => ({ ...actuel, [attributId]: liste }));
      setSelection((actuel) => ({ ...actuel, [attributId]: resultat.resultat }));
      setNouvelleValeur((actuel) => ({ ...actuel, [attributId]: "" }));
    }
  }

  async function creer() {
    setErreur(null);
    setEnCours(true);
    try {
      const valeurAttributIds = Object.values(selection).filter(Boolean);
      const resultat = await api.variantes.creer({
        produitId,
        codeBarres,
        prixAchat: Number(prixAchat) || 0,
        prixVente: Number(prixVente) || 0,
        seuilAlerte: Number(seuilAlerte) || 0,
        valeurAttributIds,
      });
      if (resultat.succes) onCree();
      else setErreur(resultat.message);
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
        {afficherAttributs && <td className="reference-auto">—</td>}
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

function FormulaireAjoutStock({
  varianteId,
  session,
  depots,
  onAnnuler,
  onAjoute,
}: {
  varianteId: string;
  session: Session;
  depots: DepotResume[];
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
      const resultat = await api.mouvements.creer({
        varianteId,
        depotId,
        type: "entree",
        quantite: quantiteNombre,
        motif,
        utilisateurId: session.utilisateurId,
      });
      if (resultat.succes) onAjoute();
      else setErreur(resultat.message);
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
      <input
        type="number"
        min={0.01}
        step="any"
        value={quantite}
        onChange={(e) => setQuantite(e.target.value)}
        autoFocus
      />
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

function LigneEditionVariante({
  variante,
  session,
  peutVoirCout,
  afficherCodeBarres,
  afficherAttributs,
  onAnnuler,
  onModifie,
}: {
  variante: VarianteDetail;
  session: Session;
  peutVoirCout: boolean;
  afficherCodeBarres: boolean;
  afficherAttributs: boolean;
  onAnnuler: () => void;
  onModifie: () => void;
}) {
  const peutModifierPrix = !!session.permissions.modifier_prix;

  const [reference, setReference] = useState(variante.reference);
  const [codeBarres, setCodeBarres] = useState(variante.codeBarres);
  const [prixAchat, setPrixAchat] = useState(String(variante.prixAchat));
  const [prixVente, setPrixVente] = useState(String(variante.prixVente));
  const [seuilAlerte, setSeuilAlerte] = useState(String(variante.seuilAlerte));
  const [erreur, setErreur] = useState<string | null>(null);
  const [enCours, setEnCours] = useState(false);
  const sousPrixAchat = Number(prixVente) > 0 && Number(prixAchat) > 0 && Number(prixVente) < Number(prixAchat);

  async function enregistrer() {
    setErreur(null);
    setEnCours(true);
    try {
      const resultat = await api.variantes.modifier(variante.id, {
        reference,
        codeBarres,
        prixAchat: Number(prixAchat) || 0,
        prixVente: Number(prixVente) || 0,
        seuilAlerte: Number(seuilAlerte) || 0,
      });
      if (resultat.succes) onModifie();
      else setErreur(resultat.message);
    } finally {
      setEnCours(false);
    }
  }

  return (
    <tr className="ligne-edition">
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
  onFermer,
}: {
  produitId: string;
  session: Session;
  onFermer: () => void;
}) {
  const peutGerer = !!session.permissions.gerer_produits_stock_achats;
  const peutVoirCout = !!session.permissions.voir_benefices_achat;

  const [produit, setProduit] = useState<ProduitDetail | null>(null);
  const [afficherFormVariante, setAfficherFormVariante] = useState(false);
  const [depots, setDepots] = useState<DepotResume[]>([]);
  const [actionVarianteOuverte, setActionVarianteOuverte] = useState<{
    id: string;
    type: "stock" | "modification";
  } | null>(null);
  const [messageStock, setMessageStock] = useState<string | null>(null);
  const [mouvements, setMouvements] = useState<MouvementResume[]>([]);
  const [ventesHistorique, setVentesHistorique] = useState<LigneVenteHistorique[]>([]);
  const [pageDetail, setPageDetail] = useState<"details" | "mouvements" | "ventes">("details");
  const [modifierInfos, setModifierInfos] = useState(false);

  async function rafraichir() {
    const p = await api.produits.obtenir(produitId);
    setProduit(p ?? null);
  }

  useEffect(() => {
    rafraichir();
    api.mouvements.listerParProduit(produitId, 50).then(setMouvements);
    api.ventes.listerParProduit(produitId, 50).then(setVentesHistorique);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [produitId]);

  useEffect(() => {
    api.depots.lister(session.boutiqueId).then(setDepots);
  }, [session.boutiqueId]);

  const afficherCodeBarres = !!produit?.variantes.some((v) => v.codeBarres);
  const afficherAttributs = !!produit?.variantes.some((v) => v.valeurs.length > 0);
  const nombreColonnesVariantes =
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
              <div className="barre-onglets">
                <button
                  type="button"
                  className={`onglet ${pageDetail === "details" ? "actif" : ""}`}
                  onClick={() => setPageDetail("details")}
                >
                  Détails
                </button>
                <button
                  type="button"
                  className={`onglet ${pageDetail === "mouvements" ? "actif" : ""}`}
                  onClick={() => setPageDetail("mouvements")}
                >
                  Historique des mouvements de stock
                </button>
                <button
                  type="button"
                  className={`onglet ${pageDetail === "ventes" ? "actif" : ""}`}
                  onClick={() => setPageDetail("ventes")}
                >
                  Historique des ventes
                </button>
              </div>

              {pageDetail === "details" && (
              <>
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
                      produitId={produit.id}
                      session={session}
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
                  {produit.variantes.map((v) => {
                    const enEdition =
                      actionVarianteOuverte?.id === v.id && actionVarianteOuverte.type === "modification";
                    const enAjoutStock = actionVarianteOuverte?.id === v.id && actionVarianteOuverte.type === "stock";
                    if (enEdition) {
                      return (
                        <LigneEditionVariante
                          key={v.id}
                          variante={v}
                          session={session}
                          peutVoirCout={peutVoirCout}
                          afficherCodeBarres={afficherCodeBarres}
                          afficherAttributs={afficherAttributs}
                          onAnnuler={() => setActionVarianteOuverte(null)}
                          onModifie={() => {
                            setActionVarianteOuverte(null);
                            rafraichir();
                          }}
                        />
                      );
                    }
                    return (
                      <Fragment key={v.id}>
                        <tr>
                          <td>{v.reference || ""}</td>
                          {afficherCodeBarres && <td>{v.codeBarres || ""}</td>}
                          {afficherAttributs && <td>{v.valeurs.join(", ") || ""}</td>}
                          {peutVoirCout && <td>{formaterMontant(v.prixAchat)}</td>}
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
                                <button
                                  type="button"
                                  onClick={() => setActionVarianteOuverte({ id: v.id, type: "modification" })}
                                >
                                  Modifier
                                </button>
                                <button
                                  type="button"
                                  className="bouton-ajouter-stock-ligne"
                                  onClick={() => setActionVarianteOuverte({ id: v.id, type: "stock" })}
                                >
                                  + Ajouter du stock
                                </button>
                              </span>
                            </td>
                          )}
                        </tr>
                        {enAjoutStock && (
                          <tr>
                            <td colSpan={nombreColonnesVariantes}>
                              <FormulaireAjoutStock
                                varianteId={v.id}
                                session={session}
                                depots={depots}
                                onAnnuler={() => setActionVarianteOuverte(null)}
                                onAjoute={() => {
                                  setActionVarianteOuverte(null);
                                  setMessageStock(
                                    `Stock ajouté pour "${produit.nom}${v.reference ? ` (${v.reference})` : ""}".`,
                                  );
                                }}
                              />
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                  {afficherFormVariante && (
                    <LigneNouvelleVariante
                      produitId={produit.id}
                      session={session}
                      afficherCodeBarres={afficherCodeBarres}
                      afficherAttributs={afficherAttributs}
                      peutVoirCout={peutVoirCout}
                      nombreColonnes={nombreColonnesVariantes}
                      onAnnuler={() => setAfficherFormVariante(false)}
                      onCree={() => {
                        setAfficherFormVariante(false);
                        rafraichir();
                      }}
                    />
                  )}
                  {Array.from({ length: Math.max(0, 10 - produit.variantes.length) }).map((_, i) => (
                    <tr key={`vide-${i}`} className="ligne-groupe-vide">
                      <td>&nbsp;</td>
                      {afficherCodeBarres && <td>&nbsp;</td>}
                      {afficherAttributs && <td>&nbsp;</td>}
                      {peutVoirCout && <td>&nbsp;</td>}
                      <td>&nbsp;</td>
                      <td>&nbsp;</td>
                      <td>&nbsp;</td>
                      {peutGerer && <td className="colonne-actions-variante">&nbsp;</td>}
                    </tr>
                  ))}
                </tbody>
              </table>
              </div>
              </>
              )}

              {pageDetail === "mouvements" && (
              <div className="zone-tableau-scroll zone-tableau-scroll-modale">
              <table className="tableau-catalogue">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Dépôt</th>
                    <th>Type</th>
                    <th>Quantité</th>
                    <th>Motif</th>
                  </tr>
                </thead>
                <tbody>
                  {mouvements.map((m) => (
                    <tr key={m.id}>
                      <td>{new Date(m.dateCreation).toLocaleString("fr-FR")}</td>
                      <td>{m.depotNom}</td>
                      <td>
                        {m.type === "entree" ? "Entrée" : m.type === "sortie" ? "Sortie" : "Ajustement"}
                      </td>
                      <td>{m.quantite}</td>
                      <td>{m.motif || ""}</td>
                    </tr>
                  ))}
                  {mouvements.length === 0 && (
                    <tr>
                      <td colSpan={5} className="liste-vide">
                        Aucun mouvement de stock.
                      </td>
                    </tr>
                  )}
                  {mouvements.length > 0 &&
                    Array.from({ length: Math.max(0, 10 - mouvements.length) }).map((_, i) => (
                      <tr key={`vide-${i}`} className="ligne-groupe-vide">
                        <td>&nbsp;</td>
                        <td>&nbsp;</td>
                        <td>&nbsp;</td>
                        <td>&nbsp;</td>
                        <td>&nbsp;</td>
                      </tr>
                    ))}
                </tbody>
              </table>
              </div>
              )}

              {pageDetail === "ventes" && (
              <div className="zone-tableau-scroll zone-tableau-scroll-modale">
              <table className="tableau-catalogue">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Vente</th>
                    <th>Client</th>
                    <th>Statut</th>
                    <th>Qté</th>
                    <th>Prix de vente</th>
                    <th>Sous-total</th>
                  </tr>
                </thead>
                <tbody>
                  {ventesHistorique.map((l, index) => (
                    <tr key={`${l.venteId}-${index}`}>
                      <td>{new Date(l.dateCreation).toLocaleString("fr-FR")}</td>
                      <td>{l.venteNumero}</td>
                      <td>{l.clientNom ?? ""}</td>
                      <td>
                        <span className={`badge-${l.statut}`}>{libelleStatutVente(l.statut)}</span>
                      </td>
                      <td>{l.quantite}</td>
                      <td>{formaterMontant(l.prixUnitaire)}</td>
                      <td>{formaterMontant(l.sousTotal)}</td>
                    </tr>
                  ))}
                  {ventesHistorique.length === 0 && (
                    <tr>
                      <td colSpan={7} className="liste-vide">
                        Aucune vente.
                      </td>
                    </tr>
                  )}
                  {ventesHistorique.length > 0 &&
                    Array.from({ length: Math.max(0, 10 - ventesHistorique.length) }).map((_, i) => (
                      <tr key={`vide-${i}`} className="ligne-groupe-vide">
                        <td>&nbsp;</td>
                        <td>&nbsp;</td>
                        <td>&nbsp;</td>
                        <td>&nbsp;</td>
                        <td>&nbsp;</td>
                        <td>&nbsp;</td>
                        <td>&nbsp;</td>
                      </tr>
                    ))}
                </tbody>
              </table>
              </div>
              )}
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

function FormulaireProduitsGroupe({
  session,
  onAnnuler,
  onCree,
}: {
  session: Session;
  onAnnuler: () => void;
  onCree: () => void;
}) {
  const peutModifierPrix = !!session.permissions.modifier_prix;

  const [categories, setCategories] = useState<ReferenceNommee[]>([]);
  const [unites, setUnites] = useState<UniteResume[]>([]);
  const [depots, setDepots] = useState<DepotResume[]>([]);
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
    api.categories.lister(session.boutiqueId).then(setCategories);
    api.unites.lister(session.boutiqueId).then(setUnites);
    api.depots.lister(session.boutiqueId).then(setDepots);
    api.produits.prochaineReference(session.boutiqueId).then((ref) => {
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
        const resultat = await api.produits.creer({
          boutiqueId: session.boutiqueId,
          nom: ligne.nom,
          categorieId: ligne.categorieId || null,
          uniteId: ligne.uniteId || null,
          codeBarres: ligne.codeBarres,
          prixAchat: Number(ligne.prixAchat) || 0,
          prixVente: Number(ligne.prixVente) || 0,
          seuilAlerte: Number(ligne.seuilAlerte) || 0,
        });
        if (!resultat.succes) {
          setErreur(`"${ligne.nom}" : ${resultat.message}`);
          return;
        }
        const quantiteNombre = Number(ligne.quantiteInitiale) || 0;
        if (depotId && quantiteNombre > 0) {
          const resultatStock = await api.mouvements.creer({
            varianteId: resultat.resultat.varianteId,
            depotId,
            type: "entree",
            quantite: quantiteNombre,
            motif: "Stock initial",
            utilisateurId: session.utilisateurId,
          });
          if (!resultatStock.succes) {
            setErreur(`"${ligne.nom}" créé, mais le stock initial a échoué : ${resultatStock.message}`);
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
          <button type="button" className="lien bouton-retour" onClick={onAnnuler}>
            ← Retour
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
              <ChampMontant
                value={prixAchat}
                disabled={!peutModifierPrix}
                onChange={setPrixAchat}
                onKeyDown={surEntree}
              />
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
                  <th>N°</th>
                  <th>Référence</th>
                  <th className="col-designation-groupe">Désignation</th>
                  <th>Catégorie</th>
                  <th>Unité</th>
                  <th>Code-barres</th>
                  <th>Prix d'achat</th>
                  <th>Prix de vente</th>
                  <th>Seuil</th>
                  <th>Qté initiale</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {lignes.map((l, index) => (
                  <tr key={l.id}>
                    <td>{index + 1}</td>
                    <td className="reference-auto">{referenceApercu(index)}</td>
                    <td className="col-designation-groupe">{l.nom}</td>
                    <td>{l.categorieNom}</td>
                    <td>{l.uniteNom}</td>
                    <td>{l.codeBarres || "—"}</td>
                    <td>{formaterMontant(l.prixAchat)}</td>
                    <td>{formaterMontant(l.prixVente)}</td>
                    <td>{l.seuilAlerte}</td>
                    <td>{l.quantiteInitiale}</td>
                    <td>
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
                {Array.from({ length: Math.max(0, 10 - lignes.length) }).map((_, i) => (
                  <tr key={`vide-${i}`} className="ligne-groupe-vide">
                    <td>&nbsp;</td>
                    <td>&nbsp;</td>
                    <td className="col-designation-groupe">&nbsp;</td>
                    <td>&nbsp;</td>
                    <td>&nbsp;</td>
                    <td>&nbsp;</td>
                    <td>&nbsp;</td>
                    <td>&nbsp;</td>
                    <td>&nbsp;</td>
                    <td>&nbsp;</td>
                    <td>&nbsp;</td>
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

const ONGLETS = [
  { cle: "produits", label: "Articles" },
  { cle: "categories", label: "Catégories" },
] as const;

type Onglet = (typeof ONGLETS)[number]["cle"];

function SelecteurOnglet({ onglet, setOnglet }: { onglet: Onglet; setOnglet: (o: Onglet) => void }) {
  return (
    <div className="barre-onglets">
      {ONGLETS.map((o) => (
        <button
          key={o.cle}
          type="button"
          className={`onglet ${onglet === o.cle ? "actif" : ""}`}
          onClick={() => setOnglet(o.cle)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function OngletProduits({
  session,
  onglet,
  setOnglet,
}: {
  session: Session;
  onglet: Onglet;
  setOnglet: (o: Onglet) => void;
}) {
  const peutGerer = !!session.permissions.gerer_produits_stock_achats;
  const peutVoirCout = !!session.permissions.voir_benefices_achat;

  const [vue, setVue] = useState<"liste" | "groupe">("liste");
  const [produits, setProduits] = useState<ProduitResume[]>([]);
  const [terme, setTerme] = useState("");
  const [produitSelectionneId, setProduitSelectionneId] = useState<string | null>(null);
  const [tri, setTri] = useState<{ colonne: ColonneTriProduit; direction: "asc" | "desc" }>({
    colonne: "nom",
    direction: "asc",
  });
  const [produitASupprimerId, setProduitASupprimerId] = useState<string | null>(null);

  async function rafraichirListe() {
    setProduits(await api.produits.lister(session.boutiqueId, terme));
  }

  useEffect(() => {
    rafraichirListe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [terme]);

  function basculerTri(colonne: ColonneTriProduit) {
    setTri((actuel) =>
      actuel.colonne === colonne
        ? { colonne, direction: actuel.direction === "asc" ? "desc" : "asc" }
        : { colonne, direction: "asc" },
    );
  }

  const produitsTries = useMemo(() => {
    const copie = [...produits];
    copie.sort((a, b) => {
      let comparaison = 0;
      if (tri.colonne === "nom") comparaison = a.nom.localeCompare(b.nom);
      else if (tri.colonne === "prixVente") comparaison = (a.prixVente ?? 0) - (b.prixVente ?? 0);
      else if (tri.colonne === "enStock") comparaison = a.enStock - b.enStock;
      return tri.direction === "asc" ? comparaison : -comparaison;
    });
    return copie;
  }, [produits, tri]);

  function icone(colonne: ColonneTriProduit) {
    if (tri.colonne !== colonne) return null;
    return tri.direction === "asc" ? " ▲" : " ▼";
  }

  async function supprimer(id: string) {
    const resultat = await api.produits.supprimer(id);
    if (resultat.succes) {
      setProduitASupprimerId(null);
      rafraichirListe();
    }
  }

  async function basculerActif(p: ProduitResume) {
    const resultat = await api.produits.modifier(p.id, { actif: !p.actif });
    if (resultat.succes) rafraichirListe();
  }

  return (
    <>
    {vue === "groupe" && (
      <div className="fond-modale" onClick={() => setVue("liste")}>
        <div className="modale-selection-produits" onClick={(e) => e.stopPropagation()}>
          <FormulaireProduitsGroupe
            session={session}
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
        <SelecteurOnglet onglet={onglet} setOnglet={setOnglet} />
        <input
          className="champ-recherche"
          placeholder="Rechercher un article…"
          value={terme}
          onChange={(e) => setTerme(e.target.value)}
        />
        {peutGerer && (
          <span className="actions-ligne">
            <button type="button" className="bouton-ajouter-variante" onClick={() => setVue("groupe")}>
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
            <tr
              key={p.id}
              onClick={() => setProduitSelectionneId(p.id)}
            >
              <td>{index + 1}</td>
              <td>{p.reference || "—"}</td>
              <td>{p.nom}</td>
              <td className="colonne-categorie-articles">{p.categorieNom ?? ""}</td>
              {peutVoirCout && <td>{p.prixAchat ?? ""}</td>}
              <td>{p.prixVente ?? ""}</td>
              <td>
                {p.enStock ? (
                  "En stock"
                ) : (
                  <span className="badge-rupture">Rupture</span>
                )}
              </td>
              {peutGerer && (
                <td onClick={(e) => e.stopPropagation()}>
                    <span className="actions-ligne">
                      <button
                        type="button"
                        className="lien-icone"
                        title="Modifier"
                        onClick={() => setProduitSelectionneId(p.id)}
                      >
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
                      <button
                        type="button"
                        className={`bouton-statut-produit ${p.actif ? "actif" : "inactif"}`}
                        onClick={() => basculerActif(p)}
                      >
                        {p.actif ? "Actif" : "Inactif"}
                      </button>
                    </span>
                </td>
              )}
            </tr>
          ))}
          {produits.length === 0 && (
            <tr>
              <td colSpan={6 + (peutVoirCout ? 1 : 0) + (peutGerer ? 1 : 0)} className="liste-vide">
                Aucun article.
              </td>
            </tr>
          )}
          {produits.length > 0 &&
            Array.from({ length: Math.max(0, 10 - produits.length) }).map((_, i) => (
              <tr key={`vide-${i}`} className="ligne-groupe-vide">
                <td>&nbsp;</td>
                <td>&nbsp;</td>
                <td>&nbsp;</td>
                <td className="colonne-categorie-articles">&nbsp;</td>
                {peutVoirCout && <td>&nbsp;</td>}
                <td>&nbsp;</td>
                <td>&nbsp;</td>
                {peutGerer && <td>&nbsp;</td>}
              </tr>
            ))}
        </tbody>
      </table>
      </div>
    </div>
    </>
  );
}

// --- Onglets Réglages catalogue : catégories, unités, attributs ---

function OngletCategories({
  session,
  onglet,
  setOnglet,
}: {
  session: Session;
  onglet: Onglet;
  setOnglet: (o: Onglet) => void;
}) {
  const peutGerer = !!session.permissions.gerer_produits_stock_achats;
  const [categories, setCategories] = useState<ReferenceNommee[]>([]);
  const [nom, setNom] = useState("");
  const [erreur, setErreur] = useState<string | null>(null);
  const [enEditionId, setEnEditionId] = useState<string | null>(null);
  const [nomEdition, setNomEdition] = useState("");
  const [confirmationSuppressionId, setConfirmationSuppressionId] = useState<string | null>(null);

  async function rafraichir() {
    setCategories(await api.categories.lister(session.boutiqueId));
  }
  useEffect(() => {
    rafraichir();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function ajouter(evenement: React.FormEvent) {
    evenement.preventDefault();
    if (!nom.trim()) return;
    const resultat = await api.categories.creer(session.boutiqueId, nom.trim());
    if (resultat.succes) {
      setNom("");
      setErreur(null);
      rafraichir();
    } else {
      setErreur(resultat.message);
    }
  }

  function commencerEdition(c: ReferenceNommee) {
    setEnEditionId(c.id);
    setNomEdition(c.nom);
  }

  async function enregistrerEdition(id: string) {
    if (!nomEdition.trim()) return;
    const resultat = await api.categories.modifier(id, nomEdition.trim());
    if (resultat.succes) {
      setEnEditionId(null);
      rafraichir();
    } else {
      setErreur(resultat.message);
    }
  }

  async function supprimer(id: string) {
    const resultat = await api.categories.supprimer(id);
    setConfirmationSuppressionId(null);
    if (resultat.succes) rafraichir();
    else setErreur(resultat.message);
  }

  return (
    <div className="reglage-catalogue">
      <div className="barre-actions barre-actions-fixe barre-actions-avec-onglets">
        <SelecteurOnglet onglet={onglet} setOnglet={setOnglet} />
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

// --- Page principale ---
// Unités et Attributs se gèrent désormais depuis Réglages (voir Reglages.tsx) —
// ici on ne fait que les consommer (menus déroulants du formulaire produit).
// L'onglet (Produits/Catégories) est affiché dans la même ligne que la
// recherche et les actions de chaque onglet (voir SelecteurOnglet) plutôt que
// dans une en-tête séparée.

export default function Produits({ session }: { session: Session }) {
  const [onglet, setOnglet] = useState<Onglet>("produits");

  return (
    <div className="page-produits">
      <div className="contenu-onglet">
        {onglet === "produits" && <OngletProduits session={session} onglet={onglet} setOnglet={setOnglet} />}
        {onglet === "categories" && <OngletCategories session={session} onglet={onglet} setOnglet={setOnglet} />}
      </div>
    </div>
  );
}
