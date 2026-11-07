import { useEffect, useRef, useState } from "react";

import { api } from "../api/reseauBoutique";
import type { PostePrincipalTrouve } from "../api/reseauBoutique";

type Etape = "preparer" | "poste" | "code" | "reception" | "fini";

const ETAPES: { cle: Etape; libelle: string }[] = [
  { cle: "preparer", libelle: "Préparer" },
  { cle: "poste", libelle: "Poste principal" },
  { cle: "code", libelle: "Code" },
  { cle: "reception", libelle: "Réception" },
];

/** « 123456 » → « 123 456 ». */
function formaterCode(saisie: string): string {
  const chiffres = saisie.replace(/\D/g, "").slice(0, 6);
  return chiffres.length > 3 ? `${chiffres.slice(0, 3)} ${chiffres.slice(3)}` : chiffres;
}

/** Message du branchement, reformulé pour l'écran de connexion. */
function messageClair(message: string): string {
  if (/Code incorrect|expir/i.test(message)) return "Code incorrect ou expiré : affichez un nouveau code sur le poste principal (il ne sert qu'une fois, 10 minutes).";
  if (/introuvable/i.test(message)) return message;
  if (/15 postes|maximum/i.test(message)) return "Le poste principal a déjà son nombre maximum d'appareils (15) : débranchez-en un d'abord.";
  return message;
}

/**
 * Copie de client-electron/src/components/RejoindreReseauAvantConnexion.tsx
 * (docs/plan_mobile_complet.md, lot 2) : seuls les appels et le mot « appareil » diffèrent.
 *
 * Écran de connexion → « 📶 Rejoindre le réseau de la boutique », avant toute
 * connexion : un appareil neuf reçoit la boutique, ses données et les comptes
 * des vendeurs ; un appareil qui a déjà une boutique ne peut rejoindre que la
 * sienne ; le poste principal est orienté ailleurs. Étapes : Préparer, Poste
 * principal, Code (validé tout seul au 6e chiffre), Réception.
 */
