import { useEffect, useState } from "react";

import { api } from "../api";
import type { Session } from "../api";

/**
 * Écran de verrouillage automatique (voir hooks/useInactivite.ts et
 * contexts/VerrouillageContext.tsx) : superposé à Shell sans le démonter, pour
 * garder l'écran/le panier en cours intacts. Se déverrouille avec le mot de
 * passe de l'utilisateur déjà connecté (api.auth.connexion réévalue les
 * identifiants sans rien changer d'autre — en ligne comme hors-ligne).
 */

// Ralentit les essais successifs de mot de passe (le compteur repart à zéro à
// chaque nouveau verrouillage puisque ce composant est démonté au déverrouillage).
function calculerPauseSecondes(echecs: number): number {
  if (echecs >= 8) return 60;
  if (echecs >= 5) return 30;
  if (echecs >= 3) return 10;
  return 0;
}

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
  const [echecs, setEchecs] = useState(0);
  const [pauseRestante, setPauseRestante] = useState(0);

  useEffect(() => {
    if (pauseRestante <= 0) return;
    const minuteur = setTimeout(() => setPauseRestante((v) => v - 1), 1000);
    return () => clearTimeout(minuteur);
  }, [pauseRestante]);

  async function soumettre(evenement: React.FormEvent) {
    evenement.preventDefault();
    if (pauseRestante > 0) return;
    setErreur(null);
    setEnCours(true);
    try {
      const resultat = await api.auth.connexion(session.username, password);
      if (resultat.succes) {
        onDeverrouille(resultat.resultat);
        return;
      }
      const nouveauxEchecs = echecs + 1;
      setEchecs(nouveauxEchecs);
      const pause = calculerPauseSecondes(nouveauxEchecs);
      if (pause > 0) setPauseRestante(pause);
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
        {(erreur || pauseRestante > 0) && (
          <div className="message-erreur">
            {pauseRestante > 0 ? `Trop de tentatives. Réessayez dans ${pauseRestante} secondes.` : erreur}
          </div>
        )}
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
              disabled={pauseRestante > 0}
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
        <button type="submit" disabled={enCours || pauseRestante > 0}>
          {pauseRestante > 0 ? `Patientez (${pauseRestante}s)` : enCours ? "Déverrouillage…" : "Déverrouiller"}
        </button>
        <button type="button" className="lien" onClick={onDeconnexion}>
          Se déconnecter
        </button>
      </form>
    </div>
  );
}
