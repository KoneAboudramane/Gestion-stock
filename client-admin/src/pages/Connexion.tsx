import QRCode from "qrcode";
import { type FormEvent, useEffect, useRef, useState } from "react";

import { connexion, definirJetons, type ReponseConnexion, validerCode } from "../api";

interface Props {
  message?: string;
  surConnecte: () => void;
}

type Etape =
  | { nom: "identifiants" }
  | { nom: "code"; jetonEtape: string }
  | { nom: "configuration"; jetonEtape: string; secret: string; qr: string };

/** Secret groupé par 4 caractères, plus facile à recopier à la main. */
function grouper(secret: string): string {
  return secret.replace(/(.{4})/g, "$1 ").trim();
}

export default function Connexion({ message, surConnecte }: Props) {
  const [etape, setEtape] = useState<Etape>({ nom: "identifiants" });
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [voirMotDePasse, setVoirMotDePasse] = useState(false);
  const [code, setCode] = useState("");
  const [erreur, setErreur] = useState(message ?? "");
  const [enCours, setEnCours] = useState(false);
  const champCode = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (etape.nom !== "identifiants") champCode.current?.focus();
  }, [etape.nom]);

  async function suivre(reponse: ReponseConnexion) {
    if (reponse.etape === "terminee") {
      definirJetons({ access: reponse.access, refresh: reponse.refresh });
      surConnecte();
    } else if (reponse.etape === "code") {
      setEtape({ nom: "code", jetonEtape: reponse.jeton_etape });
    } else {
      const qr = await QRCode.toDataURL(reponse.uri, { width: 220, margin: 1 });
      setEtape({ nom: "configuration", jetonEtape: reponse.jeton_etape, secret: reponse.secret, qr });
    }
  }

  async function soumettre(e: FormEvent) {
    e.preventDefault();
    setErreur("");
    setEnCours(true);
    try {
      if (etape.nom === "identifiants") {
        await suivre(await connexion(username.trim(), password));
      } else {
        await suivre(await validerCode(etape.jetonEtape, code));
      }
    } catch (err) {
      setErreur((err as Error).message);
      setCode("");
    } finally {
      setEnCours(false);
    }
  }

  function recommencer() {
    setEtape({ nom: "identifiants" });
    setCode("");
    setPassword("");
    setErreur("");
  }

  return (
    <div className="page-auth">
      <aside className="panneau-marque">
        <p className="marque-surtitre">Gestion Stock</p>
        <h2 className="marque-titre">Administration de la plateforme</h2>
        <p className="marque-sous-titre">
          Boutiques, inscriptions, abonnements et demandes, au même endroit. Les ventes, le stock et les clients des
          boutiques restent privés : ils ne sont jamais affichés ici.
        </p>
        <p className="marque-pied">Accès réservé aux administrateurs</p>
      </aside>

      <main className="panneau-formulaire">
        <form className="carte-auth" onSubmit={soumettre}>
          {etape.nom === "identifiants" && (
            <>
              <h1>Connexion</h1>
              <p className="sous-titre">Identifiants de votre compte administrateur.</p>
              <label>
                Identifiant
                <input
                  autoFocus
                  autoComplete="username"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  required
                />
              </label>
              <label>
                Mot de passe
                <span className="champ-mot-de-passe">
                  <input
                    type={voirMotDePasse ? "text" : "password"}
                    autoComplete="current-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                  />
                  <button
                    type="button"
                    className="oeil"
                    onClick={() => setVoirMotDePasse((v) => !v)}
                    aria-label={voirMotDePasse ? "Masquer le mot de passe" : "Afficher le mot de passe"}
                  >
                    {voirMotDePasse ? "🙈" : "👁️"}
                  </button>
                </span>
              </label>
            </>
          )}

          {etape.nom === "configuration" && (
            <>
              <h1>Double vérification</h1>
              <p className="sous-titre">
                L'administrateur principal l'a activée pour votre compte. À faire une seule fois :
              </p>
              <ol className="etapes-configuration">
                <li>
                  Installez une appli d'authentification sur votre téléphone (Google Authenticator, Microsoft
                  Authenticator…).
                </li>
                <li>Dans l'appli, ajoutez un compte en scannant ce code :</li>
              </ol>
              <img className="qr-configuration" src={etape.qr} alt="QR code à scanner avec l'appli d'authentification" />
              <p className="secret-configuration">
                Impossible de scanner ? Saisissez cette clé : <code>{grouper(etape.secret)}</code>
              </p>
              <p className="sous-titre">3. Tapez le code à 6 chiffres affiché par l'appli.</p>
            </>
          )}

          {etape.nom === "code" && (
            <>
              <h1>Code de vérification</h1>
              <p className="sous-titre">Ouvrez votre appli d'authentification et tapez le code à 6 chiffres.</p>
            </>
          )}

          {etape.nom !== "identifiants" && (
            <label>
              Code à 6 chiffres
              <input
                ref={champCode}
                className="champ-code"
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="[0-9 ]*"
                maxLength={7}
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/[^0-9]/g, "").slice(0, 6))}
                required
              />
            </label>
          )}

          {erreur && (
            <p className="message-erreur" role="alert">
              {erreur}
            </p>
          )}

          <button type="submit" disabled={enCours || (etape.nom !== "identifiants" && code.length !== 6)}>
            {enCours ? "Vérification…" : etape.nom === "identifiants" ? "Se connecter" : "Valider"}
          </button>

          {etape.nom !== "identifiants" && (
            <button type="button" className="lien" onClick={recommencer}>
              Revenir à l'identifiant
            </button>
          )}
        </form>
      </main>
    </div>
  );
}
