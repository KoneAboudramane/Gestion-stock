import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

import {
  genererLaissezPasser,
  listerLaissezPasser,
  revoquerLaissezPasser,
  type LaissezPasserGenere,
  type LaissezPasserResume,
} from "../services/laissezPasser";
import BarreRubriques from "./BarreRubriques";

/**
 * Espace Admin de l'appli → « 🎫 Laissez-passer » (docs/plan_laissez_passer_admin.md) :
 * générer, AVEC internet, un laissez-passer qui ouvrira l'Espace Admin d'un appareil
 * SANS internet ; voir et révoquer ceux déjà générés.
 * Copie conforme : client-electron/src/components/ModaleLaissezPasserAdmin.tsx (seul `appels` diffère).
 */

/** Accès au serveur (seule partie qui diffère entre le bureau et le web). */
const appels = {
  generer: genererLaissezPasser,
  lister: listerLaissezPasser,
  revoquer: revoquerLaissezPasser,
  ouvrir: (url: string) => {
    window.open(url, "_blank", "noopener");
  },
};

type Rubrique = "generer" | "liste" | "aide";

const DUREES: { valeur: number | null; libelle: string }[] = [
  { valeur: 1, libelle: "1 jour" },
  { valeur: 7, libelle: "7 jours" },
  { valeur: 15, libelle: "15 jours" },
  { valeur: 30, libelle: "30 jours" },
  { valeur: 90, libelle: "90 jours" },
  { valeur: null, libelle: "Illimité" },
];

/** « AAAA-MM-JJ » (date seule) ou ISO complet → jj/mm/aaaa. */
function dateCourte(valeur: string | null): string {
  if (!valeur) return "";
  return new Date(valeur.length === 10 ? `${valeur}T12:00:00` : valeur).toLocaleDateString("fr-FR");
}

function finDans(jours: number): string {
  const fin = new Date();
  fin.setDate(fin.getDate() + jours);
  return fin.toLocaleDateString("fr-FR");
}

const CLASSE_ETAT: Record<LaissezPasserResume["etat"], string> = {
  actif: "badge-lp badge-lp--actif",
  expire: "badge-lp",
  revoque: "badge-lp badge-lp--alerte",
  mot_de_passe_change: "badge-lp",
  compte_desactive: "badge-lp badge-lp--alerte",
};

