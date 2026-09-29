import { useEffect, useState } from "react";

//<adaptateur>
import type { Session } from "../api";
import {
  annulerDetaillage,
  detaillerOuRegrouper,
  grosDisponiblePourDetail,
  listerArticlesDetaillables,
  listerDepotsDetail,
  listerDetaillages,
  listerVariantesSimples,
  type ArticleDetaillable,
  type DetaillageResume,
  type GrosDisponible,
  type TypeDetaillage,
} from "../services/stock";
import {
  creerArticleDetail,
  definirArticleDetail,
  infoDetailVariante,
  listerUnites,
  modifierVariante,
  type InfoDetail,
} from "../services/produits";

const donnees = {
  infoDetail: (varianteId: string): Promise<InfoDetail> => infoDetailVariante(varianteId),
  articles: (boutiqueId: string, depotId?: string): Promise<ArticleDetaillable[]> => listerArticlesDetaillables(boutiqueId, depotId),
  historique: (boutiqueId: string): Promise<DetaillageResume[]> => listerDetaillages(boutiqueId),
  depots: async (boutiqueId: string): Promise<{ id: string; nom: string }[]> => listerDepotsDetail(boutiqueId),
  variantes: (boutiqueId: string): Promise<{ id: string; nom: string }[]> => listerVariantesSimples(boutiqueId),
  prixVente: (varianteId: string, prix: number): Promise<void> => modifierVariante(varianteId, { prixVente: prix }),
  unites: async (boutiqueId: string): Promise<{ id: string; nom: string }[]> => listerUnites(boutiqueId),
  operer: async (p: { varianteGrosId: string; depotId: string; nombre: number; type: TypeDetaillage; utilisateurId: string | null }): Promise<void> => {
    await detaillerOuRegrouper(p);
  },
  annuler: (id: string, utilisateurId: string | null): Promise<void> => annulerDetaillage(id, utilisateurId),
  definir: (grosId: string, detailId: string | null, quantite: number | null): Promise<void> =>
    definirArticleDetail(grosId, detailId, quantite),
  creer: async (p: { varianteGrosId: string; nom: string; prixVente: number; quantite: number; uniteId?: string | null }): Promise<void> => {
    await creerArticleDetail(p);
  },
};

/** Caisse : article de gros à ouvrir quand le détail est en rupture. */
export const grosDisponible = grosDisponiblePourDetail;

/** Nouvel article : crée et relie l'article de détail. */
export const creerArticleDeDetail = donnees.creer;
//</adaptateur>
import ChampMontant from "./ChampMontant";
import FiltrePeriodeHistorique from "./FiltrePeriodeHistorique";
import { useDevise } from "../contexts/DeviseContext";
import { useNomsUtilisateurs } from "../hooks/useNomsUtilisateurs";
import { formaterMontant } from "../lib/formatage";
import { bornesPeriode, dansPeriode, jourLocal, type PeriodeHistorique } from "../lib/periode";

export type { GrosDisponible };

function nombre(valeur: number): string {
  return valeur.toLocaleString("fr-FR", { maximumFractionDigits: 2 });
}

function messageDe(erreur: unknown): string {
  return erreur instanceof Error ? erreur.message : "Erreur inattendue.";
}

/** « carton » → « cartons » (unités de Paramètres → Unités). */
function pluriel(unite: string): string {
  const u = unite.trim().toLowerCase();
  return /[sxz]$/.test(u) ? u : `${u}s`;
}

/** « 2 cartons », « 1 paquet » ; sans unité renseignée : « 2 unité(s) ». */
export function quantiteUnite(n: number, unite: string): string {
  const u = unite.trim().toLowerCase();
  if (!u) return `${nombre(n)} unité(s)`;
  return `${nombre(n)} ${n >= 2 ? pluriel(u) : u}`;
}

/** Bouton : « Ouvrir des cartons », « Ouvrir des sacs »… ou « Ouvrir » sans unité. */
export function libelleOuvrir(uniteGros: string): string {
  return uniteGros.trim() ? `Ouvrir des ${pluriel(uniteGros)}` : "Ouvrir";
}

// --- Formulaire « Ouvrir / Regrouper » (pré-rempli, avec coût et marge) ---

