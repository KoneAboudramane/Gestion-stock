import { useEffect, useState } from "react";
import type { CSSProperties } from "react";

import type { Session } from "../api";
import BoutonsExport from "../components/BoutonsExport";
import FactureVente from "../components/FactureVente";
import FiltrePeriodeHistorique from "../components/FiltrePeriodeHistorique";
import ModaleConfirmation from "../components/ModaleConfirmation";
import { useDevise } from "../contexts/DeviseContext";
import { useSynchro } from "../contexts/SynchroContext";
import { useNomsUtilisateurs } from "../hooks/useNomsUtilisateurs";
import type { ColonneExport } from "../lib/export";
import { formaterMontant } from "../lib/formatage";
import {
  FOURNISSEURS_MOBILE_MONEY,
  libelleFournisseurMobileMoney,
  libelleModePaiement,
  libelleOperateurMobileMoney,
  libelleStatutTransactionMobileMoney,
  libelleStatutVente,
  type FournisseurMobileMoney,
} from "../lib/libelles";
import { bornesPeriode, dansPeriode, jourLocal, type PeriodeHistorique } from "../lib/periode";
import { initierPaiementMobileMoney, obtenirTransactionPourPaiement, type TransactionResume } from "../services/paiements";
import { listerDepots, type DepotResume } from "../services/catalogue";
import {
  annulerVente,
  ErreurVente,
  listerVentesLocales,
  obtenirVenteDetail,
  type PaiementDetail,
  type StatutVente,
  type VenteDetail,
  type VenteResumeLocale,
} from "../services/ventes";

/**
 * Port de client-electron/src/pages/Ventes.tsx : historique des ventes, local
 * d'abord (IndexedDB, voir services/ventes.ts) — y compris l'annulation
 * (recrédite le stock, solde toute créance liée) et le suivi des paiements
 * Mobile Money (simulation locale, voir services/paiements.ts).
 */

const STATUTS: { valeur: StatutVente | ""; label: string }[] = [
  { valeur: "", label: "Tous les statuts" },
  { valeur: "payee", label: "Payée" },
  { valeur: "credit", label: "Crédit" },
  { valeur: "annulee", label: "Annulée" },
];

// --- Paiement mobile money (simulation locale) ---

function PaiementMobileMoney({ paiement }: { paiement: PaiementDetail }) {
  const [transaction, setTransaction] = useState<TransactionResume | null | undefined>(undefined);
  const [afficherForm, setAfficherForm] = useState(false);
  const [fournisseur, setFournisseur] = useState<FournisseurMobileMoney>("wave");
  const [numeroTelephone, setNumeroTelephone] = useState("");
  const [enCours, setEnCours] = useState(false);

  async function rafraichir() {
    setTransaction((await obtenirTransactionPourPaiement(paiement.id)) ?? null);
  }
  useEffect(() => {
    rafraichir();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paiement.id]);

  async function initier(evenement: React.FormEvent) {
    evenement.preventDefault();
    setEnCours(true);
    try {
      await initierPaiementMobileMoney({ paiementId: paiement.id, fournisseur, numeroTelephone, montant: paiement.montant });
      setAfficherForm(false);
      rafraichir();
    } finally {
      setEnCours(false);
    }
  }

  if (transaction === undefined) return null;

  return (
    <div>
      {transaction ? (
        <span className={transaction.statut === "reussie" ? "badge-payee" : "badge-credit"}>
          {libelleFournisseurMobileMoney(transaction.fournisseur)} · {libelleStatutTransactionMobileMoney(transaction.statut)} (
          {transaction.referenceExterne})
        </span>
      ) : afficherForm ? (
        <form onSubmit={initier} className="formulaire-inline">
          <select value={fournisseur} onChange={(e) => setFournisseur(e.target.value as FournisseurMobileMoney)}>
            {FOURNISSEURS_MOBILE_MONEY.map((f) => (
              <option key={f.valeur} value={f.valeur}>
                {f.label}
              </option>
            ))}
          </select>
          <input placeholder="Numéro de téléphone" value={numeroTelephone} onChange={(e) => setNumeroTelephone(e.target.value)} />
          <button type="submit" disabled={enCours}>
            {enCours ? "…" : "Initier"}
          </button>
        </form>
      ) : (
        <button type="button" className="bouton-primaire" onClick={() => setAfficherForm(true)}>
          Initier le paiement mobile money
        </button>
      )}
    </div>
  );
}

