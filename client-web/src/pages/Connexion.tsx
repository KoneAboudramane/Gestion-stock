import { useEffect, useState } from "react";

import { api } from "../api";
import type { Session } from "../api";
import PanneauMarque from "../components/PanneauMarque";
import { obtenirBoutiqueInstallee } from "../services/abonnementAdmin";
import MotDePasseOublie from "./MotDePasseOublie";

/** « Se souvenir de mon identifiant » : l'identifiant seulement, jamais le mot de passe. */
const CLE_IDENTIFIANT_RETENU = "gestion-stock:identifiant-retenu";

function identifiantRetenu(): string {
  try {
    return localStorage.getItem(CLE_IDENTIFIANT_RETENU) ?? "";
  } catch {
    return "";
  }
}

function minutesSecondes(secondes: number): string {
  return `${Math.floor(secondes / 60)}:${String(secondes % 60).padStart(2, "0")}`;
}

/** Ce que sait cet ordinateur avant toute connexion (boutique, abonnement, réseau, internet). */
interface EtatPoste {
  serveurJoint: boolean;
  boutique: { nom: string; synchroAutorisee: boolean } | null;
  abonnement: { niveau: "ok" | "bientot" | "grace" | "bloque"; joursRestants: number | null; finGrace: string | null } | null;
  reseau: { role: "seul" | "principal" | "caisse"; nomPostePrincipal: string | null; relie: boolean } | null;
  comptesDuPoste: number;
  attenteSecondes: number;
}

export default function Connexion({
  onConnecte,
  allerAccesCreation,
}: {
  onConnecte: (session: Session) => void;
  allerAccesCreation: () => void;
}) {
  const [username, setUsername] = useState(identifiantRetenu);
  const [password, setPassword] = useState("");
  const [retenir, setRetenir] = useState(() => !!identifiantRetenu());
  const [majuscules, setMajuscules] = useState(false);
  const [poste, setPoste] = useState<EtatPoste | null>(null);
  const [attente, setAttente] = useState(0);
  const [afficherMotDePasse, setAfficherMotDePasse] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const [enCours, setEnCours] = useState(false);
  // "Mot de passe oublié ?" (par email) n'a de sens que pour une boutique déjà
  // autorisée à échanger avec le serveur (comptes.Boutique.synchro_autorisee) —
  // sinon aucun moyen de recevoir un code. Le repli sans email reste dans
  // Espace Admin (voir AccesCreationBoutique.tsx > ReinitialiserMotDePasseAdmin).
  const [synchroAutorisee, setSynchroAutorisee] = useState(false);
  const [motDePasseOublieOuvert, setMotDePasseOublieOuvert] = useState(false);
  // Le navigateur ne fait pas partie du réseau de la boutique : jamais « relié à un poste principal ».
  const [posteRelie, setPosteRelie] = useState<string | null>(null);

  function chargerPoste() {
    api.auth.etatPosteConnexion().then((e) => {
      setPoste(e);
      setSynchroAutorisee(Boolean(e.boutique?.synchroAutorisee));
      setPosteRelie(null); // le navigateur ne fait pas partie du réseau de la boutique
      setAttente(e.attenteSecondes);
    });
  }
  useEffect(() => {
    chargerPoste();
  }, []);
  // Compte à rebours de l'attente anti-essais.
  useEffect(() => {
    if (attente <= 0) return;
    const minuteur = setTimeout(() => setAttente((a) => Math.max(0, a - 1)), 1000);
    return () => clearTimeout(minuteur);
  }, [attente]);

  async function soumettre(evenement: React.FormEvent) {
    evenement.preventDefault();
    setErreur(null);
    setEnCours(true);
    try {
      const resultat = await api.auth.connexion(username.trim(), password);
      if (resultat.succes) {
        try {
          if (retenir) localStorage.setItem(CLE_IDENTIFIANT_RETENU, username.trim());
          else localStorage.removeItem(CLE_IDENTIFIANT_RETENU);
        } catch {
          // simple commodité
        }
        onConnecte(resultat.resultat);
      } else {
        setErreur(resultat.message);
        setPassword("");
        chargerPoste();
      }
    } finally {
      setEnCours(false);
    }
  }

  return (
    <div className="ecran-auth">
      <PanneauMarque />
      <div className="panneau-formulaire">
        <form onSubmit={soumettre} className="carte-auth">
          {poste?.boutique ? (
            <div className="entete-auth-boutique">
              <span className="initiale-boutique" aria-hidden="true">
                {poste.boutique.nom.trim().charAt(0).toUpperCase() || "🏪"}
              </span>
              <div>
                <h1>Bienvenue chez {poste.boutique.nom}</h1>
                <p className="sous-titre">Connectez-vous pour ouvrir la caisse.</p>
              </div>
            </div>
          ) : (
            <>
              <h1>Content de vous revoir</h1>
              <p className="sous-titre">Connectez-vous pour accéder à votre boutique.</p>
            </>
          )}

          {poste && (
            <div className={`etat-connexion-admin etat-connexion-admin--${poste.serveurJoint || posteRelie ? "ok" : "horsligne"}`}>
              <span>
                {posteRelie
                  ? `📶 Relié au poste principal « ${posteRelie} »${poste.reseau?.relie ? "" : " (injoignable pour l'instant)"}`
                  : poste.serveurJoint
                    ? poste.boutique && !poste.boutique.synchroAutorisee
                      ? "🔒 100 % local · serveur joint pour la connexion"
                      : "🌐 En ligne"
                    : `🟠 Sans internet : seuls les comptes déjà utilisés sur cet ordinateur peuvent entrer (${poste.comptesDuPoste}).`}
              </span>
            </div>
          )}

          {poste?.abonnement && poste.abonnement.niveau !== "ok" && (
            <div className={poste.abonnement.niveau === "bientot" ? "message-avertissement-auth" : "message-erreur"}>
              {poste.abonnement.niveau === "bientot"
                ? `⏳ Abonnement : plus que ${poste.abonnement.joursRestants ?? "?"} jour(s). Pensez à le renouveler.`
                : poste.abonnement.niveau === "grace"
                  ? `🟠 Abonnement terminé : la vente reste permise jusqu'au ${poste.abonnement.finGrace ? new Date(poste.abonnement.finGrace).toLocaleDateString("fr-FR") : "?"}.`
                  : "🔴 Abonnement terminé : la vente est bloquée. Le patron peut se connecter pour le renouveler."}
            </div>
          )}

          {attente > 0 && <div className="message-erreur">⏳ Trop d'essais : réessayez dans {minutesSecondes(attente)}.</div>}
          {erreur && attente === 0 && <div className="message-erreur">{erreur}</div>}
          <label>
            Nom d'utilisateur
            <div className="champ-avec-icone">
              <span className="icone-champ" aria-hidden="true">
                👤
              </span>
              <input
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                autoFocus={!username}
                autoComplete="username"
                required
              />
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
                onKeyUp={(e) => setMajuscules(e.getModifierState("CapsLock"))}
                onKeyDown={(e) => setMajuscules(e.getModifierState("CapsLock"))}
                autoFocus={!!username}
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
          </label>
          {majuscules && <span className="alerte-majuscules">⇪ Majuscules activées</span>}
          <label className="case-retenir-identifiant">
            <input type="checkbox" checked={retenir} onChange={(e) => setRetenir(e.target.checked)} /> Se souvenir de mon
            identifiant sur cet ordinateur
          </label>
          <button type="submit" disabled={enCours || attente > 0}>
            {enCours ? "Connexion…" : attente > 0 ? `Patientez ${minutesSecondes(attente)}` : "Se connecter"}
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
