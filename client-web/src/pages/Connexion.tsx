import { useEffect, useState } from "react";

import { api } from "../api";
import type { Session } from "../api";
import PanneauMarque from "../components/PanneauMarque";
import { obtenirBoutiqueInstallee } from "../services/abonnementAdmin";
import MotDePasseOublie from "./MotDePasseOublie";

export default function Connexion({
  onConnecte,
  allerAccesCreation,
}: {
  onConnecte: (session: Session) => void;
  allerAccesCreation: () => void;
}) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [afficherMotDePasse, setAfficherMotDePasse] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const [enCours, setEnCours] = useState(false);
  // "Mot de passe oublié ?" (par email) n'a de sens que pour une boutique déjà
  // autorisée à échanger avec le serveur (comptes.Boutique.synchro_autorisee) —
  // sinon aucun moyen de recevoir un code. Le repli sans email reste dans
  // Espace Admin (voir AccesCreationBoutique.tsx > ReinitialiserMotDePasseAdmin).
  const [synchroAutorisee, setSynchroAutorisee] = useState(false);
  const [motDePasseOublieOuvert, setMotDePasseOublieOuvert] = useState(false);

  useEffect(() => {
    obtenirBoutiqueInstallee().then((b) => setSynchroAutorisee(Boolean(b?.synchroAutorisee)));
  }, []);

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
          <h1>Content de vous revoir</h1>
          <p className="sous-titre">Connectez-vous pour consulter votre boutique.</p>
          {erreur && <div className="message-erreur">{erreur}</div>}
          <label>
            Nom d'utilisateur
            <div className="champ-avec-icone">
              <span className="icone-champ" aria-hidden="true">
                👤
              </span>
              <input value={username} onChange={(e) => setUsername(e.target.value)} autoFocus required />
            </div>
          </label>
          <label>
            Mot de passe
            <div className="champ-mot-de-passe champ-avec-icone">
              <span className="icone-champ" aria-hidden="true">
                🔒
              </span>
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
          {synchroAutorisee && (
            <button type="button" className="lien" onClick={() => setMotDePasseOublieOuvert(true)}>
              Mot de passe oublié ?
            </button>
          )}
        </form>
        {/* Volontairement discret : pas destiné aux commerçants qui se connectent
            ici, juste un accès de secours pour toi (voir mémoire projet). Mène
            à un verrou d'identifiants admin avant de révéler "Créer une boutique". */}
        <button
          type="button"
          className="icone-discrete-acces-admin"
          onClick={allerAccesCreation}
          aria-label="Espace Admin"
          title="Espace Admin"
        >
          ⚙
        </button>
      </div>
      {motDePasseOublieOuvert && <MotDePasseOublie onFermer={() => setMotDePasseOublieOuvert(false)} />}
    </div>
  );
}
