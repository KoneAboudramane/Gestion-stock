import { useState } from "react";

import { api } from "../api";
import { BadgeAbonnement, Chargement, Erreur } from "../composants/Commun";
import { dateHeure } from "../format";
import type { DemandeReseau } from "../types";
import { useChargement } from "../useChargement";

export default function DemandesReseau() {
  const [statut, setStatut] = useState("en_attente");
  const [enCours, setEnCours] = useState<string | null>(null);
  const [erreurAction, setErreurAction] = useState("");
  const { donnees, erreur, enCours: chargement, recharger } = useChargement(
    () => api<DemandeReseau[]>(`/admin/demandes-reseau/?statut=${statut}`),
    [statut],
  );

  async function traiter(d: DemandeReseau, action: "accepter" | "refuser") {
    const question =
      action === "accepter"
        ? `Activer le réseau de la boutique « ${d.boutique.nom} » ? Ses ordinateurs pourront être reliés entre eux sans internet.`
        : `Refuser la demande de réseau de « ${d.boutique.nom} » ?`;
    if (!window.confirm(question)) return;
    setEnCours(d.id);
    setErreurAction("");
    try {
      await api(`/admin/demandes-reseau/${d.id}/`, { method: "POST", body: JSON.stringify({ action }) });
      await recharger();
    } catch (e) {
      setErreurAction((e as Error).message);
    } finally {
      setEnCours(null);
    }
  }

  return (
    <div className="pile">
      <p className="aide">
        Le responsable d'une boutique demande depuis l'appli à relier plusieurs ordinateurs (poste principal + caisses)
        qui travaillent ensemble sans internet.
      </p>
      <div className="pilules">
        {[
          ["en_attente", "En attente"],
          ["acceptee", "Acceptées"],
          ["refusee", "Refusées"],
          ["toutes", "Toutes"],
        ].map(([v, l]) => (
          <button key={v} type="button" className={`pilule${statut === v ? " active" : ""}`} onClick={() => setStatut(v)}>
            {l}
          </button>
        ))}
      </div>
      {(erreur || erreurAction) && <Erreur message={erreur || erreurAction} reessayer={erreur ? recharger : undefined} />}
      {chargement && !donnees ? (
        <Chargement />
      ) : (
        donnees && (
          <section className="carte carte-tableau">
            {donnees.length === 0 ? (
              <p className="vide">{statut === "en_attente" ? "Aucune demande en attente. 🎉" : "Aucune demande."}</p>
            ) : (
              <div className="defilement-tableau">
                <table className="tableau">
                  <thead>
                    <tr>
                      <th>Reçue le</th>
                      <th>Boutique</th>
                      <th>Abonnement</th>
                      <th>Demandeur</th>
                      <th>Note</th>
                      <th>Décision</th>
                    </tr>
                  </thead>
                  <tbody>
                    {donnees.map((d) => (
                      <tr key={d.id}>
                        <td>{dateHeure(d.date)}</td>
                        <td>
                          <a href={`#/boutiques/${d.boutique.id}`}>
                            <strong>{d.boutique.nom}</strong>
                          </a>
                          <small className="sous-ligne">Réseau {d.boutique.reseau_autorise ? "activé" : "non activé"}</small>
                        </td>
                        <td>
                          <BadgeAbonnement etat={d.boutique.abonnement} />
                        </td>
                        <td>{d.demandeur || "—"}</td>
                        <td>{d.note || "—"}</td>
                        <td>
                          {d.statut === "en_attente" ? (
                            <span className="boutons-ligne">
                              <button type="button" className="bouton-danger" disabled={enCours === d.id} onClick={() => traiter(d, "refuser")}>
                                Refuser
                              </button>
                              <button type="button" className="bouton-principal" disabled={enCours === d.id} onClick={() => traiter(d, "accepter")}>
                                Activer
                              </button>
                            </span>
                          ) : (
                            <>
                              {d.statut_libelle}
                              <small className="sous-ligne">
                                {dateHeure(d.date_traitement)}
                                {d.traitee_par && ` · ${d.traitee_par}`}
                              </small>
                            </>
                          )}
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
