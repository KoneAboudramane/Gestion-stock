import { useState } from "react";

import { api } from "../api/client";
import type { Session } from "../api/client";
import PanneauMarque from "../components/PanneauMarque";

export default function Connexion({
  onConnecte,
  allerInscription,
  allerMotDePasseOublie,
}: {
  onConnecte: (session: Session) => void;
  allerInscription: () => void;
  allerMotDePasseOublie: () => void;
}) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [afficherMotDePasse, setAfficherMotDePasse] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const [enCours, setEnCours] = useState(false);

  async function soumettre(evenement: React.FormEvent) {
    evenement.preventDefault();
    setErreur(null);
    setEnCours(true);
    try {
      const resultat = await api.auth.connexion(username, password);
      if (resultat.succes) onConnecte(resultat.resultat);
      else setErreur(resultat.message);
    } finally {
      setEnCours(false);
    }
  }

  return (
    <div className="ecran-auth">
      <PanneauMarque />
      <div className="panneau-formulaire">
        <form onSubmit={soumettre} className="carte-auth">
          <h1>Content de vous revoir 👋</h1>
          <p className="sous-titre">Connectez-vous pour accéder à votre boutique.</p>
          {erreur && <div className="message-erreur">{erreur}</div>}
          <label>
            Nom d'utilisateur
            <input value={username} onChange={(e) => setUsername(e.target.value)} autoFocus required />
          </label>
          <label>
            Mot de passe
            <div className="champ-mot-de-passe">
              <input
                type={afficherMotDePasse ? "text" : "password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
              <button
                type="button"
                className="bouton-afficher-mot-de-passe"
                onClick={() => setAfficherMotDePasse((v) => !v)}
                aria-label={afficherMotDePasse ? "Masquer le mot de passe" : "Afficher le mot de passe"}
                tabIndex={-1}
              >
                {afficherMotDePasse ? "🙈" : "👁"}
              </button>
            </div>
          </label>
          <button type="submit" disabled={enCours}>
            {enCours ? "Connexion…" : "Se connecter"}
          </button>
          <button type="button" className="lien" onClick={allerMotDePasseOublie}>
            Mot de passe oublié ?
          </button>
          <button type="button" className="lien" onClick={allerInscription}>
            Créer une boutique
          </button>
        </form>
      </div>
    </div>
  );
}
