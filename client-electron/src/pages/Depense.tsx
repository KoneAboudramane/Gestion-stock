import { useEffect, useState } from "react";
import type { CSSProperties } from "react";

import { api } from "../api/client";
import type { CategorieDepense, DepenseResume, DepotResume, Session } from "../api/client";
import ChampMontant from "../components/ChampMontant";
import { useDevise } from "../contexts/DeviseContext";
import { formaterMontant } from "../lib/formatage";
import { CATEGORIES_DEPENSE, libelleCategorieDepense } from "../lib/libelles";

/**
 * Dépenses de caisse (transport, réparation, achat divers...) — accessible à
 * tout utilisateur sur son propre dépôt, contrairement au Retrait/Apport/
 * Ajustement (page Trésorerie), réservés Patron/Gérant.
 */
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
  onFermer,
}: {
  depenses: DepenseResume[];
  devise: string;
  onFermer: () => void;
}) {
  return (
    <div className="fond-modale" onClick={onFermer}>
      <div className="modale-selection-produits" onClick={(e) => e.stopPropagation()}>
        <EnteteModale titre="Historique des dépenses" onFermer={onFermer} />
        <div className="modale-corps">
          <div className="zone-tableau-scroll">
            <table className="tableau-catalogue">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Type</th>
                  <th>Description</th>
                  <th>Montant</th>
                </tr>
              </thead>
              <tbody>
                {depenses.map((d) => (
                  <tr key={d.id}>
                    <td>{new Date(d.dateCreation).toLocaleString("fr-FR")}</td>
                    <td>{libelleCategorieDepense(d.categorie)}</td>
                    <td>{d.description}</td>
                    <td>
                      {formaterMontant(d.montant)} {devise}
                    </td>
                  </tr>
                ))}
                {depenses.length === 0 && (
                  <tr>
                    <td colSpan={4} className="liste-vide-compacte">
                      Aucune dépense enregistrée.
                    </td>
                  </tr>
                )}
                {Array.from({ length: Math.max(0, 15 - depenses.length - (depenses.length === 0 ? 1 : 0)) }).map(
                  (_, i) => (
                    <tr key={`vide-${i}`} className="ligne-groupe-vide">
                      <td>&nbsp;</td>
                      <td>&nbsp;</td>
                      <td>&nbsp;</td>
                      <td>&nbsp;</td>
                    </tr>
                  ),
                )}
              </tbody>
            </table>
          </div>
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

  useEffect(() => {
    if (!session.depotId) api.depots.lister(session.boutiqueId).then(setDepots);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function rafraichir() {
    if (!depotId) return;
    setDepenses(await api.tresorerie.listerDepenses(depotId, 200));
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
        const resultat = await api.tresorerie.enregistrerDepense(
          depotId,
          ligne.categorie,
          ligne.montant,
          ligne.description,
          session.utilisateurId,
        );
        if (!resultat.succes) {
          setErreur(`${libelleCategorieDepense(ligne.categorie)} (${formaterMontant(ligne.montant)} ${devise}) : ${resultat.message}`);
          return;
        }
      }
      setLignes([]);
      await rafraichir();
    } finally {
      setEnCours(false);
    }
  }

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
              <div className="barre-actions">
                {!session.depotId && (
                  <select value={depotId} onChange={(e) => setDepotId(e.target.value)}>
                    <option value="">Choisir un dépôt…</option>
                    {depots.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.nom}
                      </option>
                    ))}
                  </select>
                )}
                <button
                  type="button"
                  className="bouton-primaire"
                  onClick={validerDepenses}
                  disabled={enCours || !depotId || lignes.length === 0}
                >
                  {enCours ? "Enregistrement…" : `Valider les dépenses (${lignes.length})`}
                </button>
              </div>

              {erreur && <div className="message-erreur">{erreur}</div>}

              <form onSubmit={(e) => e.preventDefault()} className="formulaire-catalogue formulaire-tresorerie">
                <div className="ligne-champs-tresorerie">
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
                  <table className="tableau-catalogue">
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
                          <td className="col-designation-groupe">{libelleCategorieDepense(l.categorie)}</td>
                          <td>{l.description}</td>
                          <td>
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
              </form>
            </div>
          </div>
        </div>
      )}

      {sectionOuverte === "historique" && (
        <ModaleHistoriqueDepenses
          depenses={depenses}
          devise={devise}
          onFermer={() => setSectionOuverte(null)}
        />
      )}
    </div>
  );
}
