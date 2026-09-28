import { useEffect, useState } from "react";
import type { CSSProperties } from "react";

import type { Session } from "../api";
import ChampMontant from "../components/ChampMontant";
import { useDevise } from "../contexts/DeviseContext";
import BoutonsExport from "../components/BoutonsExport";
import FiltrePeriodeHistorique from "../components/FiltrePeriodeHistorique";
import { useNomsUtilisateurs } from "../hooks/useNomsUtilisateurs";
import { bornesPeriode, dansPeriode, jourLocal, type PeriodeHistorique } from "../lib/periode";
import type { ColonneExport } from "../lib/export";
import { formaterMontant } from "../lib/formatage";
import { CATEGORIES_DEPENSE, libelleCategorieDepense } from "../lib/libelles";
import { listerDepotsDetail, type DepotResume } from "../services/stock";
import {
  enregistrerDepense,
  ErreurTresorerie,
  listerDepenses,
  soldeCaisse,
  type CategorieDepense,
  type DepenseResume,
} from "../services/tresorerie";

/**
 * Port de client-electron/src/pages/Depense.tsx : dépenses de caisse
 * (transport, réparation, achat divers...), local d'abord (IndexedDB) —
 * accessible à tout utilisateur sur son propre dépôt, contrairement au
 * Retrait/Apport/Ajustement (page Trésorerie), réservés Patron/Gérant.
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
  { cle: "depenses", label: "Dépenses", icone: "💸" },
  { cle: "historique", label: "Historique", icone: "🕘" },
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

function ModaleHistoriqueDepenses({
  depenses,
  devise,
  nomUtilisateur,
  onFermer,
}: {
  depenses: DepenseResume[];
  devise: string;
  nomUtilisateur: (id: string | null) => string;
  onFermer: () => void;
}) {
  const [periode, setPeriode] = useState<PeriodeHistorique>("30j");
  const [debutPerso, setDebutPerso] = useState(jourLocal(new Date()));
  const [finPerso, setFinPerso] = useState(jourLocal(new Date()));
  const [type, setType] = useState("");
  const [terme, setTerme] = useState("");
  const [vue, setVue] = useState<"liste" | "types">("liste");
  const types = [...new Set(depenses.map((d) => libelleCategorieDepense(d.categorie)))].sort((a, b) => a.localeCompare(b, "fr"));
  const cle = terme.trim().toLowerCase();
  const filtrees = depenses.filter(
    (d) =>
      dansPeriode(d.dateCreation, bornesPeriode(periode, debutPerso, finPerso)) &&
      (!type || libelleCategorieDepense(d.categorie) === type) &&
      (!cle || (d.description ?? "").toLowerCase().includes(cle)),
  );
  const total = filtrees.reduce((t, d) => t + d.montant, 0);
  // Répartition par type sur les dépenses filtrées, la plus coûteuse d'abord.
  const parType = [
    ...filtrees
      .reduce((m, d) => {
        const libelle = libelleCategorieDepense(d.categorie);
        const actuel = m.get(libelle) ?? { libelle, total: 0, nombre: 0 };
        actuel.total += d.montant;
        actuel.nombre += 1;
        return m.set(libelle, actuel);
      }, new Map<string, { libelle: string; total: number; nombre: number }>())
      .values(),
  ].sort((a, b) => b.total - a.total);
  const colonnesExport: ColonneExport[] = [
    { cle: "date", libelle: "Date" },
    { cle: "type", libelle: "Type" },
    { cle: "description", libelle: "Description" },
    { cle: "montant", libelle: `Montant (${devise})` },
    { cle: "par", libelle: "Effectué par" },
  ];
  const lignesExport = filtrees.map((d) => ({
    date: new Date(d.dateCreation).toLocaleString("fr-FR"),
    type: libelleCategorieDepense(d.categorie),
    description: d.description ?? "",
    montant: d.montant,
    par: nomUtilisateur(d.utilisateurId),
  }));

  return (
    <div className="fond-modale" onClick={onFermer}>
      <div className="modale-selection-produits" onClick={(e) => e.stopPropagation()}>
        <EnteteModale titre="Historique des dépenses" onFermer={onFermer} />
        <div className="modale-corps">
          <div className="tuiles-fiche">
            <div className={`tuile-fiche${total > 0 ? " tuile-fiche--alerte" : ""}`}>
              <span className="sous-info">💸 Total dépensé</span>
              <strong className="nowrap">
                {formaterMontant(total)} {devise}
              </strong>
            </div>
            <div className="tuile-fiche">
              <span className="sous-info">🧾 Dépenses</span>
              <strong>{filtrees.length}</strong>
            </div>
            <div className="tuile-fiche">
              <span className="sous-info">📊 Dépense moyenne</span>
              <strong className="nowrap">
                {formaterMontant(filtrees.length > 0 ? Math.round(total / filtrees.length) : 0)} {devise}
              </strong>
            </div>
            <div className="tuile-fiche">
              <span className="sous-info">🏷️ Type le plus coûteux</span>
              <strong>{parType[0] ? `${parType[0].libelle} (${formaterMontant(parType[0].total)})` : "—"}</strong>
            </div>
          </div>
          <div className="barre-actions barre-filtres-historique">
            <FiltrePeriodeHistorique
              periode={periode}
              setPeriode={setPeriode}
              debutPerso={debutPerso}
              setDebutPerso={setDebutPerso}
              finPerso={finPerso}
              setFinPerso={setFinPerso}
            />
            <select value={type} onChange={(e) => setType(e.target.value)}>
              <option value="">Tous les types</option>
              {types.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
            <input type="search" placeholder="Description…" value={terme} onChange={(e) => setTerme(e.target.value)} />
            <BoutonsExport titre="Historique des dépenses" colonnes={colonnesExport} lignes={lignesExport} compact />
            <div className="bascule-vue" role="group" aria-label="Affichage">
              <button type="button" className={vue === "liste" ? "actif" : ""} onClick={() => setVue("liste")}>
                📄 Liste
              </button>
              <button type="button" className={vue === "types" ? "actif" : ""} onClick={() => setVue("types")}>
                🏷️ Par type
              </button>
            </div>
          </div>
          {vue === "types" ? (
            <div className="zone-tableau-scroll zone-commandes-fiche">
              <table className="tableau-catalogue carte-mobile">
                <thead>
                  <tr>
                    <th>Type</th>
                    <th>Dépenses</th>
                    <th>Total</th>
                    <th>Part</th>
                  </tr>
                </thead>
                <tbody>
                  {parType.map((p) => (
                    <tr key={p.libelle} onClick={() => { setType(p.libelle); setVue("liste"); }} title="Voir ces dépenses">
                      <td data-label="Type">{p.libelle}</td>
                      <td data-label="Dépenses">{p.nombre}</td>
                      <td data-label="Total" className="nowrap texte-erreur">
                        −{formaterMontant(p.total)} {devise}
                      </td>
                      <td data-label="Part">
                        <span className="mini-progression">
                          <span className="barre-progression">
                            <span style={{ width: `${total > 0 ? Math.round((p.total / total) * 100) : 0}%` }} />
                          </span>
                          <span className="sous-info">{total > 0 ? Math.round((p.total / total) * 100) : 0} %</span>
                        </span>
                      </td>
                    </tr>
                  ))}
                  {parType.length === 0 && (
                    <tr>
                      <td colSpan={4} className="liste-vide-compacte">
                        Aucune dépense pour ces filtres.
                      </td>
                    </tr>
                  )}
                  {Array.from({ length: Math.max(0, 10 - Math.max(1, parType.length)) }).map((_, i) => (
                    <tr key={`vide-${i}`} className="ligne-groupe-vide">
                      <td>&nbsp;</td>
                      <td>&nbsp;</td>
                      <td>&nbsp;</td>
                      <td>&nbsp;</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="zone-tableau-scroll zone-commandes-fiche">
              <table className="tableau-catalogue carte-mobile">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Type</th>
                    <th>Description</th>
                    <th>Montant</th>
                    <th>Effectué par</th>
                  </tr>
                </thead>
                <tbody>
                  {filtrees.map((d) => (
                    <tr key={d.id}>
                      <td data-label="Date" title={new Date(d.dateCreation).toLocaleString("fr-FR")}>
                        {new Date(d.dateCreation).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" })}
                      </td>
                      <td data-label="Type">{libelleCategorieDepense(d.categorie)}</td>
                      <td data-label="Description">{d.description || "—"}</td>
                      <td data-label="Montant" className="nowrap texte-erreur">
                        −{formaterMontant(d.montant)} {devise}
                      </td>
                      <td data-label="Effectué par">{nomUtilisateur(d.utilisateurId)}</td>
                    </tr>
                  ))}
                  {filtrees.length === 0 && (
                    <tr>
                      <td colSpan={5} className="liste-vide-compacte">
                        {depenses.length === 0 ? "Aucune dépense enregistrée." : "Aucune dépense pour ces filtres."}
                      </td>
                    </tr>
                  )}
                  {Array.from({ length: Math.max(0, 10 - Math.max(1, filtrees.length)) }).map((_, i) => (
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
          {filtrees.length > 0 && (
            <div className="totaux">
              <div>
                {filtrees.length} dépense{filtrees.length > 1 ? "s" : ""}
              </div>
              <div className="total-net">
                Total : {formaterMontant(total)} {devise}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

interface LigneDepenseGroupe {
  id: string;
  categorie: CategorieDepense;
  montant: number;
  description: string;
}

export default function Depense({ session }: { session: Session }) {
  const devise = useDevise();
  const [depots, setDepots] = useState<DepotResume[]>([]);
  const [depotId, setDepotId] = useState(session.depotId ?? "");
  const [depenses, setDepenses] = useState<DepenseResume[]>([]);
  const [sectionOuverte, setSectionOuverte] = useState<Section | null>(null);

  const [categorie, setCategorie] = useState<CategorieDepense>("");
  const [montant, setMontant] = useState("");
  const [description, setDescription] = useState("");
  const [lignes, setLignes] = useState<LigneDepenseGroupe[]>([]);
  const [erreur, setErreur] = useState<string | null>(null);
  const [enCours, setEnCours] = useState(false);
  const [solde, setSolde] = useState<number | null>(null);
  const nomUtilisateur = useNomsUtilisateurs(session);

  useEffect(() => {
    if (!session.depotId) listerDepotsDetail(session.boutiqueId).then(setDepots);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function rafraichir() {
    if (!depotId) return;
    setDepenses(await listerDepenses(depotId, 2000));
    setSolde(await soldeCaisse(depotId));
  }
  useEffect(() => {
    rafraichir();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [depotId]);

  function ajouterLigne() {
    const valeur = Number(montant) || 0;
    if (!categorie.trim() || valeur <= 0) return;
    setLignes((actuel) => [
      ...actuel,
      { id: crypto.randomUUID(), categorie: categorie.trim(), montant: valeur, description: description.trim() },
    ]);
    setMontant("");
    setDescription("");
  }

  function surEntree(evenement: React.KeyboardEvent) {
    if (evenement.key === "Enter") {
      evenement.preventDefault();
      ajouterLigne();
    }
  }

  function retirerLigne(id: string) {
    setLignes((actuel) => actuel.filter((l) => l.id !== id));
  }

  async function validerDepenses() {
    setErreur(null);
    if (!depotId) {
      setErreur("Choisissez un dépôt.");
      return;
    }
    if (lignes.length === 0) {
      setErreur("Ajoutez au moins une dépense à la liste.");
      return;
    }
    setEnCours(true);
    try {
      for (const ligne of lignes) {
        try {
          await enregistrerDepense(depotId, ligne.categorie, ligne.montant, ligne.description, session.utilisateurId);
        } catch (e) {
          const message = e instanceof ErreurTresorerie ? e.message : "Erreur inattendue.";
          setErreur(`${libelleCategorieDepense(ligne.categorie)} (${formaterMontant(ligne.montant)} ${devise}) : ${message}`);
          return;
        }
      }
      setLignes([]);
      await rafraichir();
    } finally {
      setEnCours(false);
    }
  }

  const totalListe = lignes.reduce((t, l) => t + l.montant, 0);
  const soldeApres = solde !== null ? solde - totalListe : null;
  const aujourdhui = jourLocal(new Date());
  const depenseAujourdhui = depenses
    .filter((d) => jourLocal(new Date(d.dateCreation)) === aujourdhui)
    .reduce((t, d) => t + d.montant, 0);

  // Suggestions du combobox Type de dépense : les 6 types courants + tous
  // les types déjà saisis (y compris personnalisés, historique et lignes en
  // attente) — sert de référence pour retrouver un type déjà utilisé plutôt
  // que de le retaper et créer un doublon proche (ex. "Réparation vélo" vs
  // "réparation velo").
  const typesConnus = Array.from(
    new Set([
      ...CATEGORIES_DEPENSE.map((c) => c.label),
      ...depenses.map((d) => d.categorie),
      ...lignes.map((l) => l.categorie),
    ]),
  );

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

      {sectionOuverte === "depenses" && (
        <div className="fond-modale" onClick={() => setSectionOuverte(null)}>
          <div className="modale-selection-produits" onClick={(e) => e.stopPropagation()}>
            <EnteteModale titre="Dépenses" onFermer={() => setSectionOuverte(null)} />
            <div className="modale-corps">
              <div className="tuiles-fiche">
                <div className="tuile-fiche">
                  <span className="sous-info">📅 Dépensé aujourd'hui</span>
                  <strong className="nowrap">
                    {formaterMontant(depenseAujourdhui)} {devise}
                  </strong>
                </div>
                <div className="tuile-fiche">
                  <span className="sous-info">🧾 Dans la liste</span>
                  <strong className="nowrap">
                    {lignes.length} · {formaterMontant(totalListe)} {devise}
                  </strong>
                </div>
                <div className={`tuile-fiche${soldeApres !== null && soldeApres < 0 ? " tuile-fiche--alerte" : ""}`}>
                  <span className="sous-info">💰 Caisse après validation</span>
                  <strong className="nowrap">
                    {soldeApres !== null ? `${formaterMontant(soldeApres)} ${devise}` : "…"}
                  </strong>
                </div>
              </div>
              {erreur && <div className="message-erreur">{erreur}</div>}

              <form onSubmit={(e) => e.preventDefault()} className="formulaire-catalogue formulaire-tresorerie formulaire-depenses">
                <div className="types-rapides">
                  {CATEGORIES_DEPENSE.map((c) => (
                    <button
                      key={c.valeur}
                      type="button"
                      className={categorie === c.label ? "actif" : ""}
                      onClick={() => setCategorie(c.label)}
                    >
                      {c.label}
                    </button>
                  ))}
                </div>
                <div className="ligne-champs-tresorerie">
                  {!session.depotId && (
                    <label>
                      Dépôt
                      <select value={depotId} onChange={(e) => setDepotId(e.target.value)}>
                        <option value="">Choisir un dépôt…</option>
                        {depots.map((d) => (
                          <option key={d.id} value={d.id}>
                            {d.nom}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}
                  <label>
                    Type de dépense
                    <input
                      list="types-depense"
                      value={categorie}
                      onChange={(e) => setCategorie(e.target.value)}
                      onKeyDown={surEntree}
                      placeholder="Transport, réparation…"
                    />
                    <datalist id="types-depense">
                      {typesConnus.map((t) => (
                        <option key={t} value={t} />
                      ))}
                    </datalist>
                  </label>
                  <label>
                    Montant
                    <ChampMontant value={montant} onChange={setMontant} onKeyDown={surEntree} />
                  </label>
                  <label>
                    Description (optionnel)
                    <input value={description} onChange={(e) => setDescription(e.target.value)} onKeyDown={surEntree} />
                  </label>
                  <button type="button" className="bouton-ajouter-produit-groupe" onClick={ajouterLigne}>
                    + Ajouter à la liste
                  </button>
                </div>

                <div className="zone-tableau-scroll tableau-produits-groupe-scroll tableau-depenses-groupe">
                  <table className="tableau-catalogue carte-mobile">
                    <thead>
                      <tr>
                        <th className="col-designation-groupe">Type</th>
                        <th>Description</th>
                        <th>Montant</th>
                        <th className="colonne-numero-groupe" />
                      </tr>
                    </thead>
                    <tbody>
                      {lignes.map((l) => (
                        <tr key={l.id}>
                          <td data-label="Type" className="col-designation-groupe">{libelleCategorieDepense(l.categorie)}</td>
                          <td data-label="Description">{l.description || "—"}</td>
                          <td data-label="Montant" className="nowrap">
                            {formaterMontant(l.montant)} {devise}
                          </td>
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
                      {Array.from({ length: Math.max(0, 10 - lignes.length) }).map((_, i) => (
                        <tr key={`vide-${i}`} className="ligne-groupe-vide">
                          <td className="col-designation-groupe">&nbsp;</td>
                          <td>&nbsp;</td>
                          <td>&nbsp;</td>
                          <td className="colonne-numero-groupe">&nbsp;</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="totaux">
                  <div>
                    {lignes.length} dépense{lignes.length > 1 ? "s" : ""} à valider · total{" "}
                    <strong>
                      {formaterMontant(totalListe)} {devise}
                    </strong>
                  </div>
                  <button
                    type="button"
                    className="bouton-primaire"
                    onClick={validerDepenses}
                    disabled={enCours || !depotId || lignes.length === 0}
                  >
                    {enCours ? "Enregistrement…" : `Valider les dépenses (${lignes.length})`}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}

      {sectionOuverte === "historique" && (
        <ModaleHistoriqueDepenses
          depenses={depenses}
          devise={devise}
          nomUtilisateur={nomUtilisateur}
          onFermer={() => setSectionOuverte(null)}
        />
      )}
    </div>
  );
}
