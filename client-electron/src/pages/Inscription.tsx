import { useEffect, useState } from "react";

import { api } from "../api/client";
import type { AbonnementBoutique, ParametresCreationBoutique } from "../api/types";
import ChampNouveauMotDePasse from "../components/ChampNouveauMotDePasse";
import { soliditeMotDePasse } from "../lib/motDePasse";

type Etape = 1 | 2 | 3 | 4;
export type ModaleSuite = "abonnement" | "sauvegarde" | "reseau";

const ETAPES: { numero: Etape; libelle: string }[] = [
  { numero: 1, libelle: "Boutique" },
  { numero: 2, libelle: "Patron" },
  { numero: 3, libelle: "Options" },
  { numero: 4, libelle: "Récapitulatif" },
];

const DUREES = [1, 3, 6, 12];
const MODES_PAIEMENT: [string, string][] = [
  ["wave", "Wave"],
  ["orange_money", "Orange Money"],
  ["mtn", "MTN Mobile Money"],
  ["moov", "Moov Money"],
  ["especes", "Espèces"],
  ["banque", "Banque"],
  ["autre", "Autre"],
];

function ajouterMois(date: Date, mois: number): Date {
  const resultat = new Date(date);
  const jour = resultat.getDate();
  resultat.setDate(1);
  resultat.setMonth(resultat.getMonth() + mois);
  resultat.setDate(Math.min(jour, new Date(resultat.getFullYear(), resultat.getMonth() + 1, 0).getDate()));
  return resultat;
}

const emailValide = (email: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());

/**
 * Espace Admin → Créer une boutique : assistant en 4 étapes (Boutique, Patron,
 * Options, Récapitulatif) avec vérifications à chaque étape, puis fiche de
 * démarrage (copier, WhatsApp, imprimer) et suite logique (abonnement,
 * sauvegarde, réseau).
 *
 * La boutique est créée sur CE poste (un poste = une boutique) :
 * - « En ligne » : enregistrée tout de suite sur le serveur avec ses options —
 *   le patron peut se connecter partout ; repli automatique sur « sur ce poste »
 *   si le réseau manque ;
 * - « Sur ce poste seulement » : utilisable tout de suite sans internet ; tout
 *   (options comprises) part au serveur à « Activer en ligne » (Réglages >
 *   Synchronisation), le mot de passe du patron étant alors redemandé.
 */