export function FormulaireDetailler({
  session,
  varianteGrosIdInitial,
  typeInitial = "detailler",
  articleFixe = false,
  depotIdInitial,
  onTermine,
}: {
  session: Session;
  varianteGrosIdInitial?: string;
  /** Dépôt imposé (ligne du stock) ; sinon celui du vendeur ou le premier. */
  depotIdInitial?: string;
  typeInitial?: TypeDetaillage;
  /** Ouvert depuis la fiche d'un article : pas de choix d'article. */
  articleFixe?: boolean;
  onTermine?: () => void;
}) {
  const devise = useDevise();
  const peutVoirCout = !!session.permissions.voir_benefices_achat;
  const [depots, setDepots] = useState<{ id: string; nom: string }[]>([]);
  const [depotId, setDepotId] = useState(depotIdInitial ?? session.depotId ?? "");
  const [articles, setArticles] = useState<ArticleDetaillable[]>([]);
  const [grosId, setGrosId] = useState(varianteGrosIdInitial ?? "");
  const [type, setType] = useState<TypeDetaillage>(typeInitial);
  const [quantite, setQuantite] = useState(1);
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
  const detailler = type === "detailler";
  const maximum = article ? (detailler ? article.stockGros : Math.floor(article.stockDetail / article.quantite)) : 0;
  const n = Math.max(0, Math.floor(quantite));

  async function confirmer() {
    if (!article || n <= 0) return;
    setEnCours(true);
    setErreur(null);
    setSucces(null);
    try {
      await donnees.operer({ varianteGrosId: article.varianteGrosId, depotId, nombre: n, type, utilisateurId: session.utilisateurId });
      const gros = quantiteUnite(n, article.uniteGros);
      const detail = quantiteUnite(n * article.quantite, article.uniteDetail);
      setSucces(detailler ? `${gros} ouvert(s) : ${detail} de plus en stock.` : `${detail} regroupé(s) en ${gros}.`);
      setQuantite(1);
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
          Aucun article ne se vend encore au détail. Reliez un carton, un sac… à son article de détail dans « 🔗 Articles à
          détailler », ou dans la fiche de l'article (rubrique « Vente au détail »).
        </span>
      </div>
    );
  }

  const coutDetail = article ? article.prixAchatGros / article.quantite : 0;
  const margeDetail = article ? article.prixVenteDetail - coutDetail : 0;

  return (
    <div className="formulaire-detailler">
      <div className="bascule-vue" role="group" aria-label="Opération">
        <button type="button" className={detailler ? "actif" : ""} onClick={() => setType("detailler")}>
          📦 {article ? libelleOuvrir(article.uniteGros) : "Ouvrir"}
        </button>
        <button type="button" className={!detailler ? "actif" : ""} onClick={() => setType("regrouper")}>
          🔁 Regrouper
        </button>
      </div>
      <div className="champs-detailler">
        {!articleFixe && (
          <label className="champ-formulaire">
            Article
            <select value={grosId} onChange={(e) => setGrosId(e.target.value)}>
              {articles.map((a) => (
                <option key={a.varianteGrosId} value={a.varianteGrosId}>
                  {a.grosNom} (1 = {quantiteUnite(a.quantite, a.uniteDetail)})
                </option>
              ))}
            </select>
          </label>
        )}
        {depots.length > 1 && (
          <label className="champ-formulaire">
            Dépôt
            <select value={depotId} onChange={(e) => setDepotId(e.target.value)}>
              {depots.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.nom}
                </option>
              ))}
            </select>
          </label>
        )}
        <label className="champ-formulaire">
          {article
            ? detailler
              ? `Combien de ${pluriel(article.uniteGros || "unité")} ouvrir ?`
              : `Combien de ${pluriel(article.uniteGros || "unité")} refaire ?`
            : "Combien ?"}
          <span className="compteur-quantite">
            <button type="button" onClick={() => setQuantite((q) => Math.max(1, q - 1))} aria-label="Moins">
              −
            </button>
            <input type="number" min={1} step={1} value={quantite} onChange={(e) => setQuantite(Number(e.target.value) || 0)} />
            <button type="button" onClick={() => setQuantite((q) => q + 1)} aria-label="Plus">
              +
            </button>
          </span>
        </label>
      </div>
      {article && (
        <div className="apercu-detailler">
          <div>
            <span className="sous-info">En stock</span>
            <strong>
              {quantiteUnite(article.stockGros, article.uniteGros)} · {quantiteUnite(article.stockDetail, article.uniteDetail)}
            </strong>
          </div>
          <div>
            <span className="sous-info">Vous obtiendrez</span>
            <strong>
              {detailler
                ? quantiteUnite(n * article.quantite, article.uniteDetail)
                : quantiteUnite(n, article.uniteGros)}
            </strong>
          </div>
          <div>
            <span className="sous-info">Possible au maximum</span>
            <strong className={maximum < n ? "texte-erreur" : undefined}>{quantiteUnite(maximum, article.uniteGros)}</strong>
          </div>
          {peutVoirCout && detailler && (
            <div>
              <span className="sous-info">Par {article.uniteDetail.toLowerCase() || "unité"}</span>
              <strong className="nowrap">
                coût {formaterMontant(Math.round(coutDetail))} · vente {formaterMontant(article.prixVenteDetail)} ·{" "}
                <span className={margeDetail < 0 ? "texte-erreur" : "montant-entree"}>
                  marge {formaterMontant(Math.round(margeDetail))} {devise}
                </span>
              </strong>
            </div>
          )}
        </div>
      )}
      {erreur && <div className="message-erreur">{erreur}</div>}
      {succes && <div className="message-succes">✓ {succes}</div>}
      <div className="actions-formulaire">
        <button type="button" className="bouton-valider" disabled={enCours || !article || n <= 0 || n > maximum} onClick={confirmer}>
          {enCours ? "…" : detailler ? `📦 ${article ? libelleOuvrir(article.uniteGros) : "Ouvrir"}` : "🔁 Regrouper"}
        </button>
      </div>
    </div>
  );
}

