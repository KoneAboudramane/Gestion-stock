import { useEffect, useState } from "react";

import { api } from "../api";
import { BadgeAbonnement, Chargement, Erreur } from "../composants/Commun";
import { date, depuis } from "../format";
import type { ResumeBoutique } from "../types";
import { useChargement } from "../useChargement";
import FicheBoutique from "./FicheBoutique";

const ETATS = [
  { valeur: "", libelle: "Toutes" },
  { valeur: "bientot", libelle: "Finissent bientôt" },
  { valeur: "grace", libelle: "Délai de grâce" },
  { valeur: "bloque", libelle: "Ventes bloquées" },
  { valeur: "ok", libelle: "À jour" },
  { valeur: "illimite", libelle: "Sans limite" },
  { valeur: "inactive", libelle: "Désactivées" },
];

function idDansLAdresse(): string | null {
  return window.location.hash.split("/")[2] || null;
}

export default function Boutiques() {
  const [saisie, setSaisie] = useState("");
  const [recherche, setRecherche] = useState("");
  const [etat, setEtat] = useState("");
  const [ouverte, setOuverte] = useState<string | null>(idDansLAdresse);

  // La recherche part 300 ms après la dernière frappe.
  useEffect(() => {
    const minuteur = setTimeout(() => setRecherche(saisie.trim()), 300);
    return () => clearTimeout(minuteur);
  }, [saisie]);

  useEffect(() => {
    const suivre = () => setOuverte(idDansLAdresse());
    window.addEventListener("hashchange", suivre);
    return () => window.removeEventListener("hashchange", suivre);
  }, []);

  const { donnees, setDonnees, erreur, enCours, recharger } = useChargement(
    () => api<ResumeBoutique[]>(`/admin/boutiques/?${new URLSearchParams({ recherche, etat })}`),
    [recherche, etat],
  );

  function ouvrir(id: string | null) {
    window.location.hash = id ? `#/boutiques/${id}` : "#/boutiques";
  }

  return (
    <div className="pile">
      <div className="barre-filtres">
        <input
          type="search"
          className="champ-recherche"
          placeholder="Rechercher : nom, téléphone, e-mail, identifiant du patron…"
          value={saisie}
          onChange={(e) => setSaisie(e.target.value)}
        />
        <div className="pilules" role="group" aria-label="Filtrer par état">
          {ETATS.map((e) => (
            <button
              key={e.valeur}
              type="button"
              className={`pilule${etat === e.valeur ? " active" : ""}`}
              onClick={() => setEtat(e.valeur)}
            >
              {e.libelle}
            </button>
          ))}
        </div>
      </div>

      {erreur && <Erreur message={erreur} reessayer={recharger} />}
      {enCours && !donnees ? (
        <Chargement />
      ) : (
        donnees && (
          <section className="carte carte-tableau">
            <p className="compteur">
              {donnees.length} boutique{donnees.length > 1 ? "s" : ""}
              {donnees.length === 500 ? " (500 premières : affinez la recherche)" : ""}
            </p>
            {donnees.length === 0 ? (
              <p className="vide">Aucune boutique ne correspond.</p>
            ) : (
              <div className="defilement-tableau">
                <table className="tableau">
                  <thead>
                    <tr>
                      <th>Boutique</th>
                      <th>Patron</th>
                      <th>Formule</th>
                      <th>Abonnement</th>
                      <th>Fin</th>
                      <th>Utilisateurs</th>
                      <th>Dernière synchro</th>
                    </tr>
                  </thead>
                  <tbody>
                    {donnees.map((b) => (
                      <tr key={b.id} className="ligne-cliquable" onClick={() => ouvrir(b.id)}>
                        <td>
                          <strong>{b.nom}</strong>
                          <small className="sous-ligne">{b.telephone || b.email}</small>
                        </td>
                        <td>
                          {b.patron?.nom || b.patron?.username || "—"}
                          {b.patron && <small className="sous-ligne">{b.patron.telephone || b.patron.email}</small>}
                        </td>
                        <td>{b.formule_libelle}</td>
                        <td>
                          <BadgeAbonnement etat={b.abonnement} actif={b.actif} />
                        </td>
                        <td>{date(b.date_expiration_abonnement)}</td>
                        <td className="nombre">{b.nb_utilisateurs}</td>
                        <td>{b.synchro_autorisee ? depuis(b.derniere_synchro) : <span className="discret">désactivée</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        )
      )}

      {ouverte && (
        <FicheBoutique
          id={ouverte}
          surFermer={() => ouvrir(null)}
          surModifiee={(b) => setDonnees((liste) => liste?.map((x) => (x.id === b.id ? { ...x, ...b } : x)) ?? null)}
        />
      )}
    </div>
  );
}