export default function Inscription({
  onFermer,
  username: usernameAdmin,
  password: passwordAdmin,
  ouvrirModale,
}: {
  onFermer: () => void;
  username: string;
  password: string;
  /** Suite logique après la création : ouvre une autre carte de l'Espace Admin. */
  ouvrirModale?: (modale: ModaleSuite) => void;
}) {
  const [dejaInstallee, setDejaInstallee] = useState<AbonnementBoutique | null | undefined>(undefined);
  const [etape, setEtape] = useState<Etape>(1);
  const [erreur, setErreur] = useState<string | null>(null);
  const [enCours, setEnCours] = useState(false);
  // 1. Boutique
  const [boutiqueNom, setBoutiqueNom] = useState("");
  const [telephone, setTelephone] = useState("");
  const [adresse, setAdresse] = useState("");
  const [devise, setDevise] = useState("FCFA");
  // 2. Patron
  const [prenom, setPrenom] = useState("");
  const [nom, setNom] = useState("");
  const [identifiant, setIdentifiant] = useState("");
  const [disponible, setDisponible] = useState<boolean | null | "verification">(null);
  const [email, setEmail] = useState("");
  const [patronTelephone, setPatronTelephone] = useState("");
  const [motDePasse, setMotDePasse] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [doitChanger, setDoitChanger] = useState(true);
  // 3. Options
  const [essai, setEssai] = useState(true);
  const [formule, setFormule] = useState("essentiel");
  const [duree, setDuree] = useState(1);
  const [nature, setNature] = useState<"paiement" | "offert">("paiement");
  const [montant, setMontant] = useState("");
  const [mode, setMode] = useState("");
  const [reference, setReference] = useState("");
  const [synchroAutorisee, setSynchroAutorisee] = useState(false);
  const [reseauAutorise, setReseauAutorise] = useState(false);
  // 4. Création
  const [enLigne, setEnLigne] = useState(true);
  const [resultat, setResultat] = useState<{ statut: "enLigne" | "horsLigne"; demande: "enLigne" | "horsLigne" } | null>(null);
  const [copie, setCopie] = useState(false);

  useEffect(() => {
    api.admin.boutiqueLocale().then(setDejaInstallee);
  }, []);

  // Identifiant pris ? (vérifié sur le serveur ; sans internet, à l'enregistrement en ligne)
  useEffect(() => {
    const valeur = identifiant.trim();
    if (!valeur) return setDisponible(null);
    setDisponible("verification");
    const minuteur = setTimeout(async () => {
      setDisponible(await api.admin.identifiantDisponible(usernameAdmin, passwordAdmin, valeur));
    }, 500);
    return () => clearTimeout(minuteur);
  }, [identifiant, usernameAdmin, passwordAdmin]);

  const dateFin = essai ? null : ajouterMois(new Date(), duree);

  function verifierEtape(n: Etape): string | null {
    if (n === 1 && !boutiqueNom.trim()) return "Indiquez le nom de la boutique.";
    if (n === 2) {
      if (!identifiant.trim()) return "Choisissez l'identifiant du patron.";
      if (/\s/.test(identifiant.trim())) return "L'identifiant ne doit pas contenir d'espace.";
      if (disponible === false) return "Cet identifiant est déjà pris : choisissez-en un autre.";
      if (!emailValide(email)) return "Adresse e-mail invalide.";
      const solidite = soliditeMotDePasse(motDePasse, identifiant);
      if (solidite.manques.length) return `Mot de passe : ${solidite.manques.join(", ")}.`;
      if (motDePasse !== confirmation) return "Les deux mots de passe ne sont pas identiques.";
    }
    if (n === 3 && !essai && nature === "paiement" && !(Number(montant) > 0)) {
      return "Indiquez le montant reçu, ou choisissez « Offert » (ou l'essai gratuit).";
    }
    return null;
  }

  function aller(n: Etape) {
    setErreur(null);
    // On ne passe une étape que si les précédentes sont bonnes.
    for (let i = 1; i < n; i++) {
      const probleme = verifierEtape(i as Etape);
      if (probleme) {
        setEtape(i as Etape);
        return setErreur(probleme);
      }
    }
    setEtape(n);
  }

  function parametres(): ParametresCreationBoutique {
    return {
      boutiqueNom: boutiqueNom.trim(),
      telephone: telephone.trim(),
      adresse: adresse.trim(),
      devise: devise.trim() || "FCFA",
      username: identifiant.trim(),
      password: motDePasse,
      email: email.trim(),
      patronTelephone: patronTelephone.trim(),
      prenom: prenom.trim(),
      nom: nom.trim(),
      doitChanger,
      options: {
        formule,
        dateFin: dateFin ? dateFin.toISOString() : null,
        ...(essai ? {} : { nature, ...(nature === "paiement" ? { montant: Number(montant), mode, reference: reference.trim() } : {}) }),
        synchroAutorisee,
        reseauAutorise,
      },
    };
  }

  async function creer() {
    for (const n of [1, 2, 3] as Etape[]) {
      const probleme = verifierEtape(n);
      if (probleme) {
        setEtape(n);
        return setErreur(probleme);
      }
    }
    setErreur(null);
    setEnCours(true);
    try {
      if (enLigne) {
        const r = await api.admin.creerBoutiqueEnLigne(usernameAdmin, passwordAdmin, parametres());
        if (!r.succes) return setErreur(r.message);
        setResultat({ statut: r.resultat.statut, demande: "enLigne" });
      } else {
        const r = await api.admin.creerBoutiqueLocale(parametres());
        if (!r.succes) return setErreur(r.message);
        setResultat({ statut: "horsLigne", demande: "horsLigne" });
      }
    } finally {
      setEnCours(false);
    }
  }

  const texteFiche = `Votre boutique « ${boutiqueNom.trim()} » est prête sur Gestion Stock.\nIdentifiant : ${identifiant.trim()}\nMot de passe${doitChanger ? " provisoire" : ""} : ${motDePasse}${doitChanger ? "\nVous choisirez votre propre mot de passe à la première connexion." : ""}\nAbonnement : ${essai ? "essai gratuit de 15 jours" : `${formule === "pro" ? "Pro" : "Essentiel"} jusqu'au ${dateFin?.toLocaleDateString("fr-FR")}`}`;

  // --- Rendu ---

  const entete = (
    <div className="modale-entete">
      <h3>🚀 Créer une boutique</h3>
      <button type="button" className="lien bouton-retour" onClick={onFermer}>
        ← Retour
      </button>
    </div>
  );

  if (dejaInstallee) {
    return (
      <div className="fond-modale" onClick={onFermer}>
        <div className="modale-selection-produits modale-creation-boutique" onClick={(e) => e.stopPropagation()}>
          {entete}
          <div className="modale-corps contenu-reseau">
            <div className="prochaine-etape prochaine-etape--attention">
              <div>
                <span className="libelle-prochaine-etape">Cet ordinateur a déjà une boutique</span>
                <p>
                  Il est utilisé par « {dejaInstallee.boutiqueNom} » : un ordinateur sert une seule boutique. Créez la
                  nouvelle boutique depuis un autre ordinateur (ou depuis le portail web, ou dans l'admin Django).
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (resultat) {
    const local = resultat.statut === "horsLigne";
    return (
      <div className="fond-modale" onClick={onFermer}>
        <div className="modale-selection-produits modale-creation-boutique" onClick={(e) => e.stopPropagation()}>
          {entete}
          <div className="modale-corps contenu-reseau">
            <div className="carte-etat-serveur carte-etat-serveur--marche">
              <div className="entete-vue-ensemble">
                <span className="icone-vue-ensemble">🎉</span>
                <div>
                  <strong className="etat-serveur-titre">« {boutiqueNom.trim()} » est prête</strong>
                  <span className="sous-info ligne-detail-article">
                    {local
                      ? "Créée sur cet ordinateur : utilisable tout de suite, même sans internet."
                      : "Enregistrée sur le serveur : le patron peut se connecter dès maintenant, partout."}
                  </span>
                </div>
              </div>
            </div>
            {local && (
              <div className="prochaine-etape prochaine-etape--attention">
                <div>
                  <span className="libelle-prochaine-etape">À faire ensuite</span>
                  <p>
                    {resultat.demande === "enLigne" ? "Le réseau n'était pas disponible : la boutique a été créée sur cet ordinateur. " : ""}
                    Pour l'enregistrer sur le serveur (avec ses options), utilisez « Activer en ligne » depuis Réglages →
                    Synchronisation une fois connecté : le mot de passe du patron sera redemandé.
                  </p>
                </div>
              </div>
            )}
            <div className="fiches-recuperation">
              <div className="fiche-recuperation">
                <h3>Fiche de démarrage — {boutiqueNom.trim()}</h3>
                <p>
                  <strong>Patron :</strong> {[prenom, nom].filter(Boolean).join(" ") || identifiant}
                  <br />
                  <strong>Identifiant :</strong> {identifiant.trim()}
                  <br />
                  <strong>Abonnement :</strong>{" "}
                  {essai ? "essai gratuit de 15 jours" : `${formule === "pro" ? "Pro" : "Essentiel"} jusqu'au ${dateFin?.toLocaleDateString("fr-FR")}`}
                  <br />
                  <strong>Données en ligne :</strong> {synchroAutorisee ? "oui" : "non (100 % local)"} ·{" "}
                  <strong>Réseau de la boutique :</strong> {reseauAutorise ? "activé" : "non activé"}
                </p>
                <p className="fiche-recuperation-mot-de-passe">
                  Mot de passe{doitChanger ? " provisoire" : ""} : <strong>{motDePasse}</strong>
                </p>
                <p>
                  {doitChanger
                    ? "À la première connexion, l'application vous demandera de choisir votre propre mot de passe."
                    : "Gardez ce mot de passe pour vous ; ne le communiquez à personne."}
                </p>
              </div>
            </div>
            <div className="actions-code-reseau actions-activation-reseau">
              <button
                type="button"
                onClick={() => {
                  navigator.clipboard?.writeText(texteFiche);
                  setCopie(true);
                }}
              >
                {copie ? "✓ Copié" : "📋 Copier"}
              </button>
              <button
                type="button"
                onClick={() =>
                  api.systeme.ouvrirExterne(`https://wa.me/${patronTelephone.replace(/\D/g, "")}?text=${encodeURIComponent(texteFiche)}`)
                }
              >
                💬 WhatsApp{patronTelephone ? ` (${patronTelephone})` : ""}
              </button>
              <button
                type="button"
                onClick={() => {
                  document.body.classList.add("impression-fiche");
                  window.print();
                  document.body.classList.remove("impression-fiche");
                }}
              >
                🖨️ Imprimer
              </button>
            </div>
            {ouvrirModale && (
              <section className="bloc-reseau">
                <h4>Et ensuite ?</h4>
                <div className="grille-choix-reseau">
                  <button type="button" className="carte-choix-reseau" onClick={() => ouvrirModale("abonnement")}>
                    <span className="icone-choix-reseau">💳</span>
                    <strong>Abonnement</strong>
                    <span className="note-aide">Vérifier la période, enregistrer un paiement, générer un code.</span>
                  </button>
                  {!synchroAutorisee && (
                    <button type="button" className="carte-choix-reseau" onClick={() => ouvrirModale("sauvegarde")}>
                      <span className="icone-choix-reseau">💾</span>
                      <strong>Sauvegarde (recommandée)</strong>
                      <span className="note-aide">En 100 % local, les données n'existent que sur cet ordinateur.</span>
                    </button>
                  )}
                  {reseauAutorise && (
                    <button type="button" className="carte-choix-reseau" onClick={() => ouvrirModale("reseau")}>
                      <span className="icone-choix-reseau">📶</span>
                      <strong>Réseau de la boutique</strong>
                      <span className="note-aide">Relier les ordinateurs de la boutique sans internet.</span>
                    </button>
                  )}
                </div>
              </section>
            )}
          </div>
        </div>
      </div>
    );
  }

  const etiquetteDisponible =
    disponible === "verification" ? (
      <span className="sous-info">Vérification…</span>
    ) : disponible === true ? (
      <span className="autorisation-oui">✓ Disponible</span>
    ) : disponible === false ? (
      <span className="texte-erreur">✕ Déjà pris</span>
    ) : identifiant.trim() ? (
      <span className="sous-info">Vérifié à l'enregistrement en ligne (pas de connexion)</span>
    ) : null;

  return (
    <div className="fond-modale" onClick={onFermer}>
      <div className="modale-selection-produits modale-creation-boutique" onClick={(e) => e.stopPropagation()}>
        {entete}
        <div className="modale-corps contenu-reseau">
          <ol className="progression-assistant">
            {ETAPES.map((e) => (
              <li key={e.numero} className={e.numero === etape ? "actif" : e.numero < etape ? "fait" : ""}>
                <button type="button" onClick={() => aller(e.numero)}>
                  <span className="numero-etape-reseau">{e.numero < etape ? "✓" : e.numero}</span>
                  {e.libelle}
                </button>
              </li>
            ))}
          </ol>
          {erreur && <div className="message-erreur">{erreur}</div>}

          {etape === 1 && (
            <div className="champs-sauvegarde formulaire-assistant">
              <h4 className="titre-rubrique-reseau">🏪 La boutique</h4>
              <label>
                Nom de la boutique *
                <input value={boutiqueNom} onChange={(e) => setBoutiqueNom(e.target.value)} autoFocus placeholder="ex. Boutique Awa" />
              </label>
              <div className="grille-paiement-abonnement">
                <label>
                  Téléphone
                  <input value={telephone} onChange={(e) => setTelephone(e.target.value)} placeholder="ex. 07 00 00 00 00" />
                </label>
                <label>
                  Devise
                  <input value={devise} onChange={(e) => setDevise(e.target.value)} placeholder="FCFA" />
                </label>
              </div>
              <label>
                Adresse
                <input value={adresse} onChange={(e) => setAdresse(e.target.value)} placeholder="ex. Marché d'Adjamé, Abidjan" />
              </label>
            </div>
          )}

          {etape === 2 && (
            <div className="champs-sauvegarde formulaire-assistant">
              <h4 className="titre-rubrique-reseau">👤 Le patron</h4>
              <div className="grille-paiement-abonnement">
                <label>
                  Prénom
                  <input value={prenom} onChange={(e) => setPrenom(e.target.value)} autoFocus />
                </label>
                <label>
                  Nom
                  <input value={nom} onChange={(e) => setNom(e.target.value)} />
                </label>
              </div>
              <label>
                Identifiant de connexion *
                <input value={identifiant} onChange={(e) => setIdentifiant(e.target.value)} placeholder="ex. awa.kone" autoComplete="off" />
                {etiquetteDisponible}
              </label>
              <div className="grille-paiement-abonnement">
                <label>
                  E-mail *
                  <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="ex. awa@exemple.com" />
                  {email && !emailValide(email) && <span className="texte-erreur">Adresse e-mail invalide.</span>}
                </label>
                <label>
                  Téléphone (WhatsApp)
                  <input value={patronTelephone} onChange={(e) => setPatronTelephone(e.target.value)} placeholder="ex. 07 00 00 00 00" />
                </label>
              </div>
              <ChampNouveauMotDePasse
                valeur={motDePasse}
                confirmation={confirmation}
                identifiant={identifiant.trim()}
                onChange={(v, c) => {
                  setMotDePasse(v);
                  setConfirmation(c);
                }}
              />
              <label className="case-secours-sauvegarde">
                <span>
                  <input type="checkbox" checked={doitChanger} onChange={(e) => setDoitChanger(e.target.checked)} /> Le patron
                  choisira son propre mot de passe à sa première connexion
                </span>
              </label>
            </div>
          )}

          {etape === 3 && (
            <div className="champs-sauvegarde formulaire-assistant">
              <h4 className="titre-rubrique-reseau">⚙️ Les options</h4>
              <strong>Abonnement</strong>
              <div className="grille-choix-reseau">
                <button type="button" className={`carte-choix-reseau${essai ? " choisi" : ""}`} onClick={() => setEssai(true)}>
                  <span className="icone-choix-reseau">🎁</span>
                  <strong>Essai gratuit de 15 jours</strong>
                  <span className="note-aide">Formule Essentiel ; à renouveler ensuite dans « Gérer abonnement ».</span>
                </button>
                <button type="button" className={`carte-choix-reseau${!essai ? " choisi" : ""}`} onClick={() => setEssai(false)}>
                  <span className="icone-choix-reseau">💳</span>
                  <strong>Abonnement payé ou offert</strong>
                  <span className="note-aide">Choisir la formule et la durée dès maintenant.</span>
                </button>
              </div>
              {!essai && (
                <>
                  <div className="choix-formule-abonnement">
                    {(["essentiel", "pro"] as const).map((cle) => (
                      <button key={cle} type="button" className={`puce-nom-poste${formule === cle ? " choisi" : ""}`} onClick={() => setFormule(cle)}>
                        {cle === "pro" ? "Pro" : "Essentiel"}
                      </button>
                    ))}
                  </div>
                  <div className="grille-durees-abonnement">
                    {DUREES.map((mois) => (
                      <button key={mois} type="button" className={`carte-duree-abonnement${duree === mois ? " choisi" : ""}`} onClick={() => setDuree(mois)}>
                        <strong>{mois} mois</strong>
                        <span className="sous-info">jusqu'au {ajouterMois(new Date(), mois).toLocaleDateString("fr-FR")}</span>
                      </button>
                    ))}
                  </div>
                  <div className="choix-methode-restauration">
                    <label>
                      <input type="radio" checked={nature === "paiement"} onChange={() => setNature("paiement")} /> 💵 Paiement reçu
                    </label>
                    <label>
                      <input type="radio" checked={nature === "offert"} onChange={() => setNature("offert")} /> 🎁 Offert
                    </label>
                  </div>
                  {nature === "paiement" && (
                    <div className="grille-paiement-abonnement">
                      <label>
                        Montant reçu
                        <input type="number" min={0} step="any" value={montant} onChange={(e) => setMontant(e.target.value)} />
                      </label>
                      <label>
                        Payé par
                        <select value={mode} onChange={(e) => setMode(e.target.value)}>
                          <option value="">—</option>
                          {MODES_PAIEMENT.map(([cle, libelle]) => (
                            <option key={cle} value={cle}>
                              {libelle}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label>
                        Référence
                        <input value={reference} onChange={(e) => setReference(e.target.value)} placeholder="ex. MP2410…" />
                      </label>
                    </div>
                  )}
                </>
              )}
              <label className="case-secours-sauvegarde">
                <span>
                  <input type="checkbox" checked={synchroAutorisee} onChange={(e) => setSynchroAutorisee(e.target.checked)} /> 🌐
                  Envoi des données en ligne
                </span>
                <span className="note-aide">Décoché : 100 % local (pensez alors à la sauvegarde).</span>
              </label>
              <label className="case-secours-sauvegarde">
                <span>
                  <input type="checkbox" checked={reseauAutorise} onChange={(e) => setReseauAutorise(e.target.checked)} /> 📶
                  Réseau de la boutique (ordinateurs reliés sans internet)
                </span>
              </label>
            </div>
          )}

          {etape === 4 && (
            <div className="champs-sauvegarde formulaire-assistant">
              <h4 className="titre-rubrique-reseau">✅ Récapitulatif</h4>
              <div className="grille-cartes-reseau">
                <button type="button" className="carte-info-reseau cliquable" onClick={() => aller(1)}>
                  <span className="titre-carte-reseau">🏪 Boutique ›</span>
                  <strong>{boutiqueNom.trim()}</strong>
                  <span className="sous-info">{[telephone, adresse, devise].filter((v) => v.trim()).join(" · ")}</span>
                </button>
                <button type="button" className="carte-info-reseau cliquable" onClick={() => aller(2)}>
                  <span className="titre-carte-reseau">👤 Patron ›</span>
                  <strong>{identifiant.trim()}</strong>
                  <span className="sous-info">{[[prenom, nom].filter(Boolean).join(" "), email, patronTelephone].filter(Boolean).join(" · ")}</span>
                  <span className="sous-info">{doitChanger ? "choisira son mot de passe à la 1re connexion" : "garde ce mot de passe"}</span>
                </button>
                <button type="button" className="carte-info-reseau cliquable" onClick={() => aller(3)}>
                  <span className="titre-carte-reseau">⚙️ Options ›</span>
                  <strong>{essai ? "Essai gratuit 15 jours" : `${formule === "pro" ? "Pro" : "Essentiel"} · ${duree} mois`}</strong>
                  <span className="sous-info">
                    {essai ? "" : nature === "paiement" ? `${Number(montant || 0).toLocaleString("fr-FR")} F reçus` : "offert"}
                  </span>
                  <span className="sous-info">
                    {synchroAutorisee ? "🌐 en ligne" : "🔒 100 % local"} · {reseauAutorise ? "📶 réseau activé" : "réseau non activé"}
                  </span>
                </button>
              </div>
              <strong>Où créer la boutique ?</strong>
              <div className="grille-choix-reseau">
                <button type="button" className={`carte-choix-reseau${enLigne ? " choisi" : ""}`} onClick={() => setEnLigne(true)}>
                  <span className="icone-choix-reseau">🌐</span>
                  <strong>En ligne (recommandé)</strong>
                  <span className="note-aide">Enregistrée tout de suite sur le serveur : le patron se connecte partout.</span>
                </button>
                <button type="button" className={`carte-choix-reseau${!enLigne ? " choisi" : ""}`} onClick={() => setEnLigne(false)}>
                  <span className="icone-choix-reseau">📴</span>
                  <strong>Sur cet ordinateur seulement</strong>
                  <span className="note-aide">Sans internet ; à « Activer en ligne » plus tard.</span>
                </button>
              </div>
            </div>
          )}

          <div className="actions-assistant">
            {etape > 1 ? (
              <button type="button" onClick={() => aller((etape - 1) as Etape)}>
                ← Précédent
              </button>
            ) : (
              <span />
            )}
            {etape < 4 ? (
              <button type="button" className="bouton-primaire" onClick={() => aller((etape + 1) as Etape)}>
                Suivant →
              </button>
            ) : (
              <button type="button" className="bouton-primaire" disabled={enCours} onClick={creer}>
                {enCours ? "Création…" : "🚀 Créer la boutique"}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
