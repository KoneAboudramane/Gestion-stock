import { useEffect, useState } from "react";

import { api } from "../api/client";
import type {
  Depot,
  FournisseurMobileMoney,
  PaiementDetail,
  Session,
  StatutVenteHistorique,
  TransactionResume,
  VenteDetail,
  VenteResume,
} from "../api/client";
import { useDevise } from "../contexts/DeviseContext";
import {
  FOURNISSEURS_MOBILE_MONEY,
  libelleFournisseurMobileMoney,
  libelleModePaiement,
  libelleStatutTransactionMobileMoney,
  libelleStatutVente,
} from "../lib/libelles";

const STATUTS: { valeur: StatutVenteHistorique | ""; label: string }[] = [
  { valeur: "", label: "Tous les statuts" },
  { valeur: "payee", label: "Payée" },
  { valeur: "credit", label: "Crédit" },
  { valeur: "annulee", label: "Annulée" },
];

// --- Paiement mobile money (Phase 2, squelette simulé) ---

function PaiementMobileMoney({ paiement }: { paiement: PaiementDetail }) {
  const [transaction, setTransaction] = useState<TransactionResume | null | undefined>(undefined);
  const [afficherForm, setAfficherForm] = useState(false);
  const [fournisseur, setFournisseur] = useState<FournisseurMobileMoney>("wave");
  const [numeroTelephone, setNumeroTelephone] = useState("");
  const [erreur, setErreur] = useState<string | null>(null);
  const [enCours, setEnCours] = useState(false);

  async function rafraichir() {
    setTransaction((await api.paiements.obtenirTransaction(paiement.id)) ?? null);
  }
  useEffect(() => {
    rafraichir();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paiement.id]);

  async function initier(evenement: React.FormEvent) {
    evenement.preventDefault();
    setErreur(null);
    setEnCours(true);
    try {
      const resultat = await api.paiements.initier({
        paiementId: paiement.id,
        fournisseur,
        numeroTelephone,
        montant: paiement.montant,
      });
      if (resultat.succes) {
        setAfficherForm(false);
        rafraichir();
      } else {
        setErreur(resultat.message);
      }
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
          <input
            placeholder="Numéro de téléphone"
            value={numeroTelephone}
            onChange={(e) => setNumeroTelephone(e.target.value)}
          />
          <button type="submit" disabled={enCours}>
            {enCours ? "…" : "Initier"}
          </button>
          {erreur && <span className="message-erreur">{erreur}</span>}
        </form>
      ) : (
        <button type="button" onClick={() => setAfficherForm(true)}>
          Initier le paiement mobile money
        </button>
      )}
    </div>
  );
}

