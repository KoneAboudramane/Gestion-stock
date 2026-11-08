import { useEffect, useState } from "react";

import ChampNouveauMotDePasse from "../components/ChampNouveauMotDePasse";
import FicheAcces from "../components/FicheAcces";
import { imprimer } from "../lib/impression";
import { soliditeMotDePasse } from "../lib/motDePasse";
import { obtenirBoutiqueInstallee, type AbonnementBoutique } from "../services/abonnementAdmin";
import {
  creerBoutiqueEnLigne,
  creerBoutiqueLocale,
  identifiantDisponible,
  type ParametresCreationBoutique,
} from "../services/inscriptionLocale";

/** Accès aux données (seule partie qui diffère avec client-electron/src/pages/Inscription.tsx). */
const appels = {
  boutiqueLocale: (): Promise<AbonnementBoutique | null> => obtenirBoutiqueInstallee(),
  identifiantDisponible: (u: string, p: string, valeur: string) => identifiantDisponible(u, p, valeur),
  creerEnLigne: async (u: string, p: string, params: ParametresCreationBoutique): Promise<"enLigne" | "horsLigne"> =>
    (await creerBoutiqueEnLigne(u, p, params)).statut,
  creerLocale: async (params: ParametresCreationBoutique): Promise<void> => {
    await creerBoutiqueLocale(params);
  },
  whatsapp: (texte: string, telephone: string) => {
    window.open(`https://wa.me/${telephone.replace(/\D/g, "")}?text=${encodeURIComponent(texte)}`, "_blank", "noopener");
  },
  imprimer: () => {
    void imprimer("Fiche-de-connexion", "impression-fiche");
  },
  cetAppareil: "cet appareil",
  cetAppareilMaj: "Cet appareil",
};

type Etape = 1 | 2 | 3 | 4;
export type ModaleSuite = "abonnement" | "sauvegarde" | "reseau";

const ETAPES: { numero: Etape; libelle: string; icone: string }[] = [
  { numero: 1, libelle: "Boutique", icone: "🏪" },
  { numero: 2, libelle: "Patron", icone: "👤" },
  { numero: 3, libelle: "Options", icone: "⚙️" },
  { numero: 4, libelle: "Récapitulatif", icone: "✅" },
];

const DUREES = [1, 3, 6, 12];
const DUREES_ESSAI = [7, 15, 30];
const LIBELLES_FORMULE: Record<string, string> = { essentiel: "Essentiel", pro: "Pro" };
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

/** Fin d'un essai de `jours` jours qui commence aujourd'hui (fin de journée). */
function finEssaiDans(jours: number): Date {
  const fin = new Date();
  fin.setDate(fin.getDate() + jours);
  fin.setHours(23, 59, 59, 0);
  return fin;
}

const emailValide = (email: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());