export function DetailVente({ venteId, session, onRetour }: { venteId: string; session: Session; onRetour: () => void }) {
  const peutAnnuler = !!session.permissions.annuler_vente;
  const devise = useDevise();
  const nomUtilisateur = useNomsUtilisateurs(session);
  const [vente, setVente] = useState<VenteDetail | null>(null);
  const [page, setPage] = useState<"articles" | "paiements">("articles");
  const [confirmation, setConfirmation] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const [enCours, setEnCours] = useState(false);
  const [afficherFacture, setAfficherFacture] = useState(false);

  async function rafraichir() {
    setVente((await obtenirVenteDetail(venteId)) ?? null);
  }
  useEffect(() => {
    rafraichir();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [venteId]);

  async function confirmerAnnulation() {
    setEnCours(true);
    setErreur(null);
    try {
      await annulerVente(venteId, session.utilisateurId);
      setConfirmation(false);
      rafraichir();
    } catch (e) {
      setErreur(e instanceof ErreurVente ? e.message : "Erreur inattendue.");
    } finally {
      setEnCours(false);
    }
  }

  if (afficherFacture) {
    return <FactureVente venteId={venteId} session={session} labelRetour="← Retour à la vente" onRetour={() => setAfficherFacture(false)} />;
  }

  if (!vente) return <p>Chargement…</p>;
  const estAnnulee = vente.statut === "annulee";
  const montantCredit = vente.paiements.filter((p) => p.mode === "credit").reduce((t, p) => t + p.montant, 0);
  const montantComptant = vente.paiements.filter((p) => p.mode !== "credit").reduce((t, p) => t + p.montant, 0);
  const quantiteTotale = vente.lignes.reduce((t, l) => t + l.quantite, 0);
  const consequences = [
    `${formaterQuantite(quantiteTotale)} article(s) retournent dans le stock du dépôt « ${vente.depotNom} ».`,
    montantCredit > 0
      ? `Le crédit de ${formaterMontant(montantCredit)} ${devise}${vente.clientNom ? ` de ${vente.clientNom}` : ""} est annulé.`
      : "",
    "La vente reste visible dans l'historique, marquée « Annulée ».",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <>
      <div className="modale-entete">
        <h3>
          Vente {vente.numero} <span className={`badge-${vente.statut}`}>{libelleStatutVente(vente.statut)}</span>
        </h3>
        <div className="actions-formulaire">
          <button type="button" className="bouton-primaire" onClick={() => setAfficherFacture(true)}>
            Voir la facture
          </button>
          <button type="button" className="lien bouton-retour" onClick={onRetour}>
            ← Retour
          </button>
        </div>
      </div>
      <div className="modale-avec-menu">
        <nav className="menu-modale">
          <button type="button" className={page === "articles" ? "actif" : ""} onClick={() => setPage("articles")}>
            <span className="icone-menu-modale">🧾</span>
            Articles
            <span className="compteur-menu-modale">{vente.lignes.length}</span>
          </button>
          <button type="button" className={page === "paiements" ? "actif" : ""} onClick={() => setPage("paiements")}>
            <span className="icone-menu-modale">💳</span>
            Paiements
            <span className="compteur-menu-modale">{vente.paiements.length}</span>
          </button>
          {!estAnnulee && peutAnnuler && (
            <button type="button" className="bouton-menu-danger" onClick={() => setConfirmation(true)}>
              <span className="icone-menu-modale">✕</span>
              Annuler la vente
            </button>
          )}
        </nav>
        <div className="modale-corps">
          <div className="tuiles-fiche">
            <div className="tuile-fiche">
              <span className="sous-info">💰 Total net</span>
              <strong className="nowrap">
                {formaterMontant(vente.totalNet)} {devise}
              </strong>
            </div>
            <div className="tuile-fiche">
              <span className="sous-info">🏷️ Remise</span>
              <strong className="nowrap">
                {formaterMontant(vente.remise)} {devise}
              </strong>
            </div>
            <div className="tuile-fiche">
              <span className="sous-info">💵 Payé comptant</span>
              <strong className="nowrap">
                {formaterMontant(montantComptant)} {devise}
              </strong>
            </div>
            <div className={`tuile-fiche${montantCredit > 0 && !estAnnulee ? " tuile-fiche--attention" : ""}`}>
              <span className="sous-info">💳 Reste en crédit</span>
              <strong className="nowrap">
                {formaterMontant(montantCredit)} {devise}
              </strong>
            </div>
          </div>
          <div className="fiche-infos-produit">
            <div>
              <span className="sous-info">Date</span>
              <strong>{new Date(vente.dateCreation).toLocaleString("fr-FR")}</strong>
            </div>
            <div>
              <span className="sous-info">Dépôt</span>
              <strong>{vente.depotNom || "—"}</strong>
            </div>
            <div>
              <span className="sous-info">Client</span>
              <strong>
                {vente.clientNom ?? "—"}
                {vente.clientTelephone ? ` · ${vente.clientTelephone}` : ""}
              </strong>
            </div>
            <div>
              <span className="sous-info">Vendeur</span>
              <strong>{nomUtilisateur(vente.utilisateurId)}</strong>
            </div>
          </div>
          {erreur && <div className="message-erreur">{erreur}</div>}

          {page === "articles" ? (
            <div className="zone-tableau-scroll zone-commandes-fiche">
              <table className="tableau-catalogue carte-mobile">
                <thead>
                  <tr>
                    <th>N°</th>
                    <th>Désignation</th>
                    <th>Référence</th>
                    <th>Qté</th>
                    <th>PU</th>
                    <th>Sous-total</th>
                  </tr>
                </thead>
                <tbody>
                  {vente.lignes.map((l, index) => (
                    <tr key={l.id}>
                      <td data-label="N°">{index + 1}</td>
                      <td data-label="Désignation">
                        {l.produitNom}{" "}
                        {l.prixNormal !== null && (
                          <span className="badge-destockage" title={`Prix normal : ${formaterMontant(l.prixNormal)} ${devise}`}>
                            Déstockage
                          </span>
                        )}
                      </td>
                      <td data-label="Référence">{l.reference || ""}</td>
                      <td data-label="Qté">{formaterQuantite(l.quantite)}</td>
                      <td data-label="PU" className="nowrap">
                        {formaterMontant(l.prixUnitaire)}
                      </td>
                      <td data-label="Sous-total" className="nowrap">
                        {formaterMontant(l.sousTotal)} {devise}
                      </td>
                    </tr>
                  ))}
                  {Array.from({ length: Math.max(0, 10 - vente.lignes.length) }).map((_, i) => (
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
          ) : (
            <div className="zone-tableau-scroll zone-commandes-fiche">
              <table className="tableau-catalogue carte-mobile">
                <thead>
                  <tr>
                    <th>Mode</th>
                    <th>Opérateur</th>
                    <th>Montant</th>
                    <th>Suivi</th>
                  </tr>
                </thead>
                <tbody>
                  {vente.paiements.map((p) => (
                    <tr key={p.id}>
                      <td data-label="Mode">{libelleModePaiement(p.mode)}</td>
                      <td data-label="Opérateur">{p.operateur ? libelleOperateurMobileMoney(p.operateur) : ""}</td>
                      <td data-label="Montant" className="nowrap">
                        {formaterMontant(p.montant)} {devise}
                      </td>
                      <td data-label="Suivi">{p.mode === "mobile_money" && <PaiementMobileMoney paiement={p} />}</td>
                    </tr>
                  ))}
                  {vente.paiements.length === 0 && (
                    <tr>
                      <td colSpan={4} className="liste-vide">
                        Aucun paiement.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}

          {!estAnnulee && peutAnnuler && confirmation && (
            <ModaleConfirmation
              titre="Annuler cette vente ?"
              description={consequences}
              labelConfirmer="Confirmer l'annulation"
              dangereux
              enCours={enCours}
              onAnnuler={() => setConfirmation(false)}
              onConfirmer={confirmerAnnulation}
            />
          )}
        </div>
      </div>
    </>
  );
}

/** Quantité lisible : entier sans décimales, sinon deux décimales au plus. */
function formaterQuantite(quantite: number): string {
  return quantite.toLocaleString("fr-FR", { maximumFractionDigits: 2 });
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

export default function Ventes({ session }: { session: Session }) {
  const peutGerer = !!session.permissions.gerer_produits_stock_achats;
  const devise = useDevise();
  const nomUtilisateur = useNomsUtilisateurs(session);
  const { etat: etatSynchro } = useSynchro();
  const [depots, setDepots] = useState<DepotResume[]>([]);
  const [depotId, setDepotId] = useState(peutGerer ? "" : (session.depotId ?? ""));
  const [statut, setStatut] = useState<StatutVente | "">("");
  const [terme, setTerme] = useState("");
  const [periode, setPeriode] = useState<PeriodeHistorique>("mois");
  const [debutPerso, setDebutPerso] = useState(jourLocal(new Date()));
  const [finPerso, setFinPerso] = useState(jourLocal(new Date()));
  const [ventes, setVentes] = useState<VenteResumeLocale[]>([]);
  const [venteSelectionneeId, setVenteSelectionneeId] = useState<string | null>(null);

  useEffect(() => {
    if (peutGerer) listerDepots(session.boutiqueId).then(setDepots);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.boutiqueId, peutGerer]);

  async function rafraichir() {
    setVentes(await listerVentesLocales(session.boutiqueId, depotId || undefined, statut || undefined, terme));
  }
  useEffect(() => {
    rafraichir();
    // Rejoue la requête locale quand une synchro se termine (derniereSynchro
    // change) : sinon, ouvrir cet écran juste après connexion — avant la fin
    // de la synchro initiale qui rapatrie l'historique — laisse "Aucune
    // vente" affiché indéfiniment, sans qu'aucun filtre ne change pour
    // relancer la requête.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [depotId, statut, terme, etatSynchro?.derniereSynchro]);

  const bornes = bornesPeriode(periode, debutPerso, finPerso);
  const ventesPeriode = ventes.filter((v) => dansPeriode(v.dateCreation, bornes));
  // Les ventes annulées restent listées mais ne comptent pas dans les tuiles.
  const valides = ventesPeriode.filter((v) => v.statut !== "annulee");
  const chiffreAffaires = valides.reduce((t, v) => t + v.totalNet, 0);
  const venduACredit = valides.reduce((t, v) => t + (v.montantCredit ?? 0), 0);
  const panierMoyen = valides.length > 0 ? Math.round(chiffreAffaires / valides.length) : 0;

  const colonnesExport: ColonneExport[] = [
    { cle: "date", libelle: "Date" },
    { cle: "numero", libelle: "Numéro" },
    { cle: "depot", libelle: "Dépôt" },
    { cle: "client", libelle: "Client" },
    { cle: "vendeur", libelle: "Vendeur" },
    { cle: "articles", libelle: "Articles" },
    { cle: "statut", libelle: "Statut" },
    { cle: "credit", libelle: `Dont crédit (${devise})` },
    { cle: "total", libelle: `Total net (${devise})` },
  ];
  const lignesExport = ventesPeriode.map((v) => ({
    date: new Date(v.dateCreation).toLocaleString("fr-FR"),
    numero: v.numero,
    depot: v.depotNom,
    client: v.clientNom ?? "",
    vendeur: nomUtilisateur(v.utilisateurId),
    articles: v.nombreArticles,
    statut: libelleStatutVente(v.statut),
    credit: v.montantCredit,
    total: v.totalNet,
  }));

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
      {venteSelectionneeId && (
        <div className="fond-modale" onClick={() => setVenteSelectionneeId(null)}>
          <div className="modale-selection-produits" onClick={(e) => e.stopPropagation()}>
            <DetailVente
              venteId={venteSelectionneeId}
              session={session}
              onRetour={() => {
                setVenteSelectionneeId(null);
                rafraichir();
              }}
            />
          </div>
        </div>
      )}
      <div className="tuiles-fiche">
        <div className="tuile-fiche">
          <span className="sous-info">🧾 Ventes</span>
          <strong>{valides.length}</strong>
        </div>
        <div className="tuile-fiche">
          <span className="sous-info">💰 Chiffre d'affaires</span>
          <strong className="nowrap">
            {formaterMontant(chiffreAffaires)} {devise}
          </strong>
        </div>
        <div className={`tuile-fiche${venduACredit > 0 ? " tuile-fiche--attention" : ""}`}>
          <span className="sous-info">💳 Vendu à crédit</span>
          <strong className="nowrap">
            {formaterMontant(venduACredit)} {devise}
          </strong>
        </div>
        <div className="tuile-fiche">
          <span className="sous-info">🧺 Panier moyen</span>
          <strong className="nowrap">
            {formaterMontant(panierMoyen)} {devise}
          </strong>
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
        <select value={statut} onChange={(e) => setStatut(e.target.value as StatutVente | "")}>
          {STATUTS.map((s) => (
            <option key={s.valeur} value={s.valeur}>
              {s.label}
            </option>
          ))}
        </select>
        <input
          className="champ-recherche champ-recherche-ventes"
          placeholder="Rechercher par numéro ou client…"
          value={terme}
          onChange={(e) => setTerme(e.target.value)}
        />
        <BoutonsExport titre="Historique des ventes" colonnes={colonnesExport} lignes={lignesExport} compact />
      </div>
      <div className="zone-tableau-scroll">
        <table className="tableau-catalogue carte-mobile">
          <thead>
            <tr>
              <th>N°</th>
              <th>Date</th>
              <th>Numéro</th>
              <th>Dépôt</th>
              <th>Client</th>
              <th>Vendeur</th>
              <th>Articles</th>
              <th>Statut</th>
              <th>Total net</th>
            </tr>
          </thead>
          <tbody>
            {ventesPeriode.map((v, index) => (
              <tr key={v.id} onClick={() => setVenteSelectionneeId(v.id)}>
                <td data-label="N°">{index + 1}</td>
                <td data-label="Date">{new Date(v.dateCreation).toLocaleString("fr-FR")}</td>
                <td data-label="Numéro">{v.numero}</td>
                <td data-label="Dépôt">{v.depotNom}</td>
                <td data-label="Client">{v.clientNom ?? ""}</td>
                <td data-label="Vendeur">{nomUtilisateur(v.utilisateurId)}</td>
                <td data-label="Articles">{formaterQuantite(v.nombreArticles)}</td>
                <td data-label="Statut">
                  <span className={`badge-${v.statut}`}>{libelleStatutVente(v.statut)}</span>
                </td>
                <td data-label="Total net" className="nowrap">
                  {formaterMontant(v.totalNet)} {devise}
                  {v.montantCredit > 0 && v.statut !== "annulee" && (
                    <span className="sous-info"> · dont {formaterMontant(v.montantCredit)} à crédit</span>
                  )}
                </td>
              </tr>
            ))}
            {ventesPeriode.length === 0 && (
              <tr>
                <td colSpan={9} className="liste-vide">
                  {ventes.length === 0 ? "Aucune vente." : "Aucune vente sur cette période."}
                </td>
              </tr>
            )}
            {Array.from({ length: Math.max(0, 10 - Math.max(1, ventesPeriode.length)) }).map((_, i) => (
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
    </div>
  );
}
