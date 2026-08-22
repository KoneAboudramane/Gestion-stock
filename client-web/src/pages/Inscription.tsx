import { useState } from "react";

import { api } from "../api";
import PanneauMarque from "../components/PanneauMarque";

/**
 * Port de client-electron/src/pages/Inscription.tsx : demande d'inscription
 * publique (n'ouvre pas de compte directement, en attente de validation par
 * l'administrateur — voir comptes/services.py::demander_inscription). Appelle
 * directement l'API Django (comme le reste de l'authentification côté web),
 * pas de flux hors-ligne ici (créer une boutique nécessite le serveur).
 */
export default function Inscription({ allerConnexion }: { allerConnexion: () => void }) {
  const [boutiqueNom, setBoutiqueNom] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [afficherMotDePasse, setAfficherMotDePasse] = useState(false);
  const [email, setEmail] = useState("");
  const [erreur, setErreur] = useState<string | null>(null);
  const [enCours, setEnCours] = useState(false);
  const [demandeEnvoyee, setDemandeEnvoyee] = useState(false);

  async function soumettre(evenement: React.FormEvent) {
    evenement.preventDefault();
    setErreur(null);
    setEnCours(true);
    try {
      const resultat = await api.auth.inscription({ boutiqueNom, username, password, email });
      if (resultat.succes) setDemandeEnvoyee(true);
      else setErreur(resultat.message);
    } finally {
      setEnCours(false);
    }
  }

  if (demandeEnvoyee) {
    return (
      <div className="ecran-auth">
        <PanneauMarque />
        <div className="panneau-formulaire">
          <div className="carte-auth">
            <h1>Demande envoyée ✅</h1>
            <p className="sous-titre">
              Votre demande pour « {boutiqueNom} » a été transmise. Vous serez contacté(e) par email dès qu'elle
              sera validée.
            </p>
            <button type="button" onClick={allerConnexion}>
              Retour à la connexion
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="ecran-auth">
      <PanneauMarque />
      <div className="panneau-formulaire">
        <form onSubmit={soumettre} className="carte-auth">
          <h1>Créez votre boutique 🚀</h1>
          <p className="sous-titre">Quelques informations, on valide ta demande et tu es prêt à vendre.</p>
          {erreur && <div className="message-erreur">{erreur}</div>}
          <label>
            Nom de la boutique
            <input value={boutiqueNom} onChange={(e) => setBoutiqueNom(e.target.value)} autoFocus required />
          </label>
          <label>
            Nom d'utilisateur (Patron)
            <input value={username} onChange={(e) => setUsername(e.target.value)} required />
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
          <label>
            Email (pour récupérer votre mot de passe)
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </label>
          <button type="submit" disabled={enCours}>
            {enCours ? "Envoi…" : "Envoyer la demande"}
          </button>
          <button type="button" className="lien" onClick={allerConnexion}>
            J'ai déjà un compte
          </button>
        </form>
      </div>
    </div>
  );
}
