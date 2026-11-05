import { useEffect, useState } from "react";

import { api } from "../api/client";
import ChampNouveauMotDePasse from "../components/ChampNouveauMotDePasse";
import { soliditeMotDePasse } from "../lib/motDePasse";

type Etape = "qui" | "email" | "code" | "motDePasse" | "reussi" | "vendeur";

const VALIDITE_CODE_S = 15 * 60;
const DELAI_RENVOI_S = 60;
const emailValide = (email: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());

function minutesSecondes(secondes: number): string {
  return `${Math.floor(secondes / 60)}:${String(secondes % 60).padStart(2, "0")}`;
}

/**
 * « Mot de passe oublié ? » de l'écran de connexion (boutique autorisée à
 * échanger avec le serveur) : réservé au patron, par un code envoyé à son
 * e-mail (5 chiffres, 15 minutes — voir comptes/services.py ; réponse
 * toujours neutre, on ne dit jamais si l'e-mail existe). Trois étapes : e-mail,
 * code, nouveau mot de passe. Un vendeur ou un gérant est orienté vers son
 * patron ou l'administrateur. Internet nécessaire (le code part par e-mail).
 */
export default function MotDePasseOublie({ onFermer }: { onFermer: () => void }) {
  const [etape, setEtape] = useState<Etape>("qui");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [motDePasse, setMotDePasse] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [erreur, setErreur] = useState<string | null>(null);
  const [enCours, setEnCours] = useState(false);
  const [serveurJoint, setServeurJoint] = useState<boolean | null>(null);
  /** Secondes restantes avant l'expiration du code, et avant de pouvoir le renvoyer. */
  const [validite, setValidite] = useState(0);
  const [renvoi, setRenvoi] = useState(0);

  useEffect(() => {
    api.auth
      .etatConnexionAdmin()
      .then((e) => setServeurJoint(e.serveurJoint))
      .catch(() => setServeurJoint(false));
  }, []);
  useEffect(() => {
    if (validite <= 0 && renvoi <= 0) return;
    const minuteur = setTimeout(() => {
      setValidite((v) => Math.max(0, v - 1));
      setRenvoi((r) => Math.max(0, r - 1));
    }, 1000);
    return () => clearTimeout(minuteur);
  }, [validite, renvoi]);

  async function envoyerCode() {
    setErreur(null);
    if (!emailValide(email)) return setErreur("Adresse e-mail invalide.");
    setEnCours(true);
    const r = await api.auth.demanderReinitialisationMotDePasse(email.trim());
    setEnCours(false);
    if (!r.succes) return setErreur(r.message);
    setValidite(VALIDITE_CODE_S);
    setRenvoi(DELAI_RENVOI_S);
    setCode("");
    setEtape("code");
  }

  function verifierCode() {
    setErreur(null);
    if (!/^\d{5}$/.test(code.trim())) return setErreur("Le code reçu fait 5 chiffres.");
    if (validite <= 0) return setErreur("Ce code a expiré : demandez-en un nouveau.");
    setEtape("motDePasse");
  }

  async function valider() {
    setErreur(null);
    const solidite = soliditeMotDePasse(motDePasse);
    if (solidite.manques.length) return setErreur(`Mot de passe : ${solidite.manques.join(", ")}.`);
    if (motDePasse !== confirmation) return setErreur("Les deux mots de passe ne sont pas identiques.");
    setEnCours(true);
    const r = await api.auth.reinitialiserMotDePasse(email.trim(), code.trim(), motDePasse);
    setEnCours(false);
    if (!r.succes) {
      // Le serveur ne vérifie le code qu'ici : code faux ou expiré → retour à l'étape du code.
      setErreur(/code/i.test(r.message) ? "Code incorrect ou expiré : vérifiez-le, ou demandez-en un nouveau." : r.message);
      if (/code/i.test(r.message)) setEtape("code");
      return;
    }
    setEtape("reussi");
  }

  const ETAPES: { cle: Etape; libelle: string }[] = [
    { cle: "email", libelle: "E-mail" },
    { cle: "code", libelle: "Code" },
    { cle: "motDePasse", libelle: "Nouveau mot de passe" },
  ];
  const indexEtape = ETAPES.findIndex((e) => e.cle === etape);

  return (
    <div className="fond-modale" onClick={onFermer}>
      <div className="modale-selection-produits modale-auth-assistant" onClick={(e) => e.stopPropagation()}>
        <div className="modale-entete">
          <h3>🔑 Mot de passe oublié</h3>
          <button type="button" className="lien bouton-retour" onClick={onFermer}>
            ← Retour
          </button>
        </div>
        <div className="modale-corps contenu-reseau">
          {serveurJoint === false && etape !== "reussi" && (
            <div className="prochaine-etape prochaine-etape--attention">
              <div>
                <span className="libelle-prochaine-etape">Pas de connexion au serveur</span>
                <p>
                  Le code est envoyé par e-mail : il faut internet. Sans internet, demandez à votre administrateur de
                  réinitialiser votre mot de passe (Espace Admin → Mots de passe).
                </p>
              </div>
            </div>
          )}

          {indexEtape >= 0 && (
            <ol className="progression-assistant">
              {ETAPES.map((e, i) => (
                <li key={e.cle} className={i === indexEtape ? "actif" : i < indexEtape ? "fait" : ""}>
                  <button type="button" disabled>
                    <span className="numero-etape-reseau">{i < indexEtape ? "✓" : i + 1}</span>
                    {e.libelle}
                  </button>
                </li>
              ))}
            </ol>
          )}
          {erreur && <div className="message-erreur">{erreur}</div>}

          {etape === "qui" && (
            <>
              <p className="note-aide">Qui a oublié son mot de passe ?</p>
              <div className="grille-choix-reseau">
                <button type="button" className="carte-choix-reseau" onClick={() => setEtape("email")}>
                  <span className="icone-choix-reseau">👑</span>
                  <strong>Je suis le patron</strong>
                  <span className="note-aide">Un code de réinitialisation est envoyé à l'e-mail de votre compte.</span>
                </button>
                <button type="button" className="carte-choix-reseau" onClick={() => setEtape("vendeur")}>
                  <span className="icone-choix-reseau">🧑‍💼</span>
                  <strong>Je suis vendeur ou gérant</strong>
                  <span className="note-aide">C'est votre patron qui peut vous donner un nouveau mot de passe.</span>
                </button>
              </div>
            </>
          )}

          {etape === "vendeur" && (
            <>
              <div className="prochaine-etape prochaine-etape--neutre">
                <div>
                  <span className="libelle-prochaine-etape">Demandez à votre patron</span>
                  <p>
                    Votre patron se connecte, puis Informations boutique → Utilisateurs &amp; rôles → votre compte →
                    « Réinitialiser le mot de passe ». Il vous donne un nouveau mot de passe, que vous changerez ensuite.
                  </p>
                </div>
              </div>
              <p className="note-aide">
                Si le patron n'est pas joignable, l'administrateur de la plateforme peut aussi le faire (Espace Admin → Mots
                de passe), même sans internet sur cet ordinateur.
              </p>
              <div className="actions-assistant">
                <button type="button" onClick={() => setEtape("qui")}>
                  ← Précédent
                </button>
                <button type="button" className="bouton-primaire" onClick={onFermer}>
                  Compris
                </button>
              </div>
            </>
          )}

          {etape === "email" && (
            <form
              className="champs-sauvegarde formulaire-assistant"
              onSubmit={(e) => {
                e.preventDefault();
                envoyerCode();
              }}
            >
              <label>
                E-mail de votre compte patron
                <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoFocus placeholder="ex. awa@exemple.com" />
                {email && !emailValide(email) && <span className="texte-erreur">Adresse e-mail invalide.</span>}
              </label>
              <p className="note-aide">
                Si un compte patron utilise cet e-mail, vous recevrez un code de 5 chiffres, valable 15 minutes. Pour votre
                sécurité, l'application ne dit pas si l'e-mail existe.
              </p>
              <div className="actions-assistant">
                <button type="button" onClick={() => setEtape("qui")}>
                  ← Précédent
                </button>
                <button type="submit" className="bouton-primaire" disabled={enCours || serveurJoint === false}>
                  {enCours ? "Envoi…" : "📩 Recevoir le code"}
                </button>
              </div>
            </form>
          )}

          {etape === "code" && (
            <form
              className="champs-sauvegarde formulaire-assistant"
              onSubmit={(e) => {
                e.preventDefault();
                verifierCode();
              }}
            >
              <p className="note-aide">
                Un code a été envoyé à <strong>{email.trim()}</strong> (s'il correspond à un compte patron). Pensez à
                regarder dans les courriers indésirables.
              </p>
              <label>
                Code reçu par e-mail
                <input
                  className="champ-code-reseau"
                  value={code}
                  inputMode="numeric"
                  maxLength={5}
                  placeholder="12345"
                  autoFocus
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                />
              </label>
              <span className={validite > 0 ? "sous-info" : "texte-erreur"}>
                {validite > 0 ? `⏳ Valable encore ${minutesSecondes(validite)}` : "Ce code a expiré."}
              </span>
              <div>
                <button type="button" className="lien" disabled={renvoi > 0 || enCours} onClick={envoyerCode}>
                  {renvoi > 0 ? `Renvoyer le code (dans ${renvoi} s)` : "↻ Renvoyer le code"}
                </button>
              </div>
              <div className="actions-assistant">
                <button type="button" onClick={() => setEtape("email")}>
                  ← Changer d'e-mail
                </button>
                <button type="submit" className="bouton-primaire">
                  Suivant →
                </button>
              </div>
            </form>
          )}

          {etape === "motDePasse" && (
            <form
              className="champs-sauvegarde formulaire-assistant"
              onSubmit={(e) => {
                e.preventDefault();
                valider();
              }}
            >
              <ChampNouveauMotDePasse
                valeur={motDePasse}
                confirmation={confirmation}
                generable={false}
                onChange={(v, c) => {
                  setMotDePasse(v);
                  setConfirmation(c);
                }}
              />
              <div className="actions-assistant">
                <button type="button" onClick={() => setEtape("code")}>
                  ← Précédent
                </button>
                <button type="submit" className="bouton-primaire" disabled={enCours}>
                  {enCours ? "Enregistrement…" : "✅ Changer mon mot de passe"}
                </button>
              </div>
            </form>
          )}

          {etape === "reussi" && (
            <>
              <div className="carte-etat-serveur carte-etat-serveur--marche">
                <div className="entete-vue-ensemble">
                  <span className="icone-vue-ensemble">✅</span>
                  <div>
                    <strong className="etat-serveur-titre">Mot de passe changé</strong>
                    <span className="sous-info ligne-detail-article">
                      Connectez-vous maintenant avec votre identifiant et ce nouveau mot de passe.
                    </span>
                  </div>
                </div>
              </div>
              <p className="note-aide">
                Sur les ordinateurs sans internet, l'ancien mot de passe marche encore jusqu'à leur prochaine connexion en
                ligne avec le nouveau.
              </p>
              <div className="actions-formulaire">
                <button type="button" className="bouton-primaire" onClick={onFermer}>
                  Se connecter
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
