import { Fragment, useEffect, useMemo, useState } from "react";

import { api } from "../api/client";
import type {
  DepotResume,
  ProduitDetail,
  ProduitResume,
  ReferenceNommee,
  Session,
  UniteResume,
  ValeurAttributResume,
  VarianteDetail,
} from "../api/client";

// --- Onglet Produits : liste, formulaire de création, fiche détail ---

function FormulaireProduit({
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
  const [nom, setNom] = useState("");
  const [categorieId, setCategorieId] = useState("");
  const [uniteId, setUniteId] = useState("");
  const [description, setDescription] = useState("");
  const [reference, setReference] = useState("");
  const [codeBarres, setCodeBarres] = useState("");
  const [prixAchat, setPrixAchat] = useState("0");
  const [prixVente, setPrixVente] = useState("0");
  const [seuilAlerte, setSeuilAlerte] = useState("0");
  const [depotId, setDepotId] = useState("");
  const [quantiteInitiale, setQuantiteInitiale] = useState("0");
  const [erreur, setErreur] = useState<string | null>(null);
  const [enCours, setEnCours] = useState(false);
  const sousPrixAchat = Number(prixVente) > 0 && Number(prixAchat) > 0 && Number(prixVente) < Number(prixAchat);

  useEffect(() => {
    api.categories.lister(session.boutiqueId).then(setCategories);
    api.unites.lister(session.boutiqueId).then(setUnites);
    api.depots.lister(session.boutiqueId).then(setDepots);
  }, [session.boutiqueId]);

  async function soumettre(evenement: React.FormEvent) {
    evenement.preventDefault();
    setErreur(null);
    if (!nom.trim()) {
      setErreur("Le nom est requis.");
      return;
    }
    setEnCours(true);
    try {
      const resultat = await api.produits.creer({
        boutiqueId: session.boutiqueId,
        nom: nom.trim(),
        categorieId: categorieId || null,
        uniteId: uniteId || null,
        description,
        reference,
        codeBarres,
        prixAchat: Number(prixAchat) || 0,
        prixVente: Number(prixVente) || 0,
        seuilAlerte: Number(seuilAlerte) || 0,
      });
      if (!resultat.succes) {
        setErreur(resultat.message);
        return;
      }
      const quantiteNombre = Number(quantiteInitiale) || 0;
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
          setErreur(`Produit créé, mais le stock initial a échoué : ${resultatStock.message}`);
          return;
        }
      }
      onCree();
    } finally {
      setEnCours(false);
    }
  }

  return (
    <form onSubmit={soumettre} className="formulaire-catalogue formulaire-produit">
      {erreur && <div className="message-erreur">{erreur}</div>}
      <div className="colonnes-produit">
        <div>
          <h3>Nouveau produit</h3>
          <div className="grille-champs">
            <label>
              Nom
              <input value={nom} onChange={(e) => setNom(e.target.value)} autoFocus required />
            </label>
            <label>
              Catégorie
              <select value={categorieId} onChange={(e) => setCategorieId(e.target.value)}>
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
              <select value={uniteId} onChange={(e) => setUniteId(e.target.value)}>
                <option value=""></option>
                {unites.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.nom}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <label>
            Description
            <textarea value={description} onChange={(e) => setDescription(e.target.value)} />
          </label>
        </div>

        <div>
          <h4>Variante par défaut</h4>
          <div className="grille-champs">
            <label>
              Référence
              <input value={reference} onChange={(e) => setReference(e.target.value)} />
            </label>
            <label>
              Code-barres
              <input value={codeBarres} onChange={(e) => setCodeBarres(e.target.value)} />
            </label>
            <label>
              Prix d'achat
              <input
                type="number"
                min={0}
                step="any"
                value={prixAchat}
                disabled={!peutModifierPrix}
                onChange={(e) => setPrixAchat(e.target.value)}
              />
            </label>
            <label>
              Prix de vente{" "}
              {sousPrixAchat && (
                <span className="badge-rupture" title="Le prix de vente est inférieur au prix d'achat">
                  ⚠
                </span>
              )}
              <input
                type="number"
                min={0}
                step="any"
                className={sousPrixAchat ? "champ-invalide" : undefined}
                value={prixVente}
                disabled={!peutModifierPrix}
                onChange={(e) => setPrixVente(e.target.value)}
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
              />
            </label>
          </div>

          <h4>Stock initial (optionnel)</h4>
          <div className="grille-champs">
            <label>
              Dépôt
              <select value={depotId} onChange={(e) => setDepotId(e.target.value)}>
                <option value=""></option>
                {depots.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.nom}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Quantité
              <input
                type="number"
                min={0}
                step="any"
                value={quantiteInitiale}
                onChange={(e) => setQuantiteInitiale(e.target.value)}
              />
            </label>
          </div>
        </div>
      </div>

      <div className="actions-formulaire">
        <button type="button" onClick={onAnnuler}>
          Annuler
        </button>
        <button type="submit" disabled={enCours}>
          {enCours ? "Création…" : "Créer"}
        </button>
      </div>
    </form>
  );
}

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

  async function soumettre(evenement: React.FormEvent) {
    evenement.preventDefault();
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

  if (!produit) return <p>Chargement…</p>;

  return (
    <form onSubmit={soumettre} className="formulaire-catalogue">
      <h3>Modifier le produit</h3>
      {erreur && <div className="message-erreur">{erreur}</div>}
      <div className="grille-champs">
        <label>
          Nom
          <input value={nom} onChange={(e) => setNom(e.target.value)} autoFocus required />
        </label>
        <label>
          Catégorie
          <select value={categorieId} onChange={(e) => setCategorieId(e.target.value)}>
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
          <select value={uniteId} onChange={(e) => setUniteId(e.target.value)}>
            <option value=""></option>
            {unites.map((u) => (
              <option key={u.id} value={u.id}>
                {u.nom}
              </option>
            ))}
          </select>
        </label>
      </div>
      <label>
        Description
        <textarea value={description} onChange={(e) => setDescription(e.target.value)} />
      </label>
      <p className="note-aide">
        Pour modifier le prix, la référence ou le stock d'une variante précise, retourne sur la fiche du produit
        (bouton "Modifier" sur chaque ligne du tableau des variantes).
      </p>

      <div className="actions-formulaire">
        <button type="button" onClick={onAnnuler}>
          Annuler
        </button>
        <button type="submit" disabled={enCours}>
          {enCours ? "Enregistrement…" : "Enregistrer"}
        </button>
      </div>
    </form>
  );
}

