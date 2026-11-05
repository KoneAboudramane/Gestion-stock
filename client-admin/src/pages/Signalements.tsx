import { useState } from "react";

import { api } from "../api";
import { Chargement, Erreur } from "../composants/Commun";
import { dateHeure } from "../format";
import type { Signalement } from "../types";
import { useChargement } from "../useChargement";

export default function Signalements() {
  const [traites, setTraites] = useState(false);
  const [erreurAction, setErreurAction] = useState("");
  const { donnees, setDonnees, erreur, enCours, recharger } = useChargement(
    () => api<Signalement[]>(`/admin/signalements/?traites=${traites ? 1 : 0}`),
    [traites],
  );

  async function basculer(s: Signalement) {
    setErreurAction("");
    try {
      await api(`/admin/signalements/${s.id}/`, { method: "POST", body: JSON.stringify({ traite: !s.traite }) });
      setDonnees((liste) => liste?.filter((x) => x.id !== s.id) ?? null);
    } catch (e) {
      setErreurAction((e as Error).message);
    }
  }

  return (
    <div className="pile">
      <p className="aide">
        Anomalies reçues par la synchronisation : vente datée après la fin de l'abonnement, dépôt au-delà de la
        formule… La donnée a été gardée. L'appli bloque normalement ces cas : un signalement peut indiquer un poste
        modifié ou une horloge déréglée. Contactez la boutique, puis marquez-le traité.
      </p>
      <div className="pilules">
        <button type="button" className={`pilule${!traites ? " active" : ""}`} onClick={() => setTraites(false)}>
          À traiter
        </button>
        <button type="button" className={`pilule${traites ? " active" : ""}`} onClick={() => setTraites(true)}>
          Traités
        </button>
      </div>
      {(erreur || erreurAction) && <Erreur message={erreur || erreurAction} reessayer={erreur ? recharger : undefined} />}
      {enCours && !donnees ? (
        <Chargement />
      ) : (
        donnees && (
          <section className="carte carte-tableau">
            {donnees.length === 0 ? (
              <p className="vide">{traites ? "Aucun signalement traité." : "Aucun signalement à traiter. 🎉"}</p>
            ) : (
              <div className="defilement-tableau">
                <table className="tableau">
                  <thead>
                    <tr>
                      <th>Reçu le</th>
                      <th>Boutique</th>
                      <th>Anomalie</th>
                      <th>Détail</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {donnees.map((s) => (
                      <tr key={s.id}>
                        <td>{dateHeure(s.date)}</td>
                        <td>
                          <a href={`#/boutiques/${s.boutique.id}`}>
                            <strong>{s.boutique.nom}</strong>
                          </a>
                        </td>
                        <td>{s.type_libelle}</td>
                        <td>{s.detail || "—"}</td>
                        <td>
                          <button type="button" className="bouton-secondaire" onClick={() => basculer(s)}>
                            {s.traite ? "Rouvrir" : "✓ Traité"}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        )
      )}
    </div>
  );
}
