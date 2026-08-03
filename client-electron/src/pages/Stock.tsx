import { useEffect, useState } from "react";

import { api } from "../api/client";
import { useDevise } from "../contexts/DeviseContext";
import type {
  DepotResume,
  InventaireDetail,
  InventaireResume,
  LigneAchatInitiale,
  LigneInventaireDetail,
  LigneStock,
  MouvementResume,
  ResultatEcriture,
  Session,
  TransfertResume,
  TypeMouvement,
  VarianteRecherchee,
} from "../api/client";
import { libelleTypeMouvement } from "../lib/libelles";

// --- Onglet Stock : niveaux par dépôt ---

function versLigneAchatInitiale(l: LigneStock): LigneAchatInitiale {
  return {
    varianteId: l.varianteId,
    produitNom: l.produitNom,
    prixAchat: l.prixAchat,
    prixVente: l.prixVente,
    depotId: l.depotId,
    depotNom: l.depotNom,
  };
}

function OngletStockNiveau({
  session,
  filtreRuptureInitial,
  onCommander,
}: {
  session: Session;
  filtreRuptureInitial?: boolean;
  onCommander?: (lignes: LigneAchatInitiale[]) => void;
}) {
  const peutGerer = !!session.permissions.gerer_produits_stock_achats;
  const [depots, setDepots] = useState<DepotResume[]>([]);
  const [depotId, setDepotId] = useState(peutGerer ? "" : (session.depotId ?? ""));
  const [terme, setTerme] = useState("");
  const [lignes, setLignes] = useState<LigneStock[]>([]);
  const [seulementRuptures, setSeulementRuptures] = useState(!!filtreRuptureInitial);
  const [selection, setSelection] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (peutGerer) api.depots.lister(session.boutiqueId).then(setDepots);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.boutiqueId, peutGerer]);

  useEffect(() => {
    api.stock.lister(session.boutiqueId, depotId || undefined, terme).then(setLignes);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [depotId, terme]);

  const lignesAffichees = seulementRuptures ? lignes.filter((l) => l.enRupture) : lignes;
  const rupturesAffichees = lignesAffichees.filter((l) => l.enRupture);
  const toutesSelectionnees = rupturesAffichees.length > 0 && rupturesAffichees.every((l) => selection.has(l.id));

  function basculerSelection(id: string) {
    setSelection((actuel) => {
      const suivant = new Set(actuel);
      if (suivant.has(id)) suivant.delete(id);
      else suivant.add(id);
      return suivant;
    });
  }

  function basculerToutSelectionner() {
    setSelection(toutesSelectionnees ? new Set() : new Set(rupturesAffichees.map((l) => l.id)));
  }

  function commanderLaSelection() {
    const lignesChoisies = rupturesAffichees.filter((l) => selection.has(l.id)).map(versLigneAchatInitiale);
    if (lignesChoisies.length > 0) onCommander?.(lignesChoisies);
  }

  return (
    <div>
      <div className="barre-actions">
        {peutGerer ? (
          <select value={depotId} onChange={(e) => setDepotId(e.target.value)}>
            <option value="">Tous les dépôts</option>
            {depots.map((d) => (
              <option key={d.id} value={d.id}>
                {d.nom}
              </option>
            ))}
          </select>
        ) : (
          session.depotNom && <span className="depot-fixe">{session.depotNom}</span>
        )}
        <input
          className="champ-recherche"
          placeholder="Rechercher un produit…"
          value={terme}
          onChange={(e) => setTerme(e.target.value)}
        />
        <label className="case-a-cocher">
          <input
            type="checkbox"
            checked={seulementRuptures}
            onChange={(e) => setSeulementRuptures(e.target.checked)}
          />
          Seulement les ruptures
        </label>
        {selection.size > 0 && (
          <button type="button" onClick={commanderLaSelection}>
            Commander la sélection ({selection.size})
          </button>
        )}
      </div>
      <div className="zone-tableau-scroll">
      <table className="tableau-catalogue">
        <thead>
          <tr>
            <th>
              {rupturesAffichees.length > 0 && (
                <input type="checkbox" checked={toutesSelectionnees} onChange={basculerToutSelectionner} />
              )}
            </th>
            <th>Produit</th>
            <th>Référence</th>
            <th>Dépôt</th>
            <th>Quantité</th>
            <th>Seuil</th>
            <th></th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {lignesAffichees.map((l) => (
            <tr key={l.id}>
              <td>
                {l.enRupture && (
                  <input type="checkbox" checked={selection.has(l.id)} onChange={() => basculerSelection(l.id)} />
                )}
              </td>
              <td>{l.produitNom}</td>
              <td>{l.reference || ""}</td>
              <td>{l.depotNom}</td>
              <td>{l.quantite}</td>
              <td>{l.seuilAlerte}</td>
              <td>{l.enRupture ? <span className="badge-rupture">Rupture</span> : null}</td>
              <td>
                {l.enRupture && onCommander && (
                  <button type="button" onClick={() => onCommander([versLigneAchatInitiale(l)])}>
                    Commander
                  </button>
                )}
              </td>
            </tr>
          ))}
          {lignesAffichees.length === 0 && (
            <tr>
              <td colSpan={8} className="liste-vide">
                {seulementRuptures ? "Aucune rupture de stock." : "Aucune ligne de stock."}
              </td>
            </tr>
          )}
        </tbody>
      </table>
      </div>
    </div>
  );
}

