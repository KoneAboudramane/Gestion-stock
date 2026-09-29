import { useEffect, useState } from "react";

//<adaptateur>
import { api } from "../api/client";
import type {
  ArticleDetaillable,
  DetaillageResume,
  GrosDisponible,
  InfoDetail,
  Session,
  TypeDetaillage,
} from "../api/client";

function verifier<T>(
  resultat: { succes: true; resultat: T } | { succes: false; message: string },
): T {
  if (!resultat.succes) throw new Error(resultat.message);
  return resultat.resultat;
}

const donnees = {
  infoDetail: (varianteId: string): Promise<InfoDetail> =>
    api.detaillages.infoDetail(varianteId),
  articles: (
    boutiqueId: string,
    depotId?: string,
  ): Promise<ArticleDetaillable[]> =>
    api.detaillages.articles(boutiqueId, depotId),
  historique: (boutiqueId: string): Promise<DetaillageResume[]> =>
    api.detaillages.lister(boutiqueId),
  depots: async (boutiqueId: string): Promise<{ id: string; nom: string }[]> =>
    api.depots.lister(boutiqueId),
  variantes: (boutiqueId: string): Promise<{ id: string; nom: string }[]> =>
    api.detaillages.variantes(boutiqueId),
  operer: async (p: {
    varianteGrosId: string;
    depotId: string;
    nombre: number;
    type: TypeDetaillage;
    utilisateurId: string | null;
  }): Promise<void> => {
    verifier(await api.detaillages.operer(p));
  },
  annuler: async (id: string, utilisateurId: string | null): Promise<void> => {
    verifier(await api.detaillages.annuler(id, utilisateurId));
  },
  definir: async (
    grosId: string,
    detailId: string | null,
    quantite: number | null,
  ): Promise<void> => {
    verifier(await api.detaillages.definirDetail(grosId, detailId, quantite));
  },
  creer: async (p: {
    varianteGrosId: string;
    nom: string;
    prixVente: number;
    quantite: number;
  }): Promise<void> => {
    verifier(await api.detaillages.creerDetail(p));
  },
};
/** Caisse : article de gros à détailler quand le détail est en rupture. */
export const grosDisponible = (
  varianteDetailId: string,
  depotId: string,
): Promise<GrosDisponible | null> =>
  api.detaillages.grosDisponible(varianteDetailId, depotId);
//</adaptateur>
import ChampMontant from "./ChampMontant";
import FiltrePeriodeHistorique from "./FiltrePeriodeHistorique";
import { useDevise } from "../contexts/DeviseContext";
import { useNomsUtilisateurs } from "../hooks/useNomsUtilisateurs";
import {
  bornesPeriode,
  dansPeriode,
  jourLocal,
  type PeriodeHistorique,
} from "../lib/periode";

export type { GrosDisponible };

function nombre(valeur: number): string {
  return valeur.toLocaleString("fr-FR", { maximumFractionDigits: 2 });
}

function messageDe(erreur: unknown): string {
  return erreur instanceof Error ? erreur.message : "Erreur inattendue.";
}

// --- Formulaire « Détailler / Regrouper » ---