export default function RejoindreReseauAvantConnexion({ onFermer, onRejoint }: { onFermer: () => void; onRejoint: () => void }) {
  const [etape, setEtape] = useState<Etape>("preparer");
  const [estPrincipal, setEstPrincipal] = useState(false);
  const [boutiqueLocale, setBoutiqueLocale] = useState<string | null>(null);
  const [recherche, setRecherche] = useState(false);
  const [rechercheFaite, setRechercheFaite] = useState(false);
  const [trouves, setTrouves] = useState<PostePrincipalTrouve[]>([]);
  const [saisieManuelle, setSaisieManuelle] = useState(false);
  const [adresse, setAdresse] = useState("");
  const [nomAppareil, setNomAppareil] = useState("");
  const [code, setCode] = useState("");
  const [erreur, setErreur] = useState<string | null>(null);
  const [resultat, setResultat] = useState<{ boutiqueNom: string; nomPostePrincipal: string; relie: boolean; comptes: number } | null>(null);
  const envoiEnCours = useRef(false);

  useEffect(() => {
    api.reseau
      .etat()
      .then((r) => setEstPrincipal(r.role === "principal"))
      .catch(() => {});
    api.admin.boutiqueLocale().then((b) => setBoutiqueLocale(b?.boutiqueNom ?? null));
  }, []);

  async function rechercher() {
    setRecherche(true);
    setErreur(null);
    const liste = await api.reseau.rechercher();
    setRecherche(false);
    setRechercheFaite(true);
    setTrouves(liste);
    setAdresse((actuelle) => (liste.some((t) => t.adresse === actuelle) ? actuelle : (liste[0]?.adresse ?? "")));
  }

  function aller(e: Etape) {
    setErreur(null);
    if (e === "poste" && !rechercheFaite && !saisieManuelle) rechercher();
    setEtape(e);
  }

  async function rejoindre(codeSaisi = code) {
    if (envoiEnCours.current) return;
    setErreur(null);
    if (!adresse.trim()) {
      setEtape("poste");
      return setErreur("Choisissez le poste principal (ou tapez son adresse).");
    }
    if (codeSaisi.replace(/\D/g, "").length !== 6) return setErreur("Tapez les 6 chiffres affichés sur le poste principal.");
    envoiEnCours.current = true;
    setEtape("reception");
    const r = await api.reseau.rejoindreAvantConnexion({ adresse: adresse.trim(), code: codeSaisi, nomAppareil });
    envoiEnCours.current = false;
    if (!r.succes) {
      setEtape(/introuvable|même Wi-Fi/i.test(r.message) ? "poste" : "code");
      setCode("");
      return setErreur(messageClair(r.message));
    }
    setResultat(r.resultat);
    setEtape("fini");
  }

  const indexEtape = ETAPES.findIndex((e) => e.cle === etape);
  const posteChoisi = trouves.find((t) => t.adresse === adresse);

  return (
    <div className="fond-modale" onClick={onFermer}>
      <div className="modale-selection-produits modale-auth-assistant" onClick={(e) => e.stopPropagation()}>
        <div className="modale-entete">
          <h3>📶 Rejoindre le réseau de la boutique</h3>
          <button type="button" className="lien bouton-retour" onClick={onFermer}>
            ← Retour
          </button>
        </div>
        <div className="modale-corps contenu-reseau">
          {estPrincipal ? (
            <div className="prochaine-etape prochaine-etape--neutre">
              <div>
                <span className="libelle-prochaine-etape">Cet appareil est le poste principal</span>
                <p>
                  Ce sont les autres appareils qui se branchent sur lui. Connectez-vous, puis Informations boutique → Réseau
                  de la boutique → Brancher une caisse pour afficher leur code.
                </p>
              </div>
            </div>
          ) : (
            <>
              {etape !== "fini" && (
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

              {etape === "preparer" && (
                <>
                  <div className={`prochaine-etape prochaine-etape--${boutiqueLocale ? "neutre" : "ok"}`}>
                    <div>
                      <span className="libelle-prochaine-etape">{boutiqueLocale ? "Appareil de la boutique" : "Nouvel appareil"}</span>
                      <p>
                        {boutiqueLocale
                          ? `Cet appareil est celui de « ${boutiqueLocale} » : il ne peut rejoindre que le poste principal de cette boutique.`
                          : "Il recevra la boutique, ses données (articles, stock, ventes…) et les comptes des vendeurs. Vous pourrez ensuite vous y connecter, même sans internet."}
                      </p>
                    </div>
                  </div>
                  <div className="bloc-reseau">
                    <h4>Avant de commencer</h4>
                    <ul className="verifications-reseau">
                      <li className="verif-info">Le poste principal est allumé, avec l'application ouverte.</li>
                      <li className="verif-info">Cet appareil est sur le même Wi-Fi (ou le même téléphone en point d'accès) que lui.</li>
                      <li className="verif-info">Le réseau de la boutique est activé par votre administrateur.</li>
                      <li className="verif-info">
                        Sur le poste principal : Informations boutique → Réseau de la boutique → <strong>Brancher une caisse</strong> pour
                        afficher le code à 6 chiffres.
                      </li>
                    </ul>
                  </div>
                  <details className="details-abonnement">
                    <summary>❓ Comment relier les appareils sans internet ?</summary>
                    <ul className="verifications-reseau">
                      <li className="verif-info">📡 Un petit routeur Wi-Fi : le plus fiable, sans abonnement internet.</li>
                      <li className="verif-info">📱 Le point d'accès d'un téléphone (même sans forfait), allumé et sur chargeur.</li>
                      <li className="verif-info">🔌 Un câble réseau (entre deux ordinateurs).</li>
                      <li className="verif-info">🛡️ Sur le poste principal appareil : si Windows demande d'autoriser l'application sur le réseau, « Autoriser ».</li>
                    </ul>
                  </details>
                  <div className="actions-assistant">
                    <span />
                    <button type="button" className="bouton-primaire" onClick={() => aller("poste")}>
                      C'est prêt → Suivant
                    </button>
                  </div>
                </>
              )}

              {etape === "poste" && (
                <>
                  {saisieManuelle ? (
                    <div className="champs-sauvegarde">
                      <label>
                        Adresse du poste principal
                        <input value={adresse} onChange={(e) => setAdresse(e.target.value)} placeholder="ex. 192.168.1.10" autoFocus />
                        <span className="note-aide">Affichée sur le poste principal, sous le code (ex. 192.168.1.10:47800).</span>
                      </label>
                      <div>
                        <button
                          type="button"
                          onClick={() => {
                            setSaisieManuelle(false);
                            rechercher();
                          }}
                        >
                          ← Revenir à la recherche automatique
                        </button>
                      </div>
                    </div>
                  ) : recherche ? (
                    <div className="recherche-reseau-en-cours">
                      <span className="sablier-reseau" aria-hidden="true" />
                      Recherche du poste principal sur le réseau…
                    </div>
                  ) : trouves.length > 0 ? (
                    <>
                      <div className="liste-postes-trouves">
                        {trouves.map((t) => (
                          <button
                            key={t.adresse}
                            type="button"
                            className={`carte-poste-trouve${adresse === t.adresse ? " choisi" : ""}`}
                            onClick={() => setAdresse(t.adresse)}
                          >
                            <span className="icone-choix-reseau">🖥️</span>
                            <span>
                              <strong>{t.boutiqueNom}</strong>
                              <span className="sous-info ligne-detail-article">
                                poste « {t.nomPoste} » · {t.adresse}
                              </span>
                            </span>
                            {adresse === t.adresse && <span className="coche-poste-trouve">✓</span>}
                          </button>
                        ))}
                      </div>
                      <span className="note-aide">
                        <button type="button" className="lien" onClick={rechercher}>
                          ⟳ Relancer la recherche
                        </button>
                        {" · "}
                        <button type="button" className="lien" onClick={() => setSaisieManuelle(true)}>
                          Il n'est pas dans la liste : taper l'adresse
                        </button>
                      </span>
                    </>
                  ) : (
                    <div className="bandeau-pause-reseau aucun-poste-trouve">
                      <div>
                        <strong>Aucun poste principal trouvé.</strong>
                        <span className="note-aide ligne-detail-article">
                          Vérifiez les points de l'étape « Préparer ». Certains téléphones bloquent la recherche : tapez alors
                          l'adresse.
                        </span>
                      </div>
                      <div className="actions-code-reseau">
                        <button type="button" className="bouton-primaire" onClick={rechercher}>
                          ⟳ Relancer la recherche
                        </button>
                        <button type="button" onClick={() => setSaisieManuelle(true)}>
                          ⌨️ Taper l'adresse
                        </button>
                      </div>
                    </div>
                  )}
                  <label className="champ-etape-reseau">
                    <strong>Nom de cet appareil</strong>
                    <input value={nomAppareil} maxLength={40} onChange={(e) => setNomAppareil(e.target.value)} placeholder="ex. Caisse 2 (sinon : nom du téléphone)" />
                    <span className="note-aide">C'est ce nom que le poste principal verra dans sa liste d'appareils.</span>
                  </label>
                  <div className="actions-assistant">
                    <button type="button" onClick={() => aller("preparer")}>
                      ← Précédent
                    </button>
                    <button
                      type="button"
                      className="bouton-primaire"
                      disabled={!adresse.trim()}
                      onClick={() => aller("code")}
                    >
                      Suivant →
                    </button>
                  </div>
                </>
              )}

              {etape === "code" && (
                <>
                  <p className="note-aide">
                    Poste principal : <strong>{posteChoisi ? `${posteChoisi.boutiqueNom} · « ${posteChoisi.nomPoste} »` : adresse}</strong>
                  </p>
                  <label className="champ-etape-reseau">
                    <strong>Code à 6 chiffres affiché sur le poste principal</strong>
                    <input
                      className="champ-code-reseau champ-code-grand"
                      value={code}
                      inputMode="numeric"
                      placeholder="123 456"
                      autoFocus
                      onChange={(e) => {
                        const formate = formaterCode(e.target.value);
                        setCode(formate);
                        // Validé tout seul au 6e chiffre.
                        if (formate.replace(/\D/g, "").length === 6) rejoindre(formate);
                      }}
                    />
                    <span className="note-aide">Valable 10 minutes et une seule fois ; le branchement part dès le 6e chiffre.</span>
                  </label>
                  <div className="actions-assistant">
                    <button type="button" onClick={() => aller("poste")}>
                      ← Précédent
                    </button>
                    <button type="button" className="bouton-primaire" onClick={() => rejoindre()}>
                      📶 Rejoindre
                    </button>
                  </div>
                </>
              )}

              {etape === "reception" && (
                <div className="recherche-reseau-en-cours reception-reseau">
                  <span className="sablier-reseau" aria-hidden="true" />
                  <span>
                    <strong>Branchement et réception des données de la boutique…</strong>
                    <span className="sous-info ligne-detail-article">
                      Boutique, articles, stock, ventes et comptes des vendeurs : cela peut prendre un moment la première fois.
                    </span>
                  </span>
                </div>
              )}

              {etape === "fini" && resultat && (
                <>
                  <div className="carte-etat-serveur carte-etat-serveur--marche">
                    <div className="entete-vue-ensemble">
                      <span className="icone-vue-ensemble">✅</span>
                      <div>
                        <strong className="etat-serveur-titre">Relié à « {resultat.boutiqueNom} »</strong>
                        <span className="sous-info ligne-detail-article">
                          Poste principal « {resultat.nomPostePrincipal} » · {resultat.relie ? "données reçues" : "réception en cours"}
                          {nomAppareil.trim() ? ` · cet appareil : « ${nomAppareil.trim()} »` : ""}
                        </span>
                      </div>
                    </div>
                  </div>
                  <div className="grille-cartes-reseau">
                    <div className="carte-info-reseau">
                      <span className="titre-carte-reseau">👥 Comptes reçus</span>
                      <strong>{resultat.comptes}</strong>
                      <span className="sous-info">identifiants utilisables ici, même sans internet</span>
                    </div>
                    <div className="carte-info-reseau">
                      <span className="titre-carte-reseau">🔄 Échanges</span>
                      <strong>toutes les 4 secondes</strong>
                      <span className="sous-info">ventes et stock partagés avec le poste principal</span>
                    </div>
                  </div>
                  {resultat.comptes > 0 ? (
                    <div className="prochaine-etape prochaine-etape--ok">
                      <div>
                        <span className="libelle-prochaine-etape">✓ Prochaine étape</span>
                        <p>Connectez-vous avec votre identifiant habituel.</p>
                      </div>
                      <button type="button" className="bouton-primaire" onClick={onRejoint}>
                        Se connecter
                      </button>
                    </div>
                  ) : (
                    <div className="prochaine-etape prochaine-etape--attention">
                      <div>
                        <span className="libelle-prochaine-etape">Comptes pas encore reçus</span>
                        <p>
                          Patientez une minute (ils arrivent avec les échanges suivants), ou vérifiez que les comptes des vendeurs
                          ont bien été créés ou utilisés sur le poste principal.
                        </p>
                      </div>
                      <button type="button" onClick={onRejoint}>
                        Continuer
                      </button>
                    </div>
                  )}
                </>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
