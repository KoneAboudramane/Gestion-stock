import { useEffect, useState } from "react";
import type { CSSProperties } from "react";

import type { Session } from "../api";
import ChampMontant from "../components/ChampMontant";
import { useDevise } from "../contexts/DeviseContext";
import { formaterMontant } from "../lib/formatage";
import { rechercherVariantesAchat, type VarianteAchat } from "../services/achats";
import {
  appliquerMouvement,
  creerEntreeProduction,
  demarrerInventaire,
  ErreurStock,
  listerDepotsDetail,
  listerInventaires,
  listerMouvements,
  listerStock,
  listerTransferts,
  modifierLigneInventaire,
  obtenirInventaire,
  transfererStock,
  validerInventaire,
  type DepotResume,
  type InventaireDetail,
  type InventaireResume,
  type LigneAchatInitiale,
  type LigneInventaireDetail,
  type LigneStock,
  type MouvementResume,
  type TransfertResume,
  type TypeMouvement,
} from "../services/stock";

/**
 * Port de client-electron/src/pages/Stock.tsx : 4 sections (Stock/Mouvements/
 * Transferts/Inventaire), même patron boutons-cartes + modale que Achats.tsx.
 * Local d'abord (IndexedDB, voir services/stock.ts), comme le reste de
 * l'application.
 *
 * Sélection multiple des ruptures + "Commander la sélection" (2026-08-22,
 * parité Electron) : le bouton "Commander" appelle onCommander, fourni par
 * Shell.tsx, qui bascule vers l'entrée groupée ci-dessous (boutique sans
 * fournisseur) ou vers l'aperçu de commandes groupées d'Achats.tsx (boutique
 * avec fournisseur), pré-rempli avec les lignes choisies ici.
 */

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
  { cle: "stock", label: "Stock", icone: "📦" },
  { cle: "mouvements", label: "Mouvements", icone: "🔄" },
  { cle: "transferts", label: "Transferts", icone: "🚚" },
  { cle: "inventaire", label: "Inventaire", icone: "📋" },
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

function libelleTypeMouvement(type: TypeMouvement): string {
  if (type === "entree") return "Entrée";
  if (type === "sortie") return "Sortie";
  return "Ajustement";
}

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

