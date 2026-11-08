import { useEffect, useState } from "react";

import { api } from "../api/client";
import type { AbonnementBoutique, AbonnementDetailAdmin, ChampsAbonnement } from "../api/types";

/**
 * Espace Admin → « ⚙️ Options de la boutique » de cet ordinateur : envoi des
 * données en ligne (synchronisation) et carte « 📱 Appli mobile ». Même circuit
 * que Gérer abonnement (comptes/views.py::AppliquerAbonnementView) : serveur
 * d'abord, sinon appliqué sur le poste et envoyé au retour d'internet.
 * Copie conforme : client-web/src/components/ModaleOptionsBoutique.tsx (seul `appels` diffère).
 */

/** Accès aux données (seule partie qui diffère entre le bureau et le web). */
const appels = {
  boutique: (): Promise<AbonnementBoutique | null> => api.admin.boutiqueLocale(),
  serveur: async (username: string, password: string, boutiqueId: string): Promise<AbonnementDetailAdmin["boutique"] | null> => {
    const r = await api.admin.detailAbonnement(username, password, boutiqueId);
    return r.succes ? r.resultat.boutique : null;
  },
  enAttente: async (): Promise<boolean> => !!(await api.admin.abonnementEnAttente()),
  soumettre: async (
    username: string,
    password: string,
    boutiqueId: string,
    boutiqueNom: string,
    champs: ChampsAbonnement,
  ): Promise<"synchronise" | "horsLigne"> => {
    const r = await api.admin.soumettreAbonnement(username, password, boutiqueId, boutiqueNom, champs);
    if (!r.succes) throw new Error(r.message);
    return r.resultat.statut;
  },
  infos: async () => {
    const [synchro, sauvegarde, urlApk] = await Promise.all([
      api.sync.etat().catch(() => null),
      api.sauvegarde.etat().catch(() => null),
      api.systeme.urlAppliAndroid().catch(() => ""),
    ]);
    return { derniereSynchro: synchro?.derniereSynchro ?? null, sauvegarde, urlApk };
  },
};


type Rubrique = "apercu" | "synchro" | "appli";
type CleOption = "synchroAutorisee" | "appliMobileAutorisee";

interface Infos {
  derniereSynchro: string | null;
  sauvegarde: { configuree: boolean; derniereSauvegarde: string | null } | null;
  urlApk: string;
}

function dateHeure(iso: string | null | undefined): string {
  return iso ? new Date(iso).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" }) : "jamais";
}

const OPTIONS: Record<
  CleOption,
  {
    icone: string;
    titre: string;
    oui: string;
    non: string;
    activer: (nom: string) => string;
    desactiver: (nom: string) => string;
    succesOui: string;
    succesNon: string;
  }
> = {
  synchroAutorisee: {
    icone: "🌐",
    titre: "Envoi des données en ligne",
    oui: "Autorisé",
    non: "100 % local",
    activer: (nom) => `Autoriser l'envoi en ligne pour « ${nom} » ? Ses ventes, son stock et ses fiches seront envoyés au serveur.`,
    desactiver: (nom) => `Passer « ${nom} » en 100 % local ? Les données restent sur ses ordinateurs ; pensez à la sauvegarde.`,
    succesOui: "Envoi en ligne autorisé",
    succesNon: "Boutique passée en 100 % local",
  },
  appliMobileAutorisee: {
    icone: "📱",
    titre: "Appli mobile",
    oui: "Activée",
    non: "Non activée",
    activer: (nom) => `Afficher la carte « 📱 Appli mobile » (QR code de téléchargement Android) dans les Réglages de « ${nom} » ?`,
    desactiver: (nom) => `Cacher la carte « 📱 Appli mobile » des Réglages de « ${nom} » ?`,
    succesOui: "Appli mobile activée",
    succesNon: "Appli mobile désactivée",
  },
};