export function FormulaireDetailler({
  session,
  varianteGrosIdInitial,
  typeInitial = "detailler",
  onTermine,
}: {
  session: Session;
  varianteGrosIdInitial?: string;
  typeInitial?: TypeDetaillage;
  onTermine?: () => void;
}) {
  const [depots, setDepots] = useState<{ id: string; nom: string }[]>([]);
  const [depotId, setDepotId] = useState(session.depotId ?? "");
  const [articles, setArticles] = useState<ArticleDetaillable[]>([]);
  const [grosId, setGrosId] = useState(varianteGrosIdInitial ?? "");
  const [type, setType] = useState<TypeDetaillage>(typeInitial);
  const [quantite, setQuantite] = useState("1");
  const [erreur, setErreur] = useState<string | null>(null);
  const [succes, setSucces] = useState<string | null>(null);
  const [enCours, setEnCours] = useState(false);

  useEffect(() => {
    donnees.depots(session.boutiqueId).then((liste) => {
      setDepots(liste);
      if (!depotId && liste[0]) setDepotId(liste[0].id);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.boutiqueId]);

  async function chargerArticles() {
    if (!depotId) return;
    const liste = await donnees.articles(session.boutiqueId, depotId);
    setArticles(liste);
    if (!grosId && liste[0]) setGrosId(liste[0].varianteGrosId);
  }
  useEffect(() => {
    chargerArticles();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [depotId]);

  const article = articles.find((a) => a.varianteGrosId === grosId);
  const n = Math.floor(Number(quantite) || 0);
  const detailler = type === "detailler";
  const maximum = article
    ? detailler
      ? article.stockGros
      : Math.floor(article.stockDetail / article.quantite)
    : 0;

  async function confirmer() {
    if (!article || n <= 0) return;
    setEnCours(true);
    setErreur(null);
    setSucces(null);
    try {
      await donnees.operer({
        varianteGrosId: article.varianteGrosId,
        depotId,
        nombre: n,
        type,
        utilisateurId: session.utilisateurId,
      });
      setSucces(
        detailler
          ? `${nombre(n)} « ${article.grosNom} » détaillé(s) en ${nombre(n * article.quantite)} « ${article.detailNom} ».`
          : `${nombre(n * article.quantite)} « ${article.detailNom} » regroupé(s) en ${nombre(n)} « ${article.grosNom} ».`,
      );
      setQuantite("1");
      await chargerArticles();
      onTermine?.();
    } catch (e) {
      setErreur(messageDe(e));
    } finally {
      setEnCours(false);
    }
  }

  if (depotId && articles.length === 0) {
    return (
      <div className="bloc-hors-ligne">
        <span>
          Aucun article ne se détaille encore. Ouvrez la fiche d'un article de
          gros (un carton, un sac…) puis sa rubrique « Vente au détail » pour
          indiquer ce qu'il contient.
        </span>
      </div>
    );
  }

  return (
    <div className="formulaire-detailler">
      <div className="bascule-vue" role="group" aria-label="Opération">
        <button
          type="button"
          className={detailler ? "actif" : ""}
          onClick={() => setType("detailler")}
        >
          ✂️ Détailler
        </button>
        <button
          type="button"
          className={!detailler ? "actif" : ""}
          onClick={() => setType("regrouper")}
        >
          📦 Regrouper
        </button>
      </div>
      <div className="champs-detailler">
        <label className="champ-formulaire">
          Article
          <select value={grosId} onChange={(e) => setGrosId(e.target.value)}>
            {articles.map((a) => (
              <option key={a.varianteGrosId} value={a.varianteGrosId}>
                {a.grosNom} (1 = {nombre(a.quantite)} {a.detailNom})
              </option>
            ))}
          </select>
        </label>
        {depots.length > 1 && (
          <label className="champ-formulaire">
            Dépôt
            <select
              value={depotId}
              onChange={(e) => setDepotId(e.target.value)}
            >
              {depots.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.nom}
                </option>
              ))}
            </select>
          </label>
        )}
        <label className="champ-formulaire">
          {detailler ? "Nombre à détailler" : "Nombre à reconstituer"}
          <input
            type="number"
            min={1}
            step={1}
            value={quantite}
            onChange={(e) => setQuantite(e.target.value)}
          />
        </label>
      </div>
      {article && (
        <div className="apercu-detailler">
          <div>
            <span className="sous-info">En stock</span>
            <strong>
              {nombre(article.stockGros)} {article.grosNom} ·{" "}
              {nombre(article.stockDetail)} {article.detailNom}
            </strong>
          </div>
          <div>
            <span className="sous-info">Résultat</span>
            <strong>
              {detailler
                ? `${nombre(n)} ${article.grosNom} → ${nombre(n * article.quantite)} ${article.detailNom}`
                : `${nombre(n * article.quantite)} ${article.detailNom} → ${nombre(n)} ${article.grosNom}`}
            </strong>
          </div>
          <div>
            <span className="sous-info">Possible au maximum</span>
            <strong className={maximum < n ? "texte-erreur" : undefined}>
              {nombre(maximum)}
            </strong>
          </div>
        </div>
      )}
      {erreur && <div className="message-erreur">{erreur}</div>}
      {succes && <div className="message-succes">✓ {succes}</div>}
      <div className="actions-formulaire">
        <button
          type="button"
          className="bouton-valider"
          disabled={enCours || !article || n <= 0 || n > maximum}
          onClick={confirmer}
        >
          {enCours ? "…" : detailler ? "Détailler" : "Regrouper"}
        </button>
      </div>
    </div>
  );
}

