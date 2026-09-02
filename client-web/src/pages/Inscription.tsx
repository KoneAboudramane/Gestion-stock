import { useState } from "react";

import { creerBoutiqueEnLigne, creerBoutiqueLocale } from "../services/inscriptionLocale";
import GererAbonnement from "./GererAbonnement";

type Mode = "enLigne" | "horsLigne" | null;

/**
 * Port de client-electron/src/pages/Inscription.tsx. S'ouvre en modale depuis
 * AccesCreationBoutique.tsx (seul point d'entrée depuis la refonte du
 * 2026-09-01 — plus d'écran plein écran, plus de PanneauMarque).
 *
 * Deux façons de créer une boutique, au choix de l'admin :
 * - "En ligne" : enregistrée tout de suite côté serveur (comme "Créer une
 *   boutique" dans Django admin) — le Patron peut se connecter immédiatement,
 *   y compris depuis un autre appareil. Repli automatique sur "Hors ligne" si
 *   le réseau n'est finalement pas disponible.
 * - "Hors ligne" : créée directement en local (voir services/inscriptionLocale.ts) —
 *   utilisable tout de suite, même sans réseau. "Activer en ligne" reste
 *   alors un geste séparé, voir Réglages > Synchronisation.
 */
export default function Inscription({
  onFermer,
  username: usernameAdmin,
  password: passwordAdmin,
}: {
  onFermer: () => void;
  username: string;
  password: string;
}) {
  const [mode, setMode] = useState<Mode>(null);
  const [boutiqueNom, setBoutiqueNom] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [afficherMotDePasse, setAfficherMotDePasse] = useState(false);
  const [email, setEmail] = useState("");
  const [erreur, setErreur] = useState<string | null>(null);
  const [enCours, setEnCours] = useState(false);
  const [statutFinal, setStatutFinal] = useState<"enLigne" | "horsLigne" | null>(null);
  const [configurerAbonnement, setConfigurerAbonnement] = useState(false);

  async function soumettre(evenement: React.FormEvent) {
    evenement.preventDefault();
    setErreur(null);
    setEnCours(true);
    try {
      if (mode === "enLigne") {
        const resultat = await creerBoutiqueEnLigne(usernameAdmin, passwordAdmin, {
          boutiqueNom,
          username,
          password,
          email,
        });
        setStatutFinal(resultat.statut);
      } else {
        await creerBoutiqueLocale({ boutiqueNom, username, password, email });
        setStatutFinal("horsLigne");
      }
    } catch (e) {
      setErreur(e instanceof Error ? e.message : String(e));
    } finally {
      setEnCours(false);
    }
  }

  if (mode === null) {
    return (
      <div className="fond-modale" onClick={onFermer}>
        <div className="modale-selection-produits" onClick={(e) => e.stopPropagation()}>
          <div className="modale-entete">
            <h3>Créer une boutique 🚀</h3>
            <button type="button" className="lien bouton-retour" onClick={onFermer}>
              ← Retour
            </button>
          </div>
          <div className="modale-corps">
            <p className="sous-titre">Comment veux-tu créer cette boutique ?</p>
            <div className="grille-documents-comptables">
              <button type="button" className="carte-document-comptable" onClick={() => setMode("horsLigne")}>
                <span className="icone-document-comptable">📴</span>
                Hors ligne
              </button>
              <button type="button" className="carte-document-comptable" onClick={() => setMode("enLigne")}>
                <span className="icone-document-comptable">🌐</span>
                En ligne
              </button>
            </div>
            <p className="note-aide">
              Hors ligne : utilisable tout de suite sur ce poste, même sans réseau. En ligne : enregistrée tout de
              suite sur le serveur, utilisable depuis n'importe quel appareil.
            </p>
          </div>
        </div>
      </div>
    );
  }

  if (statutFinal) {
    return (
      <div className="fond-modale" onClick={onFermer}>
        <div className="modale-selection-produits" onClick={(e) => e.stopPropagation()}>
          <div className="modale-entete">
            <h3>Boutique créée ✅</h3>
            <button type="button" className="lien bouton-retour" onClick={onFermer}>
              ← Retour
            </button>
          </div>
          <div className="modale-corps">
            {statutFinal === "enLigne" ? (
              <p className="sous-titre">
                « {boutiqueNom} » est enregistrée sur le serveur. Le Patron peut se connecter avec « {username} » dès
                maintenant, y compris depuis un autre appareil.
              </p>
            ) : (
              <>
                <p className="sous-titre">
                  « {boutiqueNom} » est prête, tout de suite, même sans connexion. Le Patron peut se connecter avec «{" "}
                  {username} » dès maintenant.
                  {mode === "enLigne" && " Le réseau n'était pas disponible : la boutique a été créée en local."}
                </p>
                <p className="note-aide">
                  Pour sauvegarder cette boutique en ligne et activer la synchronisation, utilisez "Activer en ligne"
                  depuis Réglages &gt; Synchronisation une fois connecté.
                </p>
              </>
            )}
            <div className="actions-formulaire">
              <button type="button" className="bouton-primaire" onClick={() => setConfigurerAbonnement(true)}>
                Configurer l'abonnement
              </button>
            </div>
          </div>
        </div>
        {configurerAbonnement && (
          <GererAbonnement
            onFermer={() => setConfigurerAbonnement(false)}
            username={usernameAdmin}
            password={passwordAdmin}
            masquerSynchro
            demarrerEnEdition
          />
        )}
      </div>
    );
  }

  return (
    <div className="fond-modale" onClick={onFermer}>
      <div className="modale-selection-produits" onClick={(e) => e.stopPropagation()}>
        <div className="modale-entete">
          <h3>Créer une boutique 🚀</h3>
          <button type="button" className="lien bouton-retour" onClick={() => setMode(null)}>
            ← Retour
          </button>
        </div>
        <div className="modale-corps">
          <form onSubmit={soumettre} className="formulaire-catalogue formulaire-pleine-largeur-modale">
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
              Email
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
            </label>
            <div className="actions-formulaire">
              <button type="submit" className="bouton-primaire" disabled={enCours}>
                {enCours ? "Création…" : "Créer la boutique"}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