export default function ModaleOptionsBoutique({
  onFermer,
  username,
  password,
}: {
  onFermer: () => void;
  username: string;
  password: string;
}) {
  const [boutique, setBoutique] = useState<AbonnementBoutique | null | undefined>(undefined);
  const [rubrique, setRubrique] = useState<Rubrique>("apercu");
  const [horsLigne, setHorsLigne] = useState(false);
  const [enAttente, setEnAttente] = useState(false);
  const [infos, setInfos] = useState<Infos | null>(null);
  const [aConfirmer, setAConfirmer] = useState<CleOption | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [enCours, setEnCours] = useState(false);
  const [lienCopie, setLienCopie] = useState(false);

  async function charger() {
    const b = await appels.boutique();
    setBoutique(b);
    appels.infos().then(setInfos).catch(() => {});
    if (!b) return;
    const serveur = await appels.serveur(username, password, b.boutiqueId).catch(() => null);
    const attente = await appels.enAttente();
    setHorsLigne(!serveur);
    setEnAttente(attente);
    // Options réglées ailleurs (site admin, autre poste) : ce poste s'aligne sur le serveur,
    // sauf si une modification faite ici hors ligne attend d'y être envoyée.
    if (!serveur || attente) return;
    const ecart: ChampsAbonnement = {};
    if (serveur.synchro_autorisee !== b.synchroAutorisee) ecart.synchroAutorisee = serveur.synchro_autorisee;
    if (serveur.appli_mobile_autorisee !== undefined && serveur.appli_mobile_autorisee !== b.appliMobileAutorisee) {
      ecart.appliMobileAutorisee = serveur.appli_mobile_autorisee;
    }
    if (Object.keys(ecart).length === 0) return;
    try {
      await appels.soumettre(username, password, b.boutiqueId, b.boutiqueNom, ecart);
      setBoutique(await appels.boutique());
    } catch {
      // l'affichage garde l'état du poste
    }
  }
  useEffect(() => {
    charger();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function aller(r: Rubrique) {
    setErreur(null);
    setMessage(null);
    setAConfirmer(null);
    setRubrique(r);
  }

  async function basculer(cle: CleOption) {
    if (!boutique) return;
    const valeur = !boutique[cle];
    setErreur(null);
    setMessage(null);
    setEnCours(true);
    try {
      const statut = await appels.soumettre(username, password, boutique.boutiqueId, boutique.boutiqueNom, { [cle]: valeur });
      const texte = valeur ? OPTIONS[cle].succesOui : OPTIONS[cle].succesNon;
      setMessage(
        statut === "synchronise"
          ? `✅ ${texte} (sur ce poste et sur le serveur).`
          : `✅ ${texte} sur ce poste. Pas de connexion : le serveur sera prévenu au retour d'internet (Réglages → Synchronisation).`,
      );
      setEnAttente(statut !== "synchronise");
      setBoutique(await appels.boutique());
      setAConfirmer(null);
    } catch (e) {
      setErreur(e instanceof Error ? e.message : "Échec de la modification.");
    } finally {
      setEnCours(false);
    }
  }

  async function copierLien() {
    if (!infos?.urlApk) return;
    try {
      await navigator.clipboard.writeText(infos.urlApk);
      setLienCopie(true);
      setTimeout(() => setLienCopie(false), 2000);
    } catch {
      setErreur("Copie impossible : sélectionnez le lien à la main.");
    }
  }

  /** Carte d'une option : grand interrupteur, badge d'état, confirmation avant d'enregistrer. */
  function carteOption(cle: CleOption, detail: string, onDetail?: () => void) {
    if (!boutique) return null;
    const o = OPTIONS[cle];
    const actif = boutique[cle];
    return (
      <div className={`carte-option-admin${actif ? " carte-option-admin--active" : ""}`}>
        <div className="entete-option-admin">
          <span className="icone-option-admin">{o.icone}</span>
          <div className="textes-option-admin">
            <strong>{o.titre}</strong>
            <span className={`badge-lp ${actif ? "badge-lp--actif" : ""}`}>{actif ? `✅ ${o.oui}` : `🔒 ${o.non}`}</span>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={actif}
            aria-label={o.titre}
            className={`interrupteur-option${actif ? " interrupteur-option--actif" : ""}`}
            disabled={enCours}
            onClick={() => setAConfirmer(aConfirmer === cle ? null : cle)}
          >
            <span className="curseur-interrupteur-option" />
          </button>
        </div>
        <p className="note-aide">{detail}</p>
        {aConfirmer === cle && (
          <div className="confirmation-option-admin">
            <p>{actif ? o.desactiver(boutique.boutiqueNom) : o.activer(boutique.boutiqueNom)}</p>
            <div className="actions-formulaire">
              <button type="button" className="bouton-primaire" disabled={enCours} onClick={() => basculer(cle)}>
                {enCours ? "Enregistrement…" : "Confirmer"}
              </button>
              <button type="button" className="lien" onClick={() => setAConfirmer(null)}>
                Annuler
              </button>
            </div>
          </div>
        )}
        {onDetail && (
          <button type="button" className="lien lien-option-admin" onClick={onDetail}>
            Détails →
          </button>
        )}
      </div>
    );
  }

  const accord = horsLigne
    ? { ton: "neutre", texte: "🌐 Sans connexion au serveur : un changement s'applique sur ce poste et part au serveur au retour d'internet." }
    : enAttente
      ? { ton: "attention", texte: "⏳ Une modification faite sans internet attend d'être envoyée au serveur (Réglages → Synchronisation)." }
      : { ton: "ok", texte: "✅ Le serveur et ce poste sont d'accord." };

  function contenu() {
    if (!boutique) return null;
    switch (rubrique) {
      case "synchro":
        return (
          <>
            <h4 className="titre-rubrique-reseau">🌐 Envoi des données en ligne</h4>
            {carteOption(
              "synchroAutorisee",
              boutique.synchroAutorisee
                ? "Les ventes, le stock et les fiches de la boutique sont envoyés au serveur : sauvegarde en ligne, appli web et mobile à jour."
                : "Tout reste sur les ordinateurs de la boutique ; seuls le nom et l'abonnement sont en ligne.",
            )}
            <dl className="infos-option-admin">
              <dt>Dernière synchronisation de ce poste</dt>
              <dd>{boutique.synchroAutorisee ? dateHeure(infos?.derniereSynchro) : "— (100 % local)"}</dd>
              <dt>Dernière sauvegarde</dt>
              <dd>
                {infos?.sauvegarde?.configuree ? dateHeure(infos.sauvegarde.derniereSauvegarde) : "non paramétrée"}
              </dd>
            </dl>
            {!boutique.synchroAutorisee && !infos?.sauvegarde?.configuree && (
              <p className="message-erreur">
                ⚠️ 100 % local et sans sauvegarde : si l'ordinateur tombe en panne, les données sont perdues. Paramétrez la
                sauvegarde (carte 💾 Sauvegarde).
              </p>
            )}
          </>
        );
      case "appli":
        return (
          <>
            <h4 className="titre-rubrique-reseau">📱 Appli mobile</h4>
            {carteOption(
              "appliMobileAutorisee",
              boutique.appliMobileAutorisee
                ? "La carte « 📱 Appli mobile » est visible dans les Réglages : la boutique peut télécharger l'appli Android (QR code, WhatsApp, affiche)."
                : "La carte « 📱 Appli mobile » reste grisée dans les Réglages de la boutique (« Non activé par votre administrateur »).",
            )}
            <dl className="infos-option-admin">
              <dt>Lien de téléchargement Android</dt>
              <dd className="lien-apk-option">
                <code>{infos?.urlApk || "…"}</code>
                <button type="button" className="lien" disabled={!infos?.urlApk} onClick={copierLien}>
                  {lienCopie ? "✓ Copié" : "📋 Copier"}
                </button>
              </dd>
            </dl>
            <p className="note-aide">
              Le lien sert le fichier déposé sur le serveur (dossier telechargements/). Remplacez ce fichier à chaque nouvelle
              version de l'appli.
            </p>
          </>
        );
      default:
        return (
          <>
            <h4 className="titre-rubrique-reseau">🧭 Vue d'ensemble</h4>
            <div className={`prochaine-etape prochaine-etape--${accord.ton}`}>
              <div>
                <span className="libelle-prochaine-etape">Serveur et poste</span>
                <p>{accord.texte}</p>
              </div>
              {horsLigne && (
                <button type="button" disabled={enCours} onClick={() => charger()}>
                  ⟳ Réessayer
                </button>
              )}
            </div>
            <div className="grille-options-admin">
              {carteOption(
                "synchroAutorisee",
                boutique.synchroAutorisee ? "Ventes et stock envoyés au serveur." : "Tout reste sur les ordinateurs de la boutique.",
                () => aller("synchro"),
              )}
              {carteOption(
                "appliMobileAutorisee",
                boutique.appliMobileAutorisee ? "Carte de téléchargement visible dans Réglages." : "Carte de téléchargement cachée.",
                () => aller("appli"),
              )}
            </div>
            <p className="note-aide">Le réseau de la boutique se règle dans sa propre carte : 📶 Réseau de la boutique.</p>
          </>
        );
    }
  }

  const rubriques: { cle: Rubrique; label: string }[] = [
    { cle: "apercu", label: "🧭 Vue d'ensemble" },
    { cle: "synchro", label: "🌐 Envoi en ligne" },
    { cle: "appli", label: "📱 Appli mobile" },
  ];

  return (
    <div className="fond-modale" onClick={onFermer}>
      <div className="modale-selection-produits modale-abonnement-admin" onClick={(e) => e.stopPropagation()}>
        <div className="modale-entete">
          <h3>⚙️ Options de la boutique{boutique ? ` — ${boutique.boutiqueNom}` : ""}</h3>
          <button type="button" className="lien bouton-retour" onClick={onFermer}>
            ← Retour
          </button>
        </div>
        <div className="modale-corps">
          {boutique === undefined || boutique === null ? (
            <p className="sous-titre">{boutique === undefined ? "Chargement…" : "Aucune boutique n'est encore installée sur ce poste."}</p>
          ) : (
            <div className="disposition-parametres">
              <nav className="barre-laterale-parametres barre-laterale-reseau">
                <div className={`role-reseau role-reseau--${enAttente ? "alerte" : "ok"}`}>
                  <span className="sous-info">Boutique</span>
                  <strong>{boutique.synchroAutorisee ? "🌐 en ligne" : "🔒 100 % local"}</strong>
                  <span className="sous-info">📱 appli {boutique.appliMobileAutorisee ? "activée" : "non activée"}</span>
                </div>
                {rubriques.map((r) => (
                  <button
                    key={r.cle}
                    type="button"
                    className={`item-nav-parametres${rubrique === r.cle ? " actif" : ""}`}
                    onClick={() => aller(r.cle)}
                  >
                    {r.label}
                  </button>
                ))}
              </nav>
              <div className="contenu-parametres contenu-reseau">
                {erreur && <div className="message-erreur">{erreur}</div>}
                {message && <div className="message-succes">{message}</div>}
                {contenu()}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
