import { useState } from "react";

import { changerMotDePasse, type Session } from "../api/auth";
import ChampNouveauMotDePasse from "../components/ChampNouveauMotDePasse";
import { soliditeMotDePasse } from "../lib/motDePasse";

/**
 * Après un mot de passe provisoire (Espace Admin → Réinitialiser mot de passe,
 * « obliger à changer ») : l'utilisateur choisit le sien avant d'entrer dans
 * l'appli. Internet nécessaire ; sans internet, « Plus tard » laisse entrer avec
 * le provisoire (la demande reviendra à la prochaine connexion).
 */
export default function ChoisirMotDePasse({
  session,
  onTermine,
  onPlusTard,
  onDeconnexion,
}: {
  session: Session;
  onTermine: (session: Session) => void;
  onPlusTard: () => void;
  onDeconnexion: () => void;
}) {
  const [motDePasse, setMotDePasse] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [erreur, setErreur] = useState<string | null>(null);
  const [horsLigne, setHorsLigne] = useState(false);
  const [enCours, setEnCours] = useState(false);

  async function valider(evenement: React.FormEvent) {
    evenement.preventDefault();
    setErreur(null);
    const solidite = soliditeMotDePasse(motDePasse, session.username);
    if (solidite.manques.length) return setErreur(`Mot de passe : ${solidite.manques.join(", ")}.`);
    if (motDePasse !== confirmation) return setErreur("Les deux mots de passe ne sont pas identiques.");
    setEnCours(true);
    const r = await changerMotDePasse(session, motDePasse);
    setEnCours(false);
    if (r.succes) return onTermine(r.resultat);
    setErreur(r.message);
    setHorsLigne(/Connexion au serveur/.test(r.message));
  }

  return (
    <div className="ecran-auth">
      <div className="panneau-formulaire">
        <form className="carte-auth" onSubmit={valider}>
          <h1>Choisissez votre mot de passe</h1>
          <p className="sous-titre">
            Bonjour {session.username} : vous vous êtes connecté avec un mot de passe provisoire. Choisissez maintenant le
            vôtre — vous seul le connaîtrez.
          </p>
          {erreur && <div className="message-erreur">{erreur}</div>}
          <ChampNouveauMotDePasse
            valeur={motDePasse}
            confirmation={confirmation}
            identifiant={session.username}
            generable={false}
            onChange={(v, c) => {
              setMotDePasse(v);
              setConfirmation(c);
            }}
          />
          <button type="submit" className="bouton-primaire" disabled={enCours}>
            {enCours ? "Enregistrement…" : "Enregistrer mon mot de passe"}
          </button>
          {horsLigne && (
            <button type="button" onClick={onPlusTard}>
              Plus tard (pas d'internet)
            </button>
          )}
          <button type="button" className="lien" onClick={onDeconnexion}>
            Se déconnecter
          </button>
        </form>
      </div>
    </div>
  );
}