// --- Historique des détaillages ---

export function HistoriqueDetaillages({
  session,
  actualisation = 0,
}: {
  session: Session;
  actualisation?: number;
}) {
  const nomUtilisateur = useNomsUtilisateurs(session);
  const peutGerer = !!session.permissions.gerer_produits_stock_achats;
  const [operations, setOperations] = useState<DetaillageResume[]>([]);
  const [periode, setPeriode] = useState<PeriodeHistorique>("30j");
  const [debutPerso, setDebutPerso] = useState(jourLocal(new Date()));
  const [finPerso, setFinPerso] = useState(jourLocal(new Date()));
  const [aAnnuler, setAAnnuler] = useState<DetaillageResume | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);

  async function rafraichir() {
    setOperations(await donnees.historique(session.boutiqueId));
  }
  useEffect(() => {
    rafraichir();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.boutiqueId, actualisation]);

  const filtrees = operations.filter((o) =>
    dansPeriode(o.dateCreation, bornesPeriode(periode, debutPerso, finPerso)),
  );

  async function confirmerAnnulation() {
    if (!aAnnuler) return;
    try {
      await donnees.annuler(aAnnuler.id, session.utilisateurId);
      setAAnnuler(null);
      setErreur(null);
      rafraichir();
    } catch (e) {
      setAAnnuler(null);
      setErreur(messageDe(e));
    }
  }

  return (
    <>
      <div className="barre-actions barre-filtres-historique">
        <FiltrePeriodeHistorique
          periode={periode}
          setPeriode={setPeriode}
          debutPerso={debutPerso}
          setDebutPerso={setDebutPerso}
          finPerso={finPerso}
          setFinPerso={setFinPerso}
        />
      </div>
      {erreur && <div className="message-erreur">{erreur}</div>}
      <div className="zone-tableau-scroll zone-commandes-fiche">
        <table className="tableau-catalogue carte-mobile">
          <thead>
            <tr>
              <th>Date</th>
              <th>Opération</th>
              <th>De</th>
              <th>Vers</th>
              <th>Dépôt</th>
              <th>Fait par</th>
              {peutGerer && <th />}
            </tr>
          </thead>
          <tbody>
            {filtrees.map((o) => (
              <tr
                key={o.id}
                className={o.annulee ? "ligne-annulee" : undefined}
              >
                <td data-label="Date">
                  {new Date(o.dateCreation).toLocaleString("fr-FR")}
                </td>
                <td data-label="Opération">
                  {o.type === "detailler" ? "✂️ Détaillé" : "📦 Regroupé"}
                  {o.annulee && <span className="badge-annulee"> Annulé</span>}
                </td>
                <td data-label="De">
                  {nombre(o.quantiteSource)} {o.sourceNom}
                </td>
                <td data-label="Vers">
                  {nombre(o.quantiteCible)} {o.cibleNom}
                </td>
                <td data-label="Dépôt">{o.depotNom}</td>
                <td data-label="Fait par">{nomUtilisateur(o.utilisateurId)}</td>
                {peutGerer && (
                  <td>
                    {!o.annulee && (
                      <button
                        type="button"
                        className="lien"
                        onClick={() => setAAnnuler(o)}
                      >
                        Annuler
                      </button>
                    )}
                  </td>
                )}
              </tr>
            ))}
            {filtrees.length === 0 && (
              <tr>
                <td colSpan={peutGerer ? 7 : 6} className="liste-vide">
                  {operations.length === 0
                    ? "Aucune opération."
                    : "Aucune opération sur cette période."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {aAnnuler && (
        <div className="fond-modale" onClick={() => setAAnnuler(null)}>
          <div
            className="modale-confirmation"
            onClick={(e) => e.stopPropagation()}
          >
            <h3>Annuler cette opération ?</h3>
            <p className="note-aide">
              {`Les ${nombre(aAnnuler.quantiteCible)} « ${aAnnuler.cibleNom} » obtenus redeviennent ${nombre(aAnnuler.quantiteSource)} « ${aAnnuler.sourceNom} ». Possible seulement s'ils sont encore tous en stock.`}
            </p>
            <div className="actions-formulaire">
              <button
                type="button"
                className="lien"
                onClick={() => setAAnnuler(null)}
              >
                Retour
              </button>
              <button
                type="button"
                className="bouton-danger"
                onClick={confirmerAnnulation}
              >
                Annuler l'opération
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// --- Carte Stock « Détailler / Regrouper » ---

export function ModaleDetaillerRegrouper({
  session,
  onFermer,
}: {
  session: Session;
  onFermer: () => void;
}) {
  const [page, setPage] = useState<"operer" | "historique">("operer");
  const [actualisation, setActualisation] = useState(0);
  return (
    <div className="fond-modale" onClick={onFermer}>
      <div
        className="modale-selection-produits"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modale-entete">
          <h3>Détailler / Regrouper</h3>
          <button
            type="button"
            className="lien bouton-retour"
            onClick={onFermer}
          >
            ← Retour
          </button>
        </div>
        <div className="modale-avec-menu">
          <nav className="menu-modale">
            <button
              type="button"
              className={page === "operer" ? "actif" : ""}
              onClick={() => setPage("operer")}
            >
              <span className="icone-menu-modale">✂️</span>
              Détailler / regrouper
            </button>
            <button
              type="button"
              className={page === "historique" ? "actif" : ""}
              onClick={() => setPage("historique")}
            >
              <span className="icone-menu-modale">🕘</span>
              Historique
            </button>
          </nav>
          <div className="modale-corps">
            {page === "operer" ? (
              <>
                <p className="note-aide">
                  <strong>Détailler</strong> : ouvrir un article de gros pour le
                  vendre au détail (1 carton → 24 paquets).{" "}
                  <strong>Regrouper</strong> : l'inverse, pour reconstituer des
                  cartons complets. Le coût suit, la marge reste juste.
                </p>
                <FormulaireDetailler
                  session={session}
                  onTermine={() => setActualisation((a) => a + 1)}
                />
              </>
            ) : (
              <HistoriqueDetaillages
                session={session}
                actualisation={actualisation}
              />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// --- Fiche article : rubrique « Vente au détail » ---

export function PanneauVenteAuDetail({
  session,
  varianteId,
  nomArticle,
  onModifie,
}: {
  session: Session;
  varianteId: string;
  nomArticle: string;
  onModifie?: () => void;
}) {
  const devise = useDevise();
  const peutGerer = !!session.permissions.gerer_produits_stock_achats;
  const [info, setInfo] = useState<InfoDetail | null>(null);
  const [edition, setEdition] = useState(false);
  const [mode, setMode] = useState<"creer" | "existant">("creer");
  const [quantite, setQuantite] = useState("");
  const [nom, setNom] = useState("");
  const [prixVente, setPrixVente] = useState("");
  const [existantId, setExistantId] = useState("");
  const [variantes, setVariantes] = useState<{ id: string; nom: string }[]>([]);
  const [erreur, setErreur] = useState<string | null>(null);
  const [operation, setOperation] = useState<TypeDetaillage | null>(null);

  async function rafraichir() {
    setInfo(await donnees.infoDetail(varianteId));
  }
  useEffect(() => {
    rafraichir();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [varianteId]);

  function ouvrirEdition() {
    setEdition(true);
    setErreur(null);
    setQuantite(info?.detail ? String(info.detail.quantite) : "");
    setNom(`${nomArticle} (détail)`);
    setPrixVente("");
    setExistantId(info?.detail?.varianteId ?? "");
    setMode(info?.detail ? "existant" : "creer");
    donnees
      .variantes(session.boutiqueId)
      .then((liste) => setVariantes(liste.filter((v) => v.id !== varianteId)));
  }

  async function enregistrer() {
    setErreur(null);
    const q = Number(quantite) || 0;
    try {
      if (mode === "creer") {
        if (!nom.trim())
          throw new Error("Donnez un nom à l'article de détail.");
        await donnees.creer({
          varianteGrosId: varianteId,
          nom,
          prixVente: Number(prixVente) || 0,
          quantite: q,
        });
      } else {
        if (!existantId) throw new Error("Choisissez l'article de détail.");
        await donnees.definir(varianteId, existantId, q);
      }
      setEdition(false);
      await rafraichir();
      onModifie?.();
    } catch (e) {
      setErreur(messageDe(e));
    }
  }

  async function retirerLien() {
    try {
      await donnees.definir(varianteId, null, null);
      await rafraichir();
      onModifie?.();
    } catch (e) {
      setErreur(messageDe(e));
    }
  }

  if (!info) return <p>Chargement…</p>;

  return (
    <div className="panneau-vente-detail">
      {info.gros && (
        <div className="bloc-hors-ligne">
          <span>
            📦 Cet article est le <strong>détail</strong> de « {info.gros.nom} »
            : 1 {info.gros.nom} = {nombre(info.gros.quantite)} {nomArticle}.
          </span>
        </div>
      )}

      {info.detail && !edition && (
        <div className="carte-lien-detail">
          <div className="formule-lien-detail">
            <strong>1 {nomArticle}</strong>
            <span>=</span>
            <strong>
              {nombre(info.detail.quantite)} {info.detail.nom}
            </strong>
          </div>
          {peutGerer && (
            <div className="actions-ligne">
              <button
                type="button"
                className="bouton-primaire"
                onClick={() => setOperation("detailler")}
              >
                ✂️ Détailler
              </button>
              <button type="button" onClick={() => setOperation("regrouper")}>
                📦 Regrouper
              </button>
              <button type="button" className="lien" onClick={ouvrirEdition}>
                ✎ Modifier le lien
              </button>
              <button
                type="button"
                className="lien lien-danger"
                onClick={retirerLien}
              >
                Retirer le lien
              </button>
            </div>
          )}
        </div>
      )}

      {!info.detail && !edition && (
        <div className="carte-lien-detail">
          <p className="note-aide">
            Cet article ne se vend pas au détail. Si c'est un carton, un sac, un
            fardeau… que vous ouvrez pour vendre à l'unité, indiquez ce qu'il
            contient.
          </p>
          {peutGerer && (
            <button
              type="button"
              className="bouton-primaire"
              onClick={ouvrirEdition}
            >
              ✂️ Vendre aussi au détail
            </button>
          )}
        </div>
      )}

      {edition && (
        <div className="carte-lien-detail">
          <label className="champ-formulaire">
            1 {nomArticle} contient
            <input
              type="number"
              min={2}
              step={1}
              placeholder="ex. 24"
              value={quantite}
              onChange={(e) => setQuantite(e.target.value)}
            />
          </label>
          <div
            className="bascule-vue"
            role="group"
            aria-label="Article de détail"
          >
            <button
              type="button"
              className={mode === "creer" ? "actif" : ""}
              onClick={() => setMode("creer")}
            >
              Créer l'article de détail
            </button>
            <button
              type="button"
              className={mode === "existant" ? "actif" : ""}
              onClick={() => setMode("existant")}
            >
              Choisir un article existant
            </button>
          </div>
          {mode === "creer" ? (
            <div className="champs-detailler">
              <label className="champ-formulaire">
                Nom de l'article de détail
                <input
                  value={nom}
                  onChange={(e) => setNom(e.target.value)}
                  placeholder="ex. Biscuit — paquet"
                />
              </label>
              <label className="champ-formulaire">
                Prix de vente au détail ({devise})
                <ChampMontant
                  value={prixVente}
                  onChange={setPrixVente}
                  placeholder="ex. 600"
                />
              </label>
            </div>
          ) : (
            <label className="champ-formulaire">
              Article de détail
              <select
                value={existantId}
                onChange={(e) => setExistantId(e.target.value)}
              >
                <option value="">Choisir…</option>
                {variantes.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.nom}
                  </option>
                ))}
              </select>
            </label>
          )}
          {erreur && <div className="message-erreur">{erreur}</div>}
          <div className="actions-formulaire">
            <button
              type="button"
              className="lien"
              onClick={() => setEdition(false)}
            >
              Annuler
            </button>
            <button
              type="button"
              className="bouton-valider"
              onClick={enregistrer}
            >
              Enregistrer
            </button>
          </div>
        </div>
      )}

      {erreur && !edition && <div className="message-erreur">{erreur}</div>}

      {operation && (
        <div className="fond-modale" onClick={() => setOperation(null)}>
          <div
            className="modale-confirmation modale-confirmation-large"
            onClick={(e) => e.stopPropagation()}
          >
            <h3>{operation === "detailler" ? "Détailler" : "Regrouper"}</h3>
            <FormulaireDetailler
              session={session}
              varianteGrosIdInitial={varianteId}
              typeInitial={operation}
              onTermine={() => onModifie?.()}
            />
            <div className="actions-formulaire">
              <button
                type="button"
                className="lien"
                onClick={() => setOperation(null)}
              >
                Fermer
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// --- Caisse : plus de détail en stock, mais il reste du gros ---

export function ModaleDetaillerEnCaisse({
  session,
  gros,
  detailNom,
  depotId,
  onAnnuler,
  onTermine,
}: {
  session: Session;
  gros: GrosDisponible;
  detailNom: string;
  depotId: string;
  onAnnuler: () => void;
  onTermine: () => void;
}) {
  const [erreur, setErreur] = useState<string | null>(null);
  const [enCours, setEnCours] = useState(false);

  async function detailler() {
    setEnCours(true);
    setErreur(null);
    try {
      await donnees.operer({
        varianteGrosId: gros.varianteGrosId,
        depotId,
        nombre: 1,
        type: "detailler",
        utilisateurId: session.utilisateurId,
      });
      onTermine();
    } catch (e) {
      setErreur(messageDe(e));
    } finally {
      setEnCours(false);
    }
  }

  return (
    <div className="fond-modale" onClick={onAnnuler}>
      <div className="modale-confirmation" onClick={(e) => e.stopPropagation()}>
        <h3>Plus de « {detailNom} » en stock</h3>
        <p className="note-aide">
          Il reste {nombre(gros.stockGros)} « {gros.grosNom} ». Détailler 1 «{" "}
          {gros.grosNom} » donne {nombre(gros.quantite)} « {detailNom} », puis
          l'article est ajouté à la vente. L'opération est enregistrée à votre
          nom.
        </p>
        {erreur && <div className="message-erreur">{erreur}</div>}
        <div className="actions-formulaire">
          <button type="button" className="lien" onClick={onAnnuler}>
            Annuler
          </button>
          <button
            type="button"
            className="bouton-valider"
            disabled={enCours}
            onClick={detailler}
          >
            {enCours ? "…" : "✂️ Détailler et vendre"}
          </button>
        </div>
      </div>
    </div>
  );
}
