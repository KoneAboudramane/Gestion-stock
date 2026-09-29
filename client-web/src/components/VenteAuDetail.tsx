import { useEffect, useState } from "react";

//<adaptateur>
import type { Session } from "../api";
import type { ColonneExport } from "../lib/export";
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

/** Caisse : article de gros à déballer quand le détail est en rupture. */
export const grosDisponible = grosDisponiblePourDetail;

/** Nouvel article : crée et relie l'article de détail. */
export const creerArticleDeDetail = donnees.creer;
//</adaptateur>
import BoutonsExport from "./BoutonsExport";
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

/** Bouton : « Déballer des cartons », « Déballer des sacs »… ou « Déballer » sans unité. */
export function libelleOuvrir(uniteGros: string): string {
  return uniteGros.trim() ? `Déballer des ${pluriel(uniteGros)}` : "Déballer";
}

// --- Contenu commun « Déballer / Remballer » (fenêtre de l'article et carte Déballage / Remballage) ---

export function ContenuDeballage({
  session,
  varianteGrosIdInitial,
  depotIdImpose,
  typeInitial = "detailler",
  choixArticle = false,
  onTermine,
  onArticle,
}: {
  session: Session;
  varianteGrosIdInitial?: string;
  /** Dépôt de la ligne du stock ; sinon celui du vendeur (ou choix si plusieurs). */
  depotIdImpose?: string;
  typeInitial?: TypeDetaillage;
  /** Carte Déballage / Remballage : liste « Article » et bascule Déballer / Remballer. */
  choixArticle?: boolean;
  onTermine?: () => void;
  /** Article affiché (pour le titre de la fenêtre). */
  onArticle?: (article: ArticleDetaillable | null, depotNom: string) => void;
}) {
  const devise = useDevise();
  const peutVoirCout = !!session.permissions.voir_benefices_achat;
  const peutModifierPrix = !!session.permissions.modifier_prix;
  const [depots, setDepots] = useState<{ id: string; nom: string }[]>([]);
  const [depotId, setDepotId] = useState(depotIdImpose ?? session.depotId ?? "");
  const [articles, setArticles] = useState<ArticleDetaillable[] | null>(null);
  const [grosId, setGrosId] = useState(varianteGrosIdInitial ?? "");
  const [type, setType] = useState<TypeDetaillage>(typeInitial);
  const [quantite, setQuantite] = useState(1);
  const [prix, setPrix] = useState("");
  const [erreur, setErreur] = useState<string | null>(null);
  const [succes, setSucces] = useState<string | null>(null);
  const [enCours, setEnCours] = useState(false);

  useEffect(() => setType(typeInitial), [typeInitial]);

  useEffect(() => {
    donnees.depots(session.boutiqueId).then((liste) => {
      setDepots(liste);
      if (!depotId && liste[0]) setDepotId(liste[0].id);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.boutiqueId]);

  async function charger() {
    if (!depotId) return;
    const liste = await donnees.articles(session.boutiqueId, depotId);
    setArticles(liste);
    if (!liste.some((a) => a.varianteGrosId === grosId) && liste[0] && choixArticle) setGrosId(liste[0].varianteGrosId);
  }
  useEffect(() => {
    charger();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [depotId]);

  const article = articles?.find((a) => a.varianteGrosId === grosId) ?? null;
  const depotNom = depots.find((d) => d.id === depotId)?.nom ?? "";

  // Prix proposé = prix actuel de l'article de détail, à chaque changement d'article.
  useEffect(() => {
    if (article) setPrix(String(article.prixVenteDetail));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [article?.varianteGrosId]);

  useEffect(() => {
    onArticle?.(article, depotNom);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [article?.varianteGrosId, article?.stockGros, article?.stockDetail, depotNom]);

  function changerType(nouveau: TypeDetaillage) {
    setType(nouveau);
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
  const uniteGros = article?.uniteGros ?? "";
  const uniteDetail = article?.uniteDetail ?? "";
  const unDetail = uniteDetail.toLowerCase() || "unité";

  async function confirmer() {
    if (!article || !faisable) return;
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
      await donnees.operer({ varianteGrosId: article.varianteGrosId, depotId, nombre: n, type, utilisateurId: session.utilisateurId });
      setSucces(
        detailler
          ? `${quantiteUnite(n, uniteGros)} déballé(s) : ${quantiteUnite(obtenus, uniteDetail)} de plus en stock${prixModifie ? `, au prix de ${formaterMontant(prixNombre)} ${devise}` : ""}.`
          : `${quantiteUnite(obtenus, uniteDetail)} remballé(e)s en ${quantiteUnite(n, uniteGros)}.`,
      );
      setQuantite(1);
      await charger();
      onTermine?.();
    } catch (e) {
      setErreur(messageDe(e));
    } finally {
      setEnCours(false);
    }
  }

  if (choixArticle && articles && articles.length === 0) {
    return (
      <div className="bloc-hors-ligne">
        <span>
          Aucun article ne se vend encore au détail dans ce dépôt. Reliez un carton, un sac… à son article de détail dans
          « 🔗 Articles à déballer », ou dans la fiche de l'article (rubrique « Vente au détail »).
        </span>
      </div>
    );
  }

  return (
    <div className="page-ouvrir">
      {(choixArticle || (!depotIdImpose && depots.length > 1)) && (
        <div className="choix-deballage">
          {choixArticle && (
            <div className="bascule-vue" role="group" aria-label="Opération">
              <button type="button" className={detailler ? "actif" : ""} onClick={() => changerType("detailler")}>
                📦 Déballer
              </button>
              <button type="button" className={!detailler ? "actif" : ""} onClick={() => changerType("regrouper")}>
                🔁 Remballer
              </button>
            </div>
          )}
          {choixArticle && articles && (
            <label className="champ-formulaire">
              Article
              <select
                value={grosId}
                onChange={(e) => {
                  setGrosId(e.target.value);
                  setQuantite(1);
                  setErreur(null);
                  setSucces(null);
                }}
              >
                {articles.map((a) => (
                  <option key={a.varianteGrosId} value={a.varianteGrosId}>
                    {a.grosNom} (1 = {quantiteUnite(a.quantite, a.uniteDetail)})
                  </option>
                ))}
              </select>
            </label>
          )}
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
        </div>
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
                ? `Combien de ${pluriel(uniteGros || "unité")} déballer ?`
                : `Combien de ${pluriel(uniteGros || "unité")} remballer ?`}
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
                  ? `Plus aucun(e) ${(uniteGros || "unité").toLowerCase()} à déballer dans ce dépôt.`
                  : `Pas assez de ${pluriel(unDetail)} pour remballer un(e) ${(uniteGros || "unité").toLowerCase()} (il en faut ${nombre(article.quantite)}).`}
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
                  Ancien prix {formaterMontant(article.prixVenteDetail)} {devise} : le nouveau prix sera enregistré à la
                  confirmation.
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
          disabled={enCours || !article || !faisable || sousLeCout}
          onClick={confirmer}
        >
          {enCours
            ? "…"
            : !article
              ? "Déballer"
              : detailler
                ? `📦 Déballer ${quantiteUnite(n, uniteGros)} → ${quantiteUnite(obtenus, uniteDetail)}`
                : `🔁 Remballer ${quantiteUnite(obtenus, uniteDetail)} → ${quantiteUnite(n, uniteGros)}`}
        </button>
      </div>
    </div>
  );
}

// --- Historique des déballages / remballages ---

export function HistoriqueDetaillages({
  session,
  actualisation = 0,
  varianteId,
  onModifie,
}: {
  session: Session;
  actualisation?: number;
  /** Seulement les opérations de cet article (fenêtre de l'article). */
  varianteId?: string;
  onModifie?: () => void;
}) {
  const devise = useDevise();
  const nomUtilisateur = useNomsUtilisateurs(session);
  const peutGerer = !!session.permissions.gerer_produits_stock_achats;
  const peutVoirCout = !!session.permissions.voir_benefices_achat;
  const [operations, setOperations] = useState<DetaillageResume[]>([]);
  const [periode, setPeriode] = useState<PeriodeHistorique>("30j");
  const [debutPerso, setDebutPerso] = useState(jourLocal(new Date()));
  const [finPerso, setFinPerso] = useState(jourLocal(new Date()));
  const [type, setType] = useState<"" | TypeDetaillage>("");
  const [terme, setTerme] = useState("");
  const [depotId, setDepotId] = useState("");
  const [avecAnnulees, setAvecAnnulees] = useState(false);
  const [aAnnuler, setAAnnuler] = useState<DetaillageResume | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);

  async function rafraichir() {
    setOperations(await donnees.historique(session.boutiqueId));
  }
  useEffect(() => {
    rafraichir();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.boutiqueId, actualisation]);

  const depots = [...new Map(operations.map((o) => [o.depotId, o.depotNom])).entries()];
  const cle = terme.trim().toLowerCase();
  // Tout sauf le filtre « annulées » : les tuiles comptent aussi les annulées.
  const dansLesFiltres = operations.filter(
    (o) =>
      dansPeriode(o.dateCreation, bornesPeriode(periode, debutPerso, finPerso)) &&
      (!varianteId || o.varianteSourceId === varianteId || o.varianteCibleId === varianteId) &&
      (!type || o.type === type) &&
      (!depotId || o.depotId === depotId) &&
      (!cle || o.sourceNom.toLowerCase().includes(cle) || o.cibleNom.toLowerCase().includes(cle)),
  );
  const filtrees = dansLesFiltres.filter((o) => avecAnnulees || !o.annulee);
  const valides = dansLesFiltres.filter((o) => !o.annulee);
  const deballages = valides.filter((o) => o.type === "detailler");
  const remballages = valides.filter((o) => o.type === "regrouper");
  const annulees = dansLesFiltres.length - valides.length;
  const uniteObtenue = deballages[0]?.uniteCible ?? "";
  const memeUnite = deballages.every((o) => o.uniteCible === uniteObtenue);
  const obtenus = deballages.reduce((t, o) => t + o.quantiteCible, 0);
  const valeurDeballee = deballages.reduce((t, o) => t + o.quantiteCible * o.coutUnitaireCible, 0);

  const colonnesExport: ColonneExport[] = [
    { cle: "date", libelle: "Date" },
    { cle: "operation", libelle: "Opération" },
    { cle: "article", libelle: "Article" },
    { cle: "de", libelle: "De" },
    { cle: "vers", libelle: "Vers" },
    { cle: "depot", libelle: "Dépôt" },
    { cle: "par", libelle: "Fait par" },
    { cle: "etat", libelle: "État" },
  ];
  const lignesExport = filtrees.map((o) => ({
    date: new Date(o.dateCreation).toLocaleString("fr-FR"),
    operation: o.type === "detailler" ? "Déballé" : "Remballé",
    article: o.type === "detailler" ? o.sourceNom : o.cibleNom,
    de: `${quantiteUnite(o.quantiteSource, o.uniteSource)} (${o.sourceNom})`,
    vers: `${quantiteUnite(o.quantiteCible, o.uniteCible)} (${o.cibleNom})`,
    depot: o.depotNom,
    par: nomUtilisateur(o.utilisateurId),
    etat: o.annulee ? `Annulé${o.dateAnnulation ? ` le ${new Date(o.dateAnnulation).toLocaleString("fr-FR")}` : ""}` : "",
  }));

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

  const colonnes = 7 + (peutGerer ? 1 : 0);
  return (
    <>
      <div className="tuiles-fiche">
        <div className="tuile-fiche">
          <span className="sous-info">📦 Déballages</span>
          <strong>{deballages.length}</strong>
        </div>
        <div className="tuile-fiche">
          <span className="sous-info">🔁 Remballages</span>
          <strong>{remballages.length}</strong>
        </div>
        <div className="tuile-fiche">
          <span className="sous-info">🧩 Obtenus au détail</span>
          <strong className="nowrap">{memeUnite ? quantiteUnite(obtenus, uniteObtenue) : nombre(obtenus)}</strong>
        </div>
        {peutVoirCout ? (
          <div className="tuile-fiche">
            <span className="sous-info">💰 Valeur déballée (coût)</span>
            <strong className="nowrap">
              {formaterMontant(Math.round(valeurDeballee))} {devise}
            </strong>
          </div>
        ) : (
          <div className={`tuile-fiche${annulees > 0 ? " tuile-fiche--attention" : ""}`}>
            <span className="sous-info">↩️ Annulées</span>
            <strong>{annulees}</strong>
          </div>
        )}
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
        <div className="bascule-vue" role="group" aria-label="Type">
          <button type="button" className={type === "" ? "actif" : ""} onClick={() => setType("")}>
            Tous
          </button>
          <button type="button" className={type === "detailler" ? "actif" : ""} onClick={() => setType("detailler")}>
            📦 Déballés
          </button>
          <button type="button" className={type === "regrouper" ? "actif" : ""} onClick={() => setType("regrouper")}>
            🔁 Remballés
          </button>
        </div>
        {!varianteId && (
          <input type="search" placeholder="Article…" value={terme} onChange={(e) => setTerme(e.target.value)} />
        )}
        {depots.length > 1 && (
          <select value={depotId} onChange={(e) => setDepotId(e.target.value)}>
            <option value="">Tous les dépôts</option>
            {depots.map(([id, nom]) => (
              <option key={id} value={id}>
                {nom}
              </option>
            ))}
          </select>
        )}
        <label className="case-annulees">
          <input type="checkbox" checked={avecAnnulees} onChange={(e) => setAvecAnnulees(e.target.checked)} />
          Afficher les annulées{annulees > 0 ? ` (${annulees})` : ""}
        </label>
        <BoutonsExport titre="Historique des déballages" colonnes={colonnesExport} lignes={lignesExport} compact />
      </div>
      {erreur && <div className="message-erreur">{erreur}</div>}

      <div className="zone-tableau-scroll zone-commandes-fiche">
        <table className="tableau-catalogue carte-mobile">
          <thead>
            <tr>
              <th>N°</th>
              <th>Date</th>
              <th>Opération</th>
              <th>Article</th>
              <th>Quantités</th>
              <th>Dépôt</th>
              <th>Fait par</th>
              {peutGerer && <th />}
            </tr>
          </thead>
          <tbody>
            {filtrees.map((o, index) => {
              const date = new Date(o.dateCreation);
              return (
                <tr key={o.id} className={o.annulee ? "ligne-annulee" : undefined}>
                  <td data-label="N°">{index + 1}</td>
                  <td data-label="Date" className="nowrap" title={date.toLocaleString("fr-FR")}>
                    {date.toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit" })} ·{" "}
                    {date.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}
                  </td>
                  <td data-label="Opération">
                    <span className={o.type === "detailler" ? "badge-deballe" : "badge-remballe"}>
                      {o.type === "detailler" ? "📦 Déballé" : "🔁 Remballé"}
                    </span>
                    {o.annulee && (
                      <span className="sous-info ligne-detail-article">
                        Annulé{o.dateAnnulation ? ` le ${new Date(o.dateAnnulation).toLocaleDateString("fr-FR")}` : ""}
                      </span>
                    )}
                  </td>
                  <td data-label="Article">{o.type === "detailler" ? o.sourceNom : o.cibleNom}</td>
                  <td data-label="Quantités" className="nowrap">
                    <strong>
                      {quantiteUnite(o.quantiteSource, o.uniteSource)} → {quantiteUnite(o.quantiteCible, o.uniteCible)}
                    </strong>
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
              );
            })}
            {filtrees.length === 0 && (
              <tr>
                <td colSpan={colonnes} className="liste-vide">
                  {operations.length === 0 ? "Aucune opération." : "Aucune opération ne correspond."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {aAnnuler && (
        <div className="fond-modale" onClick={() => setAAnnuler(null)}>
          <div className="modale-confirmation" onClick={(e) => e.stopPropagation()}>
            <h3>Annuler ce {aAnnuler.type === "detailler" ? "déballage" : "remballage"} ?</h3>
            <p className="note-aide">
              Annuler retire {quantiteUnite(aAnnuler.quantiteCible, aAnnuler.uniteCible)} de « {aAnnuler.cibleNom} » et redonne{" "}
              {quantiteUnite(aAnnuler.quantiteSource, aAnnuler.uniteSource)} de « {aAnnuler.sourceNom} », dans « {aAnnuler.depotNom} ».
            </p>
            <p className={aAnnuler.stockCibleActuel >= aAnnuler.quantiteCible ? "note-aide" : "texte-erreur"}>
              {aAnnuler.stockCibleActuel >= aAnnuler.quantiteCible
                ? `Possible : il y en a ${quantiteUnite(aAnnuler.stockCibleActuel, aAnnuler.uniteCible)} en stock.`
                : `Impossible : il n'en reste que ${quantiteUnite(aAnnuler.stockCibleActuel, aAnnuler.uniteCible)} (déjà vendu(e)s ?).`}
            </p>
            <div className="actions-formulaire">
              <button type="button" className="lien" onClick={() => setAAnnuler(null)}>
                Retour
              </button>
              <button
                type="button"
                className="bouton-danger"
                disabled={aAnnuler.stockCibleActuel < aAnnuler.quantiteCible}
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

// --- Articles reliés (réglage fait aussi depuis le Stock) ---

function ArticlesADetailler({ session }: { session: Session }) {
  const devise = useDevise();
  const peutGerer = !!session.permissions.gerer_produits_stock_achats;
  const peutVoirCout = !!session.permissions.voir_benefices_achat;
  const [depots, setDepots] = useState<{ id: string; nom: string }[]>([]);
  const [depotId, setDepotId] = useState("");
  const [articles, setArticles] = useState<ArticleDetaillable[]>([]);
  const [variantes, setVariantes] = useState<{ id: string; nom: string }[]>([]);
  const [terme, setTerme] = useState("");
  const [seulementADeballer, setSeulementADeballer] = useState(false);
  const [choixLien, setChoixLien] = useState(false);
  const [rechercheLien, setRechercheLien] = useState("");
  const [enEdition, setEnEdition] = useState<{ id: string; nom: string } | null>(null);
  const [aRetirer, setARetirer] = useState<ArticleDetaillable | null>(null);
  const [articleOuvert, setArticleOuvert] = useState<string | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);

  async function rafraichir() {
    setArticles(await donnees.articles(session.boutiqueId, depotId || undefined));
  }
  useEffect(() => {
    donnees.depots(session.boutiqueId).then(setDepots);
    donnees.variantes(session.boutiqueId).then(setVariantes);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.boutiqueId]);
  useEffect(() => {
    rafraichir();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [depotId]);

  const aDeballer = (a: ArticleDetaillable) => a.stockGros > 0 && a.stockDetail <= a.seuilDetail;
  const cle = terme.trim().toLowerCase();
  const affiches = articles.filter(
    (a) =>
      (!cle || a.grosNom.toLowerCase().includes(cle) || a.detailNom.toLowerCase().includes(cle)) &&
      (!seulementADeballer || aDeballer(a)),
  );
  const nombreADeballer = articles.filter(aDeballer).length;
  const stockGrosTotal = articles.reduce((t, a) => t + a.stockGros, 0);
  const valeurAuDetail = articles.reduce((t, a) => t + a.stockGros * a.quantite * a.prixVenteDetail, 0);

  // Relier : ni un article déjà relié, ni un article qui est déjà le détail d'un autre.
  const relies = new Set(articles.flatMap((a) => [a.varianteGrosId, a.varianteDetailId]));
  const cleLien = rechercheLien.trim().toLowerCase();
  const candidats = variantes.filter((v) => !relies.has(v.id) && (!cleLien || v.nom.toLowerCase().includes(cleLien)));

  async function retirerLien() {
    if (!aRetirer) return;
    try {
      await donnees.definir(aRetirer.varianteGrosId, null, null);
      setARetirer(null);
      setErreur(null);
      rafraichir();
    } catch (e) {
      setARetirer(null);
      setErreur(messageDe(e));
    }
  }

  return (
    <>
      <div className="tuiles-fiche">
        <div className="tuile-fiche">
          <span className="sous-info">🔗 Articles reliés</span>
          <strong>{articles.length}</strong>
        </div>
        <div className="tuile-fiche">
          <span className="sous-info">📦 En stock (gros)</span>
          <strong>{nombre(stockGrosTotal)}</strong>
        </div>
        <div className={`tuile-fiche${nombreADeballer > 0 ? " tuile-fiche--attention" : ""}`}>
          <span className="sous-info">⚠️ À déballer</span>
          <strong>{nombreADeballer}</strong>
        </div>
        {peutVoirCout && (
          <div className="tuile-fiche">
            <span className="sous-info">💰 Valeur au détail</span>
            <strong className="nowrap">
              {formaterMontant(Math.round(valeurAuDetail))} {devise}
            </strong>
          </div>
        )}
      </div>

      <div className="barre-actions barre-filtres-historique">
        <input
          type="search"
          className="recherche-articles-deballer"
          placeholder="Rechercher un article…"
          value={terme}
          onChange={(e) => setTerme(e.target.value)}
        />
        {depots.length > 1 && (
          <select value={depotId} onChange={(e) => setDepotId(e.target.value)}>
            <option value="">Tous les dépôts</option>
            {depots.map((d) => (
              <option key={d.id} value={d.id}>
                {d.nom}
              </option>
            ))}
          </select>
        )}
        <div className="bascule-vue" role="group" aria-label="Filtre">
          <button type="button" className={!seulementADeballer ? "actif" : ""} onClick={() => setSeulementADeballer(false)}>
            Tous
          </button>
          <button type="button" className={seulementADeballer ? "actif" : ""} onClick={() => setSeulementADeballer(true)}>
            ⚠️ À déballer ({nombreADeballer})
          </button>
        </div>
        {peutGerer && (
          <button
            type="button"
            className="bouton-primaire"
            onClick={() => {
              setRechercheLien("");
              setChoixLien(true);
            }}
          >
            🔗 Relier un article
          </button>
        )}
      </div>
      {erreur && <div className="message-erreur">{erreur}</div>}

      <div className="zone-tableau-scroll zone-commandes-fiche">
        <table className="tableau-catalogue carte-mobile">
          <thead>
            <tr>
              <th>Article</th>
              <th>Stock gros</th>
              <th>Stock détail</th>
              <th>Prix au détail</th>
              {peutGerer && <th>Actions</th>}
            </tr>
          </thead>
          <tbody>
            {affiches.map((a) => {
              const marge = a.prixVenteDetail - a.prixAchatGros / a.quantite;
              return (
                <tr key={a.varianteGrosId} className="ligne-cliquable" onClick={() => setArticleOuvert(a.varianteGrosId)}>
                  <td data-label="Article">
                    <strong>{a.grosNom}</strong>
                    <span className="sous-info ligne-detail-article">
                      1 {a.uniteGros.toLowerCase() || "unité"} = {quantiteUnite(a.quantite, a.uniteDetail)} · {a.detailNom}
                    </span>
                  </td>
                  <td data-label="Stock gros" className="nowrap">
                    <strong>{quantiteUnite(a.stockGros, a.uniteGros)}</strong>
                  </td>
                  <td data-label="Stock détail" className="nowrap">
                    {quantiteUnite(a.stockDetail, a.uniteDetail)}
                    {aDeballer(a) && <span className="badge-a-detailler"> À déballer</span>}
                  </td>
                  <td data-label="Prix au détail" className="nowrap">
                    {formaterMontant(a.prixVenteDetail)} {devise}
                    {peutVoirCout && (
                      <span className={`sous-info${marge < 0 ? " texte-erreur" : ""}`}> · marge {formaterMontant(Math.round(marge))}</span>
                    )}
                  </td>
                  {peutGerer && (
                    <td data-label="Actions" onClick={(e) => e.stopPropagation()}>
                      <span className="actions-ligne">
                        <button
                          type="button"
                          className="bouton-ouvrir-stock"
                          disabled={a.stockGros <= 0}
                          title={a.stockGros <= 0 ? "Plus rien à déballer dans ce dépôt" : undefined}
                          onClick={() => setArticleOuvert(a.varianteGrosId)}
                        >
                          📦 Déballer
                        </button>
                        <button
                          type="button"
                          className="lien-icone"
                          title="Modifier le lien"
                          onClick={() => setEnEdition({ id: a.varianteGrosId, nom: a.grosNom })}
                        >
                          ✎
                        </button>
                        <button type="button" className="lien-icone lien-icone-danger" title="Retirer le lien" onClick={() => setARetirer(a)}>
                          🗑
                        </button>
                      </span>
                    </td>
                  )}
                </tr>
              );
            })}
            {affiches.length === 0 && (
              <tr>
                <td colSpan={peutGerer ? 5 : 4} className="liste-vide">
                  {articles.length === 0
                    ? "Aucun article relié. Utilisez « 🔗 Relier un article » pour indiquer ce que contient un carton, un sac…"
                    : seulementADeballer
                      ? "Rien à déballer : tous les articles de détail ont du stock."
                      : "Aucun article ne correspond."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {choixLien && (
        <div className="fond-modale" onClick={() => setChoixLien(false)}>
          <div className="modale-confirmation modale-confirmation-large" onClick={(e) => e.stopPropagation()}>
            <h3>🔗 Relier un article</h3>
            <p className="note-aide">Choisissez l'article de gros (carton, sac, boîte…) à vendre aussi au détail.</p>
            <input
              type="search"
              className="champ-recherche"
              placeholder="Rechercher un article…"
              value={rechercheLien}
              onChange={(e) => setRechercheLien(e.target.value)}
              autoFocus
            />
            <div className="liste-choix-lien">
              {candidats.slice(0, 50).map((v) => (
                <button
                  key={v.id}
                  type="button"
                  onClick={() => {
                    setChoixLien(false);
                    setEnEdition(v);
                  }}
                >
                  {v.nom}
                </button>
              ))}
              {candidats.length === 0 && <p className="note-aide">Aucun article ne correspond.</p>}
            </div>
            <div className="actions-formulaire">
              <button type="button" className="lien" onClick={() => setChoixLien(false)}>
                Annuler
              </button>
            </div>
          </div>
        </div>
      )}

      {enEdition && (
        <div className="fond-modale" onClick={() => setEnEdition(null)}>
          <div className="modale-confirmation modale-confirmation-large" onClick={(e) => e.stopPropagation()}>
            <h3>🔗 {enEdition.nom}</h3>
            <PanneauVenteAuDetail session={session} varianteId={enEdition.id} nomArticle={enEdition.nom} onModifie={rafraichir} />
            <div className="actions-formulaire">
              <button type="button" className="lien" onClick={() => setEnEdition(null)}>
                Fermer
              </button>
            </div>
          </div>
        </div>
      )}

      {aRetirer && (
        <div className="fond-modale" onClick={() => setARetirer(null)}>
          <div className="modale-confirmation" onClick={(e) => e.stopPropagation()}>
            <h3>Retirer le lien ?</h3>
            <p className="note-aide">
              « {aRetirer.grosNom} » ne se déballera plus en « {aRetirer.detailNom} ». Les deux articles et leur stock restent ;
              seul le lien disparaît. Vous pourrez le refaire plus tard.
            </p>
            <div className="actions-formulaire">
              <button type="button" className="lien" onClick={() => setARetirer(null)}>
                Annuler
              </button>
              <button type="button" className="bouton-danger" onClick={retirerLien}>
                Retirer le lien
              </button>
            </div>
          </div>
        </div>
      )}

      {articleOuvert && (
        <ModaleOuvrir
          session={session}
          varianteGrosId={articleOuvert}
          depotId={depotId || undefined}
          onFermer={() => setArticleOuvert(null)}
          onTermine={rafraichir}
        />
      )}
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
          <h3>Déballage / Remballage</h3>
          <button type="button" className="lien bouton-retour" onClick={onFermer}>
            ← Retour
          </button>
        </div>
        <div className="modale-avec-menu">
          <nav className="menu-modale">
            <button type="button" className={page === "operer" ? "actif" : ""} onClick={() => setPage("operer")}>
              <span className="icone-menu-modale">📦</span>
              Déballer / remballer
            </button>
            <button type="button" className={page === "articles" ? "actif" : ""} onClick={() => setPage("articles")}>
              <span className="icone-menu-modale">🔗</span>
              Articles à déballer
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
                  <strong>Déballer</strong> un carton, un sac… pour le vendre au détail (1 carton → 24 paquets).{" "}
                  <strong>Remballer</strong> : l'inverse, pour refaire des cartons complets. Le coût suit, la marge reste juste.
                </p>
                <ContenuDeballage
                  key={grosChoisi ?? "tous"}
                  session={session}
                  varianteGrosIdInitial={grosChoisi}
                  choixArticle
                  onTermine={() => setActualisation((a) => a + 1)}
                />
              </>
            )}
            {page === "articles" && (
              <ArticlesADetailler session={session} />
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
                🔁 Remballer
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
          Il reste {quantiteUnite(gros.stockGros, gros.uniteGros)} de « {gros.grosNom} ». Déballer 1 {uniteGros} donne{" "}
          {quantiteUnite(gros.quantite, gros.uniteDetail)}, puis l'article est ajouté à la vente. L'opération est enregistrée à
          votre nom.
        </p>
        {erreur && <div className="message-erreur">{erreur}</div>}
        <div className="actions-formulaire">
          <button type="button" className="lien" onClick={onAnnuler}>
            Annuler
          </button>
          <button type="button" className="bouton-valider" disabled={enCours} onClick={ouvrir}>
            {enCours ? "…" : `📦 Déballer 1 ${uniteGros} et vendre`}
          </button>
        </div>
      </div>
    </div>
  );
}



// --- Fenêtre d'un article : barre latérale Déballer / Remballer / Historique ---

export function ModaleOuvrir({
  session,
  varianteGrosId,
  depotId,
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
  const [page, setPage] = useState<"operer" | "historique">("operer");
  const [type, setType] = useState<TypeDetaillage>(typeInitial);
  const [entete, setEntete] = useState<{ article: ArticleDetaillable | null; depotNom: string }>({ article: null, depotNom: "" });
  const [nombreOperations, setNombreOperations] = useState(0);
  const [actualisation, setActualisation] = useState(0);

  useEffect(() => {
    donnees
      .historique(session.boutiqueId)
      .then((liste) =>
        setNombreOperations(
          liste.filter((o) => o.varianteSourceId === varianteGrosId || o.varianteCibleId === varianteGrosId).length,
        ),
      );
  }, [session.boutiqueId, varianteGrosId, actualisation]);

  const article = entete.article;
  const detailler = type === "detailler";

  return (
    <div className="fond-modale" onClick={onFermer}>
      <div className="modale-selection-produits" onClick={(e) => e.stopPropagation()}>
        <div className="modale-entete">
          <h3>
            📦 {article?.grosNom ?? "Déballage"}
            {article && (
              <span className="sous-titre-entete">
                {" "}
                · 1 {article.uniteGros.toLowerCase() || "unité"} = {quantiteUnite(article.quantite, article.uniteDetail)}
                {entete.depotNom && ` · ${entete.depotNom}`}
              </span>
            )}
          </h3>
          <button type="button" className="lien bouton-retour" onClick={onFermer}>
            ← Retour
          </button>
        </div>
        <div className="modale-avec-menu">
          <nav className="menu-modale">
            <button
              type="button"
              className={page === "operer" && detailler ? "actif" : ""}
              onClick={() => {
                setType("detailler");
                setPage("operer");
              }}
            >
              <span className="icone-menu-modale">📦</span>
              Déballer
            </button>
            <button
              type="button"
              className={page === "operer" && !detailler ? "actif" : ""}
              onClick={() => {
                setType("regrouper");
                setPage("operer");
              }}
            >
              <span className="icone-menu-modale">🔁</span>
              Remballer
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
                  onTermine?.();
                }}
              />
            ) : (
              <ContenuDeballage
                key={type}
                session={session}
                varianteGrosIdInitial={varianteGrosId}
                depotIdImpose={depotId}
                typeInitial={type}
                onArticle={(a, depotNom) => setEntete({ article: a, depotNom })}
                onTermine={() => {
                  setActualisation((a) => a + 1);
                  onTermine?.();
                }}
              />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
