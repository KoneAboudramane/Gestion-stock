import { useState } from "react";

import { api } from "../api";
import PanneauMarque from "../components/PanneauMarque";

/**
 * Récupération du mot de passe du Patron par email (réservée à ce rôle côté
 * serveur — cf. comptes/services.py). Deux étapes : demande du code par email,
 * puis saisie du code reçu + nouveau mot de passe.
 */
export default function MotDePasseOublie({ allerConnexion }: { allerConnexion: () => void }) {
  const [etape, setEtape] = useState<"demande" | "confirmation" | "reussi">("demande");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [nouveauMotDePasse, setNouveauMotDePasse] = useState("");
  const [afficherMotDePasse, setAfficherMotDePasse] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [enCours, setEnCours] = useState(false);

  async function demander(evenement: React.FormEvent) {
    evenement.preventDefault();
    setErreur(null);
    setEnCours(true);
    try {
      const resultat = await api.auth.demanderReinitialisationMotDePasse(email);
      if (resultat.succes) {
        setMessage("Si un compte Patron existe avec cet email, un code de réinitialisation vient d'être envoyé.");
        setEtape("confirmation");
      } else {
        setErreur(resultat.message);
      }
    } finally {
      setEnCours(false);
    }
  }

  async function confirmer(evenement: React.FormEvent) {
    evenement.preventDefault();
    setErreur(null);
    setEnCours(true);
    try {
      const resultat = await api.auth.reinitialiserMotDePasse(email, code, nouveauMotDePasse);
      if (resultat.succes) {
        setMessage("Mot de passe réinitialisé. Tu peux te connecter avec ton nouveau mot de passe.");
        setEtape("reussi");
      } else {
        setErreur(resultat.message);
      }
    } finally {
      setEnCours(false);
    }
  }

  if (etape === "reussi") {
    return (
      <div className="ecran-auth">
        <PanneauMarque />
        <div className="panneau-formulaire">
          <div className="carte-auth">
            <h1>C'est fait ✅</h1>
            <p className="sous-titre">Votre mot de passe a été réinitialisé.</p>
            {message && <p className="note-aide">{message}</p>}
            <button type="button" onClick={allerConnexion}>
              Retour à la connexion
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (etape === "confirmation") {
    return (
      <div className="ecran-auth">
        <PanneauMarque />
        <div className="panneau-formulaire">
          <form onSubmit={confirmer} className="carte-auth">
            <h1>Vérifiez vos emails 📩</h1>
            <p className="sous-titre">Saisissez le code reçu et votre nouveau mot de passe.</p>
            {message && <p className="note-aide">{message}</p>}
            {erreur && <div className="message-erreur">{erreur}</div>}
            <label>
              Code reçu par email
              <input value={code} onChange={(e) => setCode(e.target.value)} autoFocus required />
            </label>
            <label>
              Nouveau mot de passe
              <div className="champ-mot-de-passe">
                <input
                  type={afficherMotDePasse ? "text" : "password"}
                  value={nouveauMotDePasse}
                  onChange={(e) => setNouveauMotDePasse(e.target.value)}
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
              {enCours ? "Validation…" : "Réinitialiser le mot de passe"}
            </button>
            <button type="button" className="lien" onClick={() => setEtape("demande")}>
              Renvoyer le code
            </button>
            <button type="button" className="lien" onClick={allerConnexion}>
              Retour à la connexion
            </button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="ecran-auth">
      <PanneauMarque />
      <div className="panneau-formulaire">
        <form onSubmit={demander} className="carte-auth">
          <h1>Mot de passe oublié ?</h1>
          <p className="sous-titre">Réservé au Patron de la boutique.</p>
          <p className="note-aide">
            Pour un caissier, demande à ton Patron de réinitialiser ton mot de passe depuis Réglages &gt;
            Utilisateurs.
          </p>
          {erreur && <div className="message-erreur">{erreur}</div>}
          <label>
            Email du compte
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoFocus required />
          </label>
          <button type="submit" disabled={enCours}>
            {enCours ? "Envoi…" : "Recevoir un code par email"}
          </button>
          <button type="button" className="lien" onClick={allerConnexion}>
            Retour à la connexion
          </button>
        </form>
      </div>
    </div>
  );
}
