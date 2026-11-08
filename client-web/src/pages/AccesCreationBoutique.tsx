import { useEffect, useState } from "react";

import { api } from "../api";
import AccueilAdmin from "../components/AccueilAdmin";
import ModaleReseauAdmin from "../components/ModaleReseauAdmin";
import ModaleLaissezPasserAdmin from "../components/ModaleLaissezPasserAdmin";
import ModaleOptionsBoutique from "../components/ModaleOptionsBoutique";
import ModaleSauvegardeAdmin from "../components/ModaleSauvegardeAdmin";
import { useInactivite } from "../hooks/useInactivite";
import { signalerLaissezPasser } from "../services/laissezPasser";
import GererAbonnement from "./GererAbonnement";
import Inscription from "./Inscription";
import ReinitialiserMotDePasseAdmin from "./ReinitialiserMotDePasseAdmin";

type Modale =
  | "inscription"
  | "reinitialiserMotDePasse"
  | "abonnement"
  | "options"
  | "sauvegarde"
  | "reseau"
  | "laissezPasser"
  | null;

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
// Ancien préremplissage de l'identifiant admin : retiré (aucun nom de compte administrateur
// affiché avant la connexion), et la valeur déjà mémorisée est effacée.
try {
  localStorage.removeItem("gestion-stock:dernier-admin");
} catch {
  // stockage indisponible
}

function minutesSecondes(secondes: number): string {
  return `${Math.floor(secondes / 60)}:${String(secondes % 60).padStart(2, "0")}`;
}

