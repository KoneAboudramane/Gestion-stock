import { useState } from "react";

import type { VarianteRecherchee } from "../api/client";
import { formaterMontant } from "../lib/formatage";

/**
 * Liste complète des articles qu'on peut ajouter (bouton « ☰ Tous les articles ») :
 * on filtre, on coche, on ajoute d'un coup — ou on double-clique un article pour l'ajouter directement. En Fabrication, ceux qui ont une
 * recette passent en premier. Sert aux entrées de stock (EntreeStock.tsx) et
 * aux ingrédients d'une recette (ModaleRecette.tsx).
 */
export default function ModaleTousLesArticles({
  articles,
  stockDepot,
  dejaAjoutes,
  avecRecette,
  onAjouter,
  onFermer,
}: {
  articles: (VarianteRecherchee & { categorieNom: string | null })[];
  /** Stock par article dans le dépôt choisi (colonne absente sans dépôt, ex. recette). */
  stockDepot?: Map<string, number>;
  dejaAjoutes: Set<string>;
  /** Fabrication : articles qui ont une recette (null ailleurs). */
  avecRecette: Set<string> | null;
  onAjouter: (choisis: VarianteRecherchee[]) => void;
  onFermer: () => void;
}) {
  const [filtre, setFiltre] = useState("");
  const [coches, setCoches] = useState<Set<string>>(new Set());
  const cle = filtre.trim().toLowerCase();
  const affiches = articles
    .filter(
      (a) =>
        !cle ||
        a.produitNom.toLowerCase().includes(cle) ||
        (a.reference || "").toLowerCase().includes(cle) ||
        (a.categorieNom || "").toLowerCase().includes(cle),
    )
    .sort((a, b) => (avecRecette ? Number(avecRecette.has(b.id)) - Number(avecRecette.has(a.id)) : 0));
  const cochables = affiches.filter((a) => !dejaAjoutes.has(a.id));
  const toutCoche = cochables.length > 0 && cochables.every((a) => coches.has(a.id));
  const nombreColonnes = 5 + (stockDepot ? 1 : 0) + (avecRecette ? 1 : 0);

  function basculer(id: string) {
    setCoches((actuels) => {
      const suivants = new Set(actuels);
      if (suivants.has(id)) suivants.delete(id);
      else suivants.add(id);
      return suivants;
    });
  }

  return (
    <div className="fond-modale" onClick={onFermer}>
      <div className="modale-selection-produits modale-tous-articles" onClick={(e) => e.stopPropagation()}>
        <div className="modale-entete entete-fixe">
          <h3>☰ Tous les articles</h3>
          <div className="actions-formulaire">
            <button
              type="button"
              className="bouton-primaire"
              disabled={coches.size === 0}
              onClick={() => onAjouter(articles.filter((a) => coches.has(a.id)))}
            >
              Ajouter à la liste ({coches.size})
            </button>
            <button type="button" className="lien bouton-retour" onClick={onFermer}>
              ← Retour
            </button>
          </div>
        </div>
        <div className="modale-corps">
          <input
            type="search"
            autoFocus
            className="champ-filtre-tous-articles"
            placeholder="Filtrer par nom, référence ou catégorie…"
            value={filtre}
            onChange={(e) => setFiltre(e.target.value)}
          />
          <div className="zone-tableau-scroll zone-tous-articles">
            <table className="tableau-catalogue">
              <thead>
                <tr>
                  <th className="colonne-case-tous-articles">
                    <input
                      type="checkbox"
                      title="Tout cocher"
                      checked={toutCoche}
                      onChange={() =>
                        setCoches((actuels) => {
                          const suivants = new Set(actuels);
                          cochables.forEach((a) => (toutCoche ? suivants.delete(a.id) : suivants.add(a.id)));
                          return suivants;
                        })
                      }
                    />
                  </th>
                  <th>Article</th>
                  <th>Catégorie</th>
                  {stockDepot && <th>Stock (dépôt)</th>}
                  <th>Prix d'achat</th>
                  <th>Prix de vente</th>
                  {avecRecette && <th>Recette</th>}
                </tr>
              </thead>
              <tbody>
                {affiches.map((a) => {
                  const deja = dejaAjoutes.has(a.id);
                  return (
                    <tr
                      key={a.id}
                      className={deja ? "ligne-deja-ajoutee" : coches.has(a.id) ? "ligne-cochee" : undefined}
                      onClick={() => !deja && basculer(a.id)}
                      // Double-clic : ajoute l'article tout de suite (avec ceux déjà cochés).
                      // Les deux clics qui le précèdent ont coché puis décoché : la sélection est inchangée.
                      onDoubleClick={() => !deja && onAjouter(articles.filter((x) => x.id === a.id || coches.has(x.id)))}
                      title={deja ? undefined : "Double-cliquez pour ajouter directement"}
                    >
                      <td className="colonne-case-tous-articles">
                        <input type="checkbox" disabled={deja} checked={deja || coches.has(a.id)} readOnly />
                      </td>
                      <td>
                        {a.produitNom}
                        {a.reference && <span className="sous-info"> · {a.reference}</span>}
                        {deja && <span className="sous-info"> · déjà dans la liste</span>}
                      </td>
                      <td>{a.categorieNom ?? <span className="sous-info">—</span>}</td>
                      {stockDepot && <td>{formaterMontant(stockDepot.get(a.id) ?? 0)}</td>}
                      <td className="nowrap">{formaterMontant(a.prixAchat)}</td>
                      <td className="nowrap">{formaterMontant(a.prixVente)}</td>
                      {avecRecette && <td>{avecRecette.has(a.id) ? "🧪 Oui" : <span className="sous-info">—</span>}</td>}
                    </tr>
                  );
                })}
                {affiches.length === 0 && (
                  <tr>
                    <td colSpan={nombreColonnes} className="liste-vide">
                      {articles.length === 0 ? "Aucun article à ajouter." : "Aucun article ne correspond au filtre."}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
