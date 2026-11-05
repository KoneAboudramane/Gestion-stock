import { type FormEvent, useState } from "react";

import { api, ErreurApi } from "../api";
import { Erreur } from "../composants/Commun";

/** Changer son mot de passe. `impose` : mot de passe provisoire, rien d'autre n'est accessible avant. */
export default function MonMotDePasse({ impose = false, surChange }: { impose?: boolean; surChange?: () => void }) {
  const [ancien, setAncien] = useState("");
  const [nouveau, setNouveau] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [erreurs, setErreurs] = useState<Record<string, string>>({});
  const [erreur, setErreur] = useState("");
  const [enCours, setEnCours] = useState(false);
  const [fait, setFait] = useState(false);

  async function soumettre(e: FormEvent) {
    e.preventDefault();
    setErreurs({});
    setErreur("");
    if (nouveau !== confirmation) {
      setErreurs({ confirmation: "Les deux mots de passe ne sont pas identiques." });
      return;
    }
    setEnCours(true);
    try {
      await api("/admin/mon-mot-de-passe/", {
        method: "POST",
        body: JSON.stringify({ ancien_mot_de_passe: ancien, nouveau_mot_de_passe: nouveau }),
      });
      setFait(true);
      setAncien("");
      setNouveau("");
      setConfirmation("");
      surChange?.();
    } catch (err) {
      const champs = err instanceof ErreurApi ? err.champs : {};
      setErreurs(champs);
      if (!Object.keys(champs).length) setErreur((err as Error).message);
    } finally {
      setEnCours(false);
    }
  }

  if (fait && !impose) {
    return (
      <section className="carte carte-succes">
        <h2>✅ Mot de passe changé</h2>
        <p>Il servira dès votre prochaine connexion.</p>
      </section>
    );
  }

  return (
    <form className="pile formulaire formulaire-etroit" onSubmit={soumettre}>
      {impose && (
        <p className="note-confidentialite">
          🔑 Votre mot de passe est provisoire : choisissez le vôtre pour continuer.
        </p>
      )}
      <section className="carte">
        <div className="pile">
          <label>
            {impose ? "Mot de passe provisoire" : "Mot de passe actuel"}
            <input type="password" value={ancien} onChange={(e) => setAncien(e.target.value)} autoComplete="current-password" required />
            {erreurs.ancien_mot_de_passe && <small className="erreur-champ">{erreurs.ancien_mot_de_passe}</small>}
          </label>
          <label>
            Nouveau mot de passe
            <input type="password" value={nouveau} onChange={(e) => setNouveau(e.target.value)} autoComplete="new-password" required />
            {erreurs.nouveau_mot_de_passe && <small className="erreur-champ">{erreurs.nouveau_mot_de_passe}</small>}
          </label>
          <label>
            Nouveau mot de passe (encore)
            <input
              type="password"
              value={confirmation}
              onChange={(e) => setConfirmation(e.target.value)}
              autoComplete="new-password"
              required
            />
            {erreurs.confirmation && <small className="erreur-champ">{erreurs.confirmation}</small>}
          </label>
          <p className="aide">Au moins 8 caractères, pas uniquement des chiffres, pas trop proche de votre identifiant.</p>
        </div>
      </section>
      {erreur && <Erreur message={erreur} />}
      <div className="actions">
        <button type="submit" className="bouton-principal" disabled={enCours}>
          {enCours ? "Enregistrement…" : "Changer le mot de passe"}
        </button>
      </div>
    </form>
  );
}
