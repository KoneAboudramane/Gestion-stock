import { useEffect, useRef, useState } from "react";

import { useDevise } from "../contexts/DeviseContext";
import { formaterMontant } from "../lib/formatage";
import { listerVariantesActives, type VarianteActive } from "../services/catalogue";
import { enregistrerRecette, ErreurRecette, obtenirRecette, supprimerRecette } from "../services/recettes";
import ChampMontant from "./ChampMontant";
import ModaleTousLesArticles from "./ModaleTousLesArticles";

// Port de client-electron/src/components/ModaleRecette.tsx.
// Recette d'un article fabriqué : les ingrédients pour un lot de N articles,
// plus des frais par unité. Ouverte depuis la fiche article (Produits.tsx) et
// depuis la modale Fabrication (EntreeStock.tsx). À la fabrication, les
// ingrédients sortent du stock et le coût est calculé (voir services/recettes.ts).

interface LigneSaisie {
  ingredientId: string;
  produitNom: string;
  reference: string;
  unite: string;
  quantite: string;
  coutUnitaire: number;
}

function nombre(valeur: string): number {
  const n = Number(valeur.replace(",", "."));
  return Number.isFinite(n) ? n : 0;
}

export default function ModaleRecette({
  boutiqueId,
  varianteId,
  nomArticle,
  prixVente,
  onFermer,
  onEnregistree,
}: {
  boutiqueId: string;
  varianteId: string;
  nomArticle: string;
  prixVente: number;
  onFermer: () => void;
  /** Après enregistrement ou suppression (pour recharger les coûts affichés). */
  onEnregistree: () => void;
}) {
  const devise = useDevise();
  const [chargee, setChargee] = useState(false);
  const [existante, setExistante] = useState(false);
  const [quantiteLot, setQuantiteLot] = useState("1");
  const [frais, setFrais] = useState("");
  const [lignes, setLignes] = useState<LigneSaisie[]>([]);
  const [articles, setArticles] = useState<VarianteActive[]>([]);
  const [terme, setTerme] = useState("");
  const [listeOuverte, setListeOuverte] = useState(false);
  const [voirTout, setVoirTout] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const [enCours, setEnCours] = useState(false);
  const champRecherche = useRef<HTMLInputElement>(null);

  useEffect(() => {
    obtenirRecette(varianteId).then((recette) => {
      if (recette) {
        setExistante(true);
        setQuantiteLot(String(recette.quantiteLot));
        setFrais(recette.fraisParUnite ? String(recette.fraisParUnite) : "");
        setLignes(recette.lignes.map((l) => ({ ...l, quantite: String(l.quantite) })));
      }
      setChargee(true);
    });
    listerVariantesActives(boutiqueId).then(setArticles);
  }, [boutiqueId, varianteId]);

  const cle = terme.trim().toLowerCase();
  const proposes = cle
    ? articles
        .filter((a) => a.id !== varianteId)
        .filter(
          (a) =>
            a.produitNom.toLowerCase().includes(cle) ||
            (a.reference || "").toLowerCase().includes(cle) ||
            a.codeBarres === terme.trim(),
        )
        .slice(0, 30)
    : [];

  function ajouter(a: VarianteActive) {
    setTerme("");
    setErreur(null);
    champRecherche.current?.focus();
    if (lignes.some((l) => l.ingredientId === a.id)) return;
    setLignes((actuelles) => [
      ...actuelles,
      { ingredientId: a.id, produitNom: a.produitNom, reference: a.reference, unite: "", quantite: "", coutUnitaire: a.prixAchat },
    ]);
  }

  const lot = nombre(quantiteLot);
  const coutIngredients = lignes.reduce((t, l) => t + nombre(l.quantite) * l.coutUnitaire, 0);
  const coutUnitaire = lot > 0 ? Math.round(coutIngredients / lot + nombre(frais)) : 0;
  const marge = prixVente - coutUnitaire;

  async function enregistrer() {
    if (!(lot > 0)) return setErreur("Indiquez pour combien d'articles est la recette.");
    if (lignes.length === 0) return setErreur("Ajoutez au moins un ingrédient.");
    const sansQuantite = lignes.find((l) => !(nombre(l.quantite) > 0));
    if (sansQuantite) return setErreur(`${sansQuantite.produitNom} : indiquez la quantité.`);
    setEnCours(true);
    try {
      await enregistrerRecette({
        varianteId,
        quantiteLot: lot,
        fraisParUnite: nombre(frais),
        lignes: lignes.map((l) => ({ ingredientId: l.ingredientId, quantite: nombre(l.quantite) })),
      });
    } catch (e) {
      return setErreur(e instanceof ErreurRecette ? e.message : "Erreur inattendue.");
    } finally {
      setEnCours(false);
    }
    onEnregistree();
    onFermer();
  }

  async function supprimer() {
    setEnCours(true);
    try {
      await supprimerRecette(varianteId);
    } finally {
      setEnCours(false);
    }
    onEnregistree();
    onFermer();
  }

  return (
    <div className="fond-modale" onClick={onFermer}>
      <div className="modale-selection-produits modale-recette" onClick={(e) => e.stopPropagation()}>
        <div className="modale-entete entete-fixe">
          <h3>🧪 Recette — {nomArticle}</h3>
          <div className="actions-formulaire">
            {existante && (
              <button type="button" className="bouton-danger" onClick={supprimer} disabled={enCours}>
                Supprimer la recette
              </button>
            )}
            <button type="button" className="bouton-primaire" onClick={enregistrer} disabled={enCours || !chargee}>
              {enCours ? "Enregistrement…" : "Enregistrer la recette"}
            </button>
            <button type="button" className="lien bouton-retour" onClick={onFermer}>
              ← Retour
            </button>
          </div>
        </div>
        <div className="modale-corps">
          <p className="regle-recette">
            À chaque fabrication, les ingrédients sortent du stock du dépôt (règle de trois sur le lot) et le coût de
            l'article est calculé : ingrédients au coût moyen + autres frais.
          </p>
          {erreur && <div className="message-erreur">{erreur}</div>}
          <div className="ligne-champs-recette">
            <label>
              Pour combien d'articles ?
              <input
                type="number"
                min={0.01}
                step="any"
                value={quantiteLot}
                onChange={(e) => setQuantiteLot(e.target.value)}
              />
            </label>
            <label>
              Autres frais par article ({devise})
              <ChampMontant value={frais} placeholder="0 (main-d'œuvre, gaz…)" onChange={setFrais} />
            </label>
            <div className="recherche-commande-combobox recherche-ingredient">
              <input
                ref={champRecherche}
                autoFocus
                placeholder="🔍 Ajouter un ingrédient (nom, référence, code-barres)…"
                value={terme}
                onChange={(e) => setTerme(e.target.value)}
                onFocus={() => setListeOuverte(true)}
                onBlur={() => setListeOuverte(false)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && proposes.length === 1) {
                    e.preventDefault();
                    ajouter(proposes[0]);
                  }
                }}
              />
              <button
                type="button"
                className="bouton-tous-articles-entree"
                title="Voir tous les articles et cocher les ingrédients"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => setVoirTout(true)}
              >
                ☰ Voir tout
              </button>
              {cle && listeOuverte && (
                <ul className="resultats-recherche">
                  {proposes.map((a) => (
                    <li
                      key={a.id}
                      onMouseDown={(e) => {
                        e.preventDefault();
                        ajouter(a);
                      }}
                    >
                      <span>
                        {a.produitNom}
                        {a.reference && <span className="sous-info"> · {a.reference}</span>}
                      </span>
                      <span className="sous-info">
                        {lignes.some((l) => l.ingredientId === a.id) ? "déjà dans la recette · " : ""}coût{" "}
                        {formaterMontant(a.prixAchat)}
                      </span>
                    </li>
                  ))}
                  {proposes.length === 0 && <li className="liste-vide">Aucun article.</li>}
                </ul>
              )}
            </div>
          </div>
          <div className="zone-tableau-scroll zone-tableau-recette">
            <table className="tableau-catalogue carte-mobile">
              <thead>
                <tr>
                  <th className="colonne-numero-groupe">N°</th>
                  <th>Ingrédient</th>
                  <th>Quantité pour {lot > 0 ? formaterMontant(lot) : "…"} article{lot > 1 ? "s" : ""}</th>
                  <th>Coût moyen</th>
                  <th className="col-montant-entree">Coût</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {lignes.map((l, index) => (
                  <tr key={l.ingredientId}>
                    <td data-label="N°" className="colonne-numero-groupe">{index + 1}</td>
                    <td data-label="Ingrédient">
                      {l.produitNom}
                      {l.reference && <div className="sous-info">{l.reference}</div>}
                    </td>
                    <td data-label="Quantité" className="nowrap">
                      <input
                        className="champ-quantite-entree"
                        type="number"
                        min={0.01}
                        step="any"
                        placeholder="0"
                        value={l.quantite}
                        onChange={(e) =>
                          setLignes((actuelles) =>
                            actuelles.map((x) => (x.ingredientId === l.ingredientId ? { ...x, quantite: e.target.value } : x)),
                          )
                        }
                      />{" "}
                      {l.unite && <span className="sous-info">{l.unite}</span>}
                    </td>
                    <td data-label="Coût moyen" className="nowrap">
                      {l.coutUnitaire > 0 ? (
                        `${formaterMontant(l.coutUnitaire)} ${devise}`
                      ) : (
                        <span className="texte-erreur" title="Cet ingrédient n'a pas encore de prix d'achat : il compte pour 0.">
                          sans coût
                        </span>
                      )}
                    </td>
                    <td data-label="Coût" className="nowrap col-montant-entree">
                      {formaterMontant(Math.round(nombre(l.quantite) * l.coutUnitaire))}
                    </td>
                    <td data-label="">
                      <button
                        type="button"
                        className="bouton-retirer-ligne-groupe"
                        title="Retirer l'ingrédient"
                        onClick={() => setLignes((actuelles) => actuelles.filter((x) => x.ingredientId !== l.ingredientId))}
                      >
                        ✕
                      </button>
                    </td>
                  </tr>
                ))}
                {lignes.length === 0 && (
                  <tr>
                    <td colSpan={6} className="liste-vide">
                      {chargee ? "Recherchez un ingrédient pour l'ajouter à la recette." : "Chargement…"}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <div className="totaux totaux-recette">
            <div>
              Ingrédients pour le lot : <strong>{formaterMontant(Math.round(coutIngredients))} {devise}</strong>
            </div>
            <div className="total-net">
              Coût de revient : {formaterMontant(coutUnitaire)} {devise} / article
              {prixVente > 0 && (
                <span className={`sous-info${marge < 0 ? " texte-erreur" : ""}`}>
                  {" "}
                  · vendu {formaterMontant(prixVente)} · marge {formaterMontant(marge)}
                </span>
              )}
            </div>
          </div>
        </div>
      </div>
      {voirTout && (
        <ModaleTousLesArticles
          articles={articles.filter((a) => a.id !== varianteId)}
          dejaAjoutes={new Set(lignes.map((l) => l.ingredientId))}
          avecRecette={null}
          onAjouter={(choisis) => {
            choisis.forEach(ajouter);
            setVoirTout(false);
          }}
          onFermer={() => setVoirTout(false)}
        />
      )}
    </div>
  );
}