function FormulaireVariante({
  produitId,
  session,
  onAnnuler,
  onCree,
}: {
  produitId: string;
  session: Session;
  onAnnuler: () => void;
  onCree: () => void;
}) {
  const peutModifierPrix = !!session.permissions.modifier_prix;

  const [attributs, setAttributs] = useState<ReferenceNommee[]>([]);
  const [valeursParAttribut, setValeursParAttribut] = useState<Record<string, ValeurAttributResume[]>>({});
  const [selection, setSelection] = useState<Record<string, string>>({});
  const [nouvelleValeur, setNouvelleValeur] = useState<Record<string, string>>({});
  const [reference, setReference] = useState("");
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

  async function soumettre(evenement: React.FormEvent) {
    evenement.preventDefault();
    setErreur(null);
    setEnCours(true);
    try {
      const valeurAttributIds = Object.values(selection).filter(Boolean);
      const resultat = await api.variantes.creer({
        produitId,
        reference,
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
    <form onSubmit={soumettre} className="formulaire-catalogue">
      <h4>Nouvelle variante</h4>
      {erreur && <div className="message-erreur">{erreur}</div>}
      <div className="grille-champs">
        <label>
          Référence
          <input value={reference} onChange={(e) => setReference(e.target.value)} />
        </label>
        <label>
          Code-barres
          <input value={codeBarres} onChange={(e) => setCodeBarres(e.target.value)} />
        </label>
        <label>
          Prix d'achat
          <input
            type="number"
            min={0}
            step="any"
            value={prixAchat}
            disabled={!peutModifierPrix}
            onChange={(e) => setPrixAchat(e.target.value)}
          />
        </label>
        <label>
          Prix de vente{" "}
          {sousPrixAchat && (
            <span className="badge-rupture" title="Le prix de vente est inférieur au prix d'achat">
              ⚠
            </span>
          )}
          <input
            type="number"
            min={0}
            step="any"
            className={sousPrixAchat ? "champ-invalide" : undefined}
            value={prixVente}
            disabled={!peutModifierPrix}
            onChange={(e) => setPrixVente(e.target.value)}
          />
        </label>
        <label>
          Seuil d'alerte
          <input type="number" min={0} step="any" value={seuilAlerte} onChange={(e) => setSeuilAlerte(e.target.value)} />
        </label>
      </div>

      {attributs.length > 0 && <h4>Attributs</h4>}
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
          <button type="button" onClick={() => ajouterValeur(a.id)}>
            + Ajouter
          </button>
        </div>
      ))}

      <div className="actions-formulaire">
        <button type="button" onClick={onAnnuler}>
          Annuler
        </button>
        <button type="submit" disabled={enCours}>
          {enCours ? "Création…" : "Créer la variante"}
        </button>
      </div>
    </form>
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
  onAnnuler,
  onModifie,
}: {
  variante: VarianteDetail;
  session: Session;
  peutVoirCout: boolean;
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
      <td>
        <input value={codeBarres} onChange={(e) => setCodeBarres(e.target.value)} />
      </td>
      <td>{variante.valeurs.join(", ") || ""}</td>
      {peutVoirCout && (
        <td>
          <input
            type="number"
            min={0}
            step="any"
            value={prixAchat}
            disabled={!peutModifierPrix}
            onChange={(e) => setPrixAchat(e.target.value)}
          />
        </td>
      )}
      <td>
        <input
          type="number"
          min={0}
          step="any"
          className={sousPrixAchat ? "champ-invalide" : undefined}
          value={prixVente}
          disabled={!peutModifierPrix}
          onChange={(e) => setPrixVente(e.target.value)}
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
      <td>
        {erreur && <div className="message-erreur">{erreur}</div>}
        <span className="actions-ligne">
          <button type="button" onClick={enregistrer} disabled={enCours}>
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
  onRetour,
}: {
  produitId: string;
  session: Session;
  onRetour: () => void;
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
  const [modifierInfos, setModifierInfos] = useState(false);

  async function rafraichir() {
    const p = await api.produits.obtenir(produitId);
    setProduit(p ?? null);
  }

  useEffect(() => {
    rafraichir();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [produitId]);

  useEffect(() => {
    api.depots.lister(session.boutiqueId).then(setDepots);
  }, [session.boutiqueId]);

  if (!produit) return <p>Chargement…</p>;

  if (modifierInfos) {
    return (
      <FormulaireEditionProduit
        produitId={produit.id}
        session={session}
        onAnnuler={() => setModifierInfos(false)}
        onModifie={() => {
          setModifierInfos(false);
          rafraichir();
        }}
      />
    );
  }

  return (
    <div className="detail-produit">
      <div className="entete-detail">
        <h3>
          {produit.nom}
          {peutGerer && (
            <button type="button" className="lien bouton-modifier-infos" onClick={() => setModifierInfos(true)}>
              Modifier les informations
            </button>
          )}
        </h3>
        <button type="button" className="lien bouton-retour" onClick={onRetour}>
          ← Retour à la liste
        </button>
      </div>
      {produit.description && <p className="description-produit">{produit.description}</p>}

      <h4>Variantes</h4>
      {messageStock && <p className="note-aide">{messageStock}</p>}
      <div className="zone-tableau-scroll">
      <table className="tableau-catalogue">
        <thead>
          <tr>
            <th>Référence</th>
            <th>Code-barres</th>
            <th>Attributs</th>
            {peutVoirCout && <th>Prix d'achat</th>}
            <th>Prix de vente</th>
            <th>Seuil</th>
            {peutGerer && <th>Stock</th>}
          </tr>
        </thead>
        <tbody>
          {produit.variantes.map((v) => {
            const enEdition = actionVarianteOuverte?.id === v.id && actionVarianteOuverte.type === "modification";
            const enAjoutStock = actionVarianteOuverte?.id === v.id && actionVarianteOuverte.type === "stock";
            if (enEdition) {
              return (
                <LigneEditionVariante
                  key={v.id}
                  variante={v}
                  session={session}
                  peutVoirCout={peutVoirCout}
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
                  <td>{v.codeBarres || ""}</td>
                  <td>{v.valeurs.join(", ") || ""}</td>
                  {peutVoirCout && <td>{v.prixAchat}</td>}
                  <td>{v.prixVente}</td>
                  <td>{v.seuilAlerte}</td>
                  {peutGerer && (
                    <td>
                      <span className="actions-ligne">
                        <button type="button" onClick={() => setActionVarianteOuverte({ id: v.id, type: "modification" })}>
                          Modifier
                        </button>
                        <button type="button" onClick={() => setActionVarianteOuverte({ id: v.id, type: "stock" })}>
                          + Ajouter du stock
                        </button>
                      </span>
                    </td>
                  )}
                </tr>
                {enAjoutStock && (
                  <tr>
                    <td colSpan={peutVoirCout ? 8 : 7}>
                      <FormulaireAjoutStock
                        varianteId={v.id}
                        session={session}
                        depots={depots}
                        onAnnuler={() => setActionVarianteOuverte(null)}
                        onAjoute={() => {
                          setActionVarianteOuverte(null);
                          setMessageStock(`Stock ajouté pour "${produit.nom}${v.reference ? ` (${v.reference})` : ""}".`);
                        }}
                      />
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
      </div>

      {peutGerer && !afficherFormVariante && (
        <button type="button" onClick={() => setAfficherFormVariante(true)}>
          + Ajouter une variante
        </button>
      )}
      {afficherFormVariante && (
        <FormulaireVariante
          produitId={produit.id}
          session={session}
          onAnnuler={() => setAfficherFormVariante(false)}
          onCree={() => {
            setAfficherFormVariante(false);
            rafraichir();
          }}
        />
      )}
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
  const [prixAchat, setPrixAchat] = useState("0");
  const [prixVente, setPrixVente] = useState("0");
  const [seuilAlerte, setSeuilAlerte] = useState("0");
  const [quantiteInitiale, setQuantiteInitiale] = useState("0");

  const [lignes, setLignes] = useState<LigneProduitGroupe[]>([]);
  const [erreur, setErreur] = useState<string | null>(null);
  const [enCours, setEnCours] = useState(false);
  const sousPrixAchat = Number(prixVente) > 0 && Number(prixAchat) > 0 && Number(prixVente) < Number(prixAchat);

  useEffect(() => {
    api.categories.lister(session.boutiqueId).then(setCategories);
    api.unites.lister(session.boutiqueId).then(setUnites);
    api.depots.lister(session.boutiqueId).then(setDepots);
  }, [session.boutiqueId]);

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
        prixAchat,
        prixVente,
        seuilAlerte,
        quantiteInitiale,
      },
    ]);
    setNom("");
    setCategorieId("");
    setUniteId("");
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
      setErreur("Ajoutez au moins un produit à la liste.");
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
      <div className="entete-detail entete-fixe">
        <h3>Plusieurs produits</h3>
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
              Nom
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
              Prix d'achat
              <input
                type="number"
                min={0}
                step="any"
                value={prixAchat}
                disabled={!peutModifierPrix}
                onChange={(e) => setPrixAchat(e.target.value)}
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
              <input
                type="number"
                min={0}
                step="any"
                className={sousPrixAchat ? "champ-invalide" : undefined}
                value={prixVente}
                disabled={!peutModifierPrix}
                onChange={(e) => setPrixVente(e.target.value)}
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
          </div>
          <button type="button" onClick={ajouterProduit}>
            + Ajouter à la liste
          </button>
        </div>

        <div className="colonne-liste-produits">
          <div className="zone-tableau-scroll tableau-produits-groupe-scroll">
            <table className="tableau-catalogue">
              <thead>
                <tr>
                  <th>Nom</th>
                  <th>Catégorie</th>
                  <th>Unité</th>
                  <th>Prix d'achat</th>
                  <th>Prix de vente</th>
                  <th>Seuil</th>
                  <th>Qté initiale</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {lignes.map((l) => (
                  <tr key={l.id}>
                    <td>{l.nom}</td>
                    <td>{l.categorieNom}</td>
                    <td>{l.uniteNom}</td>
                    <td>{l.prixAchat}</td>
                    <td>{l.prixVente}</td>
                    <td>{l.seuilAlerte}</td>
                    <td>{l.quantiteInitiale}</td>
                    <td>
                      <button type="button" onClick={() => retirerLigne(l.id)}>
                        ✕
                      </button>
                    </td>
                  </tr>
                ))}
                {lignes.length === 0 && (
                  <tr>
                    <td colSpan={8} className="liste-vide">
                      Aucun produit ajouté à la liste.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </form>
  );
}

type ColonneTriProduit = "nom" | "prixVente" | "dateCreation" | "enStock";

function OngletProduits({ session }: { session: Session }) {
  const peutGerer = !!session.permissions.gerer_produits_stock_achats;
  const peutVoirCout = !!session.permissions.voir_benefices_achat;

  const [vue, setVue] = useState<"liste" | "formulaire" | "groupe" | "detail">("liste");
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
      else if (tri.colonne === "dateCreation") comparaison = a.dateCreation.localeCompare(b.dateCreation);
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

  if (vue === "formulaire") {
    return (
      <FormulaireProduit
        session={session}
        onAnnuler={() => setVue("liste")}
        onCree={() => {
          setVue("liste");
          rafraichirListe();
        }}
      />
    );
  }

  if (vue === "groupe") {
    return (
      <FormulaireProduitsGroupe
        session={session}
        onAnnuler={() => setVue("liste")}
        onCree={() => {
          setVue("liste");
          rafraichirListe();
        }}
      />
    );
  }

  if (vue === "detail" && produitSelectionneId) {
    return (
      <DetailProduit
        produitId={produitSelectionneId}
        session={session}
        onRetour={() => {
          setVue("liste");
          rafraichirListe();
        }}
      />
    );
  }

  return (
    <div>
      <div className="barre-actions barre-actions-fixe">
        <input
          className="champ-recherche"
          placeholder="Rechercher un produit…"
          value={terme}
          onChange={(e) => setTerme(e.target.value)}
        />
        {peutGerer && (
          <span className="actions-ligne">
            <button type="button" onClick={() => setVue("formulaire")}>
              + Nouveau produit
            </button>
            <button type="button" onClick={() => setVue("groupe")}>
              + Plusieurs produits
            </button>
          </span>
        )}
      </div>
      <div className="zone-tableau-scroll">
      <table className="tableau-catalogue">
        <thead>
          <tr>
            <th className="th-triable" onClick={() => basculerTri("nom")}>
              Nom{icone("nom")}
            </th>
            <th>Catégorie</th>
            {peutVoirCout && <th>Prix d'achat</th>}
            <th className="th-triable" onClick={() => basculerTri("prixVente")}>
              Prix de vente{icone("prixVente")}
            </th>
            <th className="th-triable" onClick={() => basculerTri("enStock")}>
              Stock{icone("enStock")}
            </th>
            <th className="th-triable" onClick={() => basculerTri("dateCreation")}>
              Créé le{icone("dateCreation")}
            </th>
            <th>Actif</th>
            {peutGerer && <th>Actions</th>}
          </tr>
        </thead>
        <tbody>
          {produitsTries.map((p) => (
            <tr
              key={p.id}
              onClick={() => {
                setProduitSelectionneId(p.id);
                setVue("detail");
              }}
            >
              <td>{p.nom}</td>
              <td>{p.categorieNom ?? ""}</td>
              {peutVoirCout && <td>{p.prixAchat ?? ""}</td>}
              <td>{p.prixVente ?? ""}</td>
              <td>
                {p.enStock ? (
                  "En stock"
                ) : (
                  <span className="badge-rupture">Rupture</span>
                )}
              </td>
              <td>{new Date(p.dateCreation).toLocaleDateString("fr-FR")}</td>
              <td onClick={(e) => e.stopPropagation()}>
                {peutGerer ? (
                  <button type="button" onClick={() => basculerActif(p)}>
                    {p.actif ? "Actif" : "Inactif"}
                  </button>
                ) : p.actif ? (
                  "Oui"
                ) : (
                  "Non"
                )}
              </td>
              {peutGerer && (
                <td onClick={(e) => e.stopPropagation()}>
                  {produitASupprimerId === p.id ? (
                    <span className="confirmation-suppression">
                      Supprimer ?
                      <button type="button" onClick={() => supprimer(p.id)}>
                        Oui
                      </button>
                      <button type="button" onClick={() => setProduitASupprimerId(null)}>
                        Non
                      </button>
                    </span>
                  ) : (
                    <span className="actions-ligne">
                      <button
                        type="button"
                        className="lien-icone"
                        title="Modifier"
                        onClick={() => {
                          setProduitSelectionneId(p.id);
                          setVue("detail");
                        }}
                      >
                        ✎
                      </button>
                      <button
                        type="button"
                        className="lien-icone"
                        title="Supprimer"
                        onClick={() => setProduitASupprimerId(p.id)}
                      >
                        ×
                      </button>
                    </span>
                  )}
                </td>
              )}
            </tr>
          ))}
          {produits.length === 0 && (
            <tr>
              <td colSpan={6 + (peutVoirCout ? 1 : 0) + (peutGerer ? 1 : 0)} className="liste-vide">
                Aucun produit.
              </td>
            </tr>
          )}
        </tbody>
      </table>
      </div>
    </div>
  );
}

// --- Onglets Réglages catalogue : catégories, unités, attributs ---

function OngletCategories({ session }: { session: Session }) {
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
      {peutGerer && (
        <form onSubmit={ajouter} className="formulaire-inline barre-actions-fixe">
          <input placeholder="Nouvelle catégorie" value={nom} onChange={(e) => setNom(e.target.value)} />
          <button type="submit">Ajouter</button>
        </form>
      )}
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
                <button type="button" onClick={() => enregistrerEdition(c.id)}>
                  Enregistrer
                </button>
              </div>
            </li>
          ) : (
            <li key={c.id} className="ligne-liste-simple">
              <span>{c.nom}</span>
              {peutGerer &&
                (confirmationSuppressionId === c.id ? (
                  <div className="confirmation-retrait">
                    <span>Supprimer ?</span>
                    <button type="button" onClick={() => setConfirmationSuppressionId(null)}>
                      Non
                    </button>
                    <button type="button" onClick={() => supprimer(c.id)}>
                      Oui
                    </button>
                  </div>
                ) : (
                  <div className="actions-ligne-simple">
                    <button type="button" className="lien-icone" title="Modifier" onClick={() => commencerEdition(c)}>
                      ✎
                    </button>
                    <button
                      type="button"
                      className="lien-icone"
                      title="Supprimer"
                      onClick={() => setConfirmationSuppressionId(c.id)}
                    >
                      ×
                    </button>
                  </div>
                ))}
            </li>
          ),
        )}
        {categories.length === 0 && <li className="liste-vide">Aucune catégorie.</li>}
      </ul>
    </div>
  );
}

// --- Page principale ---
// Unités et Attributs se gèrent désormais depuis Réglages (voir Reglages.tsx) —
// ici on ne fait que les consommer (menus déroulants du formulaire produit).

const ONGLETS = [
  { cle: "produits", label: "Produits" },
  { cle: "categories", label: "Catégories" },
] as const;

type Onglet = (typeof ONGLETS)[number]["cle"];

export default function Produits({ session }: { session: Session }) {
  const [onglet, setOnglet] = useState<Onglet>("produits");

  return (
    <div className="page-produits">
      <div className="entete-page-onglets">
        <h2>Produits</h2>
        <div className="barre-onglets">
          {ONGLETS.map((o) => (
            <button
              key={o.cle}
              className={`onglet ${onglet === o.cle ? "actif" : ""}`}
              onClick={() => setOnglet(o.cle)}
            >
              {o.label}
            </button>
          ))}
        </div>
      </div>
      <div className="contenu-onglet">
        {onglet === "produits" && <OngletProduits session={session} />}
        {onglet === "categories" && <OngletCategories session={session} />}
      </div>
    </div>
  );
}