function DetailVente({
  venteId,
  session,
  onRetour,
}: {
  venteId: string;
  session: Session;
  onRetour: () => void;
}) {
  const peutAnnuler = !!session.permissions.annuler_vente;
  const devise = useDevise();
  const [vente, setVente] = useState<VenteDetail | null>(null);
  const [confirmation, setConfirmation] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const [enCours, setEnCours] = useState(false);

  async function rafraichir() {
    setVente((await api.ventes.obtenir(venteId)) ?? null);
  }
  useEffect(() => {
    rafraichir();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [venteId]);

  async function confirmerAnnulation() {
    setEnCours(true);
    setErreur(null);
    try {
      const resultat = await api.ventes.annuler(venteId, session.utilisateurId);
      if (resultat.succes) {
        setConfirmation(false);
        rafraichir();
      } else {
        setErreur(resultat.message);
      }
    } finally {
      setEnCours(false);
    }
  }

  if (!vente) return <p>Chargement…</p>;
  const estAnnulee = vente.statut === "annulee";

  return (
    <div className="detail-produit">
      <div className="entete-detail">
        <h3>
          Vente {vente.numero} <span className={`badge-${vente.statut}`}>{libelleStatutVente(vente.statut)}</span>
        </h3>
        <button type="button" className="lien bouton-retour" onClick={onRetour}>
          ← Retour à la liste
        </button>
      </div>
      <p>
        Dépôt : {vente.depotNom} · Client : {vente.clientNom ?? ""} · {new Date(vente.dateCreation).toLocaleString("fr-FR")}
      </p>
      {erreur && <div className="message-erreur">{erreur}</div>}

      <div className="zone-tableau-scroll">
      <table className="tableau-catalogue">
        <thead>
          <tr>
            <th>Produit</th>
            <th>Référence</th>
            <th>Qté</th>
            <th>PU</th>
            <th>Remise</th>
            <th>Sous-total</th>
          </tr>
        </thead>
        <tbody>
          {vente.lignes.map((l) => (
            <tr key={l.id}>
              <td>{l.produitNom}</td>
              <td>{l.reference || ""}</td>
              <td>{l.quantite}</td>
              <td>{l.prixUnitaire}</td>
              <td>{l.remise}</td>
              <td>{l.sousTotal}</td>
            </tr>
          ))}
        </tbody>
      </table>
      </div>

      <div className="totaux">
        <div>Total brut : {vente.totalBrut} {devise}</div>
        <div>Remise : {vente.remise} {devise}</div>
        <div className="total-net">Total net : {vente.totalNet} {devise}</div>
      </div>

      <div className="paiements">
        <h3>Paiements</h3>
        <ul className="liste-simple">
          {vente.paiements.map((p) => (
            <li key={p.id}>
              {libelleModePaiement(p.mode)} : {p.montant} {devise}
              {p.mode === "mobile_money" && <PaiementMobileMoney paiement={p} />}
            </li>
          ))}
          {vente.paiements.length === 0 && <li className="liste-vide">Aucun paiement.</li>}
        </ul>
      </div>

      {!estAnnulee && peutAnnuler && !confirmation && (
        <button type="button" onClick={() => setConfirmation(true)}>
          Annuler la vente
        </button>
      )}
      {!estAnnulee && peutAnnuler && confirmation && (
        <div className="actions-formulaire">
          <span>Confirmer l'annulation de cette vente ? Le stock sera recrédité.</span>
          <button type="button" onClick={() => setConfirmation(false)}>
            Non
          </button>
          <button type="button" onClick={confirmerAnnulation} disabled={enCours}>
            {enCours ? "Annulation…" : "Confirmer l'annulation"}
          </button>
        </div>
      )}
    </div>
  );
}

export default function Ventes({ session }: { session: Session }) {
  const peutGerer = !!session.permissions.gerer_produits_stock_achats;
  const [depots, setDepots] = useState<Depot[]>([]);
  const [depotId, setDepotId] = useState(peutGerer ? "" : (session.depotId ?? ""));
  const [statut, setStatut] = useState<StatutVenteHistorique | "">("");
  const [terme, setTerme] = useState("");
  const [ventes, setVentes] = useState<VenteResume[]>([]);
  const [venteSelectionneeId, setVenteSelectionneeId] = useState<string | null>(null);

  useEffect(() => {
    if (peutGerer) api.catalogue.listerDepots(session.boutiqueId).then(setDepots);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.boutiqueId, peutGerer]);

  async function rafraichir() {
    setVentes(await api.ventes.lister(session.boutiqueId, depotId || undefined, statut || undefined, terme));
  }
  useEffect(() => {
    rafraichir();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [depotId, statut, terme]);

  if (venteSelectionneeId) {
    return (
      <div className="page-produits">
        <h2>Historique des ventes</h2>
        <DetailVente
          venteId={venteSelectionneeId}
          session={session}
          onRetour={() => {
            setVenteSelectionneeId(null);
            rafraichir();
          }}
        />
      </div>
    );
  }

  return (
    <div className="page-produits">
      <h2>Historique des ventes</h2>
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
        <select value={statut} onChange={(e) => setStatut(e.target.value as StatutVenteHistorique | "")}>
          {STATUTS.map((s) => (
            <option key={s.valeur} value={s.valeur}>
              {s.label}
            </option>
          ))}
        </select>
        <input
          className="champ-recherche"
          placeholder="Rechercher par numéro ou client…"
          value={terme}
          onChange={(e) => setTerme(e.target.value)}
        />
      </div>
      <div className="zone-tableau-scroll">
      <table className="tableau-catalogue">
        <thead>
          <tr>
            <th>Date</th>
            <th>Numéro</th>
            <th>Dépôt</th>
            <th>Client</th>
            <th>Statut</th>
            <th>Total net</th>
          </tr>
        </thead>
        <tbody>
          {ventes.map((v) => (
            <tr key={v.id} onClick={() => setVenteSelectionneeId(v.id)}>
              <td>{new Date(v.dateCreation).toLocaleString("fr-FR")}</td>
              <td>{v.numero}</td>
              <td>{v.depotNom}</td>
              <td>{v.clientNom ?? ""}</td>
              <td>
                <span className={`badge-${v.statut}`}>{libelleStatutVente(v.statut)}</span>
              </td>
              <td>{v.totalNet}</td>
            </tr>
          ))}
          {ventes.length === 0 && (
            <tr>
              <td colSpan={6} className="liste-vide">
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