// --- Historique des ouvertures / regroupements ---

export function HistoriqueDetaillages({
  session,
  actualisation = 0,
  varianteId,
  onModifie,
}: {
  session: Session;
  actualisation?: number;
  /** Seulement les opérations de cet article (fenêtre « Ouvrir »). */
  varianteId?: string;
  onModifie?: () => void;
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

  const filtrees = operations.filter(
    (o) =>
      dansPeriode(o.dateCreation, bornesPeriode(periode, debutPerso, finPerso)) &&
      (!varianteId || o.varianteSourceId === varianteId || o.varianteCibleId === varianteId),
  );

  async function confirmerAnnulation() {
    if (!aAnnuler) return;
    try {
      await donnees.annuler(aAnnuler.id, session.utilisateurId);
      setAAnnuler(null);
      setErreur(null);
      rafraichir();
      onModifie?.();
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
              <tr key={o.id} className={o.annulee ? "ligne-annulee" : undefined}>
                <td data-label="Date">{new Date(o.dateCreation).toLocaleString("fr-FR")}</td>
                <td data-label="Opération">
                  {o.type === "detailler" ? "📦 Ouvert" : "🔁 Regroupé"}
                  {o.annulee && <span className="badge-annulee"> Annulé</span>}
                </td>
                <td data-label="De">
                  {nombre(o.quantiteSource)} × {o.sourceNom}
                </td>
                <td data-label="Vers">
                  {nombre(o.quantiteCible)} × {o.cibleNom}
                </td>
                <td data-label="Dépôt">{o.depotNom}</td>
                <td data-label="Fait par">{nomUtilisateur(o.utilisateurId)}</td>
                {peutGerer && (
                  <td>
                    {!o.annulee && (
                      <button type="button" className="lien" onClick={() => setAAnnuler(o)}>
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
                  {operations.length === 0 ? "Aucune opération." : "Aucune opération sur cette période."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {aAnnuler && (
        <div className="fond-modale" onClick={() => setAAnnuler(null)}>
          <div className="modale-confirmation" onClick={(e) => e.stopPropagation()}>
            <h3>Annuler cette opération ?</h3>
            <p className="note-aide">
              {`Les ${nombre(aAnnuler.quantiteCible)} « ${aAnnuler.cibleNom} » obtenus redeviennent ${nombre(aAnnuler.quantiteSource)} « ${aAnnuler.sourceNom} ». Possible seulement s'ils sont encore tous en stock.`}
            </p>
            <div className="actions-formulaire">
              <button type="button" className="lien" onClick={() => setAAnnuler(null)}>
                Retour
              </button>
              <button type="button" className="bouton-danger" onClick={confirmerAnnulation}>
                Annuler l'opération
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// --- Articles reliés (réglage fait aussi depuis le Stock) ---

function ArticlesADetailler({
  session,
  onOuvrir,
}: {
  session: Session;
  onOuvrir: (varianteGrosId: string) => void;
}) {
  const [articles, setArticles] = useState<ArticleDetaillable[]>([]);
  const [variantes, setVariantes] = useState<{ id: string; nom: string }[]>([]);
  const [enEdition, setEnEdition] = useState<{ id: string; nom: string } | null>(null);
  const [choix, setChoix] = useState("");

  async function rafraichir() {
    setArticles(await donnees.articles(session.boutiqueId));
  }
  useEffect(() => {
    rafraichir();
    donnees.variantes(session.boutiqueId).then(setVariantes);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.boutiqueId]);

  if (enEdition) {
    return (
      <>
        <div className="barre-actions">
          <button type="button" className="lien" onClick={() => setEnEdition(null)}>
            ← Retour à la liste
          </button>
          <strong>{enEdition.nom}</strong>
        </div>
        <PanneauVenteAuDetail
          session={session}
          varianteId={enEdition.id}
          nomArticle={enEdition.nom}
          onModifie={rafraichir}
        />
      </>
    );
  }

  const dejaRelies = new Set(articles.map((a) => a.varianteGrosId));
  return (
    <>
      <div className="barre-actions">
        <select value={choix} onChange={(e) => setChoix(e.target.value)}>
          <option value="">Relier un autre article (carton, sac…)</option>
          {variantes
            .filter((v) => !dejaRelies.has(v.id))
            .map((v) => (
              <option key={v.id} value={v.id}>
                {v.nom}
              </option>
            ))}
        </select>
        <button
          type="button"
          className="bouton-primaire"
          disabled={!choix}
          onClick={() => {
            const v = variantes.find((x) => x.id === choix);
            if (v) setEnEdition(v);
            setChoix("");
          }}
        >
          🔗 Relier
        </button>
      </div>
      <div className="zone-tableau-scroll zone-commandes-fiche">
        <table className="tableau-catalogue carte-mobile">
          <thead>
            <tr>
              <th>Article de gros</th>
              <th>Contient</th>
              <th>Article de détail</th>
              <th>En stock</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {articles.map((a) => (
              <tr key={a.varianteGrosId}>
                <td data-label="Article de gros">
                  {a.grosNom}
                  {a.uniteGros && <span className="sous-info"> · {a.uniteGros.toLowerCase()}</span>}
                </td>
                <td data-label="Contient">{quantiteUnite(a.quantite, a.uniteDetail)}</td>
                <td data-label="Article de détail">{a.detailNom}</td>
                <td data-label="En stock">
                  {quantiteUnite(a.stockGros, a.uniteGros)} · {quantiteUnite(a.stockDetail, a.uniteDetail)}
                </td>
                <td>
                  <span className="actions-ligne">
                    <button type="button" className="bouton-primaire" onClick={() => onOuvrir(a.varianteGrosId)}>
                      📦 {libelleOuvrir(a.uniteGros)}
                    </button>
                    <button type="button" className="lien" onClick={() => setEnEdition({ id: a.varianteGrosId, nom: a.grosNom })}>
                      ✎ Modifier
                    </button>
                  </span>
                </td>
              </tr>
            ))}
            {articles.length === 0 && (
              <tr>
                <td colSpan={5} className="liste-vide">
                  Aucun article relié. Choisissez un carton, un sac… ci-dessus et indiquez ce qu'il contient.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}

// --- Carte Stock « Détailler / Regrouper » ---

export function ModaleDetaillerRegrouper({ session, onFermer }: { session: Session; onFermer: () => void }) {
  const [page, setPage] = useState<"operer" | "articles" | "historique">("operer");
  const [actualisation, setActualisation] = useState(0);
  const [grosChoisi, setGrosChoisi] = useState<string | undefined>(undefined);
  return (
    <div className="fond-modale" onClick={onFermer}>
      <div className="modale-selection-produits" onClick={(e) => e.stopPropagation()}>
        <div className="modale-entete">
          <h3>Détailler / Regrouper</h3>
          <button type="button" className="lien bouton-retour" onClick={onFermer}>
            ← Retour
          </button>
        </div>
        <div className="modale-avec-menu">
          <nav className="menu-modale">
            <button type="button" className={page === "operer" ? "actif" : ""} onClick={() => setPage("operer")}>
              <span className="icone-menu-modale">📦</span>
              Ouvrir / regrouper
            </button>
            <button type="button" className={page === "articles" ? "actif" : ""} onClick={() => setPage("articles")}>
              <span className="icone-menu-modale">🔗</span>
              Articles à détailler
            </button>
            <button type="button" className={page === "historique" ? "actif" : ""} onClick={() => setPage("historique")}>
              <span className="icone-menu-modale">🕘</span>
              Historique
            </button>
          </nav>
          <div className="modale-corps">
            {page === "operer" && (
              <>
                <p className="note-aide">
                  <strong>Ouvrir</strong> un carton, un sac… pour le vendre au détail (1 carton → 24 paquets).{" "}
                  <strong>Regrouper</strong> : l'inverse, pour refaire des cartons complets. Le coût suit, la marge reste juste.
                </p>
                <FormulaireDetailler
                  key={grosChoisi ?? "tous"}
                  session={session}
                  varianteGrosIdInitial={grosChoisi}
                  onTermine={() => setActualisation((a) => a + 1)}
                />
              </>
            )}
            {page === "articles" && (
              <ArticlesADetailler
                session={session}
                onOuvrir={(id) => {
                  setGrosChoisi(id);
                  setPage("operer");
                }}
              />
            )}
            {page === "historique" && <HistoriqueDetaillages session={session} actualisation={actualisation} />}
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
  const [uniteDetailId, setUniteDetailId] = useState("");
  const [nom, setNom] = useState("");
  const [nomModifie, setNomModifie] = useState(false);
  const [prixVente, setPrixVente] = useState("");
  const [existantId, setExistantId] = useState("");
  const [variantes, setVariantes] = useState<{ id: string; nom: string }[]>([]);
  const [unites, setUnites] = useState<{ id: string; nom: string }[]>([]);
  const [erreur, setErreur] = useState<string | null>(null);
  const [operation, setOperation] = useState<TypeDetaillage | null>(null);

  async function rafraichir() {
    setInfo(await donnees.infoDetail(varianteId));
  }
  useEffect(() => {
    rafraichir();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [varianteId]);

  const uniteArticle = info?.uniteArticle ?? "";
  const nomUniteDetail = unites.find((u) => u.id === uniteDetailId)?.nom ?? "";

  function nomPropose(uniteNom: string): string {
    return `${nomArticle} — ${uniteNom ? uniteNom.toLowerCase() : "détail"}`;
  }

  function ouvrirEdition() {
    setEdition(true);
    setErreur(null);
    setQuantite(info?.detail ? String(info.detail.quantite) : "");
    setUniteDetailId("");
    setNom(nomPropose(""));
    setNomModifie(false);
    setPrixVente("");
    setExistantId(info?.detail?.varianteId ?? "");
    setMode(info?.detail ? "existant" : "creer");
    donnees.variantes(session.boutiqueId).then((liste) => setVariantes(liste.filter((v) => v.id !== varianteId)));
    donnees.unites(session.boutiqueId).then(setUnites);
  }

  function changerUniteDetail(id: string) {
    setUniteDetailId(id);
    if (!nomModifie) setNom(nomPropose(unites.find((u) => u.id === id)?.nom ?? ""));
  }

  async function enregistrer() {
    setErreur(null);
    const q = Number(quantite) || 0;
    try {
      if (mode === "creer") {
        if (!nom.trim()) throw new Error("Donnez un nom à l'article de détail.");
        await donnees.creer({
          varianteGrosId: varianteId,
          nom,
          prixVente: Number(prixVente) || 0,
          quantite: q,
          uniteId: uniteDetailId || null,
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
  const unGros = uniteArticle ? `1 ${uniteArticle.toLowerCase()}` : `1 ${nomArticle}`;

  return (
    <div className="panneau-vente-detail">
      {info.gros && (
        <div className="bloc-hors-ligne">
          <span>
            📦 Cet article est le <strong>détail</strong> de « {info.gros.nom} » :{" "}
            {info.gros.unite ? `1 ${info.gros.unite.toLowerCase()}` : "1"} = {quantiteUnite(info.gros.quantite, uniteArticle)}.
          </span>
        </div>
      )}

      {info.detail && !edition && (
        <div className="carte-lien-detail">
          <div className="formule-lien-detail">
            <strong>{unGros}</strong>
            <span>=</span>
            <strong>{quantiteUnite(info.detail.quantite, info.detail.unite)}</strong>
            <span className="sous-info">({info.detail.nom})</span>
          </div>
          {peutGerer && (
            <div className="actions-ligne">
              <button type="button" className="bouton-primaire" onClick={() => setOperation("detailler")}>
                📦 {libelleOuvrir(uniteArticle)}
              </button>
              <button type="button" onClick={() => setOperation("regrouper")}>
                🔁 Regrouper
              </button>
              <button type="button" className="lien" onClick={ouvrirEdition}>
                ✎ Modifier le lien
              </button>
              <button type="button" className="lien lien-danger" onClick={retirerLien}>
                Retirer le lien
              </button>
            </div>
          )}
        </div>
      )}

      {!info.detail && !edition && (
        <div className="carte-lien-detail">
          <p className="note-aide">
            Cet article ne se vend pas au détail. Si c'est un carton, un sac, un fardeau… que vous ouvrez pour vendre à
            l'unité, indiquez ce qu'il contient.
          </p>
          {peutGerer && (
            <button type="button" className="bouton-primaire" onClick={ouvrirEdition}>
              ✂️ Vendre aussi au détail
            </button>
          )}
        </div>
      )}

      {edition && (
        <div className="carte-lien-detail">
          <div className="champs-detailler">
            <label className="champ-formulaire">
              {unGros} contient
              <input type="number" min={2} step={1} placeholder="ex. 24" value={quantite} onChange={(e) => setQuantite(e.target.value)} />
            </label>
            {mode === "creer" && (
              <label className="champ-formulaire">
                Unité du détail
                <select value={uniteDetailId} onChange={(e) => changerUniteDetail(e.target.value)}>
                  <option value="">(aucune)</option>
                  {unites.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.nom}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>
          <div className="bascule-vue" role="group" aria-label="Article de détail">
            <button type="button" className={mode === "creer" ? "actif" : ""} onClick={() => setMode("creer")}>
              Créer l'article de détail
            </button>
            <button type="button" className={mode === "existant" ? "actif" : ""} onClick={() => setMode("existant")}>
              Choisir un article existant
            </button>
          </div>
          {mode === "creer" ? (
            <div className="champs-detailler">
              <label className="champ-formulaire">
                Nom de l'article de détail
                <input
                  value={nom}
                  onChange={(e) => {
                    setNom(e.target.value);
                    setNomModifie(true);
                  }}
                />
              </label>
              <label className="champ-formulaire">
                Prix de vente {nomUniteDetail ? `d'un ${nomUniteDetail.toLowerCase()}` : "au détail"} ({devise})
                <ChampMontant value={prixVente} onChange={setPrixVente} placeholder="ex. 600" />
              </label>
            </div>
          ) : (
            <label className="champ-formulaire">
              Article de détail
              <select value={existantId} onChange={(e) => setExistantId(e.target.value)}>
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
            <button type="button" className="lien" onClick={() => setEdition(false)}>
              Annuler
            </button>
            <button type="button" className="bouton-valider" onClick={enregistrer}>
              Enregistrer
            </button>
          </div>
        </div>
      )}

      {erreur && !edition && <div className="message-erreur">{erreur}</div>}

      {operation && (
        <ModaleOuvrir
          session={session}
          varianteGrosId={varianteId}
          typeInitial={operation}
          onFermer={() => setOperation(null)}
          onTermine={() => onModifie?.()}
        />
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
  const uniteGros = gros.uniteGros.trim().toLowerCase() || "unité";

  async function ouvrir() {
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
          Il reste {quantiteUnite(gros.stockGros, gros.uniteGros)} de « {gros.grosNom} ». Ouvrir 1 {uniteGros} donne{" "}
          {quantiteUnite(gros.quantite, gros.uniteDetail)}, puis l'article est ajouté à la vente. L'opération est enregistrée à
          votre nom.
        </p>
        {erreur && <div className="message-erreur">{erreur}</div>}
        <div className="actions-formulaire">
          <button type="button" className="lien" onClick={onAnnuler}>
            Annuler
          </button>
          <button type="button" className="bouton-valider" disabled={enCours} onClick={ouvrir}>
            {enCours ? "…" : `📦 Ouvrir 1 ${uniteGros} et vendre`}
          </button>
        </div>
      </div>
    </div>
  );
}



// --- Fenêtre « Ouvrir » : barre latérale Ouvrir / Regrouper / Historique ---

export function ModaleOuvrir({
  session,
  varianteGrosId,
  depotId: depotIdImpose,
  typeInitial = "detailler",
  onFermer,
  onTermine,
}: {
  session: Session;
  varianteGrosId: string;
  /** Dépôt de la ligne du stock ; sinon celui du vendeur (ou choix si plusieurs). */
  depotId?: string;
  typeInitial?: TypeDetaillage;
  onFermer: () => void;
  onTermine?: () => void;
}) {
  const devise = useDevise();
  const peutVoirCout = !!session.permissions.voir_benefices_achat;
  const peutModifierPrix = !!session.permissions.modifier_prix;
  const [depots, setDepots] = useState<{ id: string; nom: string }[]>([]);
  const [depotId, setDepotId] = useState(depotIdImpose ?? session.depotId ?? "");
  const [article, setArticle] = useState<ArticleDetaillable | null>(null);
  const [page, setPage] = useState<"operer" | "historique">("operer");
  const [type, setType] = useState<TypeDetaillage>(typeInitial);
  const [quantite, setQuantite] = useState(1);
  const [prix, setPrix] = useState("");
  const [nombreOperations, setNombreOperations] = useState(0);
  const [actualisation, setActualisation] = useState(0);
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

  async function charger(garderPrix = false) {
    if (!depotId) return;
    const a = (await donnees.articles(session.boutiqueId, depotId)).find((x) => x.varianteGrosId === varianteGrosId) ?? null;
    setArticle(a);
    if (a && !garderPrix) setPrix(String(a.prixVenteDetail));
  }
  useEffect(() => {
    charger();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [depotId, varianteGrosId]);

  useEffect(() => {
    donnees
      .historique(session.boutiqueId)
      .then((liste) =>
        setNombreOperations(
          liste.filter((o) => o.varianteSourceId === varianteGrosId || o.varianteCibleId === varianteGrosId).length,
        ),
      );
  }, [session.boutiqueId, varianteGrosId, actualisation]);

  function choisir(nouveauType: TypeDetaillage) {
    setType(nouveauType);
    setPage("operer");
    setQuantite(1);
    setErreur(null);
    setSucces(null);
  }

  const detailler = type === "detailler";
  const n = Math.max(0, Math.floor(quantite));
  const maximum = article ? (detailler ? article.stockGros : Math.floor(article.stockDetail / article.quantite)) : 0;
  const obtenus = article ? n * article.quantite : 0;
  const coutDetail = article ? article.prixAchatGros / article.quantite : 0;
  const prixNombre = Number(prix) || 0;
  const marge = prixNombre - coutDetail;
  const taux = prixNombre > 0 ? Math.round((marge / prixNombre) * 100) : 0;
  const prixModifie = !!article && prixNombre !== article.prixVenteDetail;
  const sousLeCout = detailler && prixNombre < Math.round(coutDetail);
  const faisable = n > 0 && n <= maximum;
  const depotNom = depots.find((d) => d.id === depotId)?.nom ?? "";
  const uniteGros = article?.uniteGros ?? "";
  const uniteDetail = article?.uniteDetail ?? "";
  const unDetail = uniteDetail.toLowerCase() || "unité";

  async function confirmer() {
    if (!article || n <= 0 || n > maximum) return;
    setEnCours(true);
    setErreur(null);
    setSucces(null);
    try {
      if (detailler && prixModifie) {
        if (sousLeCout) {
          throw new Error(`Le prix de vente ne peut pas être inférieur au coût (${formaterMontant(Math.round(coutDetail))} ${devise}).`);
        }
        await donnees.prixVente(article.varianteDetailId, prixNombre);
      }
      await donnees.operer({ varianteGrosId, depotId, nombre: n, type, utilisateurId: session.utilisateurId });
      setSucces(
        detailler
          ? `${quantiteUnite(n, uniteGros)} ouvert(s) : ${quantiteUnite(obtenus, uniteDetail)} de plus en stock${prixModifie ? `, au prix de ${formaterMontant(prixNombre)} ${devise}` : ""}.`
          : `${quantiteUnite(obtenus, uniteDetail)} regroupé(e)s en ${quantiteUnite(n, uniteGros)}.`,
      );
      setQuantite(1);
      await charger(true);
      setActualisation((a) => a + 1);
      onTermine?.();
    } catch (e) {
      setErreur(messageDe(e));
    } finally {
      setEnCours(false);
    }
  }

  return (
    <div className="fond-modale" onClick={onFermer}>
      <div className="modale-selection-produits" onClick={(e) => e.stopPropagation()}>
        <div className="modale-entete">
          <h3>
            📦 {article?.grosNom ?? "Ouvrir"}
            {article && (
              <span className="sous-titre-entete">
                {" "}
                · 1 {uniteGros.toLowerCase() || "unité"} = {quantiteUnite(article.quantite, uniteDetail)}
                {depotNom && ` · ${depotNom}`}
              </span>
            )}
          </h3>
          <button type="button" className="lien bouton-retour" onClick={onFermer}>
            ← Retour
          </button>
        </div>
        <div className="modale-avec-menu">
          <nav className="menu-modale">
            <button type="button" className={page === "operer" && detailler ? "actif" : ""} onClick={() => choisir("detailler")}>
              <span className="icone-menu-modale">📦</span>
              Ouvrir
            </button>
            <button type="button" className={page === "operer" && !detailler ? "actif" : ""} onClick={() => choisir("regrouper")}>
              <span className="icone-menu-modale">🔁</span>
              Regrouper
            </button>
            <button type="button" className={page === "historique" ? "actif" : ""} onClick={() => setPage("historique")}>
              <span className="icone-menu-modale">🕘</span>
              Historique
              <span className="compteur-menu-modale">{nombreOperations}</span>
            </button>
          </nav>
          <div className="modale-corps">
            {page === "historique" ? (
              <HistoriqueDetaillages
                session={session}
                actualisation={actualisation}
                varianteId={varianteGrosId}
                onModifie={() => {
                  setActualisation((a) => a + 1);
                  charger(true);
                  onTermine?.();
                }}
              />
            ) : (
              <div className="page-ouvrir">
                {!depotIdImpose && depots.length > 1 && (
                  <label className="champ-formulaire champ-depot-ouvrir">
                    Dépôt
                    <select value={depotId} onChange={(e) => setDepotId(e.target.value)}>
                      {depots.map((d) => (
                        <option key={d.id} value={d.id}>
                          {d.nom}
                        </option>
                      ))}
                    </select>
                  </label>
                )}

                {!article ? (
                  <p className="note-aide">Chargement…</p>
                ) : (
                  <>
                    <div className="flux-ouvrir">
                      <div className="carte-flux">
                        <span className="sous-info">{detailler ? article.grosNom : article.detailNom}</span>
                        <strong>
                          {nombre(detailler ? article.stockGros : article.stockDetail)} <span className="fleche-flux">→</span>{" "}
                          <span className="texte-erreur">
                            {faisable ? nombre(detailler ? article.stockGros - n : article.stockDetail - obtenus) : "—"}
                          </span>
                        </strong>
                        <span className="sous-info">{pluriel((detailler ? uniteGros : uniteDetail) || "unité")}</span>
                      </div>
                      <div className="operation-flux">
                        <span>→</span>
                        <span className="sous-info">{detailler ? `× ${nombre(article.quantite)}` : `÷ ${nombre(article.quantite)}`}</span>
                      </div>
                      <div className="carte-flux">
                        <span className="sous-info">{detailler ? article.detailNom : article.grosNom}</span>
                        <strong>
                          {nombre(detailler ? article.stockDetail : article.stockGros)} <span className="fleche-flux">→</span>{" "}
                          <span className="montant-entree">
                            {faisable ? nombre(detailler ? article.stockDetail + obtenus : article.stockGros + n) : "—"}
                          </span>
                        </strong>
                        <span className="sous-info">{pluriel((detailler ? uniteDetail : uniteGros) || "unité")}</span>
                      </div>
                    </div>

                    <div className="ligne-quantite-ouvrir">
                      <span className="libelle-quantite-ouvrir">
                        {detailler
                          ? `Combien de ${pluriel(uniteGros || "unité")} ouvrir ?`
                          : `Combien de ${pluriel(uniteGros || "unité")} refaire ?`}
                      </span>
                      <span className="compteur-quantite">
                        <button type="button" onClick={() => setQuantite((q) => Math.max(1, q - 1))} aria-label="Moins">
                          −
                        </button>
                        <input type="number" min={1} step={1} value={quantite} onChange={(e) => setQuantite(Number(e.target.value) || 0)} />
                        <button type="button" onClick={() => setQuantite((q) => q + 1)} aria-label="Plus">
                          +
                        </button>
                      </span>
                      <span className="raccourcis-quantite">
                        {[1, 2, 5].map((v) => (
                          <button key={v} type="button" className={n === v ? "actif" : ""} disabled={v > maximum} onClick={() => setQuantite(v)}>
                            {v}
                          </button>
                        ))}
                        <button
                          type="button"
                          className={n === maximum && maximum > 0 ? "actif" : ""}
                          disabled={maximum <= 0}
                          onClick={() => setQuantite(maximum)}
                        >
                          Tout ({nombre(maximum)})
                        </button>
                      </span>
                    </div>
                    {n > maximum && (
                      <div className="message-erreur">
                        {maximum > 0
                          ? `Pas assez en stock : ${quantiteUnite(maximum, uniteGros)} au maximum.`
                          : detailler
                            ? `Plus aucun(e) ${(uniteGros || "unité").toLowerCase()} à ouvrir dans ce dépôt.`
                            : `Pas assez de ${pluriel(unDetail)} pour refaire un(e) ${(uniteGros || "unité").toLowerCase()} (il en faut ${nombre(article.quantite)}).`}
                      </div>
                    )}

                    {detailler && (
                      <div className="bloc-prix-ouvrir">
                        <label className="champ-formulaire">
                          Prix de vente par {unDetail} ({devise})
                          <ChampMontant
                            className={sousLeCout ? "champ-invalide" : undefined}
                            value={prix}
                            disabled={!peutModifierPrix}
                            title={peutModifierPrix ? undefined : "Votre rôle ne permet pas de modifier les prix."}
                            onChange={setPrix}
                          />
                        </label>
                        {peutVoirCout && (
                          <div className="marge-ouvrir">
                            <span>
                              Coût : <strong>{formaterMontant(Math.round(coutDetail))}</strong>
                            </span>
                            <span className={marge < 0 ? "texte-erreur" : "montant-entree"}>
                              Marge : <strong>
                                {formaterMontant(Math.round(marge))} {devise}
                              </strong>{" "}
                              ({taux} %)
                            </span>
                            <span>
                              Sur ce lot : <strong>
                                {formaterMontant(Math.round(marge * obtenus))} {devise}
                              </strong>
                            </span>
                          </div>
                        )}
                        {prixModifie && (
                          <span className="note-aide">
                            Ancien prix {formaterMontant(article.prixVenteDetail)} {devise} : le nouveau prix sera enregistré à
                            la confirmation.
                          </span>
                        )}
                      </div>
                    )}
                  </>
                )}

                {erreur && <div className="message-erreur">{erreur}</div>}
                {succes && <div className="message-succes">✓ {succes}</div>}

                <div className="actions-formulaire actions-ouvrir">
                  <button
                    type="button"
                    className="bouton-valider bouton-ouvrir-confirmer"
                    disabled={enCours || !article || n <= 0 || n > maximum || sousLeCout}
                    onClick={confirmer}
                  >
                    {enCours
                      ? "…"
                      : !article
                        ? "Ouvrir"
                        : detailler
                          ? `📦 Ouvrir ${quantiteUnite(n, uniteGros)} → ${quantiteUnite(obtenus, uniteDetail)}`
                          : `🔁 Regrouper ${quantiteUnite(obtenus, uniteDetail)} → ${quantiteUnite(n, uniteGros)}`}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
