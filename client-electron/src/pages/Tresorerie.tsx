import { useEffect, useState } from "react";
import ModaleJournee from "../components/ModaleJournee";
import type { CSSProperties } from "react";

import { api } from "../api/client";
import type {
  ClotureCaisseResume,
  DepotResume,
  JourneeCaisse,
  MouvementCaisseResume,
  OperateurMobileMoney,
  Session,
  TransfertCaisseResume,
  UtilisateurResume,
} from "../api/client";
import ChampMontant from "../components/ChampMontant";
import { useDevise } from "../contexts/DeviseContext";
import { useNomsUtilisateurs } from "../hooks/useNomsUtilisateurs";
import BoutonsExport from "../components/BoutonsExport";
import FiltrePeriodeHistorique from "../components/FiltrePeriodeHistorique";
import { bornesPeriode, dansPeriode, jourLocal, type PeriodeHistorique } from "../lib/periode";
import type { ColonneExport } from "../api/client";
import { formaterMontant } from "../lib/formatage";
import {
  OPERATEURS_MOBILE_MONEY,
  libelleCategorieMouvementCaisse,
  libelleOperateurMobileMoney,
  libelleTypeMouvementCaisse,
} from "../lib/libelles";

/**
 * Suivi de trésorerie (solde de caisse, séparé de l'écran de vente "Caisse").
 * Solde = agrégat calculé côté service, jamais stocké (voir tresorerie/services.py).
 */

/**
 * Plusieurs utilisateurs (caissières) peuvent partager le même dépôt, et le
 * Patron/Gérant peut basculer sur leur caisse : on résout donc toujours
 * l'auteur réel de chaque mouvement, jamais seulement le dépôt affecté.
 */
function creerResolveurNom(utilisateurs: UtilisateurResume[], utilisateurIdSession: string) {
  const noms = new Map(
    utilisateurs.map((u) => [String(u.id), `${u.first_name} ${u.last_name}`.trim() || u.username]),
  );
  return (id: string | null): string => {
    if (!id) return "inconnu";
    if (id === utilisateurIdSession) return "Vous";
    return noms.get(id) ?? "Autre utilisateur";
  };
}

function SelecteurDepot({
  session,
  peutChangerDepot,
  depots,
  depotId,
  setDepotId,
}: {
  session: Session;
  peutChangerDepot: boolean;
  depots: DepotResume[];
  depotId: string;
  setDepotId: (id: string) => void;
}) {
  // Un compte verrouillé sur un dépôt (caissier) n'a pas le choix. Patron et
  // Gérant (gerer_tresorerie) gardent leur dépôt assigné par défaut, mais
  // peuvent basculer sur un autre — les traces gardent leur utilisateurId
  // propre, donc on sait toujours qui a agi sur le dépôt de qui.
  if (session.depotId && !peutChangerDepot) return null;
  return (
    <select value={depotId} onChange={(e) => setDepotId(e.target.value)}>
      <option value="">Choisir un dépôt…</option>
      {depots.map((d) => (
        <option key={d.id} value={d.id}>
          {d.nom}
        </option>
      ))}
    </select>
  );
}

// --- Modales Retrait / Apport / Ajustement ---
// Même dimension fixe que les autres modales à tableau de l'appli
// (.modale-selection-produits, voir index.css) : leur historique respectif
// vit désormais dans la modale elle-même, juste sous le formulaire.

/** Date courte des historiques (l'heure complète reste au survol). */
function dateCourte(iso: string): string {
  return new Date(iso).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" });
}

/** Montant signé d'un mouvement : vert pour une entrée, rouge pour une sortie. */
function MontantSigne({ sortie, montant, devise }: { sortie: boolean; montant: number; devise: string }) {
  return (
    <span className={sortie ? "texte-erreur" : "montant-entree"}>
      {sortie ? "−" : "+"}
      {formaterMontant(Math.abs(montant))} {devise}
    </span>
  );
}

type CategorieActionCaisse = "retrait" | "apport" | "ajustement";

const SECTIONS_ACTION_CAISSE: Record<
  CategorieActionCaisse,
  { bouton: string; icone: string; modaleTitre: string; historiqueTitre: string; vide: string }
> = {
  retrait: {
    bouton: "Retrait",
    icone: "➖",
    modaleTitre: "Retrait de caisse",
    historiqueTitre: "Historique des retraits",
    vide: "Aucun retrait.",
  },
  apport: {
    bouton: "Mise de fonds",
    icone: "➕",
    modaleTitre: "Mise de fonds en caisse",
    historiqueTitre: "Historique des mises de fonds",
    vide: "Aucune mise de fonds.",
  },
  ajustement: {
    bouton: "Ajustement",
    icone: "⚖️",
    modaleTitre: "Ajustement de caisse",
    historiqueTitre: "Historique des ajustements",
    vide: "Aucun ajustement.",
  },
};

