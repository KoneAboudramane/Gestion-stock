import { useEffect, useState } from "react";

import { api } from "../api";
import { Chargement, Erreur } from "../composants/Commun";
import { dateHeure } from "../format";
import { libelleAction } from "../libelles";
import type { LigneJournal } from "../types";
import { useChargement } from "../useChargement";

interface Donnees {
  admins: string[];
  actions: string[];
  lignes: LigneJournal[];
}

export default function Journal() {
  const [filtres, setFiltres] = useState({ admin: "", action: "", origine: "", du: "", au: "", recherche: "" });
  const [saisie, setSaisie] = useState("");
  useEffect(() => {
    const minuteur = setTimeout(() => setFiltres((f) => ({ ...f, recherche: saisie.trim() })), 300);
    return () => clearTimeout(minuteur);
  }, [saisie]);

  const { donnees, erreur, enCours, recharger } = useChargement(
    () => api<Donnees>(`/admin/journal/?${new URLSearchParams(filtres)}`),
    [JSON.stringify(filtres)],
  );
  const maj = (cle: keyof typeof filtres, valeur: string) => setFiltres((f) => ({ ...f, [cle]: valeur }));

  return (
    <div className="pile">
      <div className="barre-filtres ligne-champs">
        <label>
          Administrateur
          <select value={filtres.admin} onChange={(e) => maj("admin", e.target.value)}>
            <option value="">Tous</option>
            {donnees?.admins.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
        </label>
        <label>
          Action
          <select value={filtres.action} onChange={(e) => maj("action", e.target.value)}>
            <option value="">Toutes</option>
            {donnees?.actions.map((a) => (
              <option key={a} value={a}>
                {libelleAction(a)}
              </option>
            ))}
          </select>
        </label>
        <label>
          Depuis
          <select value={filtres.origine} onChange={(e) => maj("origine", e.target.value)}>
            <option value="">Partout</option>
            <option value="espace_admin">Site d'administration</option>
            <option value="bureau">Espace Admin de l'appli</option>
          </select>
        </label>
        <label>
          Du
          <input type="date" value={filtres.du} onChange={(e) => maj("du", e.target.value)} />
        </label>
        <label>
          Au
          <input type="date" value={filtres.au} onChange={(e) => maj("au", e.target.value)} />
        </label>
        <label style={{ flex: 1, minWidth: 220 }}>
          Recherche
          <input type="search" placeholder="Boutique, détail…" value={saisie} onChange={(e) => setSaisie(e.target.value)} />
        </label>
      </div>

      {erreur && <Erreur message={erreur} reessayer={recharger} />}
      {enCours && !donnees ? (
        <Chargement />
      ) : (
        donnees && (
          <section className="carte carte-tableau">
            <p className="compteur">
              {donnees.lignes.length} action{donnees.lignes.length > 1 ? "s" : ""}
              {donnees.lignes.length === 500 ? " (500 plus récentes : affinez les filtres)" : ""}
            </p>
            {donnees.lignes.length === 0 ? (
              <p className="vide">Aucune action.</p>
            ) : (
              <div className="defilement-tableau">
                <table className="tableau">
                  <thead>
                    <tr>
                      <th>Quand</th>
                      <th>Qui</th>
                      <th>Action</th>
                      <th>Boutique</th>
                      <th>Détail</th>
                      <th>Depuis</th>
                    </tr>
                  </thead>
                  <tbody>
                    {donnees.lignes.map((l) => (
                      <tr key={l.id}>
                        <td>{dateHeure(l.date)}</td>
                        <td>
                          <strong>{l.admin}</strong>
                        </td>
                        <td>{libelleAction(l.action)}</td>
                        <td>
                          {l.boutique ? (
                            l.boutique.id ? <a href={`#/boutiques/${l.boutique.id}`}>{l.boutique.nom}</a> : l.boutique.nom
                          ) : (
                            "—"
                          )}
                        </td>
                        <td>{l.detail || "—"}</td>
                        <td>
                          {l.origine_libelle}
                          {l.adresse_ip && <small className="sous-ligne">{l.adresse_ip}</small>}
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
