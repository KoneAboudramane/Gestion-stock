import { useEffect, useState } from "react";
import type { CSSProperties } from "react";

import type { Session } from "../api";
import ChampMontant from "../components/ChampMontant";
import ModaleConfirmation from "../components/ModaleConfirmation";
import { useDevise } from "../contexts/DeviseContext";
import { formaterMontant } from "../lib/formatage";
import { rechercherVariantesAchat, type VarianteAchat } from "../services/achats";
import {
  creerMouvementManuel,
  ajouterLigneInventaire,
  annulerPerte,
  arreterDestockage,
  arreterOperationDestockage,
  creerEntreeProduction,
  declarerPerte,
  demarrerDestockage,
  demarrerOperationDestockage,
  demarrerInventaire,
  ErreurStock,
  listerDepotsDetail,
  listerDestockages,
  listerInventaires,
  listerMouvements,
  listerPertes,
  listerStock,
  listerTransferts,
  modifierDestockage,
  modifierLigneInventaire,
  obtenirInventaire,
  rechercherVariantesDestockage,
  transfererStock,
  trouverVarianteParCodeBarres,
  validerInventaire,
  type DepotResume,
  type DestockageResume,
  type InventaireDetail,
  type InventaireResume,
  type LigneAchatInitiale,
  type LigneInventaireDetail,
  type LigneStock,
  type MotifPerte,
  type MouvementResume,
  type PerteResume,
  type TransfertResume,
  type TypeMouvement,
  type VarianteDestockage,
} from "../services/stock";
import { useFabricationPropre } from "../hooks/useFabricationPropre";
import { libelleMotifPerte, libelleStatutDestockage, MOTIFS_PERTE } from "../lib/libelles";
import { ModaleProduitsDormants } from "./Rapports";
import {
  listerRelevesDormants,
  sortiesDormance,
  type ReleveDormants,
  type SortieDormance,
} from "../services/rapports";
import { useNomsUtilisateurs } from "../hooks/useNomsUtilisateurs";

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
  { cle: "pertes", label: "Pertes", icone: "🗑️" },
  { cle: "dormants", label: "Produits dormants", icone: "😴" },
  { cle: "destockage", label: "Déstockage", icone: "🏷️" },
  { cle: "historique", label: "Historique", icone: "🗂️" },
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
        <table className="tableau-catalogue carte-mobile">
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
                <td data-label="N°">{index + 1}</td>
                <td data-label="Désignation">{l.produitNom}</td>
                <td data-label="Référence">{l.reference || ""}</td>
                <td data-label="Dépôt">{l.depotNom}</td>
                <td data-label="Quantité">{l.quantite}</td>
                <td data-label="Seuil">{l.seuilAlerte}</td>
                <td data-label="Statut" className="colonne-statut-stock">{l.enRupture ? <span className="badge-rupture">Rupture</span> : null}</td>
                <td data-label="Actions" className="colonne-actions-stock">
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
            {Array.from({ length: Math.max(0, 10 - Math.max(1, lignesAffichees.length)) }).map((_, i) => (
              <tr key={`vide-${i}`} className="ligne-groupe-vide">
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
  // "Entrée" réservée aux boutiques qui fabriquent (hooks/useFabricationPropre.ts) :
  // les autres réapprovisionnent par les Achats, et gardent Sortie/Ajustement
  // pour corriger (casse, erreur de saisie…).
  const fabricationPropre = useFabricationPropre(session.boutiqueId);
  useEffect(() => {
    if (fabricationPropre === false && type === "entree") setType("ajustement");
  }, [fabricationPropre, type]);
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
          await creerMouvementManuel({
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
                {fabricationPropre && <option value="entree">Entrée</option>}
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
            <table className="tableau-catalogue carte-mobile">
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
                    <td data-label="N°" className="colonne-numero-groupe">{index + 1}</td>
                    <td data-label="Référence">{l.reference || ""}</td>
                    <td data-label="Désignation" className="col-designation-groupe">{l.produitNom}</td>
                    <td data-label="Quantité">
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
  const nomUtilisateur = useNomsUtilisateurs(session);
  const peutGerer = !!session.permissions.gerer_produits_stock_achats;
  const [depots, setDepots] = useState<DepotResume[]>([]);
  const [depotId, setDepotId] = useState(peutGerer ? "" : (session.depotId ?? ""));
  const [mouvements, setMouvements] = useState<MouvementResume[]>([]);
  const [vue, setVue] = useState<"liste" | "groupe">("liste");
  // Filtre de période (même composant que Stock → Historique) : par défaut les
  // 30 derniers jours, jusqu'à 5 000 lignes chargées au lieu des 100 dernières.
  const [periode, setPeriode] = useState<PeriodeHistorique>("30j");
  const [debutPerso, setDebutPerso] = useState(jourLocal(new Date()));
  const [finPerso, setFinPerso] = useState(jourLocal(new Date()));
  const [typeFiltre, setTypeFiltre] = useState<"" | TypeMouvement>("");

  useEffect(() => {
    if (peutGerer) listerDepotsDetail(session.boutiqueId).then(setDepots);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [peutGerer]);

  async function rafraichir() {
    setMouvements(await listerMouvements(session.boutiqueId, depotId || undefined, 5000));
  }
  useEffect(() => {
    rafraichir();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [depotId]);

  const bornes = bornesPeriode(periode, debutPerso, finPerso);
  const mouvementsFiltres = mouvements.filter(
    (m) => dansPeriode(m.dateCreation, bornes) && (!typeFiltre || m.type === typeFiltre),
  );

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
        <span className="groupe-filtres">
          <FiltrePeriodeHistorique
            periode={periode}
            setPeriode={setPeriode}
            debutPerso={debutPerso}
            setDebutPerso={setDebutPerso}
            finPerso={finPerso}
            setFinPerso={setFinPerso}
          />
          <select value={typeFiltre} onChange={(e) => setTypeFiltre(e.target.value as typeof typeFiltre)}>
            <option value="">Tous les types</option>
            <option value="entree">Entrées</option>
            <option value="sortie">Sorties</option>
            <option value="ajustement">Ajustements</option>
          </select>
        </span>
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
        <table className="tableau-catalogue carte-mobile">
          <thead>
            <tr>
              <th>Date</th>
              <th>Désignation</th>
              <th>Dépôt</th>
              <th>Type</th>
              <th>Quantité</th>
              <th>Motif</th>
              <th>Fait par</th>
            </tr>
          </thead>
          <tbody>
            {mouvementsFiltres.map((m) => (
              <tr key={m.id}>
                <td data-label="Date">{new Date(m.dateCreation).toLocaleString("fr-FR")}</td>
                <td data-label="Désignation">
                  {m.produitNom} {m.reference && `(${m.reference})`}
                </td>
                <td data-label="Dépôt">{m.depotNom}</td>
                <td data-label="Type">{libelleTypeMouvement(m.type)}</td>
                <td data-label="Quantité">{m.quantite}</td>
                <td data-label="Motif">{m.motif || ""}</td>
                <td data-label="Fait par">{nomUtilisateur(m.utilisateurId)}</td>
              </tr>
            ))}
            {mouvementsFiltres.length === 0 && (
              <tr>
                <td colSpan={7} className="liste-vide">
                  Aucun mouvement.
                </td>
              </tr>
            )}
            {Array.from({ length: Math.max(0, 10 - Math.max(1, mouvementsFiltres.length)) }).map((_, i) => (
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
            <table className="tableau-catalogue carte-mobile">
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
                    <td data-label="N°" className="colonne-numero-groupe">{index + 1}</td>
                    <td data-label="Référence">{l.reference || ""}</td>
                    <td data-label="Désignation" className="col-designation-groupe">{l.produitNom}</td>
                    <td data-label="Quantité">
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
  const nomUtilisateur = useNomsUtilisateurs(session);
  const peutGerer = !!session.permissions.gerer_produits_stock_achats;
  const [depots, setDepots] = useState<DepotResume[]>([]);
  const [transferts, setTransferts] = useState<TransfertResume[]>([]);
  const [afficherForm, setAfficherForm] = useState(false);
  // Filtre de période (même composant que Stock → Historique) : par défaut les
  // 30 derniers jours, jusqu'à 5 000 lignes chargées au lieu des 100 dernières.
  const [periode, setPeriode] = useState<PeriodeHistorique>("30j");
  const [debutPerso, setDebutPerso] = useState(jourLocal(new Date()));
  const [finPerso, setFinPerso] = useState(jourLocal(new Date()));

  async function rafraichir() {
    const tous = await listerTransferts(session.boutiqueId, 5000);
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

  const transfertsFiltres = transferts.filter((t) => dansPeriode(t.dateCreation, bornesPeriode(periode, debutPerso, finPerso)));

  return (
    <div className="onglet-transferts">
      <div className="barre-actions barre-actions-avec-onglets">
        <FiltrePeriodeHistorique
          periode={periode}
          setPeriode={setPeriode}
          debutPerso={debutPerso}
          setDebutPerso={setDebutPerso}
          finPerso={finPerso}
          setFinPerso={setFinPerso}
        />
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
        <table className="tableau-catalogue carte-mobile">
          <thead>
            <tr>
              <th>Date</th>
              <th>Désignation</th>
              <th>De</th>
              <th>Vers</th>
              <th>Quantité</th>
              <th>Fait par</th>
            </tr>
          </thead>
          <tbody>
            {transfertsFiltres.map((t) => (
              <tr key={t.id}>
                <td data-label="Date">{new Date(t.dateCreation).toLocaleString("fr-FR")}</td>
                <td data-label="Désignation">
                  {t.produitNom} {t.reference && `(${t.reference})`}
                </td>
                <td data-label="De">{t.depotSourceNom}</td>
                <td data-label="Vers">{t.depotDestinationNom}</td>
                <td data-label="Quantité">{t.quantite}</td>
                <td data-label="Fait par">{nomUtilisateur(t.utilisateurId)}</td>
              </tr>
            ))}
            {transfertsFiltres.length === 0 && (
              <tr>
                <td colSpan={6} className="liste-vide">
                  Aucun transfert.
                </td>
              </tr>
            )}
            {Array.from({ length: Math.max(0, 10 - Math.max(1, transfertsFiltres.length)) }).map((_, i) => (
              <tr key={`vide-${i}`} className="ligne-groupe-vide">
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
      <td data-label="Physique">
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
      <td data-label="Écart">{ecartAffiche}</td>
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
  // Douchette / saisie d'un code-barres (Entrée) : +1 sur l'article, ajouté
  // à l'inventaire s'il n'y est pas encore.
  const [codeSaisi, setCodeSaisi] = useState("");
  const [dernierScan, setDernierScan] = useState<string | null>(null);
  const [erreurSaisie, setErreurSaisie] = useState<string | null>(null);
  const [termeAjout, setTermeAjout] = useState("");
  const [resultatsAjout, setResultatsAjout] = useState<VarianteDestockage[]>([]);
  const [listeAjoutOuverte, setListeAjoutOuverte] = useState(false);

  useEffect(() => {
    if (!termeAjout.trim()) {
      setResultatsAjout([]);
      return;
    }
    const identifiant = setTimeout(() => {
      rechercherVariantesDestockage(session.boutiqueId, termeAjout.trim()).then(setResultatsAjout);
    }, 200);
    return () => clearTimeout(identifiant);
  }, [termeAjout, session.boutiqueId]);

  async function ajouterArticle(varianteId: string, quantite: number): Promise<boolean> {
    if (!inventaire) return false;
      try {
        await ajouterLigneInventaire(inventaire.id, varianteId, quantite);
      } catch (e) {
        setErreurSaisie(e instanceof ErreurStock ? e.message : "Erreur inattendue.");
        return false;
      }
      return true;
  }

  async function scanner(evenement: React.FormEvent) {
    evenement.preventDefault();
    const code = codeSaisi.trim();
    if (!code || !inventaire) return;
    setErreurSaisie(null);
    setCodeSaisi("");
    const ligne = inventaire.lignes.find((l) => l.codeBarres === code);
    if (ligne) {
      try {
        await enregistrerLigne(ligne.id, ligne.qtePhysique + 1);
        setDernierScan(`✓ ${ligne.produitNom} : ${ligne.qtePhysique + 1}`);
      } catch (e) {
        setErreurSaisie(e instanceof ErreurStock ? e.message : "Erreur inattendue.");
      }
      return;
    }
    const trouve = await trouverVarianteParCodeBarres(session.boutiqueId, code);
    if (!trouve) {
      setErreurSaisie(`Aucun article avec le code-barres « ${code} ».`);
      return;
    }
    if (await ajouterArticle(trouve.id, 1)) {
      setDernierScan(`✓ ${trouve.produitNom} ajouté : 1`);
      rafraichir();
    }
  }

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
      {!estValide && peutGerer && (
        <div className="barre-saisie-inventaire">
          <form onSubmit={scanner} className="champ-douchette">
            <input
              value={codeSaisi}
              onChange={(e) => setCodeSaisi(e.target.value)}
              placeholder="Scanner ou taper un code-barres, puis Entrée (+1)"
              autoFocus
            />
          </form>
          <div className="recherche-commande-combobox">
            <input
              placeholder="+ Ajouter un article absent de la liste…"
              value={termeAjout}
              onChange={(e) => setTermeAjout(e.target.value)}
              onFocus={() => setListeAjoutOuverte(true)}
              onBlur={() => setListeAjoutOuverte(false)}
            />
            {termeAjout.trim() && listeAjoutOuverte && (
              <ul className="resultats-recherche">
                {resultatsAjout
                  .filter((v) => !inventaire.lignes.some((l) => l.varianteId === v.id))
                  .map((v) => (
                    <li
                      key={v.id}
                      onMouseDown={async (e) => {
                        e.preventDefault();
                        setErreurSaisie(null);
                        if (await ajouterArticle(v.id, 0)) {
                          setTermeAjout("");
                          setDernierScan(`✓ ${v.produitNom} ajouté : saisissez la quantité comptée`);
                          rafraichir();
                        }
                      }}
                    >
                      <span>
                        {v.produitNom} {v.reference && `(${v.reference})`}
                      </span>
                    </li>
                  ))}
                {resultatsAjout.length === 0 && <li className="liste-vide">Aucun résultat.</li>}
              </ul>
            )}
          </div>
          {dernierScan && <span className="retour-douchette">{dernierScan}</span>}
          {erreurSaisie && <span className="message-erreur">{erreurSaisie}</span>}
        </div>
      )}
        <div className="zone-tableau-scroll">
          <table className="tableau-catalogue carte-mobile">
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
                    <td data-label="Désignation">{l.produitNom}</td>
                    <td data-label="Référence">{l.reference || ""}</td>
                    <td data-label="Théorique">{l.qteTheorique}</td>
                    <td data-label="Physique">{l.qtePhysique}</td>
                    <td data-label="Écart">{l.ecart}</td>
                    <td data-label={`Valeur théorique (${devise})`}>{formaterMontant(l.valeurTheorique)}</td>
                    <td data-label={`Valeur physique (${devise})`}>{formaterMontant(l.valeurPhysique)}</td>
                    <td data-label={`Écart (${devise})`}>{formaterMontant(l.valeurEcart)}</td>
                    <td data-label={`CA période (${devise})`}>{formaterMontant(l.caPeriode)}</td>
                  </tr>
                ) : (
                  <tr key={l.id}>
                    <td data-label="Désignation">{l.produitNom}</td>
                    <td data-label="Référence">{l.reference || ""}</td>
                    <td data-label="Théorique">{l.qteTheorique}</td>
                    <LigneInventaireEditable ligne={l} onEnregistrer={enregistrerLigne} />
                    <td data-label={`Valeur théorique (${devise})`}>{formaterMontant(l.valeurTheorique)}</td>
                    <td data-label={`Valeur physique (${devise})`}>{formaterMontant(l.valeurPhysique)}</td>
                    <td data-label={`Écart (${devise})`}>{formaterMontant(l.valeurEcart)}</td>
                    <td data-label={`CA période (${devise})`}>{formaterMontant(l.caPeriode)}</td>
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
              {Array.from({ length: Math.max(0, 10 - Math.max(1, inventaire.lignes.length)) }).map((_, i) => (
                <tr key={`vide-${i}`} className="ligne-groupe-vide">
                  <td>&nbsp;</td>
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
            {inventaire.lignes.length > 0 && (
              <tfoot>
                <tr className="ligne-total-inventaire">
                  <td colSpan={5}>Total</td>
                  <td data-label={`Valeur théorique (${devise})`}>{formaterMontant(inventaire.valeurTheorique)}</td>
                  <td data-label={`Valeur physique (${devise})`}>{formaterMontant(inventaire.valeurPhysique)}</td>
                  <td data-label={`Écart (${devise})`}>{formaterMontant(inventaire.ecartValeur)}</td>
                  <td data-label={`CA période (${devise})`}>{formaterMontant(inventaire.caPeriode)}</td>
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
  // « Comptage à zéro » : chaque article part de 0 ; ce qui n'est pas compté
  // sera considéré comme absent à la validation (stock très faux à reprendre).
  const [aZero, setAZero] = useState(false);

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
      const id = await demarrerInventaire(session.boutiqueId, depotChoisi, session.utilisateurId, aZero);
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
            <label className="case-a-cocher" title="Chaque article part de 0 : ce qui n'est pas compté sera considéré comme absent à la validation.">
              <input type="checkbox" checked={aZero} onChange={(e) => setAZero(e.target.checked)} />
              Comptage à zéro
            </label>
            <span className="actions-ligne">
              <button type="button" className="bouton-primaire" onClick={demarrer} disabled={enCours || !depotChoisi}>
                {enCours ? "Démarrage…" : "Démarrer un inventaire"}
              </button>
            </span>
          </>
        )}
      </div>
      <div className="zone-tableau-scroll">
        <table className="tableau-catalogue carte-mobile">
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
                <td data-label="Dépôt">{i.depotNom}</td>
                <td data-label="Statut">{i.statut === "valide" ? "Validé" : "En cours"}</td>
                <td data-label="Date">{new Date(i.dateCreation).toLocaleString("fr-FR")}</td>
              </tr>
            ))}
            {inventaires.length === 0 && (
              <tr>
                <td colSpan={3} className="liste-vide">
                  Aucun inventaire.
                </td>
              </tr>
            )}
            {Array.from({ length: Math.max(0, 10 - Math.max(1, inventaires.length)) }).map((_, i) => (
              <tr key={`vide-${i}`} className="ligne-groupe-vide">
                <td>&nbsp;</td>
                <td>&nbsp;</td>
                <td>&nbsp;</td>
              </tr>
            ))}
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
        <table className="tableau-catalogue carte-mobile">
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
                <td data-label="Désignation">{l.produitNom}</td>
                <td data-label="Dépôt">{l.depotNom}</td>
                <td data-label="Quantité">
                  <input
                    type="number"
                    min={0.01}
                    step="any"
                    value={l.quantite}
                    onChange={(e) => modifierLigne(l.varianteId, { quantite: Number(e.target.value) })}
                  />
                </td>
                <td data-label="Coût unitaire">
                  <ChampMontant
                    value={String(l.prixAchat)}
                    onChange={(valeur) => modifierLigne(l.varianteId, { prixAchat: Number(valeur) || 0 })}
                  />
                </td>
                <td data-label="Prix de vente">
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
            {Array.from({ length: Math.max(0, 10 - lignesEditees.length) }).map((_, i) => (
              <tr key={`vide-${i}`} className="ligne-groupe-vide">
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

// --- Onglet Pertes : sortie sans vente (périmé, casse, vol, don…) ---

function FormulairePerte({
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
  const [motif, setMotif] = useState<MotifPerte>("perime");
  const [detail, setDetail] = useState("");
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
  }, [terme, session.boutiqueId]);

  function ajouterLigne(variante: VarianteAchat) {
    setLignes((actuel) => {
      if (actuel.some((l) => l.varianteId === variante.id)) return actuel;
      return [
        ...actuel,
        { varianteId: variante.id, produitNom: variante.produitNom, reference: variante.reference, quantite: 1 },
      ];
    });
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
    if (motif === "autre" && !detail.trim()) {
      setErreur("Précisez la raison de la perte.");
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
          await declarerPerte({
            varianteId: ligne.varianteId,
            depotId,
            quantite: ligne.quantite,
            motif,
            detail,
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
        <h3>Déclarer une perte</h3>
        <div className="actions-formulaire">
          <button type="submit" disabled={enCours}>
            {enCours ? "Enregistrement…" : `Déclarer (${lignes.length})`}
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
              Motif
              <select value={motif} onChange={(e) => setMotif(e.target.value as MotifPerte)}>
                {MOTIFS_PERTE.map((m) => (
                  <option key={m.valeur} value={m.valeur}>
                    {m.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              {motif === "autre" ? "Précision (obligatoire)" : "Précision (facultatif)"}
              <input
                value={detail}
                onChange={(e) => setDetail(e.target.value)}
                placeholder="ex. Lot du 12/09, carton tombé…"
              />
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
                  <th>Quantité perdue</th>
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

function OngletPertes({ session }: { session: Session }) {
  const nomUtilisateur = useNomsUtilisateurs(session);
  // Déclarer une perte : réservé à ceux qui gèrent le stock (sinon un vendeur
  // pourrait "perdre" de la marchandise pour couvrir un vol).
  const peutGerer = !!session.permissions.gerer_produits_stock_achats;
  const devise = useDevise();
  const [depots, setDepots] = useState<DepotResume[]>([]);
  const [pertes, setPertes] = useState<PerteResume[]>([]);
  const [afficherForm, setAfficherForm] = useState(false);
  const [perteAAnnuler, setPerteAAnnuler] = useState<PerteResume | null>(null);
  const [erreurPerte, setErreurPerte] = useState<string | null>(null);
  const [enCoursPerte, setEnCoursPerte] = useState(false);

  async function rafraichir() {
    const toutes = await listerPertes(session.boutiqueId);
    // Même règle que les transferts : sans droit de gestion, on ne voit que son dépôt.
    setPertes(peutGerer || !session.depotNom ? toutes : toutes.filter((p) => p.depotNom === session.depotNom));
  }
  useEffect(() => {
    listerDepotsDetail(session.boutiqueId).then(setDepots);
    rafraichir();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.boutiqueId]);

  // Une perte annulée reste affichée (traçabilité) mais ne compte plus.
  const valeurTotale = pertes.filter((p) => !p.annulee).reduce((somme, p) => somme + p.valeur, 0);

  async function confirmerAnnulation() {
    if (!perteAAnnuler) return;
    setEnCoursPerte(true);
    setErreurPerte(null);
    try {
      await annulerPerte(perteAAnnuler.id, session.utilisateurId);
    } catch (e) {
      setErreurPerte(e instanceof ErreurStock ? e.message : "Erreur inattendue.");
      return;
    } finally {
      setEnCoursPerte(false);
    }
    setPerteAAnnuler(null);
    rafraichir();
  }

  return (
    <div>
      <div className="barre-actions barre-actions-avec-onglets">
        {peutGerer && (
          <span className="actions-ligne">
            <button type="button" className="bouton-ajouter-variante" onClick={() => setAfficherForm(true)}>
              + Déclarer une perte
            </button>
          </span>
        )}
      </div>
      {erreurPerte && <div className="message-erreur">{erreurPerte}</div>}
      {perteAAnnuler && (
        <ModaleConfirmation
          titre="Annuler cette perte ?"
          description={`${perteAAnnuler.quantite} × ${perteAAnnuler.produitNom} reviendront dans le stock du dépôt ${perteAAnnuler.depotNom}. La perte restera visible, marquée « Annulée ».`}
          labelConfirmer="Annuler la perte"
          dangereux
          enCours={enCoursPerte}
          onAnnuler={() => setPerteAAnnuler(null)}
          onConfirmer={confirmerAnnulation}
        />
      )}
      {afficherForm && (
        <div className="fond-modale" onClick={() => setAfficherForm(false)}>
          <div className="modale-selection-produits" onClick={(e) => e.stopPropagation()}>
            <FormulairePerte
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
        <table className="tableau-catalogue carte-mobile">
          <thead>
            <tr>
              <th>Date</th>
              <th>Désignation</th>
              <th>Dépôt</th>
              <th>Motif</th>
              <th>Quantité</th>
              <th>Valeur perdue</th>
              <th>Déclaré par</th>
              {peutGerer && <th />}
            </tr>
          </thead>
          <tbody>
            {pertes.map((p) => (
              <tr key={p.id} className={p.annulee ? "ligne-annulee" : undefined}>
                <td data-label="Date">{new Date(p.dateCreation).toLocaleString("fr-FR")}</td>
                <td data-label="Désignation">
                  {p.produitNom} {p.reference && `(${p.reference})`}
                </td>
                <td data-label="Dépôt">{p.depotNom}</td>
                <td data-label="Motif">
                  {libelleMotifPerte(p.motif)}{" "}
                  {p.annulee && <span className="badge-brouillon">Annulée</span>}
                  {p.detail && <span className="sous-info"> — {p.detail}</span>}
                </td>
                <td data-label="Quantité">{p.quantite}</td>
                <td data-label="Valeur perdue">
                  {formaterMontant(p.valeur)} {devise}
                </td>
                <td data-label="Déclaré par">{nomUtilisateur(p.utilisateurId)}</td>
                {peutGerer && (
                  <td data-label="">
                    {!p.annulee && (
                      <button type="button" className="lien" onClick={() => setPerteAAnnuler(p)}>
                        Annuler
                      </button>
                    )}
                  </td>
                )}
              </tr>
            ))}
            {pertes.length === 0 && (
              <tr>
                <td colSpan={8} className="liste-vide">
                  Aucune perte déclarée.
                </td>
              </tr>
            )}
            {Array.from({ length: Math.max(0, 10 - Math.max(1, pertes.length)) }).map((_, i) => (
              <tr key={`vide-${i}`} className="ligne-groupe-vide">
                <td>&nbsp;</td>
                <td>&nbsp;</td>
                <td>&nbsp;</td>
                <td>&nbsp;</td>
                <td>&nbsp;</td>
                <td>&nbsp;</td>
                <td>&nbsp;</td>
                {peutGerer && <td>&nbsp;</td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {pertes.length > 0 && (
        <div className="totaux">
          <div className="total-net">
            Valeur totale perdue : {formaterMontant(valeurTotale)} {devise}
          </div>
        </div>
      )}
    </div>
  );
}

function ModalePertes({ session, onFermer }: { session: Session; onFermer: () => void }) {
  return (
    <div className="fond-modale" onClick={onFermer}>
      <div className="modale-selection-produits" onClick={(e) => e.stopPropagation()}>
        <EnteteModale titre="Pertes" onFermer={onFermer} />
        <div className="modale-corps">
          <OngletPertes session={session} />
        </div>
      </div>
    </div>
  );
}

// --- Onglet Déstockage : vendre à prix réduit un article qui dort ---

/** Article proposé au déstockage : stock total tous dépôts confondus. */
export interface ArticleDestockage {
  id: string;
  produitNom: string;
  reference: string;
  prixVente: number;
  prixAchat: number;
  quantiteStock: number;
}

const REDUCTIONS_RAPIDES = [10, 20, 30, 50] as const;

const DUREES_RAPIDES = [
  { label: "Sans date de fin", jours: 0 },
  { label: "1 semaine", jours: 7 },
  { label: "2 semaines", jours: 14 },
  { label: "1 mois", jours: 30 },
] as const;

function dansNJours(jours: number): string {
  const d = new Date();
  d.setDate(d.getDate() + jours);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function FormulaireDestockage({
  session,
  articleInitial,
  onAnnuler,
  onCree,
}: {
  session: Session;
  /** Article déjà choisi (ex. depuis Rapports → Produits dormants). */
  articleInitial?: ArticleDestockage;
  onAnnuler: () => void;
  onCree: () => void;
}) {
  const devise = useDevise();
  const [articles, setArticles] = useState<ArticleDestockage[]>([]);
  const [dejaEnDestockage, setDejaEnDestockage] = useState<Set<string>>(new Set());
  const [chargement, setChargement] = useState(true);
  const [terme, setTerme] = useState("");
  // Articles choisis, dans l'ordre de sélection, chacun avec son prix de déstockage.
  const [selection, setSelection] = useState<{ article: ArticleDestockage; prixSaisi: string }[]>(
    articleInitial ? [{ article: articleInitial, prixSaisi: "" }] : [],
  );
  const [nomOperation, setNomOperation] = useState("");
  const [reductionCommune, setReductionCommune] = useState<number | null>(null);
  const [dateFin, setDateFin] = useState("");
  const [erreur, setErreur] = useState<string | null>(null);
  const [enCours, setEnCours] = useState(false);

  // Seuls les articles qui ont du stock (tous dépôts confondus) peuvent être déstockés.
  useEffect(() => {
    Promise.all([listerStock(session.boutiqueId), listerDestockages(session.boutiqueId)]).then(
      ([lignesStock, destockages]) => {
        const parVariante = new Map<string, ArticleDestockage>();
        for (const l of lignesStock) {
          const existant = parVariante.get(l.varianteId);
          if (existant) existant.quantiteStock += l.quantite;
          else
            parVariante.set(l.varianteId, {
              id: l.varianteId,
              produitNom: l.produitNom,
              reference: l.reference ?? "",
              prixVente: l.prixVente,
              prixAchat: l.prixAchat,
              quantiteStock: l.quantite,
            });
        }
        setArticles(
          [...parVariante.values()].filter((a) => a.quantiteStock > 0).sort((a, b) => a.produitNom.localeCompare(b.produitNom)),
        );
        setDejaEnDestockage(new Set(destockages.filter((d) => d.statut === "en_cours").map((d) => d.varianteId)));
        setChargement(false);
      },
    );
  }, [session.boutiqueId]);

  const termeNormalise = terme.trim().toLowerCase();
  const articlesFiltres = termeNormalise
    ? articles.filter((a) => `${a.produitNom} ${a.reference}`.toLowerCase().includes(termeNormalise))
    : articles;
  const idsChoisis = new Set(selection.map((l) => l.article.id));

  const prixAppliquant = (article: ArticleDestockage, reduction: number | null) =>
    reduction === null ? "" : String(Math.round(article.prixVente * (1 - reduction / 100)));

  function basculerArticle(article: ArticleDestockage) {
    setErreur(null);
    setSelection((actuelle) =>
      actuelle.some((l) => l.article.id === article.id)
        ? actuelle.filter((l) => l.article.id !== article.id)
        : [...actuelle, { article, prixSaisi: prixAppliquant(article, reductionCommune) }],
    );
  }

  function appliquerReduction(reduction: number) {
    setReductionCommune(reduction);
    setSelection((actuelle) => actuelle.map((l) => ({ ...l, prixSaisi: prixAppliquant(l.article, reduction) })));
  }

  function modifierPrix(id: string, prixSaisi: string) {
    setReductionCommune(null);
    setSelection((actuelle) => actuelle.map((l) => (l.article.id === id ? { ...l, prixSaisi } : l)));
  }

  const lignes = selection.map((l) => {
    const prix = Number(l.prixSaisi) || 0;
    return {
      ...l,
      prix,
      valide: prix > 0 && prix < l.article.prixVente,
      reduction: prix > 0 ? Math.round((1 - prix / l.article.prixVente) * 100) : null,
      marge: prix - l.article.prixAchat,
    };
  });
  // Plusieurs articles, ou un nom saisi : on crée une opération de déstockage nommée.
  const utiliserOperation = selection.length > 1 || nomOperation.trim() !== "";
  const nomManquant = selection.length > 1 && !nomOperation.trim();
  const toutValide = lignes.length > 0 && lignes.every((l) => l.valide) && !nomManquant;
  const argentRecupere = lignes.reduce((somme, l) => somme + (l.valide ? l.article.quantiteStock * l.prix : 0), 0);
  const nombreAPerte = lignes.filter((l) => l.valide && l.marge < 0).length;

  async function soumettre(evenement: React.FormEvent) {
    evenement.preventDefault();
    setErreur(null);
    if (selection.length === 0) {
      setErreur("Choisissez au moins un article dans la liste.");
      return;
    }
    if (nomManquant) {
      setErreur("Donnez un nom à cette opération de déstockage.");
      return;
    }
    if (!toutValide) {
      setErreur("Chaque prix de déstockage doit être positif et inférieur au prix normal de l'article.");
      return;
    }
    setEnCours(true);
    try {
      try {
        if (utiliserOperation) {
          await demarrerOperationDestockage({
            boutiqueId: session.boutiqueId,
            nom: nomOperation.trim(),
            lignes: selection.map((l) => ({ varianteId: l.article.id, prixDestockage: Number(l.prixSaisi) })),
            dateFin: dateFin || null,
            utilisateurId: session.utilisateurId,
          });
        } else {
          await demarrerDestockage({
            varianteId: selection[0].article.id,
            prixDestockage: Number(selection[0].prixSaisi),
            dateFin: dateFin || null,
            utilisateurId: session.utilisateurId,
          });
        }
      } catch (e) {
        setErreur(e instanceof ErreurStock ? e.message : "Erreur inattendue.");
        return;
      }
      onCree();
    } finally {
      setEnCours(false);
    }
  }

  return (
    <form onSubmit={soumettre} className="formulaire-destockage">
      <div className="modale-entete entete-fixe">
        <h3>Mettre en déstockage</h3>
        <div className="actions-formulaire">
          <button type="submit" className="bouton-primaire" disabled={enCours || !toutValide}>
            {enCours ? "Enregistrement…" : `Mettre en déstockage (${selection.length})`}
          </button>
          <button type="button" className="lien bouton-retour" onClick={onAnnuler}>
            ← Retour
          </button>
        </div>
      </div>
      {erreur && <div className="message-erreur">{erreur}</div>}
      <div className="colonnes-destockage">
        <section className="colonne-articles-destockage">
          <h4>1. Choisissez un ou plusieurs articles</h4>
          <input
            placeholder="Rechercher par nom ou référence…"
            value={terme}
            onChange={(e) => setTerme(e.target.value)}
          />
          <ul className="liste-articles-destockage">
            {articlesFiltres.map((a) => {
              const deja = dejaEnDestockage.has(a.id);
              const choisi = idsChoisis.has(a.id);
              return (
                <li key={a.id}>
                  <button
                    type="button"
                    className={choisi ? "actif" : undefined}
                    disabled={deja}
                    onClick={() => basculerArticle(a)}
                  >
                    <input type="checkbox" checked={choisi} readOnly tabIndex={-1} disabled={deja} />
                    <span className="texte-article-destockage">
                      <span className="nom-article-destockage">
                        {a.produitNom} {a.reference && <span className="sous-info">({a.reference})</span>}
                      </span>
                      <span className="details-article-destockage">
                        Stock : {a.quantiteStock} · {formaterMontant(a.prixVente)} {devise}
                        {deja && <span className="badge-destockage">Déjà en déstockage</span>}
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
            {!chargement && articlesFiltres.length === 0 && (
              <li className="liste-vide">
                {articles.length === 0 ? "Aucun article en stock." : "Aucun article en stock ne correspond."}
              </li>
            )}
          </ul>
        </section>

        <section className="colonne-reglage-destockage">
          {selection.length === 0 ? (
            <div className="etat-vide-destockage">
              <span className="icone-etat-vide-destockage">🏷️</span>
              <p>Cochez dans la liste le ou les articles à vendre moins cher.</p>
              <p className="note-aide">
                Le prix réduit s'appliquera automatiquement en caisse, jusqu'à la date de fin, jusqu'à ce que le stock
                soit épuisé, ou jusqu'à ce que vous l'arrêtiez.
              </p>
            </div>
          ) : (
            <>
              <label className="champ-nom-operation">
                {selection.length > 1 ? "Nom de l'opération" : "Nom de l'opération (facultatif)"}
                <input
                  value={nomOperation}
                  onChange={(e) => setNomOperation(e.target.value)}
                  placeholder="ex. Liquidation fin d'année, Fin de saison…"
                />
              </label>

              <h4>2. Nouveaux prix</h4>
              <div className="raccourcis-destockage">
                <span className="note-aide">Réduction pour {selection.length > 1 ? "tous" : "l'article"} :</span>
                {REDUCTIONS_RAPIDES.map((r) => (
                  <button
                    key={r}
                    type="button"
                    className={reductionCommune === r ? "actif" : undefined}
                    onClick={() => appliquerReduction(r)}
                  >
                    −{r} %
                  </button>
                ))}
              </div>
              <div className="zone-tableau-destockage">
                <table className="tableau-catalogue">
                  <thead>
                    <tr>
                      <th>Article</th>
                      <th>Prix normal</th>
                      <th>Prix de déstockage</th>
                      <th>Marge / article</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {lignes.map((l) => (
                      <tr key={l.article.id}>
                        <td data-label="Article">
                          {l.article.produitNom}{" "}
                          {l.article.reference && <span className="sous-info">({l.article.reference})</span>}
                          <div className="sous-info">Stock : {l.article.quantiteStock}</div>
                        </td>
                        <td data-label="Prix normal">
                          {formaterMontant(l.article.prixVente)}
                          <div className="sous-info">coût {formaterMontant(l.article.prixAchat)}</div>
                        </td>
                        <td data-label="Prix de déstockage">
                          <div className="cellule-prix-destockage">
                            <ChampMontant
                              className={l.prix > 0 && !l.valide ? "champ-invalide" : undefined}
                              value={l.prixSaisi}
                              onChange={(valeur) => modifierPrix(l.article.id, valeur)}
                            />
                            {l.valide && <span className="badge-destockage">−{l.reduction} %</span>}
                          </div>
                        </td>
                        <td data-label="Marge / article">
                          {l.valide && (
                            <span className={l.marge < 0 ? "montant-negatif" : "montant-positif"}>
                              {l.marge < 0 ? "−" : "+"}
                              {formaterMontant(Math.abs(l.marge))}
                            </span>
                          )}
                        </td>
                        <td data-label="">
                          <button
                            type="button"
                            className="bouton-retirer-ligne-groupe"
                            title="Retirer de la sélection"
                            onClick={() => basculerArticle(l.article)}
                          >
                            ✕
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <h4>3. Jusqu'à quand ?</h4>
              <div className="raccourcis-destockage">
                {DUREES_RAPIDES.map((d) => {
                  const valeur = d.jours === 0 ? "" : dansNJours(d.jours);
                  return (
                    <button
                      key={d.label}
                      type="button"
                      className={dateFin === valeur ? "actif" : undefined}
                      onClick={() => setDateFin(valeur)}
                    >
                      {d.label}
                    </button>
                  );
                })}
                <input type="date" value={dateFin} min={dansNJours(0)} onChange={(e) => setDateFin(e.target.value)} />
              </div>

              <div className="resume-destockage">
                <div>
                  <span>{utiliserOperation ? "Opération" : "Déstockage"}</span>
                  <strong>
                    {utiliserOperation ? nomOperation.trim() || "(nom à saisir)" : selection[0].article.produitNom} ·{" "}
                    {selection.length} article{selection.length > 1 ? "s" : ""}
                  </strong>
                </div>
                <div>
                  <span>Si tout le stock est vendu</span>
                  <strong>
                    {lignes.some((l) => l.valide)
                      ? `${formaterMontant(Math.round(argentRecupere))} ${devise} récupérés`
                      : "—"}
                  </strong>
                </div>
                {nombreAPerte > 0 && (
                  <p className="alerte-perte-destockage">
                    ⚠ {nombreAPerte} article{nombreAPerte > 1 ? "s" : ""} vendu{nombreAPerte > 1 ? "s" : ""} à perte : c'est
                    permis en déstockage, pour récupérer au moins une partie de l'argent.
                  </p>
                )}
                <div>
                  <span>Fin</span>
                  <strong>
                    {dateFin
                      ? `Le ${new Date(`${dateFin}T00:00:00`).toLocaleDateString("fr-FR")} ou au stock épuisé`
                      : "Au stock épuisé ou à l'arrêt manuel"}
                  </strong>
                </div>
              </div>
            </>
          )}
        </section>
      </div>
    </form>
  );
}

function ModaleModifierDestockage({
  destockage,
  onAnnuler,
  onModifie,
}: {
  destockage: DestockageResume;
  onAnnuler: () => void;
  onModifie: () => void;
}) {
  const devise = useDevise();
  const [prixSaisi, setPrixSaisi] = useState(String(destockage.prixDestockage));
  const [dateFin, setDateFin] = useState(destockage.dateFin ?? "");
  const [erreur, setErreur] = useState<string | null>(null);
  const [enCours, setEnCours] = useState(false);
  const prix = Number(prixSaisi) || 0;
  const valide = prix > 0 && prix < destockage.prixNormal;
  const reduction = valide ? Math.round((1 - prix / destockage.prixNormal) * 100) : null;
  const marge = prix - destockage.prixAchat;

  async function enregistrer(evenement: React.FormEvent) {
    evenement.preventDefault();
    setErreur(null);
    if (!valide) {
      setErreur("Le prix de déstockage doit être positif et inférieur au prix normal.");
      return;
    }
    setEnCours(true);
    try {
      await modifierDestockage(destockage.id, { prixDestockage: prix, dateFin: dateFin || null });
    } catch (e) {
      setErreur(e instanceof ErreurStock ? e.message : "Erreur inattendue.");
      return;
    } finally {
      setEnCours(false);
    }
    onModifie();
  }

  return (
    <div className="fond-modale" onClick={onAnnuler}>
      <div className="modale-selection-produits" onClick={(e) => e.stopPropagation()}>
        <form onSubmit={enregistrer} className="formulaire-destockage">
          <div className="modale-entete entete-fixe">
            <h3>Modifier le déstockage</h3>
            <div className="actions-formulaire">
              <button type="submit" className="bouton-primaire" disabled={enCours || !valide}>
                {enCours ? "Enregistrement…" : "Enregistrer"}
              </button>
              <button type="button" className="lien bouton-retour" onClick={onAnnuler}>
                ← Retour
              </button>
            </div>
          </div>
          {erreur && <div className="message-erreur">{erreur}</div>}
          <div className="colonne-reglage-destockage">
            <div className="carte-article-destockage">
              <h4>
                {destockage.produitNom} {destockage.reference && <span className="sous-info">({destockage.reference})</span>}
              </h4>
              <div className="chiffres-article-destockage">
                <div>
                  <span className="note-aide">Stock restant</span>
                  <strong>{destockage.stockRestant}</strong>
                </div>
                <div>
                  <span className="note-aide">Prix normal</span>
                  <strong>
                    {formaterMontant(destockage.prixNormal)} {devise}
                  </strong>
                </div>
                <div>
                  <span className="note-aide">Déjà vendus</span>
                  <strong>{destockage.quantiteVendue}</strong>
                </div>
              </div>
            </div>
            <h4>Nouveau prix</h4>
            <div className="ligne-prix-destockage">
              <ChampMontant value={prixSaisi} onChange={setPrixSaisi} />
              <span>{devise}</span>
            </div>
            <div className="raccourcis-destockage">
              {REDUCTIONS_RAPIDES.map((r) => (
                <button
                  key={r}
                  type="button"
                  className={reduction === r ? "actif" : undefined}
                  onClick={() => setPrixSaisi(String(Math.round(destockage.prixNormal * (1 - r / 100))))}
                >
                  −{r} %
                </button>
              ))}
            </div>
            <h4>Jusqu'à quand ?</h4>
            <div className="raccourcis-destockage">
              {DUREES_RAPIDES.map((d) => {
                const valeur = d.jours === 0 ? "" : dansNJours(d.jours);
                return (
                  <button
                    key={d.label}
                    type="button"
                    className={dateFin === valeur ? "actif" : undefined}
                    onClick={() => setDateFin(valeur)}
                  >
                    {d.label}
                  </button>
                );
              })}
              <input type="date" value={dateFin} min={dansNJours(0)} onChange={(e) => setDateFin(e.target.value)} />
            </div>
            {valide && (
              <div className="resume-destockage">
                <div>
                  <span>Prix en caisse</span>
                  <strong>
                    <s className="prix-barre">{formaterMontant(destockage.prixNormal)}</s>
                    {formaterMontant(prix)} {devise} <span className="badge-destockage">−{reduction} %</span>
                  </strong>
                </div>
                <div>
                  <span>{marge < 0 ? "Perte par article" : "Marge par article"}</span>
                  <strong className={marge < 0 ? "montant-negatif" : "montant-positif"}>
                    {marge < 0 ? "−" : "+"}
                    {formaterMontant(Math.abs(marge))} {devise}
                  </strong>
                </div>
                <p className="note-aide">
                  Les {destockage.quantiteVendue} article(s) déjà vendu(s) gardent leur prix et restent dans le bilan.
                </p>
              </div>
            )}
          </div>
        </form>
      </div>
    </div>
  );
}

function OngletDestockage({ session }: { session: Session }) {
  const nomUtilisateur = useNomsUtilisateurs(session);
  const peutGerer = !!session.permissions.gerer_produits_stock_achats;
  const devise = useDevise();
  const [destockages, setDestockages] = useState<DestockageResume[]>([]);
  const [afficherForm, setAfficherForm] = useState(false);
  const [destockageAArreter, setDestockageAArreter] = useState<DestockageResume | null>(null);
  const [destockageAModifier, setDestockageAModifier] = useState<DestockageResume | null>(null);
  const [operationAArreter, setOperationAArreter] = useState<{ id: string; nom: string } | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [enCours, setEnCours] = useState(false);

  async function rafraichir() {
    setDestockages(await listerDestockages(session.boutiqueId));
  }
  useEffect(() => {
    rafraichir();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.boutiqueId]);

  async function confirmerArret() {
    if (!destockageAArreter) return;
    setEnCours(true);
    setErreur(null);
    try {
      await arreterDestockage(destockageAArreter.id);
    } catch (e) {
      setErreur(e instanceof ErreurStock ? e.message : "Erreur inattendue.");
      return;
    } finally {
      setEnCours(false);
    }
    setDestockageAArreter(null);
    rafraichir();
  }

  async function confirmerArretOperation() {
    if (!operationAArreter) return;
    setEnCours(true);
    setErreur(null);
    try {
      await arreterOperationDestockage(operationAArreter.id);
    } catch (e) {
      setErreur(e instanceof ErreurStock ? e.message : "Erreur inattendue.");
      return;
    } finally {
      setEnCours(false);
    }
    setOperationAArreter(null);
    rafraichir();
  }

  // Opérations (groupes nommés) ayant encore au moins un article en déstockage.
  const operationsEnCours = [
    ...destockages
      .filter((d) => d.operationId && d.statut === "en_cours")
      .reduce((parId, d) => {
        const op = parId.get(d.operationId!) ?? { id: d.operationId!, nom: d.operationNom ?? "", articles: 0 };
        op.articles += 1;
        return parId.set(d.operationId!, op);
      }, new Map<string, { id: string; nom: string; articles: number }>())
      .values(),
  ];

  return (
    <div>
      <div className="barre-actions barre-actions-avec-onglets">
        {peutGerer && (
          <span className="actions-ligne">
            <button type="button" className="bouton-ajouter-variante" onClick={() => setAfficherForm(true)}>
              + Mettre en déstockage
            </button>
          </span>
        )}
      </div>
      {erreur && <div className="message-erreur">{erreur}</div>}
      {afficherForm && (
        <div className="fond-modale" onClick={() => setAfficherForm(false)}>
          <div className="modale-selection-produits" onClick={(e) => e.stopPropagation()}>
            <FormulaireDestockage
              session={session}
              onAnnuler={() => setAfficherForm(false)}
              onCree={() => {
                setAfficherForm(false);
                rafraichir();
              }}
            />
          </div>
        </div>
      )}
      {operationAArreter && (
        <ModaleConfirmation
          titre="Arrêter toute l'opération ?"
          description={`Tous les articles de « ${operationAArreter.nom} » encore en déstockage reviendront à leur prix normal en caisse.`}
          labelConfirmer="Arrêter l'opération"
          dangereux
          enCours={enCours}
          onAnnuler={() => setOperationAArreter(null)}
          onConfirmer={confirmerArretOperation}
        />
      )}
      {operationsEnCours.length > 0 && (
        <div className="operations-destockage-en-cours">
          {operationsEnCours.map((op) => (
            <div key={op.id} className="operation-destockage">
              <span>
                🏷️ <strong>{op.nom}</strong>{" "}
                <span className="sous-info">
                  · {op.articles} article{op.articles > 1 ? "s" : ""} en déstockage
                </span>
              </span>
              {peutGerer && (
                <button type="button" className="bouton-danger" onClick={() => setOperationAArreter(op)}>
                  Arrêter l'opération
                </button>
              )}
            </div>
          ))}
        </div>
      )}
      {destockageAModifier && (
        <ModaleModifierDestockage
          destockage={destockageAModifier}
          onAnnuler={() => setDestockageAModifier(null)}
          onModifie={() => {
            setDestockageAModifier(null);
            rafraichir();
          }}
        />
      )}
      {destockageAArreter && (
        <ModaleConfirmation
          titre="Arrêter ce déstockage ?"
          description={`${destockageAArreter.produitNom} reviendra à son prix normal en caisse.`}
          labelConfirmer="Arrêter le déstockage"
          dangereux
          enCours={enCours}
          onAnnuler={() => setDestockageAArreter(null)}
          onConfirmer={confirmerArret}
        />
      )}
      <div className="zone-tableau-scroll">
        <table className="tableau-catalogue carte-mobile">
          <thead>
            <tr>
              <th>Article</th>
              <th>Opération</th>
              <th>Prix</th>
              <th>Début</th>
              <th>Fin</th>
              <th>Statut</th>
              <th>Vendus</th>
              <th>Stock restant</th>
              <th>Lancé par</th>
              {peutGerer && <th />}
            </tr>
          </thead>
          <tbody>
            {destockages.map((d) => (
              <tr key={d.id}>
                <td data-label="Article">
                  {d.produitNom} {d.reference && <span className="sous-info">({d.reference})</span>}
                </td>
                <td data-label="Opération">{d.operationNom ?? "—"}</td>
                <td data-label="Prix">
                  <s className="prix-barre">{formaterMontant(d.prixNormal)}</s> {formaterMontant(d.prixDestockage)} {devise}
                </td>
                <td data-label="Début">{new Date(d.dateCreation).toLocaleDateString("fr-FR")}</td>
                <td data-label="Fin">
                  {d.dateArret
                    ? new Date(d.dateArret).toLocaleDateString("fr-FR")
                    : d.dateFin
                      ? `Prévue le ${new Date(`${d.dateFin}T00:00:00`).toLocaleDateString("fr-FR")}`
                      : "—"}
                </td>
                <td data-label="Statut">
                  <span className={d.statut === "en_cours" ? "badge-destockage" : "badge-brouillon"}>
                    {libelleStatutDestockage(d.statut, d.motifFin)}
                  </span>
                </td>
                <td data-label="Vendus">{d.quantiteVendue}</td>
                <td data-label="Stock restant">{d.stockRestant}</td>
                <td data-label="Lancé par">{nomUtilisateur(d.utilisateurId)}</td>
                {peutGerer && (
                  <td data-label="">
                    {d.statut === "en_cours" && (
                      <span className="actions-ligne">
                        <button type="button" onClick={() => setDestockageAModifier(d)}>
                          Modifier
                        </button>
                        <button type="button" className="bouton-danger" onClick={() => setDestockageAArreter(d)}>
                          Arrêter
                        </button>
                      </span>
                    )}
                  </td>
                )}
              </tr>
            ))}
            {destockages.length === 0 && (
              <tr>
                <td colSpan={10} className="liste-vide">
                  Aucun déstockage.
                </td>
              </tr>
            )}
            {Array.from({ length: Math.max(0, 10 - Math.max(1, destockages.length)) }).map((_, i) => (
              <tr key={`vide-${i}`} className="ligne-groupe-vide">
                <td>&nbsp;</td>
                <td>&nbsp;</td>
                <td>&nbsp;</td>
                <td>&nbsp;</td>
                <td>&nbsp;</td>
                <td>&nbsp;</td>
                <td>&nbsp;</td>
                <td>&nbsp;</td>
                <td>&nbsp;</td>
                {peutGerer && <td>&nbsp;</td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ModaleDestockage({ session, onFermer }: { session: Session; onFermer: () => void }) {
  return (
    <div className="fond-modale" onClick={onFermer}>
      <div className="modale-selection-produits" onClick={(e) => e.stopPropagation()}>
        <EnteteModale titre="Déstockage" onFermer={onFermer} />
        <div className="modale-corps">
          <OngletDestockage session={session} />
        </div>
      </div>
    </div>
  );
}

// --- Historique : pertes et déstockages, filtrables (carte « Historique » de la page Stock) ---

type PeriodeHistorique = "tout" | "7j" | "30j" | "mois" | "personnalisee";

function jourLocal(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

/** Bornes [début, fin] en "AAAA-MM-JJ" (incluses), ou null pour « tout ». */
function bornesPeriode(periode: PeriodeHistorique, debutPerso: string, finPerso: string): [string, string] | null {
  const aujourdhui = new Date();
  if (periode === "tout") return null;
  if (periode === "personnalisee") return [debutPerso || "0000-01-01", finPerso || "9999-12-31"];
  if (periode === "mois") {
    return [jourLocal(new Date(aujourdhui.getFullYear(), aujourdhui.getMonth(), 1)), jourLocal(aujourdhui)];
  }
  const debut = new Date(aujourdhui);
  debut.setDate(debut.getDate() - (periode === "7j" ? 6 : 29));
  return [jourLocal(debut), jourLocal(aujourdhui)];
}

function dansPeriode(dateIso: string, bornes: [string, string] | null): boolean {
  if (!bornes) return true;
  const jour = jourLocal(new Date(dateIso));
  return jour >= bornes[0] && jour <= bornes[1];
}

function FiltrePeriodeHistorique({
  periode,
  setPeriode,
  debutPerso,
  setDebutPerso,
  finPerso,
  setFinPerso,
}: {
  periode: PeriodeHistorique;
  setPeriode: (p: PeriodeHistorique) => void;
  debutPerso: string;
  setDebutPerso: (v: string) => void;
  finPerso: string;
  setFinPerso: (v: string) => void;
}) {
  return (
    <>
      <select value={periode} onChange={(e) => setPeriode(e.target.value as PeriodeHistorique)}>
        <option value="tout">Toutes les dates</option>
        <option value="7j">7 derniers jours</option>
        <option value="30j">30 derniers jours</option>
        <option value="mois">Ce mois</option>
        <option value="personnalisee">Période personnalisée</option>
      </select>
      {periode === "personnalisee" && (
        <>
          <input type="date" value={debutPerso} onChange={(e) => setDebutPerso(e.target.value)} />
          <input type="date" value={finPerso} onChange={(e) => setFinPerso(e.target.value)} />
        </>
      )}
    </>
  );
}

const DUREES_GRAPHIQUE_DORMANTS = [
  { valeur: "30", label: "30 jours" },
  { valeur: "90", label: "3 mois" },
  { valeur: "365", label: "1 an" },
  { valeur: "tout", label: "Depuis le début" },
] as const;

/**
 * Évolution des produits dormants, en deux petits graphiques alignés sur les
 * mêmes dates (argent qui dort, nombre d'articles) — deux échelles différentes,
 * donc deux graphiques plutôt qu'un seul à double axe. Un point par jour jusqu'à
 * 3 mois affichés, puis un point par mois (dernier relevé du mois). Les relevés
 * reçus sont déjà filtrés par la période choisie en haut de l'Historique.
 */
function GraphiqueArgentQuiDort({ releves, devise }: { releves: ReleveDormants[]; devise: string }) {
  const [duree, setDuree] = useState<(typeof DUREES_GRAPHIQUE_DORMANTS)[number]["valeur"]>("tout");
  const [survol, setSurvol] = useState<number | null>(null);

  const limite = duree === "tout" ? null : jourLocal(new Date(Date.now() - (Number(duree) - 1) * 86_400_000));
  const retenus = limite ? releves.filter((r) => r.date >= limite) : releves;
  const etendueJours =
    retenus.length > 1
      ? (new Date(`${retenus[retenus.length - 1].date}T00:00:00`).getTime() - new Date(`${retenus[0].date}T00:00:00`).getTime()) /
        86_400_000
      : 0;
  const parMois = etendueJours > 92;
  const points = parMois
    ? [...retenus.reduce((m, r) => m.set(r.date.slice(0, 7), r), new Map<string, ReleveDormants>()).values()]
    : retenus;
  const libelle = (r: ReleveDormants) =>
    parMois
      ? new Date(`${r.date}T00:00:00`).toLocaleDateString("fr-FR", { month: "long", year: "numeric" })
      : new Date(`${r.date}T00:00:00`).toLocaleDateString("fr-FR");

  const selecteur = (
    <div className="raccourcis-destockage">
      {DUREES_GRAPHIQUE_DORMANTS.map((d) => (
        <button
          key={d.valeur}
          type="button"
          className={duree === d.valeur ? "actif" : undefined}
          onClick={() => {
            setDuree(d.valeur);
            setSurvol(null);
          }}
        >
          {d.label}
        </button>
      ))}
    </div>
  );

  if (points.length < 2) {
    return (
      <>
        {selecteur}
        <p className="etat-vide-graphique-dormants">
          {releves.length === 0
            ? "Aucun relevé sur cette période : un relevé est pris chaque jour à l'ouverture de l'appli."
            : points.length === 1
              ? `Un seul relevé sur cette durée (${libelle(points[0])}) : ${formaterMontant(points[0].valeurImmobilisee)} ${devise}, ${points[0].nombreArticles} article(s). La courbe apparaîtra au fil des jours.`
              : "Aucun relevé sur cette durée."}
        </p>
      </>
    );
  }

  const indexActif = survol ?? points.length - 1;
  const actif = points[indexActif];
  const series = [
    {
      titre: "Argent qui dort",
      valeur: (r: ReleveDormants) => r.valeurImmobilisee,
      format: (v: number) => `${formaterMontant(v)} ${devise}`,
    },
    {
      titre: "Articles dormants",
      valeur: (r: ReleveDormants) => r.nombreArticles,
      format: (v: number) => `${v} article${v > 1 ? "s" : ""}`,
    },
  ];

  return (
    <div className="bloc-graphique-dormants">
      {selecteur}
      <div className="entete-graphique-dormants sous-info">
        <span>{libelle(actif)}</span>
        <strong>
          {formaterMontant(actif.valeurImmobilisee)} {devise}
        </strong>
        <span>
          · {actif.nombreArticles} article{actif.nombreArticles > 1 ? "s" : ""} dormant{actif.nombreArticles > 1 ? "s" : ""}
        </span>
      </div>
      {series.map((serie) => {
        const maximum = Math.max(1, ...points.map(serie.valeur));
        return (
          <div key={serie.titre} className="serie-graphique-dormants">
            <span className="titre-serie-graphique-dormants sous-info">
              {serie.titre} <span>(max. {serie.format(maximum)})</span>
            </span>
            <div className="graphique-dormants" onMouseLeave={() => setSurvol(null)}>
              {points.map((r, i) => (
                <div
                  key={r.date}
                  className={`colonne-graphique-dormants${i === indexActif ? " active" : ""}`}
                  onMouseEnter={() => setSurvol(i)}
                  title={`${libelle(r)} : ${serie.format(serie.valeur(r))}`}
                >
                  <span style={{ height: `${Math.max(2, (serie.valeur(r) / maximum) * 100)}%` }} />
                </div>
              ))}
            </div>
          </div>
        );
      })}
      <div className="axe-graphique-dormants sous-info">
        <span>{libelle(points[0])}</span>
        <span>{parMois ? "un point par mois" : "un point par jour"}</span>
        <span>{libelle(points[points.length - 1])}</span>
      </div>
      <details className="details-releves-dormants">
        <summary>Voir les relevés en chiffres</summary>
        <table className="tableau-catalogue">
          <thead>
            <tr>
              <th>{parMois ? "Mois" : "Jour"}</th>
              <th>Articles dormants</th>
              <th>Argent qui dort</th>
            </tr>
          </thead>
          <tbody>
            {[...points].reverse().map((r) => (
              <tr key={r.date}>
                <td>{libelle(r)}</td>
                <td>{r.nombreArticles}</td>
                <td>
                  {formaterMontant(r.valeurImmobilisee)} {devise}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </div>
  );
}

const LIBELLES_SORTIE_DORMANCE: Record<string, { label: string; classe: string }> = {
  revendu: { label: "Revendu", classe: "badge-recue" },
  perte: { label: "Perte", classe: "badge-rupture" },
  destockage: { label: "Déstockage", classe: "badge-destockage" },
};

function ModaleHistoriqueStock({ session, onFermer }: { session: Session; onFermer: () => void }) {
  const nomUtilisateur = useNomsUtilisateurs(session);
  const devise = useDevise();
  const peutGerer = !!session.permissions.gerer_produits_stock_achats;
  // Comme la carte Produits dormants : montre des coûts, réservé à la gestion / aux rapports.
  const peutVoirDormants = peutGerer || !!session.permissions.voir_rapports_complets;
  const [section, setSection] = useState<"pertes" | "destockages" | "dormants">("pertes");
  const [releves, setReleves] = useState<ReleveDormants[]>([]);
  const [sorties, setSorties] = useState<SortieDormance[]>([]);
  const [seuilDormance, setSeuilDormance] = useState(60);
  const [actionDormance, setActionDormance] = useState("");
  const [pertes, setPertes] = useState<PerteResume[]>([]);
  const [destockages, setDestockages] = useState<DestockageResume[]>([]);
  const [depots, setDepots] = useState<DepotResume[]>([]);

  const [periode, setPeriode] = useState<PeriodeHistorique>("tout");
  const [debutPerso, setDebutPerso] = useState(jourLocal(new Date()));
  const [finPerso, setFinPerso] = useState(jourLocal(new Date()));
  const [motif, setMotif] = useState("");
  const [depot, setDepot] = useState("");
  const [statut, setStatut] = useState<"" | "en_cours" | "termine">("");
  const [operation, setOperation] = useState("");

  useEffect(() => {
    Promise.all([
      listerPertes(session.boutiqueId),
      listerDestockages(session.boutiqueId),
      listerDepotsDetail(session.boutiqueId),
    ]).then(([toutesPertes, tousDestockages, listeDepots]) => {
      // Sans droit de gestion, on ne voit que les pertes de son dépôt (même règle que la carte Pertes).
      setPertes(
        peutGerer || !session.depotNom ? toutesPertes : toutesPertes.filter((p) => p.depotNom === session.depotNom),
      );
      setDestockages(tousDestockages);
      setDepots(listeDepots);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.boutiqueId]);

  useEffect(() => {
    listerRelevesDormants(session.boutiqueId).then(setReleves);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.boutiqueId]);
  useEffect(() => {
    sortiesDormance(session.boutiqueId, seuilDormance).then(setSorties);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.boutiqueId, seuilDormance]);

  const bornes = bornesPeriode(periode, debutPerso, finPerso);
  const releveActuel = releves.length > 0 ? releves[releves.length - 1] : null;
  const evolutionDormance =
    releves.length > 1 ? releves[releves.length - 1].valeurImmobilisee - releves[0].valeurImmobilisee : null;
  const sortiesFiltrees = sorties.filter(
    (s) => dansPeriode(s.date, bornes) && (!actionDormance || s.action === actionDormance),
  );
  const pertesFiltrees = pertes.filter(
    (p) =>
      dansPeriode(p.dateCreation, bornes) && (!motif || p.motif === motif) && (!depot || p.depotNom === depot),
  );
  const destockagesFiltres = destockages.filter(
    (d) =>
      dansPeriode(d.dateCreation, bornes) &&
      (!statut || d.statut === statut) &&
      (!operation || (operation === "__seul" ? !d.operationId : d.operationId === operation)),
  );
  const operations = [
    ...new Map(destockages.filter((d) => d.operationId).map((d) => [d.operationId!, d.operationNom ?? ""])),
  ];

  const filtrePeriode = (
    <FiltrePeriodeHistorique
      periode={periode}
      setPeriode={setPeriode}
      debutPerso={debutPerso}
      setDebutPerso={setDebutPerso}
      finPerso={finPerso}
      setFinPerso={setFinPerso}
    />
  );

  return (
    <div className="fond-modale" onClick={onFermer}>
      <div className="modale-selection-produits" onClick={(e) => e.stopPropagation()}>
        <EnteteModale titre="Historique" onFermer={onFermer} />
        <div className="modale-avec-menu">
          <nav className="menu-modale">
            <button
              type="button"
              className={section === "pertes" ? "actif" : ""}
              onClick={() => setSection("pertes")}
            >
              <span className="icone-menu-modale">🗑️</span>
              Pertes
              <span className="compteur-menu-modale">{pertesFiltrees.length}</span>
            </button>
            <button
              type="button"
              className={section === "destockages" ? "actif" : ""}
              onClick={() => setSection("destockages")}
            >
              <span className="icone-menu-modale">🏷️</span>
              Déstockages
              <span className="compteur-menu-modale">{destockagesFiltres.length}</span>
            </button>
            {peutVoirDormants && (
              <button
                type="button"
                className={section === "dormants" ? "actif" : ""}
                onClick={() => setSection("dormants")}
              >
                <span className="icone-menu-modale">😴</span>
                Dormants
                <span className="compteur-menu-modale">{sortiesFiltrees.length}</span>
              </button>
            )}
          </nav>
          <div className="modale-corps">
            {section === "pertes" ? (
              <>
                <div className="barre-actions barre-filtres-historique">
                  {filtrePeriode}
                  <select value={motif} onChange={(e) => setMotif(e.target.value)}>
                    <option value="">Tous les motifs</option>
                    {MOTIFS_PERTE.map((m) => (
                      <option key={m.valeur} value={m.valeur}>
                        {m.label}
                      </option>
                    ))}
                  </select>
                  {depots.length > 1 && (
                    <select value={depot} onChange={(e) => setDepot(e.target.value)}>
                      <option value="">Tous les dépôts</option>
                      {depots.map((d) => (
                        <option key={d.id} value={d.nom}>
                          {d.nom}
                        </option>
                      ))}
                    </select>
                  )}
                </div>
                <div className="zone-tableau-scroll">
                  <table className="tableau-catalogue carte-mobile">
                    <thead>
                      <tr>
                        <th>Date</th>
                        <th>Désignation</th>
                        <th>Dépôt</th>
                        <th>Motif</th>
                        <th>Quantité</th>
                        <th>Valeur perdue</th>
                        <th>Déclaré par</th>
                      </tr>
                    </thead>
                    <tbody>
                      {pertesFiltrees.map((p) => (
                        <tr key={p.id} className={p.annulee ? "ligne-annulee" : undefined}>
                          <td data-label="Date">{new Date(p.dateCreation).toLocaleString("fr-FR")}</td>
                          <td data-label="Désignation">
                            {p.produitNom} {p.reference && <span className="sous-info">({p.reference})</span>}
                          </td>
                          <td data-label="Dépôt">{p.depotNom}</td>
                          <td data-label="Motif">
                            {libelleMotifPerte(p.motif)}{" "}
                            {p.annulee && <span className="badge-brouillon">Annulée</span>}
                            {p.detail && <span className="sous-info"> — {p.detail}</span>}
                          </td>
                          <td data-label="Quantité">{p.quantite}</td>
                          <td data-label="Valeur perdue">
                            {formaterMontant(p.valeur)} {devise}
                          </td>
                          <td data-label="Déclaré par">{nomUtilisateur(p.utilisateurId)}</td>
                        </tr>
                      ))}
                      {pertesFiltrees.length === 0 && (
                        <tr>
                          <td colSpan={7} className="liste-vide">
                            Aucune perte pour ces filtres.
                          </td>
                        </tr>
                      )}
                      {Array.from({ length: Math.max(0, 10 - Math.max(1, pertesFiltrees.length)) }).map((_, i) => (
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
                {pertesFiltrees.length > 0 && (
                  <div className="totaux">
                    <div>
                      {pertesFiltrees.length} perte{pertesFiltrees.length > 1 ? "s" : ""} ·{" "}
                      {pertesFiltrees.filter((p) => !p.annulee).reduce((somme, p) => somme + p.quantite, 0)} article(s)
                    </div>
                    <div className="total-net">
                      Valeur perdue :{" "}
                      {formaterMontant(pertesFiltrees.filter((p) => !p.annulee).reduce((somme, p) => somme + p.valeur, 0))}{" "}
                      {devise}
                    </div>
                  </div>
                )}
              </>
            ) : section === "dormants" ? (
              <div className="section-dormants">
                <div className="barre-actions barre-filtres-historique">
                  {filtrePeriode}
                  <label className="case-a-cocher">
                    Sans vente depuis
                    <select value={seuilDormance} onChange={(e) => setSeuilDormance(Number(e.target.value))}>
                      {[30, 60, 90, 180].map((j) => (
                        <option key={j} value={j}>
                          {j} jours
                        </option>
                      ))}
                    </select>
                  </label>
                  <select value={actionDormance} onChange={(e) => setActionDormance(e.target.value)}>
                    <option value="">Toutes les actions</option>
                    <option value="revendu">Revendus</option>
                    <option value="perte">Pertes</option>
                    <option value="destockage">Déstockages</option>
                  </select>
                </div>
                <div className="tuiles-dormance">
                  <div className="tuile-dormance tuile-dormance--dort">
                    <span className="tuile-dormance-libelle">😴 Argent qui dort</span>
                    <strong>
                      {releveActuel ? `${formaterMontant(releveActuel.valeurImmobilisee)} ${devise}` : "—"}
                    </strong>
                    <span className="sous-info">
                      {releveActuel
                        ? `${releveActuel.nombreArticles} article${releveActuel.nombreArticles > 1 ? "s" : ""} sans vente depuis 60 jours`
                        : "Pas encore de relevé"}
                    </span>
                    {evolutionDormance !== null && evolutionDormance !== 0 && (
                      <span className={evolutionDormance < 0 ? "evolution-dormance baisse" : "evolution-dormance hausse"}>
                        {evolutionDormance < 0 ? "▼" : "▲"} {formaterMontant(Math.abs(evolutionDormance))} {devise} depuis le{" "}
                        {new Date(`${releves[0].date}T00:00:00`).toLocaleDateString("fr-FR")}
                      </span>
                    )}
                  </div>
                  {(
                    [
                      ["revendu", "💵 Revendus", "encaissés"],
                      ["destockage", "🏷️ Mis en déstockage", "récupérés"],
                      ["perte", "🗑️ Déclarés en perte", "perdus"],
                    ] as const
                  ).map(([action, libelle, suffixe]) => {
                    const lignes = sortiesFiltrees.filter((s) => s.action === action);
                    return (
                      <button
                        key={action}
                        type="button"
                        className={`tuile-dormance${actionDormance === action ? " active" : ""}`}
                        onClick={() => setActionDormance(actionDormance === action ? "" : action)}
                        title="Filtrer le tableau sur cette action"
                      >
                        <span className="tuile-dormance-libelle">{libelle}</span>
                        <strong>{lignes.length}</strong>
                        <span className="sous-info">
                          {formaterMontant(lignes.reduce((somme, s) => somme + s.montant, 0))} {devise} {suffixe}
                        </span>
                      </button>
                    );
                  })}
                </div>

                <section className="carte-historique-dormants">
                  <h4>
                    Évolution des produits dormants{" "}
                    <span className="sous-info">(sans vente depuis 60 jours, relevé chaque jour)</span>
                  </h4>
                  <GraphiqueArgentQuiDort
                    releves={releves.filter((r) => dansPeriode(`${r.date}T12:00:00`, bornes))}
                    devise={devise}
                  />
                </section>

                <section className="carte-historique-dormants carte-historique-dormants--tableau">
                  <h4>
                    Ce qu'on en a fait{" "}
                    <span className="sous-info">(articles restés {seuilDormance} jours ou plus sans vente)</span>
                  </h4>
                <div className="zone-tableau-scroll">
                  <table className="tableau-catalogue carte-mobile">
                    <thead>
                      <tr>
                        <th>Date</th>
                        <th>Article</th>
                        <th>Sans vente depuis</th>
                        <th>Action</th>
                        <th>Détail</th>
                        <th>Quantité</th>
                        <th>Montant</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sortiesFiltrees.map((s) => (
                        <tr key={s.id}>
                          <td data-label="Date">{new Date(s.date).toLocaleDateString("fr-FR")}</td>
                          <td data-label="Article">
                            {s.produitNom} {s.reference && <span className="sous-info">({s.reference})</span>}
                          </td>
                          <td data-label="Sans vente depuis">{s.joursSansVente} jours</td>
                          <td data-label="Action">
                            <span className={LIBELLES_SORTIE_DORMANCE[s.action].classe}>
                              {LIBELLES_SORTIE_DORMANCE[s.action].label}
                            </span>
                          </td>
                          <td data-label="Détail">
                            {s.action === "perte"
                              ? `${libelleMotifPerte(s.motif)}${s.detail ? ` — ${s.detail}` : ""}`
                              : s.action === "destockage"
                                ? `${s.detail} · ${libelleStatutDestockage(s.motif === "en_cours" ? "en_cours" : "termine", s.motif)}`
                                : s.detail}
                          </td>
                          <td data-label="Quantité">{s.quantite}</td>
                          <td data-label="Montant">
                            {formaterMontant(s.montant)} {devise}
                          </td>
                        </tr>
                      ))}
                      {sortiesFiltrees.length === 0 && (
                        <tr>
                          <td colSpan={7} className="liste-vide">
                            Aucun article resté {seuilDormance} jours sans vente n'a encore été revendu, perdu ou déstocké.
                          </td>
                        </tr>
                      )}
                      {Array.from({ length: Math.max(0, 10 - Math.max(1, sortiesFiltrees.length)) }).map((_, i) => (
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
                </section>
              </div>
            ) : (
              <>
                <div className="barre-actions barre-filtres-historique">
                  {filtrePeriode}
                  <select value={statut} onChange={(e) => setStatut(e.target.value as typeof statut)}>
                    <option value="">Tous les statuts</option>
                    <option value="en_cours">En cours</option>
                    <option value="termine">Terminés</option>
                  </select>
                  {operations.length > 0 && (
                    <select value={operation} onChange={(e) => setOperation(e.target.value)}>
                      <option value="">Toutes les opérations</option>
                      {operations.map(([id, nom]) => (
                        <option key={id} value={id}>
                          {nom}
                        </option>
                      ))}
                      <option value="__seul">Articles déstockés seuls</option>
                    </select>
                  )}
                </div>
                <div className="zone-tableau-scroll">
                  <table className="tableau-catalogue carte-mobile">
                    <thead>
                      <tr>
                        <th>Début</th>
                        <th>Article</th>
                        <th>Opération</th>
                        <th>Prix</th>
                        <th>Fin</th>
                        <th>Statut</th>
                        <th>Vendus</th>
                        <th>Argent récupéré</th>
                        <th>Lancé par</th>
                      </tr>
                    </thead>
                    <tbody>
                      {destockagesFiltres.map((d) => (
                        <tr key={d.id}>
                          <td data-label="Début">{new Date(d.dateCreation).toLocaleDateString("fr-FR")}</td>
                          <td data-label="Article">
                            {d.produitNom} {d.reference && <span className="sous-info">({d.reference})</span>}
                          </td>
                          <td data-label="Opération">{d.operationNom ?? "—"}</td>
                          <td data-label="Prix">
                            <s className="prix-barre">{formaterMontant(d.prixNormal)}</s>
                            {formaterMontant(d.prixDestockage)}
                          </td>
                          <td data-label="Fin">
                            {d.dateArret
                              ? new Date(d.dateArret).toLocaleDateString("fr-FR")
                              : d.dateFin
                                ? `Prévue le ${new Date(`${d.dateFin}T00:00:00`).toLocaleDateString("fr-FR")}`
                                : "—"}
                          </td>
                          <td data-label="Statut">
                            <span className={d.statut === "en_cours" ? "badge-destockage" : "badge-brouillon"}>
                              {libelleStatutDestockage(d.statut, d.motifFin)}
                            </span>
                          </td>
                          <td data-label="Vendus">{d.quantiteVendue}</td>
                          <td data-label="Argent récupéré">
                            {formaterMontant(d.chiffreAffaires)} {devise}
                          </td>
                          <td data-label="Lancé par">{nomUtilisateur(d.utilisateurId)}</td>
                        </tr>
                      ))}
                      {destockagesFiltres.length === 0 && (
                        <tr>
                          <td colSpan={9} className="liste-vide">
                            Aucun déstockage pour ces filtres.
                          </td>
                        </tr>
                      )}
                      {Array.from({ length: Math.max(0, 10 - Math.max(1, destockagesFiltres.length)) }).map((_, i) => (
                        <tr key={`vide-${i}`} className="ligne-groupe-vide">
                          <td>&nbsp;</td>
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
                {destockagesFiltres.length > 0 && (
                  <div className="totaux">
                    <div>
                      {destockagesFiltres.length} déstockage{destockagesFiltres.length > 1 ? "s" : ""} ·{" "}
                      {destockagesFiltres.reduce((somme, d) => somme + d.quantiteVendue, 0)} article(s) vendu(s)
                    </div>
                    <div className="total-net">
                      Argent récupéré :{" "}
                      {formaterMontant(destockagesFiltres.reduce((somme, d) => somme + d.chiffreAffaires, 0))} {devise}
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
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
        {SECTIONS.filter(
          // Produits dormants : montre des coûts d'achat, réservé à la gestion du stock / aux rapports.
          (s) =>
            s.cle !== "dormants" ||
            !!session.permissions.gerer_produits_stock_achats ||
            !!session.permissions.voir_rapports_complets,
        ).map((s) => (
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
      {sectionOuverte === "dormants" && (
        <ModaleProduitsDormants session={session} onFermer={() => setSectionOuverte(null)} />
      )}
      {sectionOuverte === "historique" && (
        <ModaleHistoriqueStock session={session} onFermer={() => setSectionOuverte(null)} />
      )}
      {sectionOuverte === "destockage" && (
        <ModaleDestockage session={session} onFermer={() => setSectionOuverte(null)} />
      )}
      {sectionOuverte === "pertes" && (
        <ModalePertes session={session} onFermer={() => setSectionOuverte(null)} />
      )}
      {sectionOuverte === "inventaire" && (
        <ModaleInventaire session={session} onFermer={() => setSectionOuverte(null)} />
      )}
    </div>
  );
}
