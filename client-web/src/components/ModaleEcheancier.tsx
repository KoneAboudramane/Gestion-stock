import { useState } from "react";

import type { EcheanceDetail } from "../services/echeancier";
import PlanificateurEcheancier from "./PlanificateurEcheancier";
import { useDevise } from "../contexts/DeviseContext";
import { LIBELLES_STATUT_ECHEANCE } from "../lib/echeancier";
import { formaterMontant } from "../lib/formatage";

/**
 * Fenêtre de l'échéancier d'une dette fournisseur ou d'un crédit client : les
 * tranches et leur statut (les « traces »), et le planificateur pour le créer
 * ou le modifier. Le parent charge les tranches et enregistre le plan.
 */
export default function ModaleEcheancier({
  titre,
  reste,
  enCours,
  peutGerer,
  echeances,
  onPlanifier,
  onFermer,
}: {
  titre: string;
  reste: number;
  enCours: boolean;
  peutGerer: boolean;
  echeances: EcheanceDetail[];
  /** Enregistre le plan ; renvoie un message d'erreur, ou null si c'est fait. */
  onPlanifier: (tranches: { dateEcheance: string; montant: number }[]) => Promise<string | null>;
  onFermer: () => void;
}) {
  const devise = useDevise();
  const [planification, setPlanification] = useState(echeances.length === 0 && peutGerer && enCours);
  const [erreur, setErreur] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function enregistrer(tranches: { dateEcheance: string; montant: number }[]) {
    setErreur(null);
    setMessage(null);
    const resultat = await onPlanifier(tranches);
    if (resultat) {
      setErreur(resultat);
      return;
    }
    setPlanification(false);
    setMessage("Échéancier enregistré.");
  }

  const prochaineId = echeances.find((e) => e.statut !== "payee")?.id;
  const payees = echeances.filter((e) => e.statut === "payee").length;
  const enRetard = echeances.filter((e) => e.statut === "en_retard").length;
  const resteTranches = echeances.reduce((t, e) => t + e.montant - e.couvert, 0);

  return (
    <div className="fond-modale" onClick={onFermer}>
      <div className="modale-selection-produits" onClick={(e) => e.stopPropagation()}>
        <div className="modale-entete">
          <h3>{titre}</h3>
          <button type="button" className="lien bouton-retour" onClick={onFermer}>
            ← Retour
          </button>
        </div>
        <div className="modale-corps">
          <div className="entete-section-echeancier">
            <span>
              Reste à payer :{" "}
              <strong>
                {formaterMontant(reste)} {devise}
              </strong>
            </span>
            {peutGerer && enCours && !planification && (
              <button type="button" className="bouton-primaire" onClick={() => setPlanification(true)}>
                {echeances.length > 0 ? "Modifier l'échéancier" : "Planifier un échéancier"}
              </button>
            )}
          </div>
          {erreur && <div className="message-erreur">{erreur}</div>}
          {message && <div className="message-succes">{message}</div>}
          {planification ? (
            <PlanificateurEcheancier
              reste={reste}
              dejaPlanifie={echeances.length > 0}
              onAnnuler={() => setPlanification(false)}
              onEnregistrer={enregistrer}
            />
          ) : (
            <>
              <h4>Tranches</h4>
              <div className="zone-tableau-scroll zone-traces-dette">
                <table className="tableau-catalogue carte-mobile">
                  <thead>
                    <tr>
                      <th>N°</th>
                      <th>Échéance</th>
                      <th>Montant</th>
                      <th>Déjà couvert</th>
                      <th>Reste</th>
                      <th>Statut</th>
                    </tr>
                  </thead>
                  <tbody>
                    {echeances.map((e, index) => (
                      <tr key={e.id} className={e.id === prochaineId ? "ligne-prochaine-echeance" : undefined}>
                        <td data-label="N°">{index + 1}</td>
                        <td data-label="Échéance">{new Date(`${e.dateEcheance}T00:00:00`).toLocaleDateString("fr-FR")}</td>
                        <td data-label="Montant">{formaterMontant(e.montant)} {devise}</td>
                        <td data-label="Déjà couvert">{formaterMontant(e.couvert)} {devise}</td>
                        <td data-label="Reste">{formaterMontant(e.montant - e.couvert)} {devise}</td>
                        <td data-label="Statut"><span className={LIBELLES_STATUT_ECHEANCE[e.statut].classe}>{LIBELLES_STATUT_ECHEANCE[e.statut].label}</span></td>
                      </tr>
                    ))}
                    {echeances.length === 0 && (
                      <tr>
                        <td colSpan={6} className="liste-vide">
                          Pas d'échéancier : le remboursement se fait librement, un peu à la fois ou d'un coup.
                        </td>
                      </tr>
                    )}
                    {Array.from({ length: Math.max(0, 10 - Math.max(1, echeances.length)) }).map((_, i) => (
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
              {echeances.length > 0 && (
                <div className="totaux">
                  <div>
                    {echeances.length} tranche{echeances.length > 1 ? "s" : ""} · {payees} payée{payees > 1 ? "s" : ""}
                    {enRetard > 0 && ` · ${enRetard} en retard`}
                  </div>
                  <div className="total-net">
                    Reste sur les tranches : {formaterMontant(resteTranches)} {devise}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
