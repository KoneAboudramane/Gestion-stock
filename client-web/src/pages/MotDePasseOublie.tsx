import { useState } from "react";

import { api } from "../api";

/**
 * Récupération du mot de passe du Patron par email (réservée à ce rôle côté
 * serveur — cf. comptes/services.py). Deux étapes : demande du code par email,
 * puis saisie du code reçu + nouveau mot de passe. S'ouvre en modale depuis
 * AccesCreationBoutique.tsx (seul point d'entrée depuis la refonte du
 * 2026-09-01 — un Patron qui oublie son mot de passe passe désormais par
 * l'exploitant plutôt qu'un lien public sur l'écran de connexion).
 */
export default function MotDePasseOublie({ onFermer }: { onFermer: () => void }) {
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
        setMessage("Mot de passe réinitialisé.");
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
      <div className="fond-modale" onClick={onFermer}>
        <div className="modale-selection-produits" onClick={(e) => e.stopPropagation()}>
          <div className="modale-entete">
            <h3>C'est fait ✅</h3>
            <button type="button" className="lien bouton-retour" onClick={onFermer}>
              ← Retour
            </button>
          </div>
          <div className="modale-corps">
            {message && <p className="note-aide">{message}</p>}
          </div>
        </div>
      </div>
    );
  }

  if (etape === "confirmation") {
    return (
      <div className="fond-modale" onClick={onFermer}>
        <div className="modale-selection-produits" onClick={(e) => e.stopPropagation()}>
          <div className="modale-entete">
            <h3>Vérifiez vos emails 📩</h3>
            <button type="button" className="lien bouton-retour" onClick={onFermer}>
              ← Retour
            </button>
          </div>
          <div className="modale-corps">
            <form onSubmit={confirmer} className="formulaire-catalogue formulaire-pleine-largeur-modale">
              <p className="sous-titre">Saisissez le code reçu et le nouveau mot de passe.</p>
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
              <div className="actions-formulaire">
                <button type="button" className="lien" onClick={() => setEtape("demande")}>
                  Renvoyer le code
                </button>
                <button type="submit" className="bouton-primaire" disabled={enCours}>
                  {enCours ? "Validation…" : "Réinitialiser le mot de passe"}
                </button>
              </div>
            </form>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="fond-modale" onClick={onFermer}>
      <div className="modale-selection-produits" onClick={(e) => e.stopPropagation()}>
        <div className="modale-entete">
          <h3>Mot de passe oublié ?</h3>
          <button type="button" className="lien bouton-retour" onClick={onFermer}>
            ← Retour
          </button>
        </div>
        <div className="modale-corps">
          <form onSubmit={demander} className="formulaire-catalogue formulaire-pleine-largeur-modale">
            <p className="sous-titre">Réservé au Patron de la boutique.</p>
            <p className="note-aide">
              Pour un caissier, il faut que son Patron réinitialise son mot de passe depuis Réglages &gt;
              Utilisateurs.
            </p>
            {erreur && <div className="message-erreur">{erreur}</div>}
            <label>
              Email du compte
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoFocus required />
            </label>
            <div className="actions-formulaire">
              <button type="submit" className="bouton-primaire" disabled={enCours}>
                {enCours ? "Envoi…" : "Recevoir un code par email"}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