function ModaleMouvementCategorie({
  titre,
  historiqueTitre,
  libelleVide,
  mouvements,
  devise,
  nomUtilisateur,
  soldeActuel,
  effet,
  motifRequis = false,
  montantSigne = false,
  onAnnuler,
  onValider,
}: {
  titre: string;
  historiqueTitre: string;
  libelleVide: string;
  mouvements: MouvementCaisseResume[];
  devise: string;
  nomUtilisateur: (id: string | null) => string;
  /** Solde de caisse avant l'opération (aperçu « après »). */
  soldeActuel: number | null;
  /** -1 : sort de la caisse (retrait), +1 : y entre (mise de fonds), 0 : selon le sens choisi (ajustement). */
  effet: -1 | 0 | 1;
  motifRequis?: boolean;
  montantSigne?: boolean;
  onAnnuler: () => void;
  onValider: (montant: number, motif: string) => Promise<string | void>;
}) {
  const [montant, setMontant] = useState("");
  const [negatif, setNegatif] = useState(false);
  const [motif, setMotif] = useState("");
  const [erreur, setErreur] = useState<string | null>(null);
  const [enCours, setEnCours] = useState(false);
  const [periode, setPeriode] = useState<PeriodeHistorique>("tout");
  const [debutPerso, setDebutPerso] = useState(jourLocal(new Date()));
  const [finPerso, setFinPerso] = useState(jourLocal(new Date()));

  const signe = effet !== 0 ? effet : negatif ? -1 : 1;
  const saisi = Number(montant) || 0;
  const soldeApres = soldeActuel !== null ? soldeActuel + signe * saisi : null;
  const filtres = mouvements.filter((m) => dansPeriode(m.dateCreation, bornesPeriode(periode, debutPerso, finPerso)));
  const total = filtres.reduce((t, m) => t + (m.type === "sortie" ? -1 : 1) * Math.abs(m.montant), 0);

  async function valider(evenement: React.FormEvent) {
    evenement.preventDefault();
    setErreur(null);
    if (motifRequis && !motif.trim()) {
      setErreur("Le motif est obligatoire.");
      return;
    }
    setEnCours(true);
    try {
      const message = await onValider(saisi * (montantSigne && negatif ? -1 : 1), motif.trim());
      if (message) setErreur(message);
    } finally {
      setEnCours(false);
    }
  }

  return (
    <div className="fond-modale" onClick={onAnnuler}>
      <div className="modale-selection-produits" onClick={(e) => e.stopPropagation()}>
        <form onSubmit={valider} className="formulaire-mouvement-caisse-modale">
          <div className="modale-entete">
            <h3>{titre}</h3>
            <button type="button" className="lien bouton-retour" onClick={onAnnuler} disabled={enCours}>
              ← Retour
            </button>
          </div>
          <div className="modale-corps">
            {erreur && <div className="message-erreur">{erreur}</div>}
            <div className="ligne-champs-tresorerie">
              <label>
                Montant
                <ChampMontant value={montant} onChange={setMontant} autoFocus />
              </label>
              {montantSigne && (
                <label>
                  Sens
                  <select value={negatif ? "1" : "0"} onChange={(e) => setNegatif(e.target.value === "1")}>
                    <option value="0">Correction vers le haut (+)</option>
                    <option value="1">Correction vers le bas (−)</option>
                  </select>
                </label>
              )}
              <label>
                Motif {motifRequis ? "" : "(optionnel)"}
                <input value={motif} onChange={(e) => setMotif(e.target.value)} />
              </label>
              <button type="submit" className="bouton-primaire" disabled={enCours}>
                {enCours ? "…" : "Valider"}
              </button>
            </div>
            <div className={`apercu-solde${soldeApres !== null && soldeApres < 0 ? " apercu-solde--alerte" : ""}`}>
              Solde de caisse : <strong>{soldeActuel !== null ? `${formaterMontant(soldeActuel)} ${devise}` : "…"}</strong>
              {saisi > 0 && soldeApres !== null && (
                <>
                  {" "}→ après : <strong>{formaterMontant(soldeApres)} {devise}</strong>
                  {soldeApres < 0 && <span> · la caisse passera en négatif</span>}
                </>
              )}
            </div>

            <div className="entete-section-tableau">
              <h4>{historiqueTitre}</h4>
              <FiltrePeriodeHistorique
                periode={periode}
                setPeriode={setPeriode}
                debutPerso={debutPerso}
                setDebutPerso={setDebutPerso}
                finPerso={finPerso}
                setFinPerso={setFinPerso}
              />
            </div>
            <div className="tuiles-fiche">
              <div className="tuile-fiche">
                <span className="sous-info">🧾 Opérations</span>
                <strong>{filtres.length}</strong>
              </div>
              <div className="tuile-fiche">
                <span className="sous-info">💰 Total</span>
                <strong className="nowrap">
                  {total > 0 ? "+" : ""}
                  {formaterMontant(total)} {devise}
                </strong>
              </div>
              <div className="tuile-fiche">
                <span className="sous-info">🕘 Dernière opération</span>
                <strong>{mouvements[0] ? new Date(mouvements[0].dateCreation).toLocaleDateString("fr-FR") : "—"}</strong>
              </div>
            </div>
            <div className="zone-tableau-scroll zone-commandes-fiche">
              <table className="tableau-catalogue">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Motif</th>
                    <th>Montant</th>
                    <th>Effectué par</th>
                  </tr>
                </thead>
                <tbody>
                  {filtres.map((m) => (
                    <tr key={m.id}>
                      <td title={new Date(m.dateCreation).toLocaleString("fr-FR")}>{dateCourte(m.dateCreation)}</td>
                      <td>{m.motif || "—"}</td>
                      <td className="nowrap">
                        <MontantSigne sortie={m.type === "sortie"} montant={m.montant} devise={devise} />
                      </td>
                      <td>{nomUtilisateur(m.utilisateurId)}</td>
                    </tr>
                  ))}
                  {filtres.length === 0 && (
                    <tr>
                      <td colSpan={4} className="liste-vide-compacte">
                        {mouvements.length === 0 ? libelleVide : "Rien sur cette période."}
                      </td>
                    </tr>
                  )}
                  {Array.from({ length: Math.max(0, 10 - Math.max(1, filtres.length)) }).map((_, i) => (
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
          </div>
        </form>
      </div>
    </div>
  );
}

// --- Historique complet du solde (tous les mouvements, toutes catégories) ---

function ModaleHistoriqueSolde({
  mouvements,
  devise,
  nomUtilisateur,
  onFermer,
}: {
  mouvements: MouvementCaisseResume[];
  devise: string;
  nomUtilisateur: (id: string | null) => string;
  onFermer: () => void;
}) {
  const [periode, setPeriode] = useState<PeriodeHistorique>("30j");
  const [debutPerso, setDebutPerso] = useState(jourLocal(new Date()));
  const [finPerso, setFinPerso] = useState(jourLocal(new Date()));
  const [sens, setSens] = useState<"" | "entree" | "sortie">("");
  const [categorie, setCategorie] = useState("");
  const [terme, setTerme] = useState("");
  const categories = [...new Set(mouvements.map((m) => m.categorie))].sort((a, b) =>
    libelleCategorieMouvementCaisse(a).localeCompare(libelleCategorieMouvementCaisse(b), "fr"),
  );
  const cle = terme.trim().toLowerCase();
  const filtres = mouvements.filter(
    (m) =>
      dansPeriode(m.dateCreation, bornesPeriode(periode, debutPerso, finPerso)) &&
      (!sens || (sens === "sortie") === (m.type === "sortie")) &&
      (!categorie || m.categorie === categorie) &&
      (!cle || (m.motif ?? "").toLowerCase().includes(cle)),
  );
  const entrees = filtres.filter((m) => m.type !== "sortie").reduce((t, m) => t + Math.abs(m.montant), 0);
  const sorties = filtres.filter((m) => m.type === "sortie").reduce((t, m) => t + Math.abs(m.montant), 0);
  const net = entrees - sorties;
  const colonnesExport: ColonneExport[] = [
    { cle: "date", libelle: "Date" },
    { cle: "type", libelle: "Type" },
    { cle: "categorie", libelle: "Catégorie" },
    { cle: "motif", libelle: "Motif" },
    { cle: "montant", libelle: `Montant (${devise})` },
    { cle: "par", libelle: "Effectué par" },
  ];
  const lignesExport = filtres.map((m) => ({
    date: new Date(m.dateCreation).toLocaleString("fr-FR"),
    type: libelleTypeMouvementCaisse(m.type),
    categorie: libelleCategorieMouvementCaisse(m.categorie),
    motif: m.motif ?? "",
    montant: (m.type === "sortie" ? -1 : 1) * Math.abs(m.montant),
    par: nomUtilisateur(m.utilisateurId),
  }));

  return (
    <div className="fond-modale" onClick={onFermer}>
      <div className="modale-selection-produits" onClick={(e) => e.stopPropagation()}>
        <div className="modale-entete">
          <h3>Historique du solde</h3>
          <button type="button" className="lien bouton-retour" onClick={onFermer}>
            ← Retour
          </button>
        </div>
        <div className="modale-corps">
          <div className="tuiles-fiche">
            <div className="tuile-fiche">
              <span className="sous-info">📥 Entrées</span>
              <strong className="nowrap montant-entree">
                +{formaterMontant(entrees)} {devise}
              </strong>
            </div>
            <div className="tuile-fiche">
              <span className="sous-info">📤 Sorties</span>
              <strong className="nowrap texte-erreur">
                −{formaterMontant(sorties)} {devise}
              </strong>
            </div>
            <div className={`tuile-fiche${net < 0 ? " tuile-fiche--alerte" : ""}`}>
              <span className="sous-info">⚖️ Variation nette</span>
              <strong className="nowrap">
                {net > 0 ? "+" : ""}
                {formaterMontant(net)} {devise}
              </strong>
            </div>
            <div className="tuile-fiche">
              <span className="sous-info">🧾 Opérations</span>
              <strong>{filtres.length}</strong>
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
            <select value={sens} onChange={(e) => setSens(e.target.value as typeof sens)}>
              <option value="">Entrées et sorties</option>
              <option value="entree">Entrées</option>
              <option value="sortie">Sorties</option>
            </select>
            <select value={categorie} onChange={(e) => setCategorie(e.target.value)}>
              <option value="">Toutes les catégories</option>
              {categories.map((c) => (
                <option key={c} value={c}>
                  {libelleCategorieMouvementCaisse(c)}
                </option>
              ))}
            </select>
            <input type="search" placeholder="Motif…" value={terme} onChange={(e) => setTerme(e.target.value)} />
            <BoutonsExport titre="Historique du solde de caisse" colonnes={colonnesExport} lignes={lignesExport} compact />
          </div>
          <div className="zone-tableau-scroll zone-commandes-fiche">
            <table className="tableau-catalogue">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Type</th>
                  <th>Catégorie</th>
                  <th>Motif</th>
                  <th>Montant</th>
                  <th>Effectué par</th>
                </tr>
              </thead>
              <tbody>
                {filtres.map((m) => (
                  <tr key={m.id}>
                    <td title={new Date(m.dateCreation).toLocaleString("fr-FR")}>{dateCourte(m.dateCreation)}</td>
                    <td>
                      <span className={m.type === "sortie" ? "badge-annulee" : "badge-payee"}>
                        {libelleTypeMouvementCaisse(m.type)}
                      </span>
                    </td>
                    <td>{libelleCategorieMouvementCaisse(m.categorie)}</td>
                    <td>{m.motif || "—"}</td>
                    <td className="nowrap">
                      <MontantSigne sortie={m.type === "sortie"} montant={m.montant} devise={devise} />
                    </td>
                    <td>{nomUtilisateur(m.utilisateurId)}</td>
                  </tr>
                ))}
                {filtres.length === 0 && (
                  <tr>
                    <td colSpan={6} className="liste-vide-compacte">
                      {mouvements.length === 0 ? "Aucun mouvement de caisse." : "Aucun mouvement pour ces filtres."}
                    </td>
                  </tr>
                )}
                {Array.from({ length: Math.max(0, 10 - Math.max(1, filtres.length)) }).map((_, i) => (
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
          {filtres.length > 0 && (
            <div className="totaux">
              <div>
                {filtres.length} opération{filtres.length > 1 ? "s" : ""} · entrées +{formaterMontant(entrees)} · sorties −
                {formaterMontant(sorties)}
              </div>
              <div className="total-net">
                Variation : {net > 0 ? "+" : ""}
                {formaterMontant(net)} {devise}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// --- Transfert mobile money -> caisse, depuis l'onglet Solde ---
// Modale compacte, dédiée au geste de transfert seul (comme les applis
// mobile money elles-mêmes) — l'historique est un bouton séparé, pas mêlé au
// formulaire (voir ModaleHistoriqueTransferts ci-dessous).

function ModaleTransfertMobileMoney({
  operateur,
  disponible,
  soldeCaisse,
  devise,
  onAnnuler,
  onValider,
}: {
  operateur: OperateurMobileMoney;
  disponible: number;
  /** Solde de caisse avant le transfert (aperçu « après »). */
  soldeCaisse: number | null;
  devise: string;
  onAnnuler: () => void;
  onValider: (montant: number) => Promise<string | void>;
}) {
  const [montant, setMontant] = useState("");
  const [erreur, setErreur] = useState<string | null>(null);
  const [enCours, setEnCours] = useState(false);
  const montantDepasseDisponible = Number(montant) > disponible;

  function definirPourcentage(fraction: number) {
    setMontant(disponible > 0 ? String(Math.floor(disponible * fraction)) : "");
  }

  async function valider(evenement: React.FormEvent) {
    evenement.preventDefault();
    if (montantDepasseDisponible) return;
    setErreur(null);
    setEnCours(true);
    try {
      const message = await onValider(Number(montant) || 0);
      if (message) setErreur(message);
    } finally {
      setEnCours(false);
    }
  }

  return (
    <div className="fond-modale" onClick={onAnnuler}>
      <div
        className={`modale-transfert-mobile-money bandeau-transfert--${operateur}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="bandeau-transfert">
          <span className="badge-operateur-transfert">{libelleOperateurMobileMoney(operateur).charAt(0)}</span>
          <div className="bandeau-transfert-titres">
            <span className="bandeau-transfert-titre">{libelleOperateurMobileMoney(operateur)}</span>
            <span className="bandeau-transfert-sous-titre">Vers la caisse</span>
          </div>
          <span className="pastille-disponible">
            {formaterMontant(disponible)} {devise}
          </span>
        </div>
        <form onSubmit={valider} className="corps-transfert">
          {erreur && <div className="message-erreur">{erreur}</div>}
          <label className="champ-montant-transfert">
            Montant à transférer
            <div className={`saisie-montant-transfert ${montantDepasseDisponible ? "saisie-montant-transfert--erreur" : ""}`}>
              <ChampMontant value={montant} onChange={setMontant} autoFocus />
              <span className="devise-inline">{devise}</span>
            </div>
            {montantDepasseDisponible && (
              <span className="aide-montant-erreur">Montant supérieur au disponible.</span>
            )}
          </label>
          <div className="apercu-transfert">
            <span>
              {libelleOperateurMobileMoney(operateur)} : {formaterMontant(disponible)} →{" "}
              <strong>{formaterMontant(Math.max(0, disponible - (Number(montant) || 0)))}</strong> {devise}
            </span>
            {soldeCaisse !== null && (
              <span>
                Caisse : {formaterMontant(soldeCaisse)} → <strong>{formaterMontant(soldeCaisse + (Number(montant) || 0))}</strong>{" "}
                {devise}
              </span>
            )}
          </div>
          <div className="raccourcis-montant-transfert">
            <button type="button" onClick={() => definirPourcentage(0.25)} disabled={disponible <= 0}>
              25%
            </button>
            <button type="button" onClick={() => definirPourcentage(0.5)} disabled={disponible <= 0}>
              50%
            </button>
            <button type="button" onClick={() => definirPourcentage(1)} disabled={disponible <= 0}>
              Tout
            </button>
          </div>
          <div className="actions-formulaire">
            <button type="button" onClick={onAnnuler} disabled={enCours}>
              Annuler
            </button>
            <button
              type="submit"
              className="bouton-primaire bouton-transferer"
              disabled={enCours || disponible <= 0 || montantDepasseDisponible}
            >
              {enCours ? "Transfert…" : "Transférer"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function ModaleHistoriqueTransferts({
  operateur,
  transferts,
  devise,
  nomUtilisateur,
  onFermer,
}: {
  /** null : tous les opérateurs (page Historique), avec une colonne Opérateur. */
  operateur: OperateurMobileMoney | null;
  transferts: TransfertCaisseResume[];
  devise: string;
  nomUtilisateur: (id: string | null) => string;
  onFermer: () => void;
}) {
  const [periode, setPeriode] = useState<PeriodeHistorique>("tout");
  const [debutPerso, setDebutPerso] = useState(jourLocal(new Date()));
  const [finPerso, setFinPerso] = useState(jourLocal(new Date()));
  const filtres = transferts.filter((t) => dansPeriode(t.dateCreation, bornesPeriode(periode, debutPerso, finPerso)));
  const total = filtres.reduce((s, t) => s + t.montant, 0);

  return (
    <div className="fond-modale" onClick={onFermer}>
      <div className="modale-selection-produits" onClick={(e) => e.stopPropagation()}>
        <div className="modale-entete">
          <h3>{operateur ? `Historique des transferts ${libelleOperateurMobileMoney(operateur)}` : "Transferts Mobile Money"}</h3>
          <button type="button" className="lien bouton-retour" onClick={onFermer}>
            ← Retour
          </button>
        </div>
        <div className="modale-corps">
          <div className="tuiles-fiche">
            <div className="tuile-fiche">
              <span className="sous-info">🔁 Transferts</span>
              <strong>{filtres.length}</strong>
            </div>
            <div className="tuile-fiche">
              <span className="sous-info">💰 Total vers la caisse</span>
              <strong className="nowrap">
                {formaterMontant(total)} {devise}
              </strong>
            </div>
            <div className="tuile-fiche">
              <span className="sous-info">📊 Transfert moyen</span>
              <strong className="nowrap">
                {formaterMontant(filtres.length > 0 ? Math.round(total / filtres.length) : 0)} {devise}
              </strong>
            </div>
            <div className="tuile-fiche">
              <span className="sous-info">🕘 Dernier transfert</span>
              <strong>{transferts[0] ? new Date(transferts[0].dateCreation).toLocaleDateString("fr-FR") : "—"}</strong>
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
          </div>
          <div className="zone-tableau-scroll zone-commandes-fiche">
            <table className="tableau-catalogue">
              <thead>
                <tr>
                  <th>Date</th>
                  {!operateur && <th>Opérateur</th>}
                  <th>Montant</th>
                  <th>Effectué par</th>
                </tr>
              </thead>
              <tbody>
                {filtres.map((t) => (
                  <tr key={t.id}>
                    <td title={new Date(t.dateCreation).toLocaleString("fr-FR")}>{dateCourte(t.dateCreation)}</td>
                    {!operateur && <td data-label="Opérateur">{libelleOperateurMobileMoney(t.operateur)}</td>}
                    <td className="nowrap montant-entree">
                      +{formaterMontant(t.montant)} {devise}
                    </td>
                    <td>{nomUtilisateur(t.utilisateurId)}</td>
                  </tr>
                ))}
                {filtres.length === 0 && (
                  <tr>
                    <td colSpan={operateur ? 3 : 4} className="liste-vide-compacte">
                      {transferts.length === 0 ? "Aucun transfert." : "Aucun transfert sur cette période."}
                    </td>
                  </tr>
                )}
                {Array.from({ length: Math.max(0, 10 - Math.max(1, filtres.length)) }).map((_, i) => (
                  <tr key={`vide-${i}`} className="ligne-groupe-vide">
                    <td>&nbsp;</td>
                    {!operateur && <td>&nbsp;</td>}
                    <td>&nbsp;</td>
                    <td>&nbsp;</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {filtres.length > 0 && (
            <div className="totaux">
              <div>
                {filtres.length} transfert{filtres.length > 1 ? "s" : ""}
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

// --- Onglet Solde & historique ---

function OngletHistorique({
  session,
  depotId,
  peutGererTresorerie,
  nomUtilisateur,
  onDepotChange,
}: {
  session: Session;
  depotId: string;
  peutGererTresorerie: boolean;
  nomUtilisateur: (id: string | null) => string;
  onDepotChange: () => void;
}) {
  const devise = useDevise();
  const [solde, setSolde] = useState<number | null>(null);
  const [mouvements, setMouvements] = useState<MouvementCaisseResume[]>([]);
  const [transferts, setTransferts] = useState<TransfertCaisseResume[]>([]);
  const [clotures, setClotures] = useState<ClotureCaisseResume[]>([]);
  const [modaleOuverte, setModaleOuverte] = useState<
    CategorieActionCaisse | "historique" | "transfert" | "historiqueTransfert" | "cloture" | "journee" | null
  >(null);
  const [soldesMobileMoney, setSoldesMobileMoney] = useState<Record<OperateurMobileMoney, number> | null>(null);
  // « Aujourd'hui » (chiffres du jour du dépôt) à chaque arrivée sur la page ; « Solde » (cumulé) sur demande.
  const [modeAffichage, setModeAffichage] = useState<"solde" | "jour">("jour");
  const [aujourdhui, setAujourdhui] = useState<JourneeCaisse | null>(null);

  function changerModeAffichage(mode: "solde" | "jour") {
    setModeAffichage(mode);
  }

  async function chargerAujourdhui() {
    if (!depotId) return;
    const debut = new Date();
    debut.setHours(0, 0, 0, 0);
    const fin = new Date(debut);
    fin.setDate(fin.getDate() + 1);
    setAujourdhui(await api.tresorerie.journee(session.boutiqueId, depotId, debut.toISOString(), fin.toISOString()));
  }
  const [selection, setSelection] = useState<"caisse" | OperateurMobileMoney>("caisse");

  async function rafraichirSoldesMobileMoney() {
    const paires = await Promise.all(
      OPERATEURS_MOBILE_MONEY.map((o) =>
        api.tresorerie
          .soldeMobileMoneyDisponible(session.boutiqueId, session.utilisateurId, o.valeur)
          .then((montant) => [o.valeur, montant] as const),
      ),
    );
    setSoldesMobileMoney(Object.fromEntries(paires) as Record<OperateurMobileMoney, number>);
  }

  async function rafraichir() {
    if (!depotId) return;
    setSolde(await api.tresorerie.solde(depotId));
    setMouvements(await api.tresorerie.listerMouvements(depotId, 2000));
    setTransferts(await api.tresorerie.listerTransferts(depotId, 1000));
    setClotures(await api.tresorerie.listerClotures(depotId, 365));
    await chargerAujourdhui();
  }
  useEffect(() => {
    rafraichir();
    onDepotChange();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [depotId]);

  // Toujours crédité à celui qui vend (jamais une ligne partagée, voir
  // tresorerie/services.py) : ce solde dépend de l'utilisateur connecté, pas
  // du dépôt affiché — indépendant de depotId.
  useEffect(() => {
    rafraichirSoldesMobileMoney();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.boutiqueId, session.utilisateurId]);

  async function fermerEtRafraichir() {
    setModaleOuverte(null);
    await rafraichir();
  }

  async function fermerEtRafraichirTransfert() {
    setModaleOuverte(null);
    await rafraichir();
    await rafraichirSoldesMobileMoney();
  }

  const mouvementsParCategorie: Record<CategorieActionCaisse, MouvementCaisseResume[]> = {
    retrait: mouvements.filter((m) => m.categorie === "retrait"),
    apport: mouvements.filter((m) => m.categorie === "apport"),
    ajustement: mouvements.filter((m) => m.categorie === "ajustement"),
  };

  const modeJour = modeAffichage === "jour";
  const encaisseAujourdhui = aujourdhui
    ? aujourdhui.entrees
        .filter((l) => l.categorie === "vente_especes" || l.categorie === "remboursement_credit")
        .reduce((t, l) => t + l.montant, 0)
    : null;
  const mobileMoneyAujourdhui = (operateur: string) =>
    aujourdhui ? (aujourdhui.mobileMoney.find((m) => m.operateur === operateur)?.montant ?? 0) : null;
  const itemsSolde: { cle: "caisse" | OperateurMobileMoney; label: string; valeur: number | null; alerte: boolean }[] =
    [
      modeJour
        ? { cle: "caisse", label: "Espèces encaissées aujourd'hui", valeur: encaisseAujourdhui, alerte: false }
        : { cle: "caisse", label: "Solde de caisse", valeur: solde, alerte: (solde ?? 0) < 0 },
      ...OPERATEURS_MOBILE_MONEY.map((o) => ({
        cle: o.valeur as "caisse" | OperateurMobileMoney,
        label: modeJour ? `${o.label} (aujourd'hui)` : o.label,
        valeur: modeJour ? mobileMoneyAujourdhui(o.valeur) : soldesMobileMoney ? soldesMobileMoney[o.valeur] : null,
        alerte: false,
      })),
    ];
  const itemSelectionne = itemsSolde.find((i) => i.cle === selection)!;
  const autresItems = itemsSolde.filter((i) => i.cle !== selection);

  return (
    <div className={`onglet-solde${modeJour ? " onglet-solde--jour" : ""}`}>
      <div className="bascule-vue bascule-mode-tresorerie" role="group" aria-label="Affichage">
        <button type="button" className={!modeJour ? "actif" : ""} onClick={() => changerModeAffichage("solde")}>
          💰 Solde
        </button>
        <button type="button" className={modeJour ? "actif" : ""} onClick={() => changerModeAffichage("jour")}>
          📅 Aujourd'hui
        </button>
      </div>
      <div className="disposition-solde">
        <div className="detail-solde">
          <div className="carte-stat carte-stat-solde-principal">
            {selection === "caisse" && peutGererTresorerie && depotId && (
              <button type="button" className="bouton-cloture-coin" onClick={() => setModaleOuverte("cloture")}>
                Clôturer la caisse
              </button>
            )}
            <span className="carte-stat-label">{itemSelectionne.label}</span>
            <span className={`carte-stat-valeur ${itemSelectionne.alerte ? "carte-stat-alerte" : ""}`}>
              {itemSelectionne.valeur !== null ? `${formaterMontant(itemSelectionne.valeur)} ${devise}` : "…"}
            </span>
            {modeJour && aujourdhui && selection === "caisse" && (
              <span className="rappel-solde-jour">
                🧾 {aujourdhui.nombreVentes} vente{aujourdhui.nombreVentes > 1 ? "s" : ""} · CA{" "}
                {formaterMontant(aujourdhui.chiffreAffaires)} {devise}
                {aujourdhui.credit > 0 && ` · dont ${formaterMontant(aujourdhui.credit)} à crédit`}
                <br />
                Solde de caisse : {solde !== null ? `${formaterMontant(solde)} ${devise}` : "…"}
              </span>
            )}
            {modeJour && selection !== "caisse" && soldesMobileMoney && (
              <span className="rappel-solde-jour">
                Solde disponible : {formaterMontant(soldesMobileMoney[selection])} {devise}
              </span>
            )}
          </div>

          {selection !== "caisse" && depotId && (
            <div className="grille-documents-comptables">
              <button type="button" className="carte-document-comptable" onClick={() => setModaleOuverte("transfert")}>
                <span className="icone-document-comptable">🔁</span>
                Transfert
              </button>
              <button
                type="button"
                className="carte-document-comptable"
                onClick={() => setModaleOuverte("historiqueTransfert")}
              >
                <span className="icone-document-comptable">🕘</span>
                Historique
              </button>
            </div>
          )}

          {selection === "caisse" && depotId && (
            <div className="grille-documents-comptables">
              <button type="button" className="carte-document-comptable" onClick={() => setModaleOuverte("journee")}>
                <span className="icone-document-comptable">📅</span>
                Journée
              </button>
              {peutGererTresorerie &&
                (Object.keys(SECTIONS_ACTION_CAISSE) as CategorieActionCaisse[]).map((categorie) => (
                  <button
                    key={categorie}
                    type="button"
                    className="carte-document-comptable"
                    onClick={() => setModaleOuverte(categorie)}
                  >
                    <span className="icone-document-comptable">{SECTIONS_ACTION_CAISSE[categorie].icone}</span>
                    {SECTIONS_ACTION_CAISSE[categorie].bouton}
                  </button>
                ))}
              <button
                type="button"
                className="carte-document-comptable"
                onClick={() => setModaleOuverte("historique")}
              >
                <span className="icone-document-comptable">🕘</span>
                Historique
              </button>
            </div>
          )}
        </div>

        <div className="menu-solde">
          {autresItems.map((item) => (
            <button
              key={item.cle}
              type="button"
              className="carte-stat menu-solde-item"
              onClick={() => setSelection(item.cle)}
            >
              <span className="carte-stat-label">{item.label}</span>
              <span className="carte-stat-valeur">
                {item.valeur !== null ? `${formaterMontant(item.valeur)} ${devise}` : "…"}
              </span>
            </button>
          ))}
        </div>
      </div>

      {modaleOuverte === "historique" && (
        <ModaleHistoriqueSolde
          mouvements={mouvements}
          devise={devise}
          nomUtilisateur={nomUtilisateur}
          onFermer={() => setModaleOuverte(null)}
        />
      )}

      {modaleOuverte === "transfert" && selection !== "caisse" && (
        <ModaleTransfertMobileMoney
          operateur={selection}
          disponible={soldesMobileMoney ? soldesMobileMoney[selection] : 0}
          soldeCaisse={solde}
          devise={devise}
          onAnnuler={() => setModaleOuverte(null)}
          onValider={async (montant) => {
            const resultat = await api.tresorerie.effectuerTransfert({
              boutiqueId: session.boutiqueId,
              depotId,
              utilisateurSourceId: session.utilisateurId,
              operateur: selection,
              montant,
              utilisateurId: session.utilisateurId,
            });
            if (!resultat.succes) return resultat.message;
            await fermerEtRafraichirTransfert();
          }}
        />
      )}

      {modaleOuverte === "historiqueTransfert" && selection !== "caisse" && (
        <ModaleHistoriqueTransferts
          operateur={selection}
          transferts={transferts.filter((t) => t.operateur === selection)}
          devise={devise}
          nomUtilisateur={nomUtilisateur}
          onFermer={() => setModaleOuverte(null)}
        />
      )}

      {modaleOuverte === "journee" && (
        <ModaleJournee
          session={session}
          depotIdInitial={depotId}
          depotCourantId={depotId}
          onCloturer={() => setModaleOuverte("cloture")}
          onFermer={() => setModaleOuverte(null)}
        />
      )}

      {modaleOuverte === "cloture" && (
        <ModaleClotureCaisse
          soldeActuel={solde}
          clotures={clotures}
          devise={devise}
          nomUtilisateur={nomUtilisateur}
          onAnnuler={() => setModaleOuverte(null)}
          onValider={async (soldeCompte) => {
            const resultat = await api.tresorerie.cloturer(depotId, soldeCompte, session.utilisateurId);
            if (!resultat.succes) return resultat.message;
            await fermerEtRafraichir();
          }}
        />
      )}

      {modaleOuverte === "retrait" && (
        <ModaleMouvementCategorie
          titre={SECTIONS_ACTION_CAISSE.retrait.modaleTitre}
          historiqueTitre={SECTIONS_ACTION_CAISSE.retrait.historiqueTitre}
          libelleVide={SECTIONS_ACTION_CAISSE.retrait.vide}
          mouvements={mouvementsParCategorie.retrait}
          soldeActuel={solde}
          effet={-1}
          devise={devise}
          nomUtilisateur={nomUtilisateur}
          onAnnuler={() => setModaleOuverte(null)}
          onValider={async (montant, motif) => {
            const resultat = await api.tresorerie.effectuerRetrait(depotId, montant, motif, session.utilisateurId);
            if (!resultat.succes) return resultat.message;
            await fermerEtRafraichir();
          }}
        />
      )}
      {modaleOuverte === "apport" && (
        <ModaleMouvementCategorie
          titre={SECTIONS_ACTION_CAISSE.apport.modaleTitre}
          historiqueTitre={SECTIONS_ACTION_CAISSE.apport.historiqueTitre}
          libelleVide={SECTIONS_ACTION_CAISSE.apport.vide}
          mouvements={mouvementsParCategorie.apport}
          soldeActuel={solde}
          effet={1}
          devise={devise}
          nomUtilisateur={nomUtilisateur}
          onAnnuler={() => setModaleOuverte(null)}
          onValider={async (montant, motif) => {
            const resultat = await api.tresorerie.enregistrerApport(depotId, montant, motif, session.utilisateurId);
            if (!resultat.succes) return resultat.message;
            await fermerEtRafraichir();
          }}
        />
      )}
      {modaleOuverte === "ajustement" && (
        <ModaleMouvementCategorie
          titre={SECTIONS_ACTION_CAISSE.ajustement.modaleTitre}
          historiqueTitre={SECTIONS_ACTION_CAISSE.ajustement.historiqueTitre}
          libelleVide={SECTIONS_ACTION_CAISSE.ajustement.vide}
          mouvements={mouvementsParCategorie.ajustement}
          soldeActuel={solde}
          effet={0}
          devise={devise}
          nomUtilisateur={nomUtilisateur}
          motifRequis
          montantSigne
          onAnnuler={() => setModaleOuverte(null)}
          onValider={async (montant, motif) => {
            const resultat = await api.tresorerie.ajusterCaisse(depotId, montant, motif, session.utilisateurId);
            if (!resultat.succes) return resultat.message;
            await fermerEtRafraichir();
          }}
        />
      )}
    </div>
  );
}

// --- Onglet Clôtures ---

// --- Clôture de caisse, depuis l'onglet Solde ---

function ModaleClotureCaisse({
  soldeActuel,
  clotures,
  devise,
  nomUtilisateur,
  onAnnuler,
  onValider,
}: {
  soldeActuel: number | null;
  clotures: ClotureCaisseResume[];
  devise: string;
  nomUtilisateur: (id: string | null) => string;
  onAnnuler: () => void;
  onValider: (soldeCompte: number) => Promise<string | void>;
}) {
  const [soldeCompte, setSoldeCompte] = useState("");
  const [erreur, setErreur] = useState<string | null>(null);
  const [enCours, setEnCours] = useState(false);
  // Écart en direct : positif = excédent, négatif = manque.
  const ecartSaisi = soldeCompte !== "" && soldeActuel !== null ? (Number(soldeCompte) || 0) - soldeActuel : null;
  const ecartCumule = clotures.reduce((t, c) => t + c.ecart, 0);

  async function valider(evenement: React.FormEvent) {
    evenement.preventDefault();
    setErreur(null);
    setEnCours(true);
    try {
      const message = await onValider(Number(soldeCompte) || 0);
      if (message) setErreur(message);
    } finally {
      setEnCours(false);
    }
  }

  return (
    <div className="fond-modale" onClick={onAnnuler}>
      <div className="modale-selection-produits" onClick={(e) => e.stopPropagation()}>
        <form onSubmit={valider} className="formulaire-mouvement-caisse-modale">
          <div className="modale-entete">
            <h3>Clôture de caisse</h3>
            <button type="button" className="lien bouton-retour" onClick={onAnnuler} disabled={enCours}>
              ← Retour
            </button>
          </div>
          <div className="modale-corps">
            {erreur && <div className="message-erreur">{erreur}</div>}
            <div className="cloture-saisie">
              <div className="tuile-fiche cloture-theorique">
                <span className="sous-info">Solde théorique</span>
                <strong className={soldeActuel !== null && soldeActuel < 0 ? "texte-erreur" : undefined}>
                  {soldeActuel !== null ? `${formaterMontant(soldeActuel)} ${devise}` : "…"}
                </strong>
              </div>
              <label>
                Montant réellement compté
                <ChampMontant value={soldeCompte} onChange={setSoldeCompte} autoFocus />
              </label>
              <div
                className={`cloture-ecart${
                  ecartSaisi === null ? "" : ecartSaisi === 0 ? " cloture-ecart--juste" : ecartSaisi < 0 ? " cloture-ecart--manque" : " cloture-ecart--exces"
                }`}
              >
                {ecartSaisi === null
                  ? "Saisissez le montant compté"
                  : ecartSaisi === 0
                    ? "Caisse juste ✓"
                    : ecartSaisi < 0
                      ? `Manque ${formaterMontant(-ecartSaisi)} ${devise}`
                      : `Excédent ${formaterMontant(ecartSaisi)} ${devise}`}
              </div>
              <button type="submit" className="bouton-primaire" disabled={enCours || soldeCompte === ""}>
                {enCours ? "…" : "Clôturer"}
              </button>
            </div>

            <h4>Historique des clôtures</h4>
            <div className="tuiles-fiche">
              <div className="tuile-fiche">
                <span className="sous-info">🔒 Clôtures</span>
                <strong>{clotures.length}</strong>
              </div>
              <div className={`tuile-fiche${ecartCumule < 0 ? " tuile-fiche--alerte" : ""}`}>
                <span className="sous-info">⚖️ Écart cumulé</span>
                <strong className="nowrap">
                  {ecartCumule > 0 ? "+" : ""}
                  {formaterMontant(ecartCumule)} {devise}
                </strong>
              </div>
              <div className="tuile-fiche">
                <span className="sous-info">🕘 Dernière clôture</span>
                <strong>{clotures[0] ? new Date(clotures[0].dateCreation).toLocaleDateString("fr-FR") : "—"}</strong>
              </div>
            </div>
            <div className="zone-tableau-scroll zone-commandes-fiche">
              <table className="tableau-catalogue">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Solde théorique</th>
                    <th>Solde compté</th>
                    <th>Écart</th>
                    <th>Effectué par</th>
                  </tr>
                </thead>
                <tbody>
                  {clotures.map((c) => (
                    <tr key={c.id}>
                      <td title={new Date(c.dateCreation).toLocaleString("fr-FR")}>{dateCourte(c.dateCreation)}</td>
                      <td className="nowrap">
                        {formaterMontant(c.soldeTheorique)} {devise}
                      </td>
                      <td className="nowrap">
                        {formaterMontant(c.soldeCompte)} {devise}
                      </td>
                      <td className="nowrap">
                        <strong className={c.ecart < 0 ? "texte-erreur" : c.ecart > 0 ? "texte-avertissement" : "montant-entree"}>
                          {c.ecart === 0 ? "Juste ✓" : `${c.ecart > 0 ? "+" : ""}${formaterMontant(c.ecart)} ${devise}`}
                        </strong>
                      </td>
                      <td>{nomUtilisateur(c.utilisateurId)}</td>
                    </tr>
                  ))}
                  {clotures.length === 0 && (
                    <tr>
                      <td colSpan={5} className="liste-vide-compacte">
                        Aucune clôture enregistrée.
                      </td>
                    </tr>
                  )}
                  {Array.from({ length: Math.max(0, 10 - Math.max(1, clotures.length)) }).map((_, i) => (
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
          </div>
        </form>
      </div>
    </div>
  );
}

// --- Page principale ---

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

/** Page Historique : mouvements du solde de caisse d'un dépôt. */
export function HistoriqueCaisseDepot({ session, depotId, onFermer }: { session: Session; depotId: string; onFermer: () => void }) {
  const devise = useDevise();
  const nomUtilisateur = useNomsUtilisateurs(session);
  const [mouvements, setMouvements] = useState<MouvementCaisseResume[]>([]);
  useEffect(() => {
    if (depotId) api.tresorerie.listerMouvements(depotId, 2000).then(setMouvements);
  }, [depotId]);
  return <ModaleHistoriqueSolde mouvements={mouvements} devise={devise} nomUtilisateur={nomUtilisateur} onFermer={onFermer} />;
}

/** Page Historique : transferts Mobile Money vers la caisse d'un dépôt, tous opérateurs. */
export function TransfertsMobileMoneyDepot({ session, depotId, onFermer }: { session: Session; depotId: string; onFermer: () => void }) {
  const devise = useDevise();
  const nomUtilisateur = useNomsUtilisateurs(session);
  const [transferts, setTransferts] = useState<TransfertCaisseResume[]>([]);
  useEffect(() => {
    if (depotId) api.tresorerie.listerTransferts(depotId, 1000).then(setTransferts);
  }, [depotId]);
  return (
    <ModaleHistoriqueTransferts
      operateur={null}
      transferts={transferts}
      devise={devise}
      nomUtilisateur={nomUtilisateur}
      onFermer={onFermer}
    />
  );
}

export default function Tresorerie({ session }: { session: Session }) {
  const peutGererTresorerie = !!session.permissions.gerer_tresorerie;
  const [depots, setDepots] = useState<DepotResume[]>([]);
  const [depotId, setDepotId] = useState(session.depotId ?? "");
  const [utilisateurs, setUtilisateurs] = useState<UtilisateurResume[]>([]);

  // session.depotId peut se rafraîchir après le montage (retour de
  // rafraichirPermissions lancé en tâche de fond au démarrage, ou dépôt de
  // vente modifié dans Informations boutique) : l'état local doit le suivre,
  // pas seulement s'initialiser une fois au montage.
  useEffect(() => {
    if (session.depotId) setDepotId(session.depotId);
  }, [session.depotId]);

  useEffect(() => {
    if (!session.depotId || peutGererTresorerie) {
      api.depots.lister(session.boutiqueId).then((liste) => {
        setDepots(liste);
        // Sans dépôt assigné (Patron/Gérant, voir Réglages), le sélecteur
        // partait vide par défaut — même repli silencieux que Caisse.tsx :
        // premier dépôt de la boutique, modifiable ensuite via le sélecteur.
        if (!session.depotId && liste[0]) setDepotId(liste[0].id);
      });
      // Plusieurs caissières peuvent partager le même dépôt : on résout leur
      // nom pour tracer qui a réellement agi sur la caisse (voir creerResolveurNom).
      api.comptes.listerUtilisateurs(session).then((resultat) => {
        if (resultat.succes) setUtilisateurs(resultat.resultat);
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const nomUtilisateur = creerResolveurNom(utilisateurs, session.utilisateurId);

  return (
    <div className="page-produits page-tresorerie page-accueil">
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
      <div className="barre-actions barre-actions-avec-onglets">
        <SelecteurDepot
          session={session}
          peutChangerDepot={peutGererTresorerie}
          depots={depots}
          depotId={depotId}
          setDepotId={setDepotId}
        />
      </div>
      <div className="contenu-onglet">
        <OngletHistorique
          session={session}
          depotId={depotId}
          peutGererTresorerie={peutGererTresorerie}
          nomUtilisateur={nomUtilisateur}
          onDepotChange={() => {}}
        />
      </div>
    </div>
  );
}
