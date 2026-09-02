import { useEffect, useState } from "react";

import { api } from "../api";
import GererAbonnement from "./GererAbonnement";
import Inscription from "./Inscription";
import ReinitialiserMotDePasseAdmin from "./ReinitialiserMotDePasseAdmin";

type Modale = "inscription" | "reinitialiserMotDePasse" | "abonnement" | null;

/**
 * Port de client-electron/src/pages/AccesCreationBoutique.tsx : verrou devant
 * "Créer une boutique" (voir Connexion.tsx, point d'accès caché derrière la
 * petite icône) — demande les identifiants d'un compte administrateur
 * (is_staff côté Django, voir comptes/views.py::VerifierAccesAdminView) avant
 * de révéler les actions ci-dessous. Ne touche jamais à la session déjà
 * active sur cet appareil. Pas de PanneauMarque (panneau marketing pensé
 * pour les commerçants) : cet écran n'a de sens que pour l'exploitant.
 *
 * Actions en cartes ouvrant une modale (même patron que Réglages) plutôt
 * qu'un lien vers un écran plein écran — Inscription n'a d'ailleurs plus
 * d'autre point d'entrée depuis cette refonte. "Réinitialiser mot de passe"
 * ici est le repli sans email/code (identité déjà prouvée par ce verrou) ; le
 * flux par email classique (voir MotDePasseOublie.tsx) reste accessible
 * depuis Connexion.tsx quand la boutique a la synchro activée.
 */
export default function AccesCreationBoutique({ allerConnexion }: { allerConnexion: () => void }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [valide, setValide] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const [enCours, setEnCours] = useState(false);
  const [modaleOuverte, setModaleOuverte] = useState<Modale>(null);

  useEffect(() => {
    // Best-effort, silencieux : détecte une révocation d'accès admin survenue
    // pendant que ce poste était hors-ligne (voir api/auth.ts::verifierRevocationAdmin).
    // Sans effet si hors-ligne — retentera à la prochaine ouverture d'Espace Admin.
    api.auth.verifierRevocationAdmin();
  }, []);

  async function verifier(evenement: React.FormEvent) {
    evenement.preventDefault();
    setErreur(null);
    setEnCours(true);
    try {
      const resultat = await api.auth.verifierAccesAdmin(username, password);
      if (resultat.succes && resultat.resultat) setValide(true);
      else setErreur("Accès refusé.");
    } finally {
      setEnCours(false);
    }
  }

  if (valide) {
    return (
      <div className="ecran-auth">
        <div className="panneau-formulaire">
          <div className="carte-auth">
            <h1>Espace Admin</h1>
            <p className="sous-titre">Choisis une action.</p>
            <div className="grille-documents-comptables">
              <button
                type="button"
                className="carte-document-comptable"
                onClick={() => setModaleOuverte("inscription")}
              >
                <span className="icone-document-comptable">🚀</span>
                Créer une boutique
              </button>
              <button
                type="button"
                className="carte-document-comptable"
                onClick={() => setModaleOuverte("reinitialiserMotDePasse")}
              >
                <span className="icone-document-comptable">🔑</span>
                Réinitialiser mot de passe
              </button>
              <button
                type="button"
                className="carte-document-comptable"
                onClick={() => setModaleOuverte("abonnement")}
              >
                <span className="icone-document-comptable">💳</span>
                Gérer abonnement
              </button>
            </div>
            <button type="button" className="lien" onClick={allerConnexion}>
              Retour à la connexion
            </button>
          </div>
        </div>
        {modaleOuverte === "inscription" && (
          <Inscription onFermer={() => setModaleOuverte(null)} username={username} password={password} />
        )}
        {modaleOuverte === "reinitialiserMotDePasse" && (
          <ReinitialiserMotDePasseAdmin onFermer={() => setModaleOuverte(null)} username={username} password={password} />
        )}
        {modaleOuverte === "abonnement" && (
          <GererAbonnement onFermer={() => setModaleOuverte(null)} username={username} password={password} />
        )}
      </div>
    );
  }

  return (
    <div className="ecran-auth">
      <div className="panneau-formulaire">
        <form onSubmit={verifier} className="carte-auth">
          <h1>Espace Admin</h1>
          <p className="sous-titre">Réservé à l'administrateur de la plateforme.</p>
          {erreur && <div className="message-erreur">{erreur}</div>}
          <label>
            Nom d'utilisateur
            <input value={username} onChange={(e) => setUsername(e.target.value)} autoFocus required />
          </label>
          <label>
            Mot de passe
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          </label>
          <button type="submit" disabled={enCours}>
            {enCours ? "Vérification…" : "Valider"}
          </button>
          <button type="button" className="lien" onClick={allerConnexion}>
            Retour à la connexion
          </button>
        </form>
      </div>
    </div>
  );
}
