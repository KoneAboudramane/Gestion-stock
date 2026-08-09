import { useEffect, useState } from "react";

import { api } from "../api";
import type { Session } from "../api";
import FactureVente from "../components/FactureVente";
import ModaleConfirmation from "../components/ModaleConfirmation";
import { useDevise } from "../contexts/DeviseContext";
import { formaterMontant } from "../lib/formatage";
import { libelleModePaiement, libelleStatutVente } from "../lib/libelles";
import { listerDepots, type DepotResume } from "../services/catalogue";
import { listerVentesLocales, obtenirVenteDetail, type StatutVente, type VenteDetail, type VenteResumeLocale } from "../services/ventes";

/**
 * Port simplifié de client-electron/src/pages/Ventes.tsx : historique des
 * ventes lu depuis IndexedDB (les mêmes données déjà synchronisées que la
 * Caisse et FactureVente utilisent — voir services/ventes.ts). L'annulation
 * est la seule écriture, et passe par le serveur (recréditer le stock, inverser
 * un crédit éventuel est une vraie logique métier, sans miroir local) : voir
 * ventes/services.py::annuler_vente. Une resynchronisation immédiate rapatrie
 * le résultat dans IndexedDB.
 *
 * Non repris ici par rapport à l'Electron : le suivi des paiements Mobile Money
 * (Phase 2, squelette simulé côté Electron — hors périmètre).
 */

const STATUTS: { valeur: StatutVente | ""; label: string }[] = [
  { valeur: "", label: "Tous les statuts" },
  { valeur: "payee", label: "Payée" },
  { valeur: "credit", label: "Crédit" },
  { valeur: "annulee", label: "Annulée" },
];

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
      const resultat = await api.ventes.annuler(venteId);
      if (resultat.succes) {
        await api.sync.executer(session);
        setConfirmation(false);
        rafraichir();
      } else {
        setErreur(resultat.message);
      }
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
