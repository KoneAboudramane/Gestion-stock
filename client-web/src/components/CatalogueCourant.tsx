import { useState } from "react";

import type { Session } from "../api";
import { ATTRIBUTS_PAR_DEFAUT, UNITES_PAR_DEFAUT, memeNom } from "../lib/catalogueParDefaut";
import { creerAttribut, creerUnite, creerValeurAttribut } from "../services/produits";

const donnees = {
  creerUnite: (boutiqueId: string, nom: string, abreviation: string) => creerUnite(boutiqueId, nom, abreviation),
  creerAttribut: (boutiqueId: string, nom: string): Promise<string> => creerAttribut(boutiqueId, nom),
  creerValeur: (attributId: string, valeur: string) => creerValeurAttribut(attributId, valeur),
};

/** Unités courantes qui manquent, à cocher puis ajouter d'un coup. */
export function ModaleUnitesCourantes({
  session,
  existantes,
  onFermer,
  onAjoute,
}: {
  session: Session;
  existantes: string[];
  onFermer: () => void;
  onAjoute: () => void;
}) {
  const manquantes = UNITES_PAR_DEFAUT.filter((u) => !existantes.some((e) => memeNom(e, u.nom)));
  const [choix, setChoix] = useState<Set<string>>(new Set(manquantes.map((u) => u.nom)));
  const [enCours, setEnCours] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);

  async function ajouter() {
    setEnCours(true);
    setErreur(null);
    try {
      for (const u of manquantes.filter((x) => choix.has(x.nom))) await donnees.creerUnite(session.boutiqueId, u.nom, u.abreviation);
      onAjoute();
      onFermer();
    } catch (e) {
      setErreur(e instanceof Error ? e.message : "Erreur inattendue.");
    } finally {
      setEnCours(false);
    }
  }

  return (
    <div className="fond-modale" onClick={onFermer}>
      <div className="modale-confirmation modale-confirmation-large" onClick={(e) => e.stopPropagation()}>
        <h3>➕ Unités courantes</h3>
        {manquantes.length === 0 ? (
          <p className="note-aide">Vous avez déjà toutes les unités courantes.</p>
        ) : (
          <>
            <p className="note-aide">Cochez celles à ajouter (vous pourrez les renommer ou les supprimer ensuite).</p>
            <div className="grille-choix-courants">
              {manquantes.map((u) => (
                <label key={u.nom} className="choix-courant">
                  <input
                    type="checkbox"
                    checked={choix.has(u.nom)}
                    onChange={(e) => {
                      const suivant = new Set(choix);
                      if (e.target.checked) suivant.add(u.nom);
                      else suivant.delete(u.nom);
                      setChoix(suivant);
                    }}
                  />
                  {u.nom} <span className="sous-info">({u.abreviation})</span>
                </label>
              ))}
            </div>
          </>
        )}
        {erreur && <div className="message-erreur">{erreur}</div>}
        <div className="actions-formulaire">
          <button type="button" className="lien" onClick={onFermer}>
            Fermer
          </button>
          {manquantes.length > 0 && (
            <button type="button" className="bouton-valider" disabled={enCours || choix.size === 0} onClick={ajouter}>
              {enCours ? "…" : `Ajouter (${choix.size})`}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/** Attributs courants (et leurs valeurs) qui manquent ; complète un attribut déjà présent. */
export function ModaleAttributsCourants({
  session,
  attributs,
  valeurs,
  onFermer,
  onAjoute,
}: {
  session: Session;
  attributs: { id: string; nom: string }[];
  valeurs: Record<string, { valeur: string }[]>;
  onFermer: () => void;
  onAjoute: () => void;
}) {
  const aAjouter = ATTRIBUTS_PAR_DEFAUT.map((a) => {
    const existant = attributs.find((x) => memeNom(x.nom, a.nom));
    const deja = existant ? (valeurs[existant.id] ?? []).map((v) => v.valeur) : [];
    return { ...a, existant, manquantes: a.valeurs.filter((v) => !deja.some((d) => memeNom(d, v))) };
  }).filter((a) => !a.existant || a.manquantes.length > 0);
  const [choix, setChoix] = useState<Set<string>>(new Set(aAjouter.map((a) => a.nom)));
  const [enCours, setEnCours] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);

  async function ajouter() {
    setEnCours(true);
    setErreur(null);
    try {
      for (const a of aAjouter.filter((x) => choix.has(x.nom))) {
        const id = a.existant ? a.existant.id : await donnees.creerAttribut(session.boutiqueId, a.nom);
        for (const v of a.manquantes) await donnees.creerValeur(id, v);
      }
      onAjoute();
      onFermer();
    } catch (e) {
      setErreur(e instanceof Error ? e.message : "Erreur inattendue.");
    } finally {
      setEnCours(false);
    }
  }

  return (
    <div className="fond-modale" onClick={onFermer}>
      <div className="modale-confirmation modale-confirmation-large" onClick={(e) => e.stopPropagation()}>
        <h3>➕ Attributs courants</h3>
        {aAjouter.length === 0 ? (
          <p className="note-aide">Vous avez déjà tous les attributs courants et leurs valeurs.</p>
        ) : (
          <>
            <p className="note-aide">Cochez ceux à ajouter. Un attribut déjà présent est seulement complété avec les valeurs qui lui manquent.</p>
            <div className="liste-choix-courants">
              {aAjouter.map((a) => (
                <label key={a.nom} className="choix-courant">
                  <input
                    type="checkbox"
                    checked={choix.has(a.nom)}
                    onChange={(e) => {
                      const suivant = new Set(choix);
                      if (e.target.checked) suivant.add(a.nom);
                      else suivant.delete(a.nom);
                      setChoix(suivant);
                    }}
                  />
                  <strong>{a.nom}</strong>
                  {a.existant && <span className="sous-info"> (déjà présent, on complète)</span>}
                  <span className="sous-info ligne-detail-article">{a.manquantes.join(" · ")}</span>
                </label>
              ))}
            </div>
          </>
        )}
        {erreur && <div className="message-erreur">{erreur}</div>}
        <div className="actions-formulaire">
          <button type="button" className="lien" onClick={onFermer}>
            Fermer
          </button>
          {aAjouter.length > 0 && (
            <button type="button" className="bouton-valider" disabled={enCours || choix.size === 0} onClick={ajouter}>
              {enCours ? "…" : `Ajouter (${choix.size})`}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
