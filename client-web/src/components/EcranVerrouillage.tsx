import { useState } from "react";

import { api } from "../api";
import type { Session } from "../api";

/**
 * Écran de verrouillage automatique (voir hooks/useInactivite.ts et
 * contexts/VerrouillageContext.tsx) : superposé à Shell sans le démonter, pour
 * garder l'écran/le panier en cours intacts. Se déverrouille avec le mot de
 * passe de l'utilisateur déjà connecté (api.auth.connexion réévalue les
 * identifiants sans rien changer d'autre — en ligne comme hors-ligne).
 */
export default function EcranVerrouillage({
  session,
  onDeverrouille,
  onDeconnexion,
}: {
  session: Session;
  onDeverrouille: (session: Session) => void;
  onDeconnexion: () => void;
}) {
  const [password, setPassword] = useState("");
  const [afficherMotDePasse, setAfficherMotDePasse] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const [enCours, setEnCours] = useState(false);

  async function soumettre(evenement: React.FormEvent) {
    evenement.preventDefault();
    setErreur(null);
    setEnCours(true);
    try {
      const resultat = await api.auth.connexion(session.username, password);
      if (resultat.succes) onDeverrouille(resultat.resultat);
      else setErreur(resultat.message);
    } finally {
      setEnCours(false);
    }
  }

  return (
    <div className="ecran-verrouillage">
      <form onSubmit={soumettre} className="carte-auth carte-verrouillage">
        <span className="icone-verrouillage" aria-hidden="true">
          🔒
        </span>
        <h1>Session verrouillée</h1>
        <p className="sous-titre">
          {session.boutiqueNom} · {session.username}
        </p>
        {erreur && <div className="message-erreur">{erreur}</div>}
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
              autoFocus
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
          {enCours ? "Déverrouillage…" : "Déverrouiller"}
        </button>
        <button type="button" className="lien" onClick={onDeconnexion}>
          Se déconnecter
        </button>
      </form>
    </div>
  );
}
