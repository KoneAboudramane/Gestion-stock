import { useEffect, useState } from "react";

import { listerPatrons, reinitialiserMotDePasseAdmin, type PatronResume } from "../api/auth";

/**
 * Port navigateur de client-electron/src/pages/ReinitialiserMotDePasseAdmin.tsx.
 * Carte "Réinitialiser mot de passe" de l'Espace Admin (voir
 * AccesCreationBoutique.tsx) : réinitialise directement le mot de passe d'un
 * Patron, sans code ni email — l'identité de l'exploitant est déjà prouvée
 * par le verrou admin (identifiants réutilisés, jamais redemandés ici). Le
 * flux par email (code envoyé au Patron) reste séparé, voir
 * MotDePasseOublie.tsx, accessible directement depuis Connexion.tsx quand la
 * boutique a la synchro activée.
 *
 * Le Patron se choisit toujours dans un menu (toutes boutiques confondues) —
 * jamais de pré-sélection devinée : un admin gère potentiellement plusieurs
 * boutiques, jamais évident de savoir laquelle il vise sans lui demander.
 * Repli sur une saisie manuelle uniquement si la liste n'a pas pu être
 * chargée (réseau, accès refusé).
 */
export default function ReinitialiserMotDePasseAdmin({
  onFermer,
  username,
  password,
}: {
  onFermer: () => void;
  username: string;
  password: string;
}) {
  const [usernameCible, setUsernameCible] = useState("");
  const [patrons, setPatrons] = useState<PatronResume[] | null>(null);
  const [nouveauMotDePasse, setNouveauMotDePasse] = useState("");
  const [afficherMotDePasse, setAfficherMotDePasse] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const [enCours, setEnCours] = useState(false);
  const [reussi, setReussi] = useState(false);

  useEffect(() => {
    listerPatrons(username, password).then(setPatrons);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function soumettre(evenement: React.FormEvent) {
    evenement.preventDefault();
    setErreur(null);
    setEnCours(true);
    try {
      const resultat = await reinitialiserMotDePasseAdmin(username, password, usernameCible, nouveauMotDePasse);
      if (resultat.succes) setReussi(true);
      else setErreur(resultat.message);
    } finally {
      setEnCours(false);
    }
  }

  if (reussi) {
    return (
      <div className="fond-modale" onClick={onFermer}>
        <div className="modale-selection-produits" onClick={(e) => e.stopPropagation()}>
          <div className="modale-entete">
            <h3>Mot de passe réinitialisé ✅</h3>
            <button type="button" className="lien bouton-retour" onClick={onFermer}>
              ← Retour
            </button>
          </div>
          <div className="modale-corps">
            <p className="sous-titre">Le compte « {usernameCible} » peut se connecter avec le nouveau mot de passe.</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="fond-modale" onClick={onFermer}>
      <div className="modale-selection-produits" onClick={(e) => e.stopPropagation()}>
        <div className="modale-entete">
          <h3>Réinitialiser mot de passe 🔑</h3>
          <button type="button" className="lien bouton-retour" onClick={onFermer}>
            ← Retour
          </button>
        </div>
        <div className="modale-corps">
          <form onSubmit={soumettre} className="formulaire-catalogue formulaire-pleine-largeur-modale">
            <p className="sous-titre">Réservé aux comptes Patron.</p>
            {erreur && <div className="message-erreur">{erreur}</div>}
            {patrons && patrons.length > 0 ? (
              <label>
                Patron
                <select value={usernameCible} onChange={(e) => setUsernameCible(e.target.value)} required>
                  <option value="" disabled>
                    Choisir un Patron
                  </option>
                  {patrons.map((p) => (
                    <option key={p.username} value={p.username}>
                      {p.boutiqueNom ? `${p.boutiqueNom} — ${p.username}` : p.username}
                    </option>
                  ))}
                </select>
              </label>
            ) : (
              <label>
                Nom d'utilisateur du Patron
                <input value={usernameCible} onChange={(e) => setUsernameCible(e.target.value)} autoFocus required />
              </label>
            )}
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
              <button type="submit" className="bouton-primaire" disabled={enCours}>
                {enCours ? "Enregistrement…" : "Réinitialiser"}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
