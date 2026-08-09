import { useEffect, useState } from "react";

import type { Session } from "../api";
import FactureVente from "../components/FactureVente";
import ModaleConfirmation from "../components/ModaleConfirmation";
import { useDevise } from "../contexts/DeviseContext";
import { formaterMontant } from "../lib/formatage";
import {
  FOURNISSEURS_MOBILE_MONEY,
  libelleFournisseurMobileMoney,
  libelleModePaiement,
  libelleStatutTransactionMobileMoney,
  libelleStatutVente,
  type FournisseurMobileMoney,
} from "../lib/libelles";
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

function DetailVente({ venteId, session, onRetour }: { venteId: string; session: Session; onRetour: () => void }) {
  const peutAnnuler = !!session.permissions.annuler_vente;
  const devise = useDevise();
  const [vente, setVente] = useState<VenteDetail | null>(null);
  const [confirmation, setConfirmation] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const [enCours, setEnCours] = useState(false);
  const [afficherFacture, setAfficherFacture] = useState(false);

  async function rafraichir() {
    const v = await obtenirVenteDetail(venteId);
    setVente(v ?? null);
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
      <div className="modale-corps">
        <p>
          Client : {vente.clientNom ?? ""} · {new Date(vente.dateCreation).toLocaleString("fr-FR")}
        </p>
        {erreur && <div className="message-erreur">{erreur}</div>}

        <div className="zone-tableau-scroll">
          <table className="tableau-catalogue">
            <thead>
              <tr>
                <th>N°</th>
                <th>Désignation</th>
                <th>Référence</th>
                <th>Qté</th>
                <th>PU</th>
                <th>Remise</th>
                <th>Sous-total</th>
              </tr>
            </thead>
            <tbody>
              {vente.lignes.map((l, index) => (
                <tr key={l.id}>
                  <td>{index + 1}</td>
                  <td>{l.produitNom}</td>
                  <td>{l.reference || ""}</td>
                  <td>{l.quantite}</td>
                  <td>{formaterMontant(l.prixUnitaire)}</td>
                  <td>{formaterMontant(l.remise)}</td>
                  <td>{formaterMontant(l.sousTotal)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="totaux">
          <div>
            Total brut : {formaterMontant(vente.totalBrut)} {devise}
          </div>
          <div>
            Remise : {formaterMontant(vente.remise)} {devise}
          </div>
          <div className="total-net">
            Total net : {formaterMontant(vente.totalNet)} {devise}
          </div>
        </div>

        <div className="paiements">
          <h3>Paiements</h3>
          <ul className="liste-simple">
            {vente.paiements.map((p) => (
              <li key={p.id}>
                {libelleModePaiement(p.mode)} : {formaterMontant(p.montant)} {devise}
                {p.mode === "mobile_money" && <PaiementMobileMoney paiement={p} />}
              </li>
            ))}
            {vente.paiements.length === 0 && <li className="liste-vide">Aucun paiement.</li>}
          </ul>
        </div>

        {!estAnnulee && peutAnnuler && (
          <button type="button" className="bouton-danger" onClick={() => setConfirmation(true)}>
            Annuler la vente
          </button>
        )}
        {!estAnnulee && peutAnnuler && confirmation && (
          <ModaleConfirmation
            titre="Annuler cette vente ?"
            description="Le stock sera recrédité."
            labelConfirmer="Confirmer l'annulation"
            dangereux
            enCours={enCours}
            onAnnuler={() => setConfirmation(false)}
            onConfirmer={confirmerAnnulation}
          />
        )}
      </div>
    </>
  );
}

export default function Ventes({ session }: { session: Session }) {
  const peutGerer = !!session.permissions.gerer_produits_stock_achats;
  const [depots, setDepots] = useState<DepotResume[]>([]);
  const [depotId, setDepotId] = useState(peutGerer ? "" : (session.depotId ?? ""));
  const [statut, setStatut] = useState<StatutVente | "">("");
  const [terme, setTerme] = useState("");
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [depotId, statut, terme]);

  return (
    <div className="page-produits">
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
      </div>
      <div className="zone-tableau-scroll">
        <table className="tableau-catalogue">
          <thead>
            <tr>
              <th>N°</th>
              <th>Date</th>
              <th>Numéro</th>
              <th>Dépôt</th>
              <th>Client</th>
              <th>Statut</th>
              <th>Total net</th>
            </tr>
          </thead>
          <tbody>
            {ventes.map((v, index) => (
              <tr key={v.id} onClick={() => setVenteSelectionneeId(v.id)}>
                <td>{index + 1}</td>
                <td>{new Date(v.dateCreation).toLocaleString("fr-FR")}</td>
                <td>{v.numero}</td>
                <td>{v.depotNom}</td>
                <td>{v.clientNom ?? ""}</td>
                <td>
                  <span className={`badge-${v.statut}`}>{libelleStatutVente(v.statut)}</span>
                </td>
                <td>{formaterMontant(v.totalNet)}</td>
              </tr>
            ))}
            {ventes.length === 0 && (
              <tr>
                <td colSpan={7} className="liste-vide">
                  Aucune vente.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
