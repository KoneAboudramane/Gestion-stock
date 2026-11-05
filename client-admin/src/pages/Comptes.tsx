import { type FormEvent, useEffect, useState } from "react";

import { api, ErreurApi } from "../api";
import { Chargement, Erreur, Modale } from "../composants/Commun";
import { dateHeure, motDePasseProvisoire } from "../format";
import type { CompteBoutique } from "../types";
import { useChargement } from "../useChargement";

export default function Comptes() {
  const [saisie, setSaisie] = useState("");
  const [recherche, setRecherche] = useState("");
  const [choisi, setChoisi] = useState<CompteBoutique | null>(null);

  useEffect(() => {
    const minuteur = setTimeout(() => setRecherche(saisie.trim()), 300);
    return () => clearTimeout(minuteur);
  }, [saisie]);

  const { donnees, setDonnees, erreur, enCours, recharger } = useChargement(
    () => api<CompteBoutique[]>(`/admin/comptes/?${new URLSearchParams({ recherche })}`),
    [recherche],
  );

  return (
    <div className="pile">
      <p className="aide">
        Tous les comptes des boutiques (patrons, gérants, vendeurs…). Les administrateurs n'apparaissent pas ici. Pour un
        mot de passe oublié : donnez un mot de passe provisoire, le commerçant choisit le sien à la connexion suivante.
      </p>
      <input
        type="search"
        className="champ-recherche"
        placeholder="Rechercher : identifiant, nom, téléphone, e-mail, boutique…"
        value={saisie}
        onChange={(e) => setSaisie(e.target.value)}
      />
      {erreur && <Erreur message={erreur} reessayer={recharger} />}
      {enCours && !donnees ? (
        <Chargement />
      ) : (
        donnees && (
          <section className="carte carte-tableau">
            <p className="compteur">
              {donnees.length} compte{donnees.length > 1 ? "s" : ""}
            </p>
            {donnees.length === 0 ? (
              <p className="vide">Aucun compte ne correspond.</p>
            ) : (
              <div className="defilement-tableau">
                <table className="tableau">
                  <thead>
                    <tr>
                      <th>Boutique</th>
                      <th>Compte</th>
                      <th>Rôle</th>
                      <th>Contact</th>
                      <th>Dernière connexion en ligne</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {donnees.map((c) => (
                      <tr key={c.id} className={c.actif ? "" : "ligne-inactive"}>
                        <td>{c.boutique ? <a href={`#/boutiques/${c.boutique.id}`}>{c.boutique.nom}</a> : "—"}</td>
                        <td>
                          <strong>{c.username}</strong>
                          {c.nom && <small className="sous-ligne">{c.nom}</small>}
                        </td>
                        <td>{c.role || "—"}</td>
                        <td>
                          {c.telephone || "—"}
                          {c.email && <small className="sous-ligne">{c.email}</small>}
                        </td>
                        <td>
                          {c.actif ? dateHeure(c.derniere_connexion) : "Compte désactivé"}
                          {c.doit_changer_mot_de_passe && <small className="sous-ligne">Mot de passe provisoire en cours</small>}
                        </td>
                        <td>
                          {c.actif && (
                            <button type="button" className="bouton-secondaire" onClick={() => setChoisi(c)}>
                              🔑 Mot de passe
                            </button>
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
      {choisi && (
        <Reinitialiser
          compte={choisi}
          surFermer={() => setChoisi(null)}
          surFait={(c) => setDonnees((liste) => liste?.map((x) => (x.id === c.id ? c : x)) ?? null)}
        />
      )}
    </div>
  );
}

function Reinitialiser({
  compte,
  surFermer,
  surFait,
}: {
  compte: CompteBoutique;
  surFermer: () => void;
  surFait: (c: CompteBoutique) => void;
}) {
  const [motDePasse, setMotDePasse] = useState(motDePasseProvisoire);
  const [doitChanger, setDoitChanger] = useState(true);
  const [erreur, setErreur] = useState("");
  const [enCours, setEnCours] = useState(false);
  const [fait, setFait] = useState(false);

  async function soumettre(e: FormEvent) {
    e.preventDefault();
    setEnCours(true);
    setErreur("");
    try {
      const c = await api<CompteBoutique>(`/admin/comptes/${compte.id}/mot-de-passe/`, {
        method: "POST",
        body: JSON.stringify({ nouveau_mot_de_passe: motDePasse, doit_changer: doitChanger }),
      });
      surFait(c);
      setFait(true);
    } catch (err) {
      setErreur(err instanceof ErreurApi && err.champs.nouveau_mot_de_passe ? err.champs.nouveau_mot_de_passe : (err as Error).message);
    } finally {
      setEnCours(false);
    }
  }

  return (
    <Modale titre={`Mot de passe de ${compte.username}`} surFermer={surFermer}>
      {fait ? (
        <section className="carte carte-succes">
          <h2>✅ Mot de passe changé</h2>
          <p>Donnez-le au commerçant ({compte.boutique?.nom ?? "sans boutique"}) :</p>
          <dl className="infos identifiants-remis">
            <div className="info">
              <dt>Identifiant</dt>
              <dd>
                <code>{compte.username}</code>
              </dd>
            </div>
            <div className="info">
              <dt>Mot de passe</dt>
              <dd>
                <code>{motDePasse}</code>
              </dd>
            </div>
          </dl>
          <div className="actions">
            <button type="button" className="bouton-principal" onClick={surFermer}>
              Fermer
            </button>
          </div>
        </section>
      ) : (
        <form className="pile formulaire" onSubmit={soumettre}>
          <section className="carte">
            <p className="aide">
              {compte.nom || compte.username} · {compte.role || "sans rôle"} · {compte.boutique?.nom ?? "sans boutique"}
            </p>
            <label className="champ-plein">
              Nouveau mot de passe
              <span className="champ-avec-bouton">
                <input value={motDePasse} onChange={(e) => setMotDePasse(e.target.value)} required autoComplete="off" />
                <button type="button" className="bouton-secondaire" onClick={() => setMotDePasse(motDePasseProvisoire())}>
                  Générer
                </button>
              </span>
            </label>
            <label className="interrupteur">
              <input type="checkbox" checked={doitChanger} onChange={(e) => setDoitChanger(e.target.checked)} />
              Lui faire choisir son propre mot de passe à la prochaine connexion
            </label>
          </section>
          {erreur && <Erreur message={erreur} />}
          <div className="actions">
            <button type="button" className="bouton-secondaire" onClick={surFermer}>
              Annuler
            </button>
            <button type="submit" className="bouton-principal" disabled={enCours || !motDePasse}>
              {enCours ? "Enregistrement…" : "Changer le mot de passe"}
            </button>
          </div>
        </form>
      )}
    </Modale>
  );
}