/**
 * Espace Admin → Créer une boutique : assistant en 4 étapes (Boutique, Patron,
 * Options, Récapitulatif) dans la barre de gauche, avec vérifications à chaque
 * étape, puis fiche de démarrage (copier, WhatsApp, imprimer) et suite logique
 * (abonnement, sauvegarde, réseau).
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
  const [essaiJours, setEssaiJours] = useState(15);
  const [formule, setFormule] = useState("essentiel");
  const [duree, setDuree] = useState(1);
  const [nature, setNature] = useState<"paiement" | "offert">("paiement");
  const [montant, setMontant] = useState("");
  const [mode, setMode] = useState("");
  const [reference, setReference] = useState("");
  const [synchroAutorisee, setSynchroAutorisee] = useState(false);
  const [reseauAutorise, setReseauAutorise] = useState(false);
  const [appliMobileAutorisee, setAppliMobileAutorisee] = useState(false);
  // 4. Création
  const [enLigne, setEnLigne] = useState(true);
  const [resultat, setResultat] = useState<{ statut: "enLigne" | "horsLigne"; demande: "enLigne" | "horsLigne" } | null>(null);

  useEffect(() => {
    appels.boutiqueLocale().then(setDejaInstallee);
  }, []);

  // Identifiant pris ? (vérifié sur le serveur ; sans internet, à l'enregistrement en ligne)
  useEffect(() => {
    const valeur = identifiant.trim();
    if (!valeur) return setDisponible(null);
    setDisponible("verification");
    const minuteur = setTimeout(async () => {
      setDisponible(await appels.identifiantDisponible(usernameAdmin, passwordAdmin, valeur));
    }, 500);
    return () => clearTimeout(minuteur);
  }, [identifiant, usernameAdmin, passwordAdmin]);

  const dateFin = essai ? finEssaiDans(essaiJours) : ajouterMois(new Date(), duree);
  const libelleAbonnement = essai
    ? `Essai gratuit ${LIBELLES_FORMULE[formule]} de ${essaiJours} jours (jusqu'au ${dateFin.toLocaleDateString("fr-FR")})`
    : `${LIBELLES_FORMULE[formule]} jusqu'au ${dateFin.toLocaleDateString("fr-FR")}${nature === "offert" ? " (offert)" : ""}`;

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
        dateFin: dateFin.toISOString(),
        ...(essai
          ? { nature: "essai" as const }
          : { nature, ...(nature === "paiement" ? { montant: Number(montant), mode, reference: reference.trim() } : {}) }),
        synchroAutorisee,
        reseauAutorise,
        appliMobileAutorisee,
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
        setResultat({ statut: await appels.creerEnLigne(usernameAdmin, passwordAdmin, parametres()), demande: "enLigne" });
      } else {
        await appels.creerLocale(parametres());
        setResultat({ statut: "horsLigne", demande: "horsLigne" });
      }
    } catch (e) {
      setErreur(e instanceof Error ? e.message : "Échec de la création.");
    } finally {
      setEnCours(false);
    }
  }

  const texteFiche = `Votre boutique « ${boutiqueNom.trim()} » est prête sur Gestion Stock.\nIdentifiant : ${identifiant.trim()}\nMot de passe${doitChanger ? " provisoire" : ""} : ${motDePasse}${doitChanger ? "\nVous choisirez votre propre mot de passe à la première connexion." : ""}\nAbonnement : ${libelleAbonnement}`;

  // --- Rendu ---

  const entete = (
    <div className="modale-entete">
      <h3>🚀 Créer une boutique{resultat ? ` — ${boutiqueNom.trim()}` : ""}</h3>
      <button type="button" className="lien bouton-retour" onClick={onFermer}>
        ← Retour
      </button>
    </div>
  );

  function interrupteur(
    icone: string,
    titre: string,
    actif: boolean,
    changer: (v: boolean) => void,
    detailOui: string,
    detailNon: string,
  ) {
    return (
      <div className={`carte-option-admin${actif ? " carte-option-admin--active" : ""}`}>
        <div className="entete-option-admin">
          <span className="icone-option-admin">{icone}</span>
          <div className="textes-option-admin">
            <strong>{titre}</strong>
            <span className="sous-info">{actif ? detailOui : detailNon}</span>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={actif}
            aria-label={titre}
            className={`interrupteur-option${actif ? " interrupteur-option--actif" : ""}`}
            onClick={() => changer(!actif)}
          >
            <span className="curseur-interrupteur-option" />
          </button>
        </div>
      </div>
    );
  }

  if (dejaInstallee) {
    return (
      <div className="fond-modale" onClick={onFermer}>
        <div className="modale-selection-produits modale-abonnement-admin" onClick={(e) => e.stopPropagation()}>
          {entete}
          <div className="modale-corps contenu-reseau">
            <div className="prochaine-etape prochaine-etape--attention">
              <div>
                <span className="libelle-prochaine-etape">{appels.cetAppareilMaj} a déjà une boutique</span>
                <p>
                  Il est utilisé par « {dejaInstallee.boutiqueNom} » : un appareil sert une seule boutique. Créez la nouvelle
                  boutique depuis un autre appareil (ou sur le site d'administration, ou dans l'admin Django).
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
        <div className="modale-selection-produits modale-abonnement-admin" onClick={(e) => e.stopPropagation()}>
          {entete}
          <div className="modale-corps contenu-reseau">
            <div className="carte-etat-serveur carte-etat-serveur--marche">
              <div className="entete-vue-ensemble">
                <span className="icone-vue-ensemble">🎉</span>
                <div>
                  <strong className="etat-serveur-titre">« {boutiqueNom.trim()} » est prête</strong>
                  <span className="sous-info ligne-detail-article">
                    {local
                      ? `Créée sur ${appels.cetAppareil} : utilisable tout de suite, même sans internet.`
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
                    {resultat.demande === "enLigne" ? `Le réseau n'était pas disponible : la boutique a été créée sur ${appels.cetAppareil}. ` : ""}
                    Pour l'enregistrer sur le serveur (avec ses options), utilisez « Activer en ligne » depuis Réglages →
                    Synchronisation une fois connecté : le mot de passe du patron sera redemandé.
                  </p>
                </div>
              </div>
            )}
            <FicheAcces
              titre={`Fiche de démarrage — ${boutiqueNom.trim()}`}
              details={[
                { libelle: "Patron", valeur: [prenom, nom].filter(Boolean).join(" ") || identifiant.trim() },
                { libelle: "Abonnement", valeur: libelleAbonnement },
                { libelle: "Données en ligne", valeur: synchroAutorisee ? "oui" : "non (100 % local)" },
                { libelle: "Réseau · Appli mobile", valeur: `${reseauAutorise ? "activé" : "non"} · ${appliMobileAutorisee ? "activée" : "non"}` },
              ]}
              identifiant={identifiant.trim()}
              motDePasse={motDePasse}
              provisoire={doitChanger}
              texteAPartager={texteFiche}
              telephone={patronTelephone}
              onWhatsapp={appels.whatsapp}
              onImprimer={appels.imprimer}
            />
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
                      <span className="note-aide">En 100 % local, les données n'existent que sur {appels.cetAppareil}.</span>
                    </button>
                  )}
                  {reseauAutorise && (
                    <button type="button" className="carte-choix-reseau" onClick={() => ouvrirModale("reseau")}>
                      <span className="icone-choix-reseau">📶</span>
                      <strong>Réseau de la boutique</strong>
                      <span className="note-aide">Relier les appareils de la boutique sans internet.</span>
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
      <div className="modale-selection-produits modale-abonnement-admin" onClick={(e) => e.stopPropagation()}>
        {entete}
        <div className="modale-corps">
          <div className="disposition-parametres">
            <nav className="barre-laterale-parametres barre-laterale-reseau">
              <div className="role-reseau role-reseau--ok">
                <span className="sous-info">Nouvelle boutique</span>
                <strong>{boutiqueNom.trim() || "sans nom"}</strong>
                {identifiant.trim() && <span className="sous-info">👤 {identifiant.trim()}</span>}
                <span className="sous-info">
                  {essai ? `🎁 essai ${essaiJours} j` : `💳 ${LIBELLES_FORMULE[formule]} ${duree} mois`}
                </span>
              </div>
              {ETAPES.map((e) => (
                <button
                  key={e.numero}
                  type="button"
                  className={`item-nav-parametres${e.numero === etape ? " actif" : ""}`}
                  onClick={() => aller(e.numero)}
                >
                  <span className={`numero-etape-nav${e.numero < etape ? " fait" : ""}`}>{e.numero < etape ? "✓" : e.numero}</span>
                  {e.icone} {e.libelle}
                </button>
              ))}
            </nav>
            <div className="contenu-parametres contenu-reseau">
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
                  <label className="carte-option-boutique">
                    <input type="checkbox" checked={doitChanger} onChange={(e) => setDoitChanger(e.target.checked)} />
                    <span>
                      <strong>Mot de passe provisoire</strong>
                      <span className="note-aide">Le patron choisira son propre mot de passe à sa première connexion.</span>
                    </span>
                  </label>
                </div>
              )}

              {etape === 3 && (
                <div className="champs-sauvegarde formulaire-assistant">
                  <h4 className="titre-rubrique-reseau">⚙️ Les options</h4>
                  <div className="etape-reseau">
                    <span className="numero-etape-reseau">1</span>
                    <div className="champ-etape-reseau">
                      <strong>Abonnement de départ</strong>
                      <div className="grille-choix-reseau">
                        <button type="button" className={`carte-choix-reseau${essai ? " choisi" : ""}`} onClick={() => setEssai(true)}>
                          <span className="icone-choix-reseau">🎁</span>
                          <strong>Essai gratuit</strong>
                          <span className="note-aide">7, 15 ou 30 jours, puis à renouveler dans « Gérer abonnement ».</span>
                        </button>
                        <button type="button" className={`carte-choix-reseau${!essai ? " choisi" : ""}`} onClick={() => setEssai(false)}>
                          <span className="icone-choix-reseau">💳</span>
                          <strong>Abonnement payé ou offert</strong>
                          <span className="note-aide">Choisir la formule et la durée dès maintenant.</span>
                        </button>
                      </div>
                    </div>
                  </div>
                  <div className="etape-reseau">
                    <span className="numero-etape-reseau">2</span>
                    <div className="champ-etape-reseau">
                      <strong>Formule</strong>
                      <div className="choix-formule-abonnement">
                        {(["essentiel", "pro"] as const).map((cle) => (
                          <button key={cle} type="button" className={`puce-nom-poste${formule === cle ? " choisi" : ""}`} onClick={() => setFormule(cle)}>
                            {LIBELLES_FORMULE[cle]}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                  <div className="etape-reseau">
                    <span className="numero-etape-reseau">3</span>
                    <div className="champ-etape-reseau">
                      <strong>Durée</strong>
                      <div className="grille-durees-abonnement">
                        {essai
                          ? DUREES_ESSAI.map((jours) => (
                              <button
                                key={jours}
                                type="button"
                                className={`carte-duree-abonnement${essaiJours === jours ? " choisi" : ""}`}
                                onClick={() => setEssaiJours(jours)}
                              >
                                <strong>{jours} jours</strong>
                                <span className="sous-info">jusqu'au {finEssaiDans(jours).toLocaleDateString("fr-FR")}</span>
                              </button>
                            ))
                          : DUREES.map((mois) => (
                              <button
                                key={mois}
                                type="button"
                                className={`carte-duree-abonnement${duree === mois ? " choisi" : ""}`}
                                onClick={() => setDuree(mois)}
                              >
                                <strong>{mois} mois</strong>
                                <span className="sous-info">jusqu'au {ajouterMois(new Date(), mois).toLocaleDateString("fr-FR")}</span>
                              </button>
                            ))}
                      </div>
                    </div>
                  </div>
                  {!essai && (
                    <div className="etape-reseau">
                      <span className="numero-etape-reseau">4</span>
                      <div className="champ-etape-reseau champs-sauvegarde">
                        <strong>Paiement</strong>
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
                      </div>
                    </div>
                  )}
                  <strong>Accès de la boutique</strong>
                  <div className="grille-options-admin">
                    {interrupteur("🌐", "Envoi des données en ligne", synchroAutorisee, setSynchroAutorisee, "Ventes et stock envoyés au serveur.", "100 % local : pensez à la sauvegarde.")}
                    {interrupteur("📶", "Réseau de la boutique", reseauAutorise, setReseauAutorise, "Appareils reliés sans internet.", "Chaque appareil travaille seul.")}
                    {interrupteur("📱", "Appli mobile", appliMobileAutorisee, setAppliMobileAutorisee, "Carte de téléchargement dans Réglages.", "Carte de téléchargement cachée.")}
                  </div>
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
                      <strong>{libelleAbonnement}</strong>
                      {!essai && (
                        <span className="sous-info">{nature === "paiement" ? `${Number(montant || 0).toLocaleString("fr-FR")} F reçus` : "offert"}</span>
                      )}
                      <span className="sous-info">
                        {synchroAutorisee ? "🌐 en ligne" : "🔒 100 % local"} · {reseauAutorise ? "📶 réseau" : "pas de réseau"} ·{" "}
                        {appliMobileAutorisee ? "📱 appli mobile" : "pas d'appli mobile"}
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
                      <strong>Sur {appels.cetAppareil} seulement</strong>
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
      </div>
    </div>
  );
}