// --- Onglet Stock (niveaux) ---

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
    if (peutGerer) listerDepotsDetail(session.boutiqueId).then(setDepots);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [peutGerer]);

  useEffect(() => {
    listerStock(session.boutiqueId, depotId || undefined).then(setLignes);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [depotId]);

  const termeNormalise = terme.trim().toLowerCase();
  const lignesFiltrees = termeNormalise
    ? lignes.filter(
        (l) => l.produitNom.toLowerCase().includes(termeNormalise) || l.reference.toLowerCase().includes(termeNormalise),
      )
    : lignes;
  const lignesAffichees = seulementRuptures ? lignesFiltrees.filter((l) => l.enRupture) : lignesFiltrees;
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
          className="champ-recherche champ-recherche-stock"
          placeholder="Rechercher un article…"
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
          <span className="actions-ligne">
            <button type="button" className="bouton-primaire" onClick={commanderLaSelection}>
              Commander la sélection ({selection.size})
            </button>
          </span>
        )}
      </div>
      <div className="zone-tableau-scroll">
        <table className="tableau-catalogue">
          <thead>
            <tr>
              <th>N°</th>
              <th>Désignation</th>
              <th>Référence</th>
              <th>Dépôt</th>
              <th>Quantité</th>
              <th>Seuil</th>
              <th className="colonne-statut-stock">Statut</th>
              <th className="colonne-actions-stock">
                <span className="entete-actions-stock">
                  Actions
                  {rupturesAffichees.length > 0 && (
                    <input
                      type="checkbox"
                      className="case-selection"
                      title="Tout sélectionner"
                      checked={toutesSelectionnees}
                      onChange={basculerToutSelectionner}
                    />
                  )}
                </span>
              </th>
            </tr>
          </thead>
          <tbody>
            {lignesAffichees.map((l, index) => (
              <tr key={l.id}>
                <td>{index + 1}</td>
                <td>{l.produitNom}</td>
                <td>{l.reference || ""}</td>
                <td>{l.depotNom}</td>
                <td>{l.quantite}</td>
                <td>{l.seuilAlerte}</td>
                <td className="colonne-statut-stock">{l.enRupture ? <span className="badge-rupture">Rupture</span> : null}</td>
                <td className="colonne-actions-stock">
                  {l.enRupture && (
                    <span className="actions-ligne">
                      <input
                        type="checkbox"
                        className="case-selection"
                        checked={selection.has(l.id)}
                        onChange={() => basculerSelection(l.id)}
                      />
                      {onCommander && (
                        <button
                          type="button"
                          className="bouton-commander-stock"
                          onClick={() => onCommander([versLigneAchatInitiale(l)])}
                        >
                          Commander
                        </button>
                      )}
                    </span>
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

interface LigneMouvementGroupe {
  varianteId: string;
  produitNom: string;
  reference: string;
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
  const [type, setType] = useState<TypeMouvement>("entree");
  const [motif, setMotif] = useState("");
  const [terme, setTerme] = useState("");
  const [resultats, setResultats] = useState<VarianteAchat[]>([]);
  const [dropdownOuvert, setDropdownOuvert] = useState(false);
  const [lignes, setLignes] = useState<LigneMouvementGroupe[]>([]);
  const [erreur, setErreur] = useState<string | null>(null);
  const [enCours, setEnCours] = useState(false);

  useEffect(() => {
    if (!terme.trim()) {
      setResultats([]);
      return;
    }
    const identifiant = setTimeout(() => {
      rechercherVariantesAchat(session.boutiqueId, terme.trim()).then(setResultats);
    }, 200);
    return () => clearTimeout(identifiant);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [terme]);

  function ajouterLigne(variante: VarianteAchat) {
    setLignes((actuel) => {
      if (actuel.some((l) => l.varianteId === variante.id)) return actuel;
      return [
        ...actuel,
        { varianteId: variante.id, produitNom: variante.produitNom, reference: variante.reference, quantite: 1 },
      ];
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
      setErreur("Ajoutez au moins un article.");
      return;
    }
    setEnCours(true);
    try {
      for (const ligne of lignes) {
        try {
          await appliquerMouvement({
            varianteId: ligne.varianteId,
            depotId,
            type,
            quantite: type === "ajustement" ? ligne.quantite : Math.abs(ligne.quantite),
            motif,
            utilisateurId: session.utilisateurId,
          });
        } catch (e) {
          setErreur(`${ligne.produitNom} : ${e instanceof ErreurStock ? e.message : "Erreur inattendue."}`);
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
      <div className="modale-entete entete-fixe">
        <h3>Nouveau mouvement</h3>
        <div className="actions-formulaire">
          <button type="submit" disabled={enCours}>
            {enCours ? "Enregistrement…" : `Enregistrer (${lignes.length})`}
          </button>
          <button type="button" className="lien bouton-retour" onClick={onAnnuler}>
            ← Retour
          </button>
        </div>
      </div>
      {erreur && <div className="message-erreur">{erreur}</div>}
      <div className="colonnes-mouvement-groupe">
        <div className="colonne-recherche-groupe">
          <div className="ligne-champs-recherche-commande">
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
              Motif
              <input value={motif} onChange={(e) => setMotif(e.target.value)} placeholder="ex. Réassort livraison" />
            </label>

            <div className="recherche-commande-combobox">
              <input
                placeholder="Rechercher un article à ajouter…"
                value={terme}
                onChange={(e) => setTerme(e.target.value)}
                onFocus={() => setDropdownOuvert(true)}
                onBlur={() => setDropdownOuvert(false)}
              />
              {terme.trim() && dropdownOuvert && (
                <ul className="resultats-recherche">
                  {resultats
                    .filter((v) => !lignes.some((l) => l.varianteId === v.id))
                    .map((v) => (
                      <li
                        key={v.id}
                        onMouseDown={(e) => {
                          e.preventDefault();
                          ajouterLigne(v);
                        }}
                      >
                        <span>
                          {v.produitNom} {v.reference && `(${v.reference})`}
                        </span>
                      </li>
                    ))}
                  {resultats.length === 0 && <li className="liste-vide">Aucun résultat.</li>}
                </ul>
              )}
            </div>
          </div>
        </div>

        <div className="colonne-lignes-groupe">
          <div className="lignes-groupe-scrollable">
            <table className="tableau-catalogue">
              <thead>
                <tr>
                  <th className="colonne-numero-groupe">N°</th>
                  <th>Référence</th>
                  <th className="col-designation-groupe">Désignation</th>
                  <th>Quantité {type === "ajustement" && "(± )"}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {lignes.map((l, index) => (
                  <tr key={l.varianteId}>
                    <td className="colonne-numero-groupe">{index + 1}</td>
                    <td>{l.reference || ""}</td>
                    <td className="col-designation-groupe">{l.produitNom}</td>
                    <td>
                      <input
                        type="number"
                        min={type === "ajustement" ? undefined : 0.01}
                        step="any"
                        value={l.quantite}
                        onChange={(e) => modifierQuantite(l.varianteId, Number(e.target.value))}
                      />
                    </td>
                    <td>
                      <button
                        type="button"
                        className="bouton-retirer-ligne-groupe"
                        title="Retirer de la liste"
                        onClick={() => retirerLigne(l.varianteId)}
                      >
                        ✕
                      </button>
                    </td>
                  </tr>
                ))}
                {Array.from({ length: Math.max(0, 10 - lignes.length) }).map((_, i) => (
                  <tr key={`vide-${i}`} className="ligne-groupe-vide">
                    <td className="colonne-numero-groupe">&nbsp;</td>
                    <td>&nbsp;</td>
                    <td className="col-designation-groupe">&nbsp;</td>
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

function OngletMouvements({ session }: { session: Session }) {
  const peutGerer = !!session.permissions.gerer_produits_stock_achats;
  const [depots, setDepots] = useState<DepotResume[]>([]);
  const [depotId, setDepotId] = useState(peutGerer ? "" : (session.depotId ?? ""));
  const [mouvements, setMouvements] = useState<MouvementResume[]>([]);
  const [vue, setVue] = useState<"liste" | "groupe">("liste");

  useEffect(() => {
    if (peutGerer) listerDepotsDetail(session.boutiqueId).then(setDepots);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [peutGerer]);

  async function rafraichir() {
    setMouvements(await listerMouvements(session.boutiqueId, depotId || undefined));
  }
  useEffect(() => {
    rafraichir();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [depotId]);

  return (
    <div>
      {vue === "groupe" && (
        <div className="fond-modale" onClick={() => setVue("liste")}>
          <div className="modale-selection-produits" onClick={(e) => e.stopPropagation()}>
            <FormulaireMouvementGroupe
              session={session}
              depots={depots}
              onAnnuler={() => setVue("liste")}
              onCree={() => {
                setVue("liste");
                rafraichir();
              }}
            />
          </div>
        </div>
      )}
      <div className="barre-actions barre-actions-avec-onglets">
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
            <button type="button" className="bouton-ajouter-variante" onClick={() => setVue("groupe")}>
              + Nouveau mouvement
            </button>
          </span>
        )}
      </div>
      <div className="zone-tableau-scroll">
        <table className="tableau-catalogue">
          <thead>
            <tr>
              <th>Date</th>
              <th>Désignation</th>
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

interface LigneTransfertGroupe {
  varianteId: string;
  produitNom: string;
  reference: string;
  quantite: number;
}

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
  const [depotSourceId, setDepotSourceId] = useState(depots[0]?.id ?? "");
  const [depotDestinationId, setDepotDestinationId] = useState(depots[1]?.id ?? "");
  const [terme, setTerme] = useState("");
  const [resultats, setResultats] = useState<VarianteAchat[]>([]);
  const [dropdownOuvert, setDropdownOuvert] = useState(false);
  const [lignes, setLignes] = useState<LigneTransfertGroupe[]>([]);
  const [erreur, setErreur] = useState<string | null>(null);
  const [enCours, setEnCours] = useState(false);

  useEffect(() => {
    if (!terme.trim()) {
      setResultats([]);
      return;
    }
    const identifiant = setTimeout(() => {
      rechercherVariantesAchat(session.boutiqueId, terme.trim()).then(setResultats);
    }, 200);
    return () => clearTimeout(identifiant);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [terme]);

  function ajouterLigne(variante: VarianteAchat) {
    setLignes((actuel) => {
      if (actuel.some((l) => l.varianteId === variante.id)) return actuel;
      return [
        ...actuel,
        { varianteId: variante.id, produitNom: variante.produitNom, reference: variante.reference, quantite: 1 },
      ];
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
    if (!depotSourceId || !depotDestinationId) {
      setErreur("Choisissez les dépôts source et destination.");
      return;
    }
    if (depotSourceId === depotDestinationId) {
      setErreur("Les dépôts source et destination doivent être différents.");
      return;
    }
    if (lignes.length === 0) {
      setErreur("Ajoutez au moins un article.");
      return;
    }
    setEnCours(true);
    try {
      for (const ligne of lignes) {
        try {
          await transfererStock({
            varianteId: ligne.varianteId,
            depotSourceId,
            depotDestinationId,
            quantite: ligne.quantite,
            utilisateurId: session.utilisateurId,
          });
        } catch (e) {
          setErreur(`${ligne.produitNom} : ${e instanceof ErreurStock ? e.message : "Erreur inattendue."}`);
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
      <div className="modale-entete entete-fixe">
        <h3>Nouveau transfert</h3>
        <div className="actions-formulaire">
          <button type="submit" disabled={enCours}>
            {enCours ? "Enregistrement…" : `Transférer (${lignes.length})`}
          </button>
          <button type="button" className="lien bouton-retour" onClick={onAnnuler}>
            ← Retour
          </button>
        </div>
      </div>
      {erreur && <div className="message-erreur">{erreur}</div>}
      <div className="colonnes-mouvement-groupe">
        <div className="colonne-recherche-groupe">
          <div className="ligne-champs-recherche-commande">
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

            <div className="recherche-commande-combobox">
              <input
                placeholder="Rechercher un article à ajouter…"
                value={terme}
                onChange={(e) => setTerme(e.target.value)}
                onFocus={() => setDropdownOuvert(true)}
                onBlur={() => setDropdownOuvert(false)}
              />
              {terme.trim() && dropdownOuvert && (
                <ul className="resultats-recherche">
                  {resultats
                    .filter((v) => !lignes.some((l) => l.varianteId === v.id))
                    .map((v) => (
                      <li
                        key={v.id}
                        onMouseDown={(e) => {
                          e.preventDefault();
                          ajouterLigne(v);
                        }}
                      >
                        <span>
                          {v.produitNom} {v.reference && `(${v.reference})`}
                        </span>
                      </li>
                    ))}
                  {resultats.length === 0 && <li className="liste-vide">Aucun résultat.</li>}
                </ul>
              )}
            </div>
          </div>
        </div>

        <div className="colonne-lignes-groupe">
          <div className="lignes-groupe-scrollable">
            <table className="tableau-catalogue">
              <thead>
                <tr>
                  <th className="colonne-numero-groupe">N°</th>
                  <th>Référence</th>
                  <th className="col-designation-groupe">Désignation</th>
                  <th>Quantité</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {lignes.map((l, index) => (
                  <tr key={l.varianteId}>
                    <td className="colonne-numero-groupe">{index + 1}</td>
                    <td>{l.reference || ""}</td>
                    <td className="col-designation-groupe">{l.produitNom}</td>
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
                      <button
                        type="button"
                        className="bouton-retirer-ligne-groupe"
                        title="Retirer de la liste"
                        onClick={() => retirerLigne(l.varianteId)}
                      >
                        ✕
                      </button>
                    </td>
                  </tr>
                ))}
                {Array.from({ length: Math.max(0, 10 - lignes.length) }).map((_, i) => (
                  <tr key={`vide-${i}`} className="ligne-groupe-vide">
                    <td className="colonne-numero-groupe">&nbsp;</td>
                    <td>&nbsp;</td>
                    <td className="col-designation-groupe">&nbsp;</td>
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

function OngletTransferts({ session }: { session: Session }) {
  const peutGerer = !!session.permissions.gerer_produits_stock_achats;
  const [depots, setDepots] = useState<DepotResume[]>([]);
  const [transferts, setTransferts] = useState<TransfertResume[]>([]);
  const [afficherForm, setAfficherForm] = useState(false);

  async function rafraichir() {
    const tous = await listerTransferts(session.boutiqueId);
    // Un caissier ne voit que les transferts qui concernent son dépôt (source
    // ou destination) — le Patron/Gérant garde la vue globale.
    setTransferts(
      peutGerer || !session.depotNom
        ? tous
        : tous.filter((t) => t.depotSourceNom === session.depotNom || t.depotDestinationNom === session.depotNom),
    );
  }
  useEffect(() => {
    listerDepotsDetail(session.boutiqueId).then(setDepots);
    rafraichir();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div>
      <div className="barre-actions barre-actions-avec-onglets">
        {peutGerer && !afficherForm && (
          <span className="actions-ligne">
            <button type="button" className="bouton-ajouter-variante" onClick={() => setAfficherForm(true)}>
              + Nouveau transfert
            </button>
          </span>
        )}
      </div>
      {afficherForm && (
        <div className="fond-modale" onClick={() => setAfficherForm(false)}>
          <div className="modale-selection-produits" onClick={(e) => e.stopPropagation()}>
            <FormulaireTransfert
              session={session}
              depots={depots}
              onAnnuler={() => setAfficherForm(false)}
              onCree={() => {
                setAfficherForm(false);
                rafraichir();
              }}
            />
          </div>
        </div>
      )}
      <div className="zone-tableau-scroll">
        <table className="tableau-catalogue">
          <thead>
            <tr>
              <th>Date</th>
              <th>Désignation</th>
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

/** Saisie libre jusqu'à confirmation explicite (Entrée ou ✓), comme les Mouvements. */
function LigneInventaireEditable({
  ligne,
  onEnregistrer,
}: {
  ligne: LigneInventaireDetail;
  onEnregistrer: (id: string, valeur: number) => Promise<void>;
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
      await onEnregistrer(ligne.id, nombreValeur);
    } catch (e) {
      setErreur(e instanceof ErreurStock ? e.message : "Erreur inattendue.");
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
    setInventaire((await obtenirInventaire(inventaireId)) ?? null);
  }
  useEffect(() => {
    rafraichir();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inventaireId]);

  async function enregistrerLigne(id: string, valeur: number) {
    await modifierLigneInventaire(id, valeur);
    await rafraichir();
  }

  async function valider() {
    setEnCours(true);
    setErreur(null);
    try {
      await validerInventaire(inventaireId, session.utilisateurId);
      await rafraichir();
    } catch (e) {
      setErreur(e instanceof ErreurStock ? e.message : "Erreur inattendue.");
    } finally {
      setEnCours(false);
    }
  }

  if (!inventaire) return <p>Chargement…</p>;
  const estValide = inventaire.statut === "valide";

  return (
    <>
      <div className="modale-entete">
        <div className="entete-detail-titre">
          <h3>Inventaire : {inventaire.depotNom}</h3>
          <span className="statut-inline">Statut : {estValide ? "Validé" : "En cours"}</span>
        </div>
        <div className="entete-detail-actions">
          {!estValide && peutGerer && (
            <button type="button" className="bouton-primaire" onClick={valider} disabled={enCours}>
              {enCours ? "Validation…" : "Valider l'inventaire"}
            </button>
          )}
          <button type="button" className="lien bouton-retour" onClick={onRetour}>
            ← Retour
          </button>
        </div>
      </div>
      <div className="modale-corps">
        {erreur && <div className="message-erreur">{erreur}</div>}
        <div className="zone-tableau-scroll">
          <table className="tableau-catalogue">
            <thead>
              <tr>
                <th>Désignation</th>
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
                    <td>{formaterMontant(l.valeurTheorique)}</td>
                    <td>{formaterMontant(l.valeurPhysique)}</td>
                    <td>{formaterMontant(l.valeurEcart)}</td>
                    <td>{formaterMontant(l.caPeriode)}</td>
                  </tr>
                ) : (
                  <tr key={l.id}>
                    <td>{l.produitNom}</td>
                    <td>{l.reference || ""}</td>
                    <td>{l.qteTheorique}</td>
                    <LigneInventaireEditable ligne={l} onEnregistrer={enregistrerLigne} />
                    <td>{formaterMontant(l.valeurTheorique)}</td>
                    <td>{formaterMontant(l.valeurPhysique)}</td>
                    <td>{formaterMontant(l.valeurEcart)}</td>
                    <td>{formaterMontant(l.caPeriode)}</td>
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
                  <td>{formaterMontant(inventaire.valeurTheorique)}</td>
                  <td>{formaterMontant(inventaire.valeurPhysique)}</td>
                  <td>{formaterMontant(inventaire.ecartValeur)}</td>
                  <td>{formaterMontant(inventaire.caPeriode)}</td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>
    </>
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
    const tous = await listerInventaires(session.boutiqueId);
    setInventaires(peutGerer || !session.depotNom ? tous : tous.filter((i) => i.depotNom === session.depotNom));
  }
  useEffect(() => {
    rafraichir();
    listerDepotsDetail(session.boutiqueId).then((liste) => {
      setDepots(liste);
      if (liste[0]) setDepotChoisi(liste[0].id);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function demarrer() {
    if (!depotChoisi) return;
    setEnCours(true);
    setErreur(null);
    try {
      const id = await demarrerInventaire(session.boutiqueId, depotChoisi, session.utilisateurId);
      await rafraichir();
      setInventaireSelectionneId(id);
      setVue("detail");
    } catch (e) {
      setErreur(e instanceof ErreurStock ? e.message : "Erreur inattendue.");
    } finally {
      setEnCours(false);
    }
  }

  return (
    <div>
      {vue === "detail" && inventaireSelectionneId && (
        <div className="fond-modale" onClick={() => setVue("liste")}>
          <div className="modale-selection-produits" onClick={(e) => e.stopPropagation()}>
            <DetailInventaire
              inventaireId={inventaireSelectionneId}
              session={session}
              onRetour={() => {
                setVue("liste");
                rafraichir();
              }}
            />
          </div>
        </div>
      )}
      {erreur && <div className="message-erreur">{erreur}</div>}
      <div className="barre-actions barre-actions-avec-onglets">
        {peutGerer && (
          <>
            <select value={depotChoisi} onChange={(e) => setDepotChoisi(e.target.value)}>
              {depots.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.nom}
                </option>
              ))}
            </select>
            <span className="actions-ligne">
              <button type="button" className="bouton-primaire" onClick={demarrer} disabled={enCours || !depotChoisi}>
                {enCours ? "Démarrage…" : "Démarrer un inventaire"}
              </button>
            </span>
          </>
        )}
      </div>
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
      setErreur("Aucun article à enregistrer.");
      return;
    }
    setEnCours(true);
    try {
      for (const ligne of lignesEditees) {
        try {
          await creerEntreeProduction({
            varianteId: ligne.varianteId,
            depotId: ligne.depotId,
            quantite: ligne.quantite,
            prixAchat: ligne.prixAchat,
            prixVente: ligne.prixVente,
            motif,
            utilisateurId: session.utilisateurId,
          });
        } catch (e) {
          setErreur(`${ligne.produitNom} : ${e instanceof ErreurStock ? e.message : "Erreur inattendue."}`);
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
          <button
            type="button"
            className="bouton-primaire"
            onClick={confirmer}
            disabled={enCours || lignesEditees.length === 0}
          >
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
              <th>Désignation</th>
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
                  <ChampMontant
                    value={String(l.prixAchat)}
                    onChange={(valeur) => modifierLigne(l.varianteId, { prixAchat: Number(valeur) || 0 })}
                  />
                </td>
                <td>
                  <ChampMontant
                    value={String(l.prixVente)}
                    onChange={(valeur) => modifierLigne(l.varianteId, { prixVente: Number(valeur) || 0 })}
                  />
                </td>
                <td>
                  <button
                    type="button"
                    className="bouton-retirer-ligne-groupe"
                    title="Retirer de la liste"
                    onClick={() => retirerLigne(l.varianteId)}
                  >
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
// Chaque section (Stock / Mouvements / Transferts / Inventaire) est un
// bouton-carte qui ouvre sa propre modale, même patron que Achats.tsx.

function ModaleStockNiveau({
  session,
  filtreRuptureInitial,
  onCommander,
  onFermer,
}: {
  session: Session;
  filtreRuptureInitial?: boolean;
  onCommander?: (lignes: LigneAchatInitiale[]) => void;
  onFermer: () => void;
}) {
  return (
    <div className="fond-modale" onClick={onFermer}>
      <div className="modale-selection-produits" onClick={(e) => e.stopPropagation()}>
        <EnteteModale titre="Stock" onFermer={onFermer} />
        <div className="modale-corps">
          <OngletStockNiveau session={session} filtreRuptureInitial={filtreRuptureInitial} onCommander={onCommander} />
        </div>
      </div>
    </div>
  );
}

function ModaleMouvements({ session, onFermer }: { session: Session; onFermer: () => void }) {
  return (
    <div className="fond-modale" onClick={onFermer}>
      <div className="modale-selection-produits" onClick={(e) => e.stopPropagation()}>
        <EnteteModale titre="Mouvements" onFermer={onFermer} />
        <div className="modale-corps">
          <OngletMouvements session={session} />
        </div>
      </div>
    </div>
  );
}

function ModaleTransferts({ session, onFermer }: { session: Session; onFermer: () => void }) {
  return (
    <div className="fond-modale" onClick={onFermer}>
      <div className="modale-selection-produits" onClick={(e) => e.stopPropagation()}>
        <EnteteModale titre="Transferts" onFermer={onFermer} />
        <div className="modale-corps">
          <OngletTransferts session={session} />
        </div>
      </div>
    </div>
  );
}

function ModaleInventaire({ session, onFermer }: { session: Session; onFermer: () => void }) {
  return (
    <div className="fond-modale" onClick={onFermer}>
      <div className="modale-selection-produits" onClick={(e) => e.stopPropagation()}>
        <EnteteModale titre="Inventaire" onFermer={onFermer} />
        <div className="modale-corps">
          <OngletInventaire session={session} />
        </div>
      </div>
    </div>
  );
}

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
  const [sectionOuverte, setSectionOuverte] = useState<Section | null>(filtreRuptureInitial ? "stock" : null);
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
      {sectionOuverte === "stock" && (
        <ModaleStockNiveau
          session={session}
          filtreRuptureInitial={filtreRuptureInitial}
          onCommander={onCommander}
          onFermer={() => setSectionOuverte(null)}
        />
      )}
      {sectionOuverte === "mouvements" && (
        <ModaleMouvements session={session} onFermer={() => setSectionOuverte(null)} />
      )}
      {sectionOuverte === "transferts" && (
        <ModaleTransferts session={session} onFermer={() => setSectionOuverte(null)} />
      )}
      {sectionOuverte === "inventaire" && (
        <ModaleInventaire session={session} onFermer={() => setSectionOuverte(null)} />
      )}
    </div>
  );
}