// --- Onglet Mouvements ---

function FormulaireMouvement({
  session,
  depots,
  onAnnuler,
  onCree,
}: {
  session: Session;
  depots: DepotResume[];
  onAnnuler: () => void;
  onCree: () => void;
}) {
  const [terme, setTerme] = useState("");
  const [resultats, setResultats] = useState<VarianteRecherchee[]>([]);
  const [varianteChoisie, setVarianteChoisie] = useState<VarianteRecherchee | null>(null);
  const [depotId, setDepotId] = useState(depots[0]?.id ?? "");
  const [type, setType] = useState<TypeMouvement>("entree");
  const [quantite, setQuantite] = useState("1");
  const [motif, setMotif] = useState("");
  const [erreur, setErreur] = useState<string | null>(null);
  const [enCours, setEnCours] = useState(false);

  useEffect(() => {
    if (!terme.trim()) {
      setResultats([]);
      return;
    }
    const identifiant = setTimeout(() => {
      api.catalogue.rechercherVariantes(session.boutiqueId, terme.trim()).then(setResultats);
    }, 200);
    return () => clearTimeout(identifiant);
  }, [terme, session.boutiqueId]);

  async function soumettre(evenement: React.FormEvent) {
    evenement.preventDefault();
    setErreur(null);
    if (!varianteChoisie) {
      setErreur("Choisissez un produit.");
      return;
    }
    if (!depotId) {
      setErreur("Choisissez un dépôt.");
      return;
    }
    const quantiteNombre = Number(quantite);
    if (!quantiteNombre || (type !== "ajustement" && quantiteNombre <= 0)) {
      setErreur("Quantité invalide.");
      return;
    }
    setEnCours(true);
    try {
      const resultat = await api.mouvements.creer({
        varianteId: varianteChoisie.id,
        depotId,
        type,
        quantite: type === "ajustement" ? quantiteNombre : Math.abs(quantiteNombre),
        motif,
        utilisateurId: session.utilisateurId,
      });
      if (resultat.succes) onCree();
      else setErreur(resultat.message);
    } finally {
      setEnCours(false);
    }
  }

  return (
    <form onSubmit={soumettre} className="formulaire-catalogue">
      <h4>Nouveau mouvement</h4>
      {erreur && <div className="message-erreur">{erreur}</div>}
      {!varianteChoisie ? (
        <>
          <input placeholder="Rechercher un produit…" value={terme} onChange={(e) => setTerme(e.target.value)} autoFocus />
          <ul className="resultats-recherche">
            {resultats.map((v) => (
              <li
                key={v.id}
                onClick={() => {
                  setVarianteChoisie(v);
                  setTerme("");
                  setResultats([]);
                }}
              >
                <span>
                  {v.produitNom} {v.reference && `(${v.reference})`}
                </span>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <p>
          Produit : <strong>{varianteChoisie.produitNom}</strong>{" "}
          <button type="button" className="lien" onClick={() => setVarianteChoisie(null)}>
            changer
          </button>
        </p>
      )}
      <div className="grille-champs">
        <label>
          Dépôt
          <select value={depotId} onChange={(e) => setDepotId(e.target.value)}>
            {depots.map((d) => (
              <option key={d.id} value={d.id}>
                {d.nom}
              </option>
            ))}
          </select>
        </label>
        <label>
          Type
          <select value={type} onChange={(e) => setType(e.target.value as TypeMouvement)}>
            <option value="entree">Entrée</option>
            <option value="sortie">Sortie</option>
            <option value="ajustement">Ajustement (correction signée)</option>
          </select>
        </label>
        <label>
          Quantité {type === "ajustement" && "(peut être négative)"}
          <input type="number" step="any" value={quantite} onChange={(e) => setQuantite(e.target.value)} />
        </label>
        <label>
          Motif
          <input value={motif} onChange={(e) => setMotif(e.target.value)} />
        </label>
      </div>
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

interface LigneMouvementGroupe {
  varianteId: string;
  produitNom: string;
  quantite: number;
}

function FormulaireMouvementGroupe({
  session,
  depots,
  onAnnuler,
  onCree,
}: {
  session: Session;
  depots: DepotResume[];
  onAnnuler: () => void;
  onCree: () => void;
}) {
  const [depotId, setDepotId] = useState(depots[0]?.id ?? "");
  const [motif, setMotif] = useState("");
  const [terme, setTerme] = useState("");
  const [resultats, setResultats] = useState<VarianteRecherchee[]>([]);
  const [lignes, setLignes] = useState<LigneMouvementGroupe[]>([]);
  const [erreur, setErreur] = useState<string | null>(null);
  const [enCours, setEnCours] = useState(false);

  useEffect(() => {
    if (!terme.trim()) {
      setResultats([]);
      return;
    }
    const identifiant = setTimeout(() => {
      api.catalogue.rechercherVariantes(session.boutiqueId, terme.trim()).then(setResultats);
    }, 200);
    return () => clearTimeout(identifiant);
  }, [terme, session.boutiqueId]);

  function ajouterLigne(variante: VarianteRecherchee) {
    setLignes((actuel) => {
      if (actuel.some((l) => l.varianteId === variante.id)) return actuel;
      return [...actuel, { varianteId: variante.id, produitNom: variante.produitNom, quantite: 1 }];
    });
    setTerme("");
    setResultats([]);
  }

  function modifierQuantite(varianteId: string, quantite: number) {
    setLignes((actuel) => actuel.map((l) => (l.varianteId === varianteId ? { ...l, quantite } : l)));
  }

  function retirerLigne(varianteId: string) {
    setLignes((actuel) => actuel.filter((l) => l.varianteId !== varianteId));
  }

  async function soumettre(evenement: React.FormEvent) {
    evenement.preventDefault();
    setErreur(null);
    if (!depotId) {
      setErreur("Choisissez un dépôt.");
      return;
    }
    if (lignes.length === 0) {
      setErreur("Ajoutez au moins un produit.");
      return;
    }
    setEnCours(true);
    try {
      for (const ligne of lignes) {
        const resultat = await api.mouvements.creer({
          varianteId: ligne.varianteId,
          depotId,
          type: "entree",
          quantite: ligne.quantite,
          motif,
          utilisateurId: session.utilisateurId,
        });
        if (!resultat.succes) {
          setErreur(`${ligne.produitNom} : ${resultat.message}`);
          return;
        }
      }
      onCree();
    } finally {
      setEnCours(false);
    }
  }

  return (
    <form onSubmit={soumettre} className="formulaire-mouvement-groupe">
      <div className="entete-detail entete-fixe">
        <h3>Entrée groupée</h3>
        <div className="actions-formulaire">
          <button type="button" onClick={onAnnuler}>
            Annuler
          </button>
          <button type="submit" disabled={enCours}>
            {enCours ? "Enregistrement…" : `Enregistrer (${lignes.length})`}
          </button>
        </div>
      </div>
      {erreur && <div className="message-erreur">{erreur}</div>}
      <div className="colonnes-mouvement-groupe">
        <div className="colonne-recherche-groupe">
          <div className="grille-champs">
            <label>
              Dépôt
              <select value={depotId} onChange={(e) => setDepotId(e.target.value)}>
                {depots.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.nom}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Motif
              <input value={motif} onChange={(e) => setMotif(e.target.value)} placeholder="ex. Réassort livraison" />
            </label>
          </div>

          <input
            placeholder="Rechercher un produit à ajouter…"
            value={terme}
            onChange={(e) => setTerme(e.target.value)}
          />
          <ul className="resultats-recherche">
            {resultats.map((v) => (
              <li key={v.id} onClick={() => ajouterLigne(v)}>
                <span>
                  {v.produitNom} {v.reference && `(${v.reference})`}
                </span>
              </li>
            ))}
          </ul>
        </div>

        <div className="colonne-lignes-groupe">
          <div className="lignes-groupe-scrollable">
            <table className="tableau-catalogue">
              <thead>
                <tr>
                  <th>Produit</th>
                  <th>Quantité</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {lignes.map((l) => (
                  <tr key={l.varianteId}>
                    <td>{l.produitNom}</td>
                    <td>
                      <input
                        type="number"
                        min={0.01}
                        step="any"
                        value={l.quantite}
                        onChange={(e) => modifierQuantite(l.varianteId, Number(e.target.value))}
                      />
                    </td>
                    <td>
                      <button type="button" onClick={() => retirerLigne(l.varianteId)}>
                        ✕
                      </button>
                    </td>
                  </tr>
                ))}
                {lignes.length === 0 && (
                  <tr>
                    <td colSpan={3} className="liste-vide">
                      Aucun produit ajouté.
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

function OngletMouvements({ session }: { session: Session }) {
  const peutGerer = !!session.permissions.gerer_produits_stock_achats;
  const [depots, setDepots] = useState<DepotResume[]>([]);
  const [depotId, setDepotId] = useState(peutGerer ? "" : (session.depotId ?? ""));
  const [mouvements, setMouvements] = useState<MouvementResume[]>([]);
  const [vue, setVue] = useState<"liste" | "formulaire" | "groupe">("liste");

  useEffect(() => {
    api.depots.lister(session.boutiqueId).then(setDepots);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.boutiqueId]);

  async function rafraichir() {
    setMouvements(await api.mouvements.lister(session.boutiqueId, depotId || undefined));
  }
  useEffect(() => {
    rafraichir();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [depotId]);

  if (vue === "formulaire") {
    return (
      <FormulaireMouvement
        session={session}
        depots={depots}
        onAnnuler={() => setVue("liste")}
        onCree={() => {
          setVue("liste");
          rafraichir();
        }}
      />
    );
  }

  if (vue === "groupe") {
    return (
      <FormulaireMouvementGroupe
        session={session}
        depots={depots}
        onAnnuler={() => setVue("liste")}
        onCree={() => {
          setVue("liste");
          rafraichir();
        }}
      />
    );
  }

  return (
    <div>
      <div className="barre-actions">
        {peutGerer ? (
          <select value={depotId} onChange={(e) => setDepotId(e.target.value)}>
            <option value="">Tous les dépôts</option>
            {depots.map((d) => (
              <option key={d.id} value={d.id}>
                {d.nom}
              </option>
            ))}
          </select>
        ) : (
          session.depotNom && <span className="depot-fixe">{session.depotNom}</span>
        )}
        {peutGerer && (
          <span className="actions-ligne">
            <button type="button" onClick={() => setVue("formulaire")}>
              + Nouveau mouvement
            </button>
            <button type="button" onClick={() => setVue("groupe")}>
              + Entrée groupée
            </button>
          </span>
        )}
      </div>
      <div className="zone-tableau-scroll">
      <table className="tableau-catalogue">
        <thead>
          <tr>
            <th>Date</th>
            <th>Produit</th>
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
              <td>
                {m.produitNom} {m.reference && `(${m.reference})`}
              </td>
              <td>{m.depotNom}</td>
              <td>{libelleTypeMouvement(m.type)}</td>
              <td>{m.quantite}</td>
              <td>{m.motif || ""}</td>
            </tr>
          ))}
          {mouvements.length === 0 && (
            <tr>
              <td colSpan={6} className="liste-vide">
                Aucun mouvement.
              </td>
            </tr>
          )}
        </tbody>
      </table>
      </div>
    </div>
  );
}

// --- Onglet Transferts ---

function FormulaireTransfert({
  session,
  depots,
  onAnnuler,
  onCree,
}: {
  session: Session;
  depots: DepotResume[];
  onAnnuler: () => void;
  onCree: () => void;
}) {
  const [terme, setTerme] = useState("");
  const [resultats, setResultats] = useState<VarianteRecherchee[]>([]);
  const [varianteChoisie, setVarianteChoisie] = useState<VarianteRecherchee | null>(null);
  const [depotSourceId, setDepotSourceId] = useState(depots[0]?.id ?? "");
  const [depotDestinationId, setDepotDestinationId] = useState(depots[1]?.id ?? "");
  const [quantite, setQuantite] = useState("1");
  const [erreur, setErreur] = useState<string | null>(null);
  const [enCours, setEnCours] = useState(false);

  useEffect(() => {
    if (!terme.trim()) {
      setResultats([]);
      return;
    }
    const identifiant = setTimeout(() => {
      api.catalogue.rechercherVariantes(session.boutiqueId, terme.trim()).then(setResultats);
    }, 200);
    return () => clearTimeout(identifiant);
  }, [terme, session.boutiqueId]);

  async function soumettre(evenement: React.FormEvent) {
    evenement.preventDefault();
    setErreur(null);
    if (!varianteChoisie) {
      setErreur("Choisissez un produit.");
      return;
    }
    setEnCours(true);
    try {
      const resultat = await api.transferts.creer({
        varianteId: varianteChoisie.id,
        depotSourceId,
        depotDestinationId,
        quantite: Number(quantite) || 0,
        utilisateurId: session.utilisateurId,
      });
      if (resultat.succes) onCree();
      else setErreur(resultat.message);
    } finally {
      setEnCours(false);
    }
  }

  return (
    <form onSubmit={soumettre} className="formulaire-catalogue">
      <h4>Nouveau transfert</h4>
      {erreur && <div className="message-erreur">{erreur}</div>}
      {!varianteChoisie ? (
        <>
          <input placeholder="Rechercher un produit…" value={terme} onChange={(e) => setTerme(e.target.value)} autoFocus />
          <ul className="resultats-recherche">
            {resultats.map((v) => (
              <li
                key={v.id}
                onClick={() => {
                  setVarianteChoisie(v);
                  setTerme("");
                  setResultats([]);
                }}
              >
                <span>
                  {v.produitNom} {v.reference && `(${v.reference})`}
                </span>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <p>
          Produit : <strong>{varianteChoisie.produitNom}</strong>{" "}
          <button type="button" className="lien" onClick={() => setVarianteChoisie(null)}>
            changer
          </button>
        </p>
      )}
      <div className="grille-champs">
        <label>
          Dépôt source
          <select value={depotSourceId} onChange={(e) => setDepotSourceId(e.target.value)}>
            {depots.map((d) => (
              <option key={d.id} value={d.id}>
                {d.nom}
              </option>
            ))}
          </select>
        </label>
        <label>
          Dépôt destination
          <select value={depotDestinationId} onChange={(e) => setDepotDestinationId(e.target.value)}>
            {depots.map((d) => (
              <option key={d.id} value={d.id}>
                {d.nom}
              </option>
            ))}
          </select>
        </label>
        <label>
          Quantité
          <input type="number" min={0.01} step="any" value={quantite} onChange={(e) => setQuantite(e.target.value)} />
        </label>
      </div>
      <div className="actions-formulaire">
        <button type="button" onClick={onAnnuler}>
          Annuler
        </button>
        <button type="submit" disabled={enCours}>
          {enCours ? "Transfert…" : "Transférer"}
        </button>
      </div>
    </form>
  );
}

function OngletTransferts({ session }: { session: Session }) {
  const peutGerer = !!session.permissions.gerer_produits_stock_achats;
  const [depots, setDepots] = useState<DepotResume[]>([]);
  const [transferts, setTransferts] = useState<TransfertResume[]>([]);
  const [afficherForm, setAfficherForm] = useState(false);

  async function rafraichir() {
    const tous = await api.transferts.lister(session.boutiqueId);
    // Un caissier ne voit que les transferts qui concernent son dépôt (source ou
    // destination) — le Patron/Gérant garde la vue globale.
    setTransferts(
      peutGerer || !session.depotNom
        ? tous
        : tous.filter((t) => t.depotSourceNom === session.depotNom || t.depotDestinationNom === session.depotNom),
    );
  }
  useEffect(() => {
    api.depots.lister(session.boutiqueId).then(setDepots);
    rafraichir();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.boutiqueId]);

  return (
    <div>
      {peutGerer && !afficherForm && (
        <div className="barre-actions">
          <button type="button" onClick={() => setAfficherForm(true)}>
            + Nouveau transfert
          </button>
        </div>
      )}
      {afficherForm && (
        <FormulaireTransfert
          session={session}
          depots={depots}
          onAnnuler={() => setAfficherForm(false)}
          onCree={() => {
            setAfficherForm(false);
            rafraichir();
          }}
        />
      )}
      <div className="zone-tableau-scroll">
      <table className="tableau-catalogue">
        <thead>
          <tr>
            <th>Date</th>
            <th>Produit</th>
            <th>De</th>
            <th>Vers</th>
            <th>Quantité</th>
          </tr>
        </thead>
        <tbody>
          {transferts.map((t) => (
            <tr key={t.id}>
              <td>{new Date(t.dateCreation).toLocaleString("fr-FR")}</td>
              <td>
                {t.produitNom} {t.reference && `(${t.reference})`}
              </td>
              <td>{t.depotSourceNom}</td>
              <td>{t.depotDestinationNom}</td>
              <td>{t.quantite}</td>
            </tr>
          ))}
          {transferts.length === 0 && (
            <tr>
              <td colSpan={5} className="liste-vide">
                Aucun transfert.
              </td>
            </tr>
          )}
        </tbody>
      </table>
      </div>
    </div>
  );
}

// --- Onglet Inventaire ---

/** Saisie libre jusqu'à confirmation explicite (Entrée ou ✓) — comme les Mouvements,
 * plutôt que l'ancien enregistrement immédiat au blur qui partait avant d'avoir fini de corriger. */
function LigneInventaireEditable({
  ligne,
  onEnregistrer,
}: {
  ligne: LigneInventaireDetail;
  onEnregistrer: (id: string, valeur: number) => Promise<ResultatEcriture<void>>;
}) {
  const [valeur, setValeur] = useState(String(ligne.qtePhysique));
  const [enCours, setEnCours] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const nombreValeur = Number(valeur);
  const valeurValide = valeur.trim() !== "" && !Number.isNaN(nombreValeur);
  const modifie = valeurValide && nombreValeur !== ligne.qtePhysique;
  const ecartAffiche = valeurValide ? nombreValeur - ligne.qteTheorique : ligne.ecart;

  async function enregistrer() {
    if (!modifie) return;
    setEnCours(true);
    setErreur(null);
    try {
      const resultat = await onEnregistrer(ligne.id, nombreValeur);
      if (!resultat.succes) setErreur(resultat.message);
    } finally {
      setEnCours(false);
    }
  }

  return (
    <>
      <td>
        <div className="champ-mot-de-passe-genere">
          <input
            type="number"
            step="any"
            value={valeur}
            onChange={(e) => setValeur(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") enregistrer();
            }}
          />
          {modifie && (
            <button type="button" className="lien-icone" title="Enregistrer" disabled={enCours} onClick={enregistrer}>
              ✓
            </button>
          )}
        </div>
        {erreur && <div className="message-erreur">{erreur}</div>}
      </td>
      <td>{ecartAffiche}</td>
    </>
  );
}

function DetailInventaire({
  inventaireId,
  session,
  onRetour,
}: {
  inventaireId: string;
  session: Session;
  onRetour: () => void;
}) {
  const peutGerer = !!session.permissions.gerer_produits_stock_achats;
  const [inventaire, setInventaire] = useState<InventaireDetail | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [enCours, setEnCours] = useState(false);
  const devise = useDevise();

  async function rafraichir() {
    setInventaire((await api.inventaires.obtenir(inventaireId)) ?? null);
  }
  useEffect(() => {
    rafraichir();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inventaireId]);

  async function enregistrerLigne(ligneId: string, valeur: number) {
    const resultat = await api.inventaires.validerLigne(ligneId, valeur);
    if (resultat.succes) rafraichir();
    return resultat;
  }

  async function valider() {
    setEnCours(true);
    setErreur(null);
    try {
      const resultat = await api.inventaires.valider(inventaireId, session.utilisateurId);
      if (resultat.succes) rafraichir();
      else setErreur(resultat.message);
    } finally {
      setEnCours(false);
    }
  }

  if (!inventaire) return <p>Chargement…</p>;
  const estValide = inventaire.statut === "valide";

  return (
    <div className="detail-produit">
      <div className="entete-detail">
        <div className="entete-detail-titre">
          <h3>Inventaire : {inventaire.depotNom}</h3>
          <span className="statut-inline">Statut : {estValide ? "Validé" : "En cours"}</span>
        </div>
        <div className="entete-detail-actions">
          {!estValide && peutGerer && (
            <button type="button" onClick={valider} disabled={enCours}>
              {enCours ? "Validation…" : "Valider l'inventaire"}
            </button>
          )}
          <button type="button" className="lien bouton-retour" onClick={onRetour}>
            ← Retour à la liste
          </button>
        </div>
      </div>
      {erreur && <div className="message-erreur">{erreur}</div>}
      <div className="zone-tableau-scroll">
      <table className="tableau-catalogue">
        <thead>
          <tr>
            <th>Produit</th>
            <th>Référence</th>
            <th>Théorique</th>
            <th>Physique</th>
            <th>Écart</th>
            <th>Valeur théorique ({devise})</th>
            <th>Valeur physique ({devise})</th>
            <th>Écart ({devise})</th>
            <th>CA période ({devise})</th>
          </tr>
        </thead>
        <tbody>
          {inventaire.lignes.map((l) =>
            estValide || !peutGerer ? (
              <tr key={l.id}>
                <td>{l.produitNom}</td>
                <td>{l.reference || ""}</td>
                <td>{l.qteTheorique}</td>
                <td>{l.qtePhysique}</td>
                <td>{l.ecart}</td>
                <td>{l.valeurTheorique}</td>
                <td>{l.valeurPhysique}</td>
                <td>{l.valeurEcart}</td>
                <td>{l.caPeriode}</td>
              </tr>
            ) : (
              <tr key={l.id}>
                <td>{l.produitNom}</td>
                <td>{l.reference || ""}</td>
                <td>{l.qteTheorique}</td>
                <LigneInventaireEditable ligne={l} onEnregistrer={enregistrerLigne} />
                <td>{l.valeurTheorique}</td>
                <td>{l.valeurPhysique}</td>
                <td>{l.valeurEcart}</td>
                <td>{l.caPeriode}</td>
              </tr>
            ),
          )}
          {inventaire.lignes.length === 0 && (
            <tr>
              <td colSpan={9} className="liste-vide">
                Aucune ligne (aucun stock dans ce dépôt au démarrage de l'inventaire).
              </td>
            </tr>
          )}
        </tbody>
        {inventaire.lignes.length > 0 && (
          <tfoot>
            <tr className="ligne-total-inventaire">
              <td colSpan={5}>Total</td>
              <td>{inventaire.valeurTheorique}</td>
              <td>{inventaire.valeurPhysique}</td>
              <td>{inventaire.ecartValeur}</td>
              <td>{inventaire.caPeriode}</td>
            </tr>
          </tfoot>
        )}
      </table>
      </div>
    </div>
  );
}

function OngletInventaire({ session }: { session: Session }) {
  const peutGerer = !!session.permissions.gerer_produits_stock_achats;
  const [vue, setVue] = useState<"liste" | "detail">("liste");
  const [inventaires, setInventaires] = useState<InventaireResume[]>([]);
  const [depots, setDepots] = useState<DepotResume[]>([]);
  const [depotChoisi, setDepotChoisi] = useState("");
  const [inventaireSelectionneId, setInventaireSelectionneId] = useState<string | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [enCours, setEnCours] = useState(false);

  async function rafraichir() {
    const tous = await api.inventaires.lister(session.boutiqueId);
    setInventaires(peutGerer || !session.depotNom ? tous : tous.filter((i) => i.depotNom === session.depotNom));
  }
  useEffect(() => {
    rafraichir();
    api.depots.lister(session.boutiqueId).then((liste) => {
      setDepots(liste);
      if (liste[0]) setDepotChoisi(liste[0].id);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.boutiqueId]);

  async function demarrer() {
    if (!depotChoisi) return;
    setEnCours(true);
    setErreur(null);
    try {
      const resultat = await api.inventaires.demarrer(session.boutiqueId, depotChoisi, session.utilisateurId);
      if (resultat.succes) {
        await rafraichir();
        setInventaireSelectionneId(resultat.resultat);
        setVue("detail");
      } else {
        setErreur(resultat.message);
      }
    } finally {
      setEnCours(false);
    }
  }

  if (vue === "detail" && inventaireSelectionneId) {
    return (
      <DetailInventaire
        inventaireId={inventaireSelectionneId}
        session={session}
        onRetour={() => {
          setVue("liste");
          rafraichir();
        }}
      />
    );
  }

  return (
    <div>
      {erreur && <div className="message-erreur">{erreur}</div>}
      {peutGerer && (
        <div className="barre-actions">
          <select value={depotChoisi} onChange={(e) => setDepotChoisi(e.target.value)}>
            {depots.map((d) => (
              <option key={d.id} value={d.id}>
                {d.nom}
              </option>
            ))}
          </select>
          <button type="button" onClick={demarrer} disabled={enCours || !depotChoisi}>
            {enCours ? "Démarrage…" : "Démarrer un inventaire"}
          </button>
        </div>
      )}
      <div className="zone-tableau-scroll">
      <table className="tableau-catalogue">
        <thead>
          <tr>
            <th>Dépôt</th>
            <th>Statut</th>
            <th>Date</th>
          </tr>
        </thead>
        <tbody>
          {inventaires.map((i) => (
            <tr
              key={i.id}
              onClick={() => {
                setInventaireSelectionneId(i.id);
                setVue("detail");
              }}
            >
              <td>{i.depotNom}</td>
              <td>{i.statut === "valide" ? "Validé" : "En cours"}</td>
              <td>{new Date(i.dateCreation).toLocaleString("fr-FR")}</td>
            </tr>
          ))}
          {inventaires.length === 0 && (
            <tr>
              <td colSpan={3} className="liste-vide">
                Aucun inventaire.
              </td>
            </tr>
          )}
        </tbody>
      </table>
      </div>
    </div>
  );
}

// --- Entrée groupée depuis une sélection de ruptures (boutique sans fournisseur : fabrication propre) ---

interface LigneEntreeGroupee {
  varianteId: string;
  produitNom: string;
  depotId: string;
  depotNom: string;
  quantite: number;
  prixAchat: number;
  prixVente: number;
}

function EntreeGroupeeDepuisSelection({
  session,
  lignes,
  onAnnuler,
  onCreee,
}: {
  session: Session;
  lignes: LigneAchatInitiale[];
  onAnnuler: () => void;
  onCreee: () => void;
}) {
  const [lignesEditees, setLignesEditees] = useState<LigneEntreeGroupee[]>(
    lignes.map((l) => ({
      varianteId: l.varianteId,
      produitNom: l.produitNom,
      depotId: l.depotId,
      depotNom: l.depotNom,
      quantite: 1,
      prixAchat: l.prixAchat,
      prixVente: l.prixVente,
    })),
  );
  const [motif, setMotif] = useState("Réapprovisionnement (production)");
  const [erreur, setErreur] = useState<string | null>(null);
  const [enCours, setEnCours] = useState(false);

  function modifierLigne(varianteId: string, champs: Partial<LigneEntreeGroupee>) {
    setLignesEditees((actuel) => actuel.map((l) => (l.varianteId === varianteId ? { ...l, ...champs } : l)));
  }

  function retirerLigne(varianteId: string) {
    setLignesEditees((actuel) => actuel.filter((l) => l.varianteId !== varianteId));
  }

  async function confirmer() {
    setErreur(null);
    if (lignesEditees.length === 0) {
      setErreur("Aucun produit à enregistrer.");
      return;
    }
    setEnCours(true);
    try {
      for (const ligne of lignesEditees) {
        const resultat = await api.mouvements.creerEntreeProduction({
          varianteId: ligne.varianteId,
          depotId: ligne.depotId,
          quantite: ligne.quantite,
          prixAchat: ligne.prixAchat,
          prixVente: ligne.prixVente,
          motif,
          utilisateurId: session.utilisateurId,
        });
        if (!resultat.succes) {
          setErreur(`${ligne.produitNom} : ${resultat.message}`);
          return;
        }
      }
      onCreee();
    } finally {
      setEnCours(false);
    }
  }

  return (
    <div className="detail-produit">
      <div className="entete-detail entete-fixe">
        <h3>Entrée de stock pour les produits en rupture ({lignesEditees.length})</h3>
        <div className="actions-formulaire">
          <button type="button" onClick={onAnnuler}>
            Annuler
          </button>
          <button type="button" onClick={confirmer} disabled={enCours || lignesEditees.length === 0}>
            {enCours ? "Enregistrement…" : "Confirmer l'entrée"}
          </button>
        </div>
      </div>
      {erreur && <div className="message-erreur">{erreur}</div>}
      <label>
        Motif
        <input value={motif} onChange={(e) => setMotif(e.target.value)} />
      </label>
      <div className="zone-tableau-scroll">
      <table className="tableau-catalogue">
        <thead>
          <tr>
            <th>Produit</th>
            <th>Dépôt</th>
            <th>Quantité</th>
            <th>Coût unitaire</th>
            <th>Prix de vente</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {lignesEditees.map((l) => (
            <tr key={l.varianteId}>
              <td>{l.produitNom}</td>
              <td>{l.depotNom}</td>
              <td>
                <input
                  type="number"
                  min={0.01}
                  step="any"
                  value={l.quantite}
                  onChange={(e) => modifierLigne(l.varianteId, { quantite: Number(e.target.value) })}
                />
              </td>
              <td>
                <input
                  type="number"
                  min={0}
                  step="any"
                  value={l.prixAchat}
                  onChange={(e) => modifierLigne(l.varianteId, { prixAchat: Number(e.target.value) })}
                />
              </td>
              <td>
                <input
                  type="number"
                  min={0}
                  step="any"
                  value={l.prixVente}
                  onChange={(e) => modifierLigne(l.varianteId, { prixVente: Number(e.target.value) })}
                />
              </td>
              <td>
                <button type="button" onClick={() => retirerLigne(l.varianteId)}>
                  ✕
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      </div>
    </div>
  );
}

// --- Page principale ---
// Dépôts se gère désormais depuis Réglages (voir Reglages.tsx) — ici on ne
// fait que les consommer (sélecteurs de filtre par dépôt).

const ONGLETS = [
  { cle: "stock", label: "Stock" },
  { cle: "mouvements", label: "Mouvements" },
  { cle: "transferts", label: "Transferts" },
  { cle: "inventaire", label: "Inventaire" },
] as const;

type Onglet = (typeof ONGLETS)[number]["cle"];

export default function Stock({
  session,
  filtreRuptureInitial,
  lignesEntreeInitiales,
  onCommander,
}: {
  session: Session;
  filtreRuptureInitial?: boolean;
  lignesEntreeInitiales?: LigneAchatInitiale[];
  onCommander?: (lignes: LigneAchatInitiale[]) => void;
}) {
  const [onglet, setOnglet] = useState<Onglet>("stock");
  const [entreeGroupeeActive, setEntreeGroupeeActive] = useState(false);

  // Raccourci "Commander" sur une rupture, boutique sans fournisseur : ouvre
  // directement l'entrée de stock groupée. Ne pas vider lignesEntreeInitiales
  // ici (à la charge de Shell, en quittant la page) — sinon React regrouperait
  // les deux mises à jour et l'écran s'ouvrirait déjà vide.
  useEffect(() => {
    if (lignesEntreeInitiales && lignesEntreeInitiales.length > 0) setEntreeGroupeeActive(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lignesEntreeInitiales]);

  if (entreeGroupeeActive) {
    return (
      <div className="page-produits">
        <h2>Stock</h2>
        <EntreeGroupeeDepuisSelection
          session={session}
          lignes={lignesEntreeInitiales ?? []}
          onAnnuler={() => setEntreeGroupeeActive(false)}
          onCreee={() => setEntreeGroupeeActive(false)}
        />
      </div>
    );
  }

  return (
    <div className="page-produits">
      <div className="entete-page-onglets">
        <h2>Stock</h2>
        <div className="barre-onglets">
          {ONGLETS.map((o) => (
            <button key={o.cle} className={`onglet ${onglet === o.cle ? "actif" : ""}`} onClick={() => setOnglet(o.cle)}>
              {o.label}
            </button>
          ))}
        </div>
      </div>
      <div className="contenu-onglet">
        {onglet === "stock" && (
          <OngletStockNiveau session={session} filtreRuptureInitial={filtreRuptureInitial} onCommander={onCommander} />
        )}
        {onglet === "mouvements" && <OngletMouvements session={session} />}
        {onglet === "transferts" && <OngletTransferts session={session} />}
        {onglet === "inventaire" && <OngletInventaire session={session} />}
      </div>
    </div>
  );
}
