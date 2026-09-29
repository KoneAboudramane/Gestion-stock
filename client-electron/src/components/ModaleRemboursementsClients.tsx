import { useEffect, useState } from "react";

import { api } from "../api/client";
import type {
  ColonneExport,
  RemboursementClient,
  Session,
} from "../api/client";
import BoutonsExport from "./BoutonsExport";
import FiltrePeriodeHistorique from "./FiltrePeriodeHistorique";
import { useDevise } from "../contexts/DeviseContext";
import { useNomsUtilisateurs } from "../hooks/useNomsUtilisateurs";
import { formaterMontant } from "../lib/formatage";
import { libelleModePaiement } from "../lib/libelles";
import {
  bornesPeriode,
  dansPeriode,
  jourLocal,
  type PeriodeHistorique,
} from "../lib/periode";

/** Page Historique : tous les remboursements reçus sur les crédits clients. */
export default function ModaleRemboursementsClients({
  session,
  onFermer,
}: {
  session: Session;
  onFermer: () => void;
}) {
  const devise = useDevise();
  const nomUtilisateur = useNomsUtilisateurs(session);
  const [remboursements, setRemboursements] = useState<RemboursementClient[]>(
    [],
  );
  const [periode, setPeriode] = useState<PeriodeHistorique>("mois");
  const [debutPerso, setDebutPerso] = useState(jourLocal(new Date()));
  const [finPerso, setFinPerso] = useState(jourLocal(new Date()));
  const [terme, setTerme] = useState("");

  useEffect(() => {
    api.credits.remboursements(session.boutiqueId).then(setRemboursements);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.boutiqueId]);

  const cle = terme.trim().toLowerCase();
  const filtres = remboursements.filter(
    (r) =>
      dansPeriode(
        r.dateCreation,
        bornesPeriode(periode, debutPerso, finPerso),
      ) &&
      (!cle ||
        r.clientNom.toLowerCase().includes(cle) ||
        (r.venteNumero ?? "").toLowerCase().includes(cle)),
  );
  const total = filtres.reduce((t, r) => t + r.montant, 0);
  const nombreClients = new Set(filtres.map((r) => r.clientNom)).size;

  const colonnesExport: ColonneExport[] = [
    { cle: "date", libelle: "Date" },
    { cle: "client", libelle: "Client" },
    { cle: "vente", libelle: "Vente" },
    { cle: "mode", libelle: "Mode" },
    { cle: "montant", libelle: `Montant (${devise})` },
    { cle: "par", libelle: "Encaissé par" },
  ];
  const lignesExport = filtres.map((r) => ({
    date: new Date(r.dateCreation).toLocaleString("fr-FR"),
    client: r.clientNom,
    vente: r.venteNumero ?? "",
    mode: libelleModePaiement(r.mode),
    montant: r.montant,
    par: nomUtilisateur(r.utilisateurId),
  }));

  return (
    <div className="fond-modale" onClick={onFermer}>
      <div
        className="modale-selection-produits"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modale-entete">
          <h3>Remboursements clients</h3>
          <button
            type="button"
            className="lien bouton-retour"
            onClick={onFermer}
          >
            ← Retour
          </button>
        </div>
        <div className="modale-corps">
          <div className="tuiles-fiche">
            <div className="tuile-fiche">
              <span className="sous-info">💰 Encaissé</span>
              <strong className="nowrap">
                {formaterMontant(total)} {devise}
              </strong>
            </div>
            <div className="tuile-fiche">
              <span className="sous-info">💳 Remboursements</span>
              <strong>{filtres.length}</strong>
            </div>
            <div className="tuile-fiche">
              <span className="sous-info">👥 Clients</span>
              <strong>{nombreClients}</strong>
            </div>
            <div className="tuile-fiche">
              <span className="sous-info">📊 Remboursement moyen</span>
              <strong className="nowrap">
                {formaterMontant(
                  filtres.length > 0 ? Math.round(total / filtres.length) : 0,
                )}{" "}
                {devise}
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
            <input
              type="search"
              placeholder="Client ou n° de vente…"
              value={terme}
              onChange={(e) => setTerme(e.target.value)}
            />
            <BoutonsExport
              titre="Remboursements clients"
              colonnes={colonnesExport}
              lignes={lignesExport}
              compact
            />
          </div>
          <div className="zone-tableau-scroll zone-commandes-fiche">
            <table className="tableau-catalogue">
              <thead>
                <tr>
                  <th>N°</th>
                  <th>Date</th>
                  <th>Client</th>
                  <th>Vente</th>
                  <th>Mode</th>
                  <th>Montant</th>
                  <th>Encaissé par</th>
                </tr>
              </thead>
              <tbody>
                {filtres.map((r, index) => (
                  <tr key={r.id}>
                    <td data-label="N°">{index + 1}</td>
                    <td data-label="Date">
                      {new Date(r.dateCreation).toLocaleString("fr-FR")}
                    </td>
                    <td data-label="Client">{r.clientNom}</td>
                    <td data-label="Vente">{r.venteNumero ?? ""}</td>
                    <td data-label="Mode">{libelleModePaiement(r.mode)}</td>
                    <td data-label="Montant" className="nowrap montant-entree">
                      +{formaterMontant(r.montant)} {devise}
                    </td>
                    <td data-label="Encaissé par">
                      {nomUtilisateur(r.utilisateurId)}
                    </td>
                  </tr>
                ))}
                {filtres.length === 0 && (
                  <tr>
                    <td colSpan={7} className="liste-vide">
                      {remboursements.length === 0
                        ? "Aucun remboursement."
                        : "Aucun remboursement sur cette période."}
                    </td>
                  </tr>
                )}
                {Array.from({
                  length: Math.max(0, 10 - Math.max(1, filtres.length)),
                }).map((_, i) => (
                  <tr key={`vide-${i}`} className="ligne-groupe-vide">
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
      </div>
    </div>
  );
}