export default function ModaleLaissezPasserAdmin({
  onFermer,
  username,
  password,
}: {
  onFermer: () => void;
  username: string;
  password: string;
}) {
  const [rubrique, setRubrique] = useState<Rubrique>("generer");
  const [duree, setDuree] = useState<number | null>(15);
  const [genere, setGenere] = useState<LaissezPasserGenere | null>(null);
  const [liste, setListe] = useState<LaissezPasserResume[] | null>(null);
  const [erreurListe, setErreurListe] = useState<string | null>(null);
  const [aRevoquer, setARevoquer] = useState<LaissezPasserResume | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [enCours, setEnCours] = useState(false);
  const [copie, setCopie] = useState(false);

  async function chargerListe() {
    setErreurListe(null);
    try {
      setListe(await appels.lister(username, password));
    } catch (e) {
      setErreurListe(e instanceof Error ? e.message : "Liste indisponible.");
    }
  }
  useEffect(() => {
    chargerListe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function aller(r: Rubrique) {
    setErreur(null);
    setMessage(null);
    setRubrique(r);
  }

  async function generer() {
    setErreur(null);
    setMessage(null);
    setEnCours(true);
    try {
      setGenere(await appels.generer(username, password, duree));
      setCopie(false);
      chargerListe();
    } catch (e) {
      setErreur(e instanceof Error ? e.message : "Génération impossible.");
    } finally {
      setEnCours(false);
    }
  }

  async function revoquer(lp: LaissezPasserResume) {
    setErreur(null);
    setMessage(null);
    setEnCours(true);
    try {
      setListe(await appels.revoquer(username, password, lp.id));
      setMessage(`Laissez-passer n° ${lp.numero} révoqué : l'appareil qui l'utilise perdra l'accès admin à son retour sur internet.`);
      setARevoquer(null);
    } catch (e) {
      setErreur(e instanceof Error ? e.message : "Révocation impossible.");
    } finally {
      setEnCours(false);
    }
  }

  async function copier() {
    if (!genere) return;
    try {
      await navigator.clipboard.writeText(genere.code);
      setCopie(true);
    } catch {
      setErreur("Copie impossible : sélectionnez le code à la main.");
    }
  }

  function envoyerWhatsapp() {
    if (!genere) return;
    const texte = `Laissez-passer Gestion Stock (Espace Admin sans internet)${genere.illimite ? "" : ` — valable jusqu'au ${dateCourte(genere.date_fin)}`} :\n${genere.code}`;
    appels.ouvrir(`https://wa.me/?text=${encodeURIComponent(texte)}`);
  }

  function imprimer() {
    document.body.classList.add("impression-laissez-passer");
    window.print();
    document.body.classList.remove("impression-laissez-passer");
  }

  const actifs = liste?.filter((lp) => lp.etat === "actif").length ?? null;
  const rubriques: { cle: Rubrique; label: string; compteur?: string }[] = [
    { cle: "generer", label: "🎫 Générer" },
    { cle: "liste", label: "📋 Mes laissez-passer", compteur: actifs ? String(actifs) : undefined },
    { cle: "aide", label: "❓ Comment s'en servir" },
  ];

  function contenu() {
    switch (rubrique) {
      case "liste":
        return (
          <>
            <h4 className="titre-rubrique-reseau">📋 Mes laissez-passer</h4>
            <p className="note-aide">
              Le code n'est gardé nulle part : seuls le numéro et l'état sont listés. Révoquer un laissez-passer coupe
              l'accès admin de l'appareil qui l'utilise, dès son retour sur internet.
            </p>
            {erreurListe ? (
              <div className="prochaine-etape prochaine-etape--neutre">
                <div>
                  <span className="libelle-prochaine-etape">Sans connexion au serveur</span>
                  <p>{erreurListe}</p>
                </div>
                <button type="button" onClick={chargerListe}>
                  ⟳ Réessayer
                </button>
              </div>
            ) : liste === null ? (
              <p className="sous-titre">Chargement…</p>
            ) : liste.length === 0 ? (
              <p className="sous-titre">Aucun laissez-passer pour le moment.</p>
            ) : (
              <div className="zone-tableau-scroll zone-appareils-reseau">
                <table className="tableau-catalogue carte-mobile tableau-appareils-reseau">
                  <thead>
                    <tr>
                      <th>N°</th>
                      <th>Créé le</th>
                      <th>Valable jusqu'au</th>
                      <th>État</th>
                      <th>Utilisations</th>
                      {liste.some((lp) => lp.admin !== username) && <th>Admin</th>}
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {liste.map((lp) => (
                      <tr key={lp.id}>
                        <td data-label="N°" className="nowrap code-numero-lp">
                          {lp.numero}
                        </td>
                        <td data-label="Créé le" className="nowrap">
                          {dateCourte(lp.date_creation)}
                        </td>
                        <td data-label="Valable jusqu'au" className="nowrap">
                          {lp.illimite ? "illimité" : dateCourte(lp.date_fin)}
                        </td>
                        <td data-label="État">
                          <span className={CLASSE_ETAT[lp.etat] ?? "badge-lp"}>{lp.etat_libelle}</span>
                        </td>
                        <td data-label="Utilisations">
                          {lp.utilisations}
                          {lp.derniere_utilisation && <span className="sous-info"> · dernière le {dateCourte(lp.derniere_utilisation)}</span>}
                        </td>
                        {liste.some((x) => x.admin !== username) && <td data-label="Admin">{lp.admin}</td>}
                        <td>
                          {lp.etat === "actif" &&
                            (aRevoquer?.id === lp.id ? (
                              <span className="actions-ligne-lp">
                                <button type="button" className="bouton-danger" disabled={enCours} onClick={() => revoquer(lp)}>
                                  Confirmer
                                </button>
                                <button type="button" className="lien" onClick={() => setARevoquer(null)}>
                                  Annuler
                                </button>
                              </span>
                            ) : (
                              <button type="button" className="lien" onClick={() => setARevoquer(lp)}>
                                ⛔ Révoquer
                              </button>
                            ))}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        );
      case "aide":
        return (
          <>
            <h4 className="titre-rubrique-reseau">❓ Comment s'en servir</h4>
            <ol className="etapes-aide-lp">
              <li>
                <strong>Avant de partir, avec internet</strong> : générez le laissez-passer ici et copiez-le (ou envoyez-le
                vous par WhatsApp, ou imprimez-le).
              </li>
              <li>
                <strong>Sur place, sans internet</strong>, sur l'appareil neuf : ⚙ Espace Admin → cochez « 🎫 J'ai un
                laissez-passer » et collez le code.
              </li>
              <li>Tapez votre identifiant et votre mot de passe administrateur : le code seul ne suffit pas.</li>
            </ol>
            <p className="note-aide">
              Il cesse de marcher si vous changez de mot de passe, à sa date de fin, ou si vous le révoquez (ici ou sur le
              site d'administration).
            </p>
          </>
        );
      default:
        return (
          <>
            <h4 className="titre-rubrique-reseau">🎫 Générer un laissez-passer</h4>
            <p className="note-aide">
              Il ouvre l'Espace Admin d'un appareil <strong>qui n'a jamais vu internet</strong>. Générez-le avec internet,
              avant de partir. <button type="button" className="lien" onClick={() => aller("aide")}>Comment s'en servir ?</button>
            </p>
            <div className="etape-reseau">
              <span className="numero-etape-reseau">1</span>
              <div className="champ-etape-reseau">
                <strong>Durée</strong>
                <div className="grille-durees-abonnement">
                  {DUREES.map((d) => (
                    <button
                      key={d.libelle}
                      type="button"
                      className={`carte-duree-abonnement${duree === d.valeur ? " choisi" : ""}`}
                      onClick={() => setDuree(d.valeur)}
                    >
                      <strong>{d.libelle}</strong>
                      <span className="sous-info">{d.valeur === null ? "sans date de fin" : `jusqu'au ${finDans(d.valeur)}`}</span>
                    </button>
                  ))}
                </div>
                {duree === null && (
                  <span className="note-aide">
                    ⚠️ Illimité : il servira sur tous vos appareils neufs, aussi longtemps que vous voulez. Gardez-le en lieu
                    sûr ; il reste protégé par votre mot de passe.
                  </span>
                )}
              </div>
            </div>
            <div className="etape-reseau">
              <span className="numero-etape-reseau">2</span>
              <div className="champ-etape-reseau">
                <strong>Générer</strong>
                <div className="actions-formulaire">
                  <button type="button" className="bouton-primaire" disabled={enCours} onClick={generer}>
                    {enCours ? "Génération…" : genere ? "🎫 Générer un autre" : "🎫 Générer le laissez-passer"}
                  </button>
                </div>
              </div>
            </div>
            {genere && (
              <div className="bloc-code-lp">
                <div className="entete-code-lp">
                  <strong>Votre laissez-passer · n° {genere.numero}</strong>
                  <span>{genere.illimite ? "Sans date de fin" : `Valable jusqu'au ${dateCourte(genere.date_fin)}`}</span>
                </div>
                <p className="alerte-code-lp">⚠️ Montré une seule fois : copiez-le maintenant, il n'est gardé nulle part.</p>
                <textarea className="code-lp" rows={4} readOnly value={genere.code} onFocus={(e) => e.target.select()} />
                <div className="actions-formulaire">
                  <button type="button" className="bouton-primaire" onClick={copier}>
                    {copie ? "✓ Copié" : "📋 Copier le code"}
                  </button>
                  <button type="button" onClick={envoyerWhatsapp}>
                    💬 WhatsApp
                  </button>
                  <button type="button" onClick={imprimer}>
                    🖨 Imprimer
                  </button>
                </div>
              </div>
            )}
          </>
        );
    }
  }

  return (
    <div className="fond-modale" onClick={onFermer}>
      <div className="modale-selection-produits modale-abonnement-admin" onClick={(e) => e.stopPropagation()}>
        <div className="modale-entete">
          <h3>🎫 Laissez-passer</h3>
          <button type="button" className="lien bouton-retour" onClick={onFermer}>
            ← Retour
          </button>
        </div>
        <div className="modale-corps">
          <div className="disposition-parametres">
            <BarreRubriques
              etiquette="Laissez-passer"
              etat={actifs === null ? "—" : `${actifs} actif(s)`}
              rubriques={rubriques}
              active={rubrique}
              onChoisir={aller}
            />
            <div className="contenu-parametres contenu-reseau">
              {erreur && <div className="message-erreur">{erreur}</div>}
              {message && <div className="message-succes">{message}</div>}
              {contenu()}
            </div>
          </div>
        </div>
      </div>
      {genere &&
        createPortal(
          <div className="zone-impression-laissez-passer">
            <h1>Laissez-passer Gestion Stock</h1>
            <p>
              Espace Admin sans internet · n° {genere.numero} ·{" "}
              {genere.illimite ? "sans date de fin" : `valable jusqu'au ${dateCourte(genere.date_fin)}`}
            </p>
            <pre>{genere.code}</pre>
            <p className="pied-lp">
              À garder en lieu sûr. Le code seul ne suffit pas : identifiant et mot de passe administrateur demandés.
            </p>
          </div>,
          document.body,
        )}
    </div>
  );
}
