import { useState } from "react";

import { api } from "../api";
import { Chargement, Erreur, Info, Modale } from "../composants/Commun";
import { date, dateHeure, dansNJours } from "../format";
import type { DemandeInscription } from "../types";
import { useChargement } from "../useChargement";

const STATUTS = [
  { valeur: "en_attente", libelle: "En attente" },
  { valeur: "approuvee", libelle: "Approuvées" },
  { valeur: "rejetee", libelle: "Rejetées" },
  { valeur: "toutes", libelle: "Toutes" },
];

interface Liste {
  duree_essai_jours: number;
  demandes: DemandeInscription[];
}

export default function Inscriptions() {
  const [statut, setStatut] = useState("en_attente");
  const [ouverte, setOuverte] = useState<DemandeInscription | null>(null);
  const { donnees, erreur, enCours, recharger } = useChargement(
    () => api<Liste>(`/admin/inscriptions/?statut=${statut}`),
    [statut],
  );

  return (
    <div className="pile">
      <div className="pilules" role="group" aria-label="Filtrer par statut">
        {STATUTS.map((s) => (
          <button
            key={s.valeur}
            type="button"
            className={`pilule${statut === s.valeur ? " active" : ""}`}
            onClick={() => setStatut(s.valeur)}
          >
            {s.libelle}
          </button>
        ))}
      </div>

      {erreur && <Erreur message={erreur} reessayer={recharger} />}
      {enCours && !donnees ? (
        <Chargement />
      ) : (
        donnees && (
          <section className="carte carte-tableau">
            {donnees.demandes.length === 0 ? (
              <p className="vide">{statut === "en_attente" ? "Aucune demande en attente. 🎉" : "Aucune demande."}</p>
            ) : (
              <div className="defilement-tableau">
                <table className="tableau">
                  <thead>
                    <tr>
                      <th>Reçue le</th>
                      <th>Boutique</th>
                      <th>Demandeur</th>
                      <th>Contact</th>
                      <th>Formule</th>
                      <th>Statut</th>
                    </tr>
                  </thead>
                  <tbody>
                    {donnees.demandes.map((d) => (
                      <tr key={d.id} className="ligne-cliquable" onClick={() => setOuverte(d)}>
                        <td>{dateHeure(d.date)}</td>
                        <td>
                          <strong>{d.boutique_nom}</strong>
                          <small className="sous-ligne">{d.boutique_adresse}</small>
                        </td>
                        <td>
                          {d.nom || d.username}
                          <small className="sous-ligne">{d.username}</small>
                        </td>
                        <td>
                          {d.telephone || "—"}
                          <small className="sous-ligne">{d.email}</small>
                        </td>
                        <td>{d.formule_libelle}</td>
                        <td>
                          <span className={`badge ${{ en_attente: "badge-orange", approuvee: "badge-vert", rejetee: "badge-gris" }[d.statut]}`}>
                            {d.statut_libelle}
                          </span>
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

      {ouverte && donnees && (
        <TraiterDemande
          demande={ouverte}
          dureeEssai={donnees.duree_essai_jours}
          surFermer={() => setOuverte(null)}
          surTraitee={() => {
            setOuverte(null);
            void recharger();
          }}
        />
      )}
    </div>
  );
}

function TraiterDemande({
  demande,
  dureeEssai,
  surFermer,
  surTraitee,
}: {
  demande: DemandeInscription;
  dureeEssai: number;
  surFermer: () => void;
  surTraitee: () => void;
}) {
  const [formule, setFormule] = useState(demande.formule);
  const [dateFin, setDateFin] = useState(dansNJours(dureeEssai));
  const [enCours, setEnCours] = useState(false);
  const [erreur, setErreur] = useState("");

  async function traiter(action: "approuver" | "rejeter") {
    const question =
      action === "approuver"
        ? `Créer la boutique « ${demande.boutique_nom} » et son compte Patron « ${demande.username} » ? Un e-mail de bienvenue lui sera envoyé.`
        : `Rejeter la demande de « ${demande.boutique_nom} » ? Un e-mail le lui annoncera.`;
    if (!window.confirm(question)) return;
    setEnCours(true);
    setErreur("");
    try {
      await api(`/admin/inscriptions/${demande.id}/`, {
        method: "POST",
        body: JSON.stringify(action === "approuver" ? { action, formule, date_fin: dateFin } : { action }),
      });
      surTraitee();
    } catch (e) {
      setErreur((e as Error).message);
    } finally {
      setEnCours(false);
    }
  }

  return (
    <Modale titre={`Demande : ${demande.boutique_nom}`} surFermer={surFermer}>
      <div className="pile">
        <div className="deux-colonnes">
          <section className="carte">
            <h3>Boutique demandée</h3>
            <dl className="infos">
              <Info libelle="Nom">{demande.boutique_nom}</Info>
              <Info libelle="Adresse">{demande.boutique_adresse}</Info>
              <Info libelle="Téléphone">{demande.boutique_telephone}</Info>
              <Info libelle="E-mail">{demande.boutique_email}</Info>
              <Info libelle="Devise">{demande.boutique_devise}</Info>
            </dl>
          </section>
          <section className="carte">
            <h3>Futur Patron</h3>
            <dl className="infos">
              <Info libelle="Nom">{demande.nom}</Info>
              <Info libelle="Identifiant">{demande.username}</Info>
              <Info libelle="Téléphone">{demande.telephone}</Info>
              <Info libelle="E-mail">{demande.email}</Info>
              <Info libelle="Reçue le">{dateHeure(demande.date)}</Info>
            </dl>
          </section>
        </div>

        {demande.statut === "en_attente" ? (
          <section className="carte">
            <h3>Validation</h3>
            <div className="ligne-champs">
              <label>
                Formule
                <select value={formule} onChange={(e) => setFormule(e.target.value as typeof formule)}>
                  <option value="essentiel">Essentiel</option>
                  <option value="pro">Pro</option>
                </select>
              </label>
              <label>
                Fin de l'essai gratuit
                <input type="date" value={dateFin} min={dansNJours(0)} onChange={(e) => setDateFin(e.target.value)} required />
              </label>
            </div>
            <p className="aide">
              Par défaut {dureeEssai} jours d'essai, jusqu'au {date(new Date(`${dansNJours(dureeEssai)}T12:00`).toISOString())}.
            </p>
            {erreur && <Erreur message={erreur} />}
            <div className="actions">
              <button type="button" className="bouton-danger" disabled={enCours} onClick={() => traiter("rejeter")}>
                Rejeter
              </button>
              <button type="button" className="bouton-principal" disabled={enCours || !dateFin} onClick={() => traiter("approuver")}>
                {enCours ? "Enregistrement…" : "Approuver et créer la boutique"}
              </button>
            </div>
          </section>
        ) : (
          <p className="aide">Demande déjà traitée : {demande.statut_libelle.toLowerCase()}.</p>
        )}
      </div>
    </Modale>
  );
}