export default function AccesCreationBoutique({ allerConnexion }: { allerConnexion: () => void }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [valide, setValide] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const [enCours, setEnCours] = useState(false);
  const [modaleOuverte, setModaleOuverte] = useState<Modale>(null);
  const [actualisation, setActualisation] = useState(0);
  const [afficherMotDePasse, setAfficherMotDePasse] = useState(false);
  const [majuscules, setMajuscules] = useState(false);
  const [etatConnexion, setEtatConnexion] = useState<{ serveurJoint: boolean; adminsDuPoste: string[] } | null>(null);
  const [attente, setAttente] = useState(0);
  // Laissez-passer admin : appareil qui n'a jamais vu internet (docs/plan_laissez_passer_admin.md).
  const [avecLaissezPasser, setAvecLaissezPasser] = useState(false);
  const [laissezPasser, setLaissezPasser] = useState("");

  async function chargerEtatConnexion() {
    const etat = await api.auth.etatConnexionAdmin();
    setEtatConnexion(etat);
    setAttente(etat.attenteSecondes);
  }
  useEffect(() => {
    if (!valide) chargerEtatConnexion();
  }, [valide]);
  // Compte à rebours de l'attente anti-essais.
  useEffect(() => {
    if (attente <= 0) return;
    const minuteur = setTimeout(() => setAttente((a) => Math.max(0, a - 1)), 1000);
    return () => clearTimeout(minuteur);
  }, [attente]);

  /** Se déconnecter (ou 5 min sans activité) : retour au verrou admin, mot de passe effacé. */
  function verrouiller() {
    setModaleOuverte(null);
    setValide(false);
    setPassword("");
  }
  useInactivite(5 * 60_000, valide, verrouiller);

  useEffect(() => {
    // Best-effort, silencieux : détecte une révocation d'accès admin survenue
    // pendant que ce poste était hors-ligne (voir api/auth.ts::verifierRevocationAdmin).
    // Sans effet si hors-ligne — retentera à la prochaine ouverture d'Espace Admin.
    api.auth.verifierRevocationAdmin();
    // Laissez-passer utilisés sans internet : signalés au serveur, retirés s'ils ne valent plus.
    void signalerLaissezPasser();
  }, []);

  async function verifier(evenement: React.FormEvent) {
    evenement.preventDefault();
    setErreur(null);
    setEnCours(true);
    try {
      const resultat =
        avecLaissezPasser && laissezPasser.trim()
          ? await api.auth.connexionAdminParLaissezPasser(laissezPasser, username.trim(), password)
          : await api.auth.connexionAdmin(username.trim(), password);
      if (resultat.succes) {
        setValide(true);
      } else {
        setErreur(resultat.message);
        setPassword("");
        await chargerEtatConnexion();
      }
    } finally {
      setEnCours(false);
    }
  }

  if (valide) {
    const fermer = () => {
      setModaleOuverte(null);
      setActualisation((n) => n + 1);
    };
    return (
      <>
        <AccueilAdmin
          username={username}
          password={password}
          actualisation={actualisation}
          ouvrir={(carte) => setModaleOuverte(carte)}
          onDeconnexion={verrouiller}
        />
        {modaleOuverte === "inscription" && (
          <Inscription onFermer={fermer} username={username} password={password} ouvrirModale={(suite) => setModaleOuverte(suite)} />
        )}
        {modaleOuverte === "reinitialiserMotDePasse" && (
          <ReinitialiserMotDePasseAdmin onFermer={fermer} username={username} password={password} />
        )}
        {modaleOuverte === "reseau" && <ModaleReseauAdmin onFermer={fermer} username={username} password={password} />}
        {modaleOuverte === "sauvegarde" && <ModaleSauvegardeAdmin onFermer={fermer} username={username} password={password} />}
        {modaleOuverte === "laissezPasser" && <ModaleLaissezPasserAdmin onFermer={fermer} username={username} password={password} />}
        {modaleOuverte === "abonnement" && <GererAbonnement onFermer={fermer} username={username} password={password} />}
        {modaleOuverte === "options" && <ModaleOptionsBoutique onFermer={fermer} username={username} password={password} />}
      </>
    );
  }

  return (
    <div className="ecran-auth">
      <div className="panneau-formulaire">
        <form onSubmit={verifier} className="carte-auth carte-auth-admin">
          <div className="entete-auth-admin">
            <span className="icone-auth-admin">🛡️</span>
            <div>
              <h1>Espace Admin</h1>
              <p className="sous-titre">Réservé à l'administrateur de la plateforme.</p>
            </div>
          </div>

          {etatConnexion &&
            (etatConnexion.serveurJoint ? (
              <div className="etat-connexion-admin etat-connexion-admin--ok">🛰️ Serveur joint : vérification en ligne.</div>
            ) : (
              <div className="etat-connexion-admin etat-connexion-admin--horsligne">
                <span>
                  📴 <strong>Sans internet</strong> : seuls les comptes déjà vérifiés en ligne sur cet ordinateur peuvent entrer.
                </span>
                {etatConnexion.adminsDuPoste.length > 0 ? (
                  <span className="sous-info">
                    {etatConnexion.adminsDuPoste.length} compte{etatConnexion.adminsDuPoste.length > 1 ? "s" : ""} administrateur
                    {etatConnexion.adminsDuPoste.length > 1 ? "s" : ""} déjà vérifié{etatConnexion.adminsDuPoste.length > 1 ? "s" : ""} ici.
                  </span>
                ) : (
                  <span className="sous-info">
                    Aucun pour l'instant : une première connexion avec internet est nécessaire, ou un 🎫 laissez-passer.
                  </span>
                )}
              </div>
            ))}

          {attente > 0 && (
            <div className="message-erreur">⏳ Trop d'essais : réessayez dans {minutesSecondes(attente)}.</div>
          )}
          {erreur && attente === 0 && <div className="message-erreur">{erreur}</div>}

          <label>
            Identifiant administrateur
            <input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoFocus
              autoComplete="off"
              required
            />
          </label>
          <label>
            Mot de passe
            <div className="champ-mot-de-passe">
              <input
                type={afficherMotDePasse ? "text" : "password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onKeyUp={(e) => setMajuscules(e.getModifierState("CapsLock"))}
                onKeyDown={(e) => setMajuscules(e.getModifierState("CapsLock"))}
                autoComplete="current-password"
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
            {majuscules && <span className="alerte-majuscules">⇪ Majuscules activées</span>}
          </label>
          <label className="case-laissez-passer">
            <span>
              <input type="checkbox" checked={avecLaissezPasser} onChange={(e) => setAvecLaissezPasser(e.target.checked)} /> 🎫
              J'ai un laissez-passer (appareil sans internet)
            </span>
          </label>
          {avecLaissezPasser && (
            <label>
              Laissez-passer
              <textarea
                rows={4}
                className="champ-code-activation"
                placeholder="LP-XXXXX-XXXXX-…"
                value={laissezPasser}
                onChange={(e) => setLaissezPasser(e.target.value)}
              />
              <span className="sous-info">
                Généré avant de partir sur le site d'administration (🎫 Laissez-passer). Il faut aussi votre identifiant et
                votre mot de passe.
              </span>
            </label>
          )}
          <button type="submit" className="bouton-primaire" disabled={enCours || attente > 0}>
            {enCours ? "Vérification…" : attente > 0 ? `Patientez ${minutesSecondes(attente)}` : "🔓 Entrer"}
          </button>

          <details className="details-abonnement">
            <summary>Ce que permet l'Espace Admin</summary>
            <ul className="verifications-reseau">
              <li className="verif-info">💳 Abonnement : renouveler, paiements déclarés, code d'activation</li>
              <li className="verif-info">📶 Réseau de la boutique : activer, traiter les demandes</li>
              <li className="verif-info">🔑 Mots de passe de tous les comptes</li>
              <li className="verif-info">🚀 Créer une boutique sur cet appareil</li>
            </ul>
          </details>
          <button type="button" className="lien" onClick={allerConnexion}>
            ← Retour à la connexion
          </button>
        </form>
      </div>
    </div>
  );
}
