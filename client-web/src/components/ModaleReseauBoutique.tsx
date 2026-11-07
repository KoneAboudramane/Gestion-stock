import { useEffect, useState, type ReactNode } from "react";

import { api } from "../api/reseauBoutique";
import type { EtatDemandeReseau, EtatReseau, EtatSauvegarde, PostePrincipalTrouve, Session } from "../api/reseauBoutique";
import { useSynchro } from "../contexts/SynchroContext";
import { ModaleEtatSauvegarde } from "./EtatSauvegarde";
import ModaleConfirmation from "./ModaleConfirmation";
import { estAppliMobile } from "../lib/appliAndroid";
import { batterieSansRestriction, ouvrirReglagesBatterie } from "../lib/impression";

// Copie de client-electron/src/components/ModaleReseauBoutique.tsx (même fenêtre
// sur le bureau, le web et l'appli ; docs/plan_mobile_complet.md, lot 2) : seuls
// les appels (api/reseauBoutique.ts) et le mot « appareil » diffèrent.
//
// Réglages → Réseau de la boutique (docs/plan_reseau_local.md, lot 2) : faire
// de cet appareil le poste principal, afficher son adresse et le code à
// 6 chiffres pour brancher les caisses, voir et débrancher les appareils.
// Côté caisse (lot 3) : « Se brancher au poste principal » et état de la liaison.
// Barre latérale à gauche : une rubrique par sujet, selon le rôle de l'appareil.

function depuis(iso: string | null): string {
  if (!iso) return "jamais";
  const secondes = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (secondes < 60) return `il y a ${Math.max(secondes, 0)} s`;
  if (secondes < 3600) return `il y a ${Math.round(secondes / 60)} min`;
  return new Date(iso).toLocaleString("fr-FR");
}

type Rubrique = "apercu" | "serveur" | "brancher" | "appareils" | "seBrancher" | "devenirPrincipal" | "aide";

/** « 2 h 15 min », « 12 min », « quelques secondes ». */
function duree(depuisIso: string): string {
  const minutes = Math.floor((Date.now() - new Date(depuisIso).getTime()) / 60000);
  if (minutes < 1) return "quelques secondes";
  if (minutes < 60) return `${minutes} min`;
  const heures = Math.floor(minutes / 60);
  if (heures < 24) return `${heures} h ${minutes % 60} min`;
  return `${Math.floor(heures / 24)} j ${heures % 24} h`;
}

function minutesRestantes(expire: string): string {
  const minutes = Math.max(0, Math.ceil((new Date(expire).getTime() - Date.now()) / 60000));
  return `${minutes} min`;
}

const CLE_WHATSAPP_ADMIN = "gestion-stock:whatsapp-administrateur";

function whatsappMemorise(): string {
  try {
    return localStorage.getItem(CLE_WHATSAPP_ADMIN) ?? "";
  } catch {
    return "";
  }
}

/**
 * Réseau pas encore activé par l'administrateur : on l'explique et le
 * responsable demande l'activation (admin Django) et/ou prévient par WhatsApp.
 */
function BlocActivationReseau({ session, peutGerer, onVerifie }: { session: Session; peutGerer: boolean; onVerifie: () => void }) {
  const [demande, setDemande] = useState<EtatDemandeReseau | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [enCours, setEnCours] = useState(false);
  const whatsapp = demande?.whatsapp || whatsappMemorise();

  function retenir(etat: EtatDemandeReseau) {
    setDemande(etat);
    try {
      if (etat.whatsapp) localStorage.setItem(CLE_WHATSAPP_ADMIN, etat.whatsapp);
    } catch {
      // stockage indisponible : le numéro sera redemandé au serveur
    }
  }

  useEffect(() => {
    if (!peutGerer) return;
    api.comptes.etatDemandeReseau(session).then((r) => r.succes && retenir(r.resultat));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function demander() {
    setEnCours(true);
    setErreur(null);
    setMessage(null);
    const resultat = await api.comptes.demanderActivationReseau(session, "");
    setEnCours(false);
    if (!resultat.succes) {
      return setErreur(
        `La demande n'a pas pu partir (${resultat.message}). Sans internet, prévenez votre administrateur${whatsapp ? " par WhatsApp" : ""} : il peut aussi activer le réseau sur place, dans l'Espace Admin.`,
      );
    }
    retenir(resultat.resultat);
    setMessage("✅ Demande envoyée à votre administrateur.");
  }

  async function verifier() {
    setEnCours(true);
    setErreur(null);
    setMessage(null);
    try {
      await api.auth.rafraichirPermissions(session);
    } catch {
      // hors ligne : on relit simplement l'état du poste
    }
    setEnCours(false);
    onVerifie();
    const r = await api.comptes.etatDemandeReseau(session);
    if (r.succes) {
      retenir(r.resultat);
      setMessage(r.resultat.reseau_autorise ? "✅ Le réseau est activé." : "Pas encore activé par l'administrateur.");
    } else {
      setMessage("Pas d'internet : impossible de vérifier pour l'instant.");
    }
  }

  const texteWhatsapp = `Bonjour, je souhaite activer le réseau de la boutique « ${session.boutiqueNom} » (appareils reliés sans internet). Identifiant : ${session.boutiqueId}`;

  return (
    <div className="bloc-activation-reseau">
      <div>
        <strong>🔒 Réseau de la boutique non activé</strong>
        <p className="note-aide">
          Relier les appareils de la boutique est une option activée par votre administrateur, à votre demande. Une fois
          activée, vous pourrez faire de cet appareil le poste principal ou le brancher sur un autre.
        </p>
      </div>
      {demande?.demande_en_attente && (
        <div className="message-succes">
          📨 Demande envoyée le {new Date(demande.demande_en_attente).toLocaleDateString("fr-FR")} : en attente de votre
          administrateur.
        </div>
      )}
      {message && <div className="message-succes">{message}</div>}
      {erreur && <div className="message-erreur">{erreur}</div>}
      {peutGerer ? (
        <div className="actions-code-reseau actions-activation-reseau">
          {!demande?.demande_en_attente && (
            <button type="button" className="bouton-primaire" disabled={enCours} onClick={demander}>
              📨 Demander l'activation
            </button>
          )}
          {whatsapp && (
            <button
              type="button"
              onClick={() =>
                api.systeme.ouvrirExterne(`https://wa.me/${whatsapp.replace(/\D/g, "")}?text=${encodeURIComponent(texteWhatsapp)}`)
              }
            >
              💬 Prévenir par WhatsApp
            </button>
          )}
          <button type="button" disabled={enCours} onClick={verifier}>
            ⟳ Vérifier l'activation
          </button>
        </div>
      ) : (
        <p className="note-aide">Demandez au responsable de la boutique de faire la demande.</p>
      )}
    </div>
  );
}

export default function ModaleReseauBoutique({ session, onFermer }: { session: Session; onFermer: () => void }) {
  const peutGerer = !!session.permissions.gerer_utilisateurs_reglages;
  const [etat, setEtat] = useState<EtatReseau | null>(null);
  const [nomPoste, setNomPoste] = useState("");
  const [erreur, setErreur] = useState<string | null>(null);
  const [enCours, setEnCours] = useState(false);
  const [confirmerArret, setConfirmerArret] = useState(false);
  const [aDebrancher, setADebrancher] = useState<{ id: string; nom: string } | null>(null);
  // Côté caisse : trouver le poste principal et s'y brancher.
  const [recherche, setRecherche] = useState(false);
  const [rechercheFaite, setRechercheFaite] = useState(false);
  const [trouves, setTrouves] = useState<PostePrincipalTrouve[]>([]);
  const [adresse, setAdresse] = useState("");
  const [code, setCode] = useState("");
  const [confirmerDebranchement, setConfirmerDebranchement] = useState(false);
  const [rubrique, setRubrique] = useState<Rubrique>("apercu");
  const [confirmerPause, setConfirmerPause] = useState(false);
  const [saisieManuelle, setSaisieManuelle] = useState(false);
  const [sauvegarde, setSauvegarde] = useState<EtatSauvegarde | null>(null);
  const [enAttenteEnLigne, setEnAttenteEnLigne] = useState(0);
  const [sauvegardeOuverte, setSauvegardeOuverte] = useState(false);
  const synchro = useSynchro();
  // Appli mobile : l'économie de batterie de certaines marques coupe le serveur malgré la notification.
  const [batterieLibre, setBatterieLibre] = useState<boolean | null>(null);
  useEffect(() => {
    const verifier = () => void batterieSansRestriction().then(setBatterieLibre);
    verifier();
    // Retour des réglages d'Android : on relit.
    window.addEventListener("focus", verifier);
    document.addEventListener("visibilitychange", verifier);
    return () => {
      window.removeEventListener("focus", verifier);
      document.removeEventListener("visibilitychange", verifier);
    };
  }, []);

  // Vue d'ensemble : sauvegarde du poste et envois en ligne en attente (poste seul).
  useEffect(() => {
    api.sauvegarde.etat().then(setSauvegarde).catch(() => {});
    api.sync
      .enAttente(session.boutiqueId)
      .then((liste) => setEnAttenteEnLigne(liste.reduce((total, e) => total + e.nombre, 0)))
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function rechercherPostes() {
    setRecherche(true);
    setErreur(null);
    const liste = (await api.reseau.rechercher()).filter((t) => t.boutiqueId === session.boutiqueId);
    setRecherche(false);
    setRechercheFaite(true);
    setTrouves(liste);
    // Le poste déjà choisi reste choisi s'il est encore là ; sinon le premier trouvé.
    setAdresse((actuelle) => (liste.some((t) => t.adresse === actuelle) ? actuelle : (liste[0]?.adresse ?? "")));
  }

  async function seBrancher() {
    setEnCours(true);
    setErreur(null);
    const resultat = await api.reseau.seBrancher({ adresse, code, boutiqueId: session.boutiqueId });
    setEnCours(false);
    if (!resultat.succes) return setErreur(resultat.message);
    setCode("");
    setEtat(resultat.resultat);
    setRubrique("apercu");
  }

  async function rafraichir() {
    setEtat(await api.reseau.etat());
  }
  useEffect(() => {
    rafraichir();
    // Toutes les 3 s : appareils reliés, temps restant du code.
    const identifiant = setInterval(rafraichir, 3000);
    return () => clearInterval(identifiant);
  }, []);

  async function devenirPrincipal() {
    setEnCours(true);
    setErreur(null);
    const resultat = await api.reseau.devenirPrincipal({
      boutiqueId: session.boutiqueId,
      boutiqueNom: session.boutiqueNom,
      nomPoste,
    });
    setEnCours(false);
    if (!resultat.succes) return setErreur(resultat.message);
    setEtat(resultat.resultat);
    setRubrique("brancher");
  }

  async function basculerPause() {
    setEnCours(true);
    setErreur(null);
    const resultat = etat?.enPause ? await api.reseau.reprendre() : await api.reseau.mettreEnPause();
    setEnCours(false);
    setConfirmerPause(false);
    if (!resultat.succes) return setErreur(resultat.message);
    setEtat(resultat.resultat);
  }

  async function redemarrer() {
    setEnCours(true);
    setErreur(null);
    const resultat = await api.reseau.redemarrer();
    setEnCours(false);
    if (!resultat.succes) return setErreur(resultat.message);
    setEtat(resultat.resultat);
  }

  async function quitter() {
    setEnCours(true);
    const resultat = await api.reseau.quitterPrincipal();
    setEnCours(false);
    setConfirmerArret(false);
    if (!resultat.succes) return setErreur(resultat.message);
    setEtat(resultat.resultat);
    setRubrique("apercu");
  }

  const principal = etat?.role === "principal";
  const caisse = etat?.role === "caisse" && etat.caisse ? etat.caisse : null;
  const caissesReliees = etat?.appareils.filter((a) => a.relie).length ?? 0;
  const colonnesAppareils = peutGerer ? 6 : 5;

  // Barre latérale : les rubriques dépendent du rôle de cet appareil.
  const rubriques: { cle: Rubrique; label: string; compteur?: string }[] = principal
    ? [
        { cle: "apercu", label: "🖥️ Vue d'ensemble" },
        { cle: "serveur", label: "⚙️ Serveur", compteur: etat?.enMarche ? "🟢" : etat?.enPause ? "⏹" : "🔴" },
        { cle: "brancher", label: "🔑 Brancher une caisse" },
        { cle: "appareils", label: "📋 Appareils", compteur: `${caissesReliees}/${etat?.appareils.length ?? 0}` },
        { cle: "aide", label: "❓ Aide" },
      ]
    : caisse
      ? [
          { cle: "apercu", label: "📶 Vue d'ensemble" },
          { cle: "serveur", label: "⚙️ Serveur", compteur: caisse.relie ? "🟢" : "🟠" },
          { cle: "aide", label: "❓ Aide" },
        ]
      : [
          { cle: "apercu", label: "💻 Vue d'ensemble" },
          { cle: "serveur", label: "⚙️ Serveur", compteur: "⚪" },
          { cle: "seBrancher", label: "📶 Se brancher" },
          { cle: "devenirPrincipal", label: "🖥️ Devenir poste principal" },
          { cle: "aide", label: "❓ Aide" },
        ];
  const rubriqueActive = rubriques.some((r) => r.cle === rubrique) ? rubrique : "apercu";
  const roleLibelle = principal ? (etat?.enPause ? "Poste principal (serveur arrêté)" : "Poste principal") : caisse ? "Caisse branchée" : "Poste seul";
  const roleEtat = principal
    ? etat?.enMarche
      ? "ok"
      : "alerte"
    : caisse
      ? caisse.relie
        ? "ok"
        : "alerte"
      : "neutre";

  // « Se brancher » : la recherche se lance toute seule à l'ouverture de la rubrique.
  useEffect(() => {
    if (rubriqueActive === "seBrancher" && peutGerer && !rechercheFaite && !recherche && !saisieManuelle) rechercherPostes();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rubriqueActive]);

  const reserve = <p className="note-aide">Réservé à ceux qui gèrent les utilisateurs et les réglages.</p>;

  type Ton = "ok" | "attention" | "alerte" | "neutre";
  const CLASSE_TON: Record<Ton, string> = { ok: "marche", attention: "arrete", alerte: "panne", neutre: "neutre" };

  /** Vue d'ensemble des trois rôles : état, prochaine étape, chemin des données, cartes cliquables. */
  function vueEnsemble() {
    if (!etat) return null;
    const enLigne = session.synchroAutorisee;
    const internet = principal
      ? etat.internet
      : caisse
        ? caisse.internetPrincipal
        : { derniereSynchro: synchro.etat?.derniereSynchro ?? null, enAttente: enAttenteEnLigne };
    const nonReliees = etat.appareils.filter((a) => !a.relie).length;

    // 1. Carte d'état
    let icone: string;
    let titre: string;
    let sousTitre: string;
    let ton: Ton;
    if (principal) {
      icone = "🖥️";
      titre = `Poste principal « ${etat.nomPoste} »`;
      if (etat.enMarche) {
        ton = nonReliees > 0 ? "attention" : "ok";
        sousTitre = `Serveur en marche${etat.demarreLe ? ` depuis ${duree(etat.demarreLe)}` : ""} · ${caissesReliees} caisse${caissesReliees > 1 ? "s" : ""} reliée${caissesReliees > 1 ? "s" : ""} sur ${etat.appareils.length}`;
      } else {
        ton = etat.enPause ? "attention" : "alerte";
        sousTitre = etat.enPause ? "Serveur arrêté à la main : les caisses vendent seules" : "Serveur arrêté : les caisses vendent seules";
      }
    } else if (caisse) {
      icone = "📶";
      titre = "Caisse branchée";
      ton = caisse.relie ? "ok" : "alerte";
      sousTitre = caisse.relie
        ? `Reliée au poste principal « ${caisse.nomPostePrincipal} » · échangé ${depuis(caisse.derniereSynchro)}`
        : `Poste principal « ${caisse.nomPostePrincipal} » injoignable · les ventes continuent ici`;
    } else {
      icone = "💻";
      titre = "Poste seul";
      ton = "neutre";
      sousTitre = "Cet appareil ne partage ses ventes et son stock avec aucun autre";
    }

    // 2. Prochaine étape
    let etape: { ton: Ton; texte: ReactNode; action?: { libelle: string; onClick: () => void } } | null = null;
    let blocEtape: ReactNode = null;
    if (!principal && !caisse) {
      if (!etat.reseauAutorise) {
        etape = { ton: "attention", texte: "Pour relier les appareils, demandez d'abord l'activation du réseau à votre administrateur." };
        blocEtape = <BlocActivationReseau session={session} peutGerer={peutGerer} onVerifie={rafraichir} />;
      } else {
        etape = { ton: "neutre", texte: "Choisissez le rôle de cet appareil dans le réseau de la boutique." };
        blocEtape = (
          <div className="grille-choix-reseau">
            <button type="button" className="carte-choix-reseau" onClick={() => setRubrique("seBrancher")}>
              <span className="icone-choix-reseau">📶</span>
              <strong>Cet appareil est une caisse</strong>
              <span className="note-aide">Se brancher à un poste principal déjà en place, avec son code à 6 chiffres.</span>
            </button>
            <button type="button" className="carte-choix-reseau" onClick={() => setRubrique("devenirPrincipal")}>
              <span className="icone-choix-reseau">🖥️</span>
              <strong>Cet appareil sera le poste principal</strong>
              <span className="note-aide">Celui qui reste allumé toute la journée ; les caisses se branchent sur lui.</span>
            </button>
          </div>
        );
      }
    } else if (principal) {
      if (!etat.reseauAutorise) {
        etape = { ton: "alerte", texte: "Le réseau a été désactivé par votre administrateur : le serveur est arrêté, les caisses vendent seules." };
      } else if (etat.enPause) {
        etape = {
          ton: "attention",
          texte: "Serveur arrêté : démarrez-le pour que les caisses se reconnectent (sans nouveau code).",
          action: peutGerer ? { libelle: "▶ Démarrer le serveur", onClick: basculerPause } : undefined,
        };
      } else if (!etat.enMarche) {
        etape = {
          ton: "alerte",
          texte: etat.erreur ?? "Le serveur ne répond pas.",
          action: peutGerer ? { libelle: "⟳ Redémarrer le serveur", onClick: redemarrer } : undefined,
        };
      } else if (etat.adresses.length === 0) {
        etape = { ton: "alerte", texte: "Cet appareil n'est relié à aucun réseau : connectez-le au Wi-Fi, au téléphone ou au câble." };
      } else if (estAppliMobile && batterieLibre === false) {
        etape = {
          ton: "attention",
          texte:
            "Pour que les caisses restent reliées écran éteint, retirez Gestion Stock de l'économie de batterie (« Sans restriction » ou « Ne pas optimiser »).",
          action: { libelle: "🔋 Régler la batterie", onClick: ouvrirReglagesBatterie },
        };
      } else if (etat.appareils.length === 0) {
        etape = {
          ton: "neutre",
          texte: "Branchez votre première caisse : affichez le code et tapez-le sur la caisse.",
          action: { libelle: "🔑 Brancher une caisse", onClick: () => setRubrique("brancher") },
        };
      } else if (nonReliees > 0) {
        etape = {
          ton: "attention",
          texte: `${nonReliees} caisse${nonReliees > 1 ? "s" : ""} pas vue${nonReliees > 1 ? "s" : ""} récemment : vérifiez qu'elle${nonReliees > 1 ? "s sont allumées" : " est allumée"} et sur le même Wi-Fi.`,
          action: { libelle: "📋 Voir les appareils", onClick: () => setRubrique("appareils") },
        };
      } else if (sauvegarde && !sauvegarde.configuree && !enLigne) {
        etape = { ton: "attention", texte: "Aucune sauvegarde : en 100 % local, demandez à votre administrateur de la paramétrer." };
      } else {
        etape = { ton: "ok", texte: `Tout fonctionne : ${caissesReliees === 1 ? "la caisse est reliée" : `les ${caissesReliees} caisses sont reliées`}.` };
      }
    } else if (caisse) {
      if (!caisse.relie) {
        etape = {
          ton: "alerte",
          texte: `Vérifiez que le poste principal « ${caisse.nomPostePrincipal} » est allumé, l'application ouverte, et que cet appareil est sur le même Wi-Fi. Si son adresse a changé, la caisse le retrouve toute seule.`,
          action: { libelle: "⟳ Réessayer maintenant", onClick: async () => setEtat(await api.reseau.synchroniser()) },
        };
      } else if (caisse.enAttente > 0) {
        etape = {
          ton: "attention",
          texte: `${caisse.enAttente} élément(s) en cours d'envoi au poste principal.`,
          action: { libelle: "⟳ Échanger maintenant", onClick: async () => setEtat(await api.reseau.synchroniser()) },
        };
      } else {
        etape = { ton: "ok", texte: "Tout fonctionne : cette caisse voit les mêmes ventes et le même stock que le poste principal." };
      }
    }

    // 3. Chemin des données
    const noeudEnLigne = {
      icone: enLigne ? "🌐" : "🔒",
      libelle: enLigne ? "En ligne" : "Rien en ligne",
      sous: enLigne ? ((internet?.enAttente ?? 0) > 0 ? `${internet?.enAttente} en attente` : "tout est envoyé") : "100 % local",
    };
    const chemin: { icone: string; libelle: string; sous: string; ici?: boolean; lienOk?: boolean }[] = principal
      ? [
          { icone: "📶", libelle: `Caisses (${etat.appareils.length})`, sous: `${caissesReliees} reliée${caissesReliees > 1 ? "s" : ""}`, lienOk: etat.enMarche },
          { icone: "🖥️", libelle: "Ce poste", sous: `« ${etat.nomPoste} »`, ici: true, lienOk: true },
          noeudEnLigne,
        ]
      : caisse
        ? [
            { icone: "💻", libelle: "Cette caisse", sous: etat.nomOrdinateur, ici: true, lienOk: caisse.relie },
            { icone: "🖥️", libelle: "Poste principal", sous: `« ${caisse.nomPostePrincipal} »`, lienOk: true },
            noeudEnLigne,
          ]
        : [{ icone: "💻", libelle: "Cet appareil", sous: etat.nomOrdinateur, ici: true, lienOk: true }, noeudEnLigne];

    // 4. Cartes
    const cartes: { cle: string; titre: string; lignes: ReactNode[]; onClick?: () => void }[] = [
      {
        cle: "autorisations",
        titre: "🔐 Autorisations",
        lignes: [
          <span key="l" className={enLigne ? "autorisation-oui" : "autorisation-non"}>
            {enLigne ? "🌐 Envoi en ligne autorisé" : "🔒 Envoi en ligne : non (100 % local)"}
          </span>,
          <span key="r" className={etat.reseauAutorise ? "autorisation-oui" : "autorisation-non"}>
            {etat.reseauAutorise ? "📶 Réseau activé" : "📶 Réseau non activé"}
          </span>,
          <span key="a" className="sous-info">réglés par votre administrateur</span>,
        ],
      },
      {
        cle: "serveur",
        titre: "⚙️ Serveur",
        onClick: () => setRubrique("serveur"),
        lignes: principal
          ? [
              <strong key="e">{etat.enMarche ? "🟢 En marche" : etat.enPause ? "⏹ Arrêté" : "🔴 En panne"}</strong>,
              <span key="a">{etat.adresses[0] ? `${etat.adresses[0]}:${etat.port ?? "—"}` : "aucun réseau"}</span>,
              <span key="d" className="sous-info">{etat.demarreLe ? `depuis ${duree(etat.demarreLe)}` : "—"}</span>,
            ]
          : caisse
            ? [
                <strong key="e">{caisse.relie ? "🟢 Relié" : "🟠 Injoignable"}</strong>,
                <span key="a">{caisse.adresse}</span>,
                <span key="d" className="sous-info">sur le poste principal</span>,
              ]
            : [<strong key="e">⚪ Aucun serveur ici</strong>, <span key="d" className="sous-info">poste seul</span>],
      },
      principal
        ? {
            cle: "caisses",
            titre: "📋 Caisses",
            onClick: () => setRubrique("appareils"),
            lignes: [
              <strong key="n">
                {caissesReliees} / {etat.appareils.length} reliée{caissesReliees > 1 ? "s" : ""}
              </strong>,
              ...etat.appareils.slice(0, 3).map((a) => (
                <span key={a.id} className="ligne-appareil-carte">
                  {a.relie ? "🟢" : "⚪"} {a.nom}
                </span>
              )),
              ...(etat.appareils.length > 3 ? [<span key="plus" className="sous-info">+ {etat.appareils.length - 3} autre(s)</span>] : []),
              ...(etat.appareils.length === 0 ? [<span key="vide" className="sous-info">aucune pour l'instant</span>] : []),
            ],
          }
        : caisse
          ? {
              cle: "caisses",
              titre: "📶 Cette caisse",
              lignes: [
                <strong key="o">{etat.nomOrdinateur}</strong>,
                <span key="a">{caisse.enAttente > 0 ? `${caisse.enAttente} en attente d'envoi` : "✓ rien en attente"}</span>,
              ],
            }
          : {
              cle: "caisses",
              titre: "📋 Caisses",
              lignes: [<strong key="n">Aucune</strong>, <span key="d" className="sous-info">aucun appareil relié</span>],
            },
      {
        cle: "enligne",
        titre: "🌐 Envoi en ligne",
        lignes: !enLigne
          ? [<strong key="m">🔒 100 % local</strong>, <span key="d" className="sous-info">rien n'est envoyé</span>]
          : [
              <strong key="e">{(internet?.enAttente ?? 0) > 0 ? `${internet?.enAttente} en attente` : "✓ tout est envoyé"}</strong>,
              <span key="d" className="sous-info">dernier envoi {depuis(internet?.derniereSynchro ?? null)}</span>,
              ...(caisse ? [<span key="p" className="sous-info">par le poste principal</span>] : []),
            ],
      },
      {
        cle: "sauvegarde",
        titre: "💾 Sauvegarde",
        onClick: caisse ? undefined : () => setSauvegardeOuverte(true),
        lignes: caisse
          ? [<strong key="c">Sur le poste principal</strong>, <span key="d" className="sous-info">rien à faire ici</span>]
          : !sauvegarde?.configuree
            ? [<strong key="n">Non paramétrée</strong>, <span key="d" className="sous-info">à faire par l'administrateur</span>]
            : [
                <strong key="s">{sauvegarde.alerte === "aucune" ? "✓ À jour" : "⚠️ En retard"}</strong>,
                <span key="d" className="sous-info">dernière {depuis(sauvegarde.derniereSauvegarde)}</span>,
              ],
      },
    ];

    return (
      <>
        <div className="ligne-etat-reseau">
          <div className={`carte-etat-serveur carte-etat-serveur--${CLASSE_TON[ton]}`}>
            <div className="entete-vue-ensemble">
              <span className="icone-vue-ensemble">{icone}</span>
              <div>
                <strong className="etat-serveur-titre">{titre}</strong>
                <span className="sous-info ligne-detail-article">{sousTitre}</span>
              </div>
            </div>
          </div>
          <div className="chemin-reseau" aria-label="Chemin des données">
            {chemin.map((n, i) => (
              <div key={n.libelle} className="maillon-chemin-reseau">
                <div className={`noeud-chemin-reseau${n.ici ? " ici" : ""}`}>
                  <span className="icone-noeud-reseau">{n.icone}</span>
                  <strong>{n.libelle}</strong>
                  <span className="sous-info">{n.sous}</span>
                  {n.ici && <span className="badge-ici-reseau">ici</span>}
                </div>
                {i < chemin.length - 1 && (
                  <span className={`fleche-chemin-reseau${n.lienOk === false ? " coupee" : ""}`}>{n.lienOk === false ? "✕" : "→"}</span>
                )}
              </div>
            ))}
          </div>
        </div>

        {etape && (
          <div className={`prochaine-etape prochaine-etape--${etape.ton}`}>
            <div>
              <span className="libelle-prochaine-etape">{etape.ton === "ok" ? "✓ État" : "👉 Prochaine étape"}</span>
              <p>{etape.texte}</p>
            </div>
            {etape.action && (
              <button type="button" className="bouton-primaire" disabled={enCours} onClick={etape.action.onClick}>
                {etape.action.libelle}
              </button>
            )}
          </div>
        )}
        {blocEtape}

        <div className="grille-cartes-reseau">
          {cartes.map((c) =>
            c.onClick ? (
              <button key={c.cle} type="button" className="carte-info-reseau cliquable" onClick={c.onClick}>
                <span className="titre-carte-reseau">
                  {c.titre} <span className="sous-info">›</span>
                </span>
                {c.lignes}
              </button>
            ) : (
              <div key={c.cle} className="carte-info-reseau">
                <span className="titre-carte-reseau">{c.titre}</span>
                {c.lignes}
              </div>
            ),
          )}
        </div>

        {caisse && peutGerer && (
          <div className="zone-danger-reseau">
            <div>
              <strong>Débrancher cette caisse</strong>
              <p className="note-aide">Elle redevient un poste seul ; un nouveau code sera nécessaire pour la rebrancher.</p>
            </div>
            <button type="button" className="bouton-danger" onClick={() => setConfirmerDebranchement(true)}>
              Débrancher
            </button>
          </div>
        )}
      </>
    );
  }

  function contenu() {
    if (!etat) return <p className="sous-info">Chargement…</p>;

    if (rubriqueActive === "aide") {
      return (
        <>
          <h4 className="titre-rubrique-reseau">❓ Comment relier vos appareils ?</h4>
          <p>
            Tous les appareils doivent être reliés <strong>au même réseau</strong>. Internet n'est pas nécessaire.
          </p>
          <div className="grille-moyens-reseau">
            <div className="bloc-reseau">
              <h4>📡 Un petit routeur Wi-Fi</h4>
              <p className="note-aide">
                Le plus fiable : branché sur une prise, sans abonnement internet, il relie tous les postes toute la journée.
              </p>
            </div>
            <div className="bloc-reseau">
              <h4>📱 Le point d'accès d'un téléphone</h4>
              <p className="note-aide">
                Activez « Point d'accès » sur le téléphone, puis connectez chaque appareil à ce Wi-Fi. Le forfait n'est
                pas nécessaire. Téléphone allumé, près des postes et sur chargeur (5 à 10 appareils en général).
              </p>
            </div>
            <div className="bloc-reseau">
              <h4>🔌 Un câble réseau</h4>
              <p className="note-aide">Entre deux ordinateurs, pour deux postes seulement.</p>
            </div>
          </div>
          <div className="bloc-reseau">
            <h4>📱 Téléphones et tablettes</h4>
            <p className="note-aide">
              Avec l'appli mobile, un téléphone ou une tablette peut être <strong>caisse</strong> ou <strong>poste
              principal</strong>, et se mélanger avec des ordinateurs. Un poste principal mobile : sur chargeur, appli
              ouverte (une notification « 🟢 Serveur de la boutique actif » reste affichée), et retiré de l'économie de
              batterie — sinon certaines marques (Tecno, Infinix, Itel, Xiaomi…) coupent le serveur écran éteint. Le
              téléphone qui partage son point d'accès peut lui-même être le poste principal.
            </p>
            {estAppliMobile && (
              <p className="note-aide">
                Cet appareil : économie de batterie {batterieLibre ? "✅ sans restriction" : "⚠️ active"}{" "}
                <button type="button" className="lien" onClick={ouvrirReglagesBatterie}>
                  🔋 Régler la batterie
                </button>
              </p>
            )}
          </div>
          <div className="bloc-reseau">
            <h4>🛡️ Pare-feu Windows</h4>
            <p className="note-aide">
              Au premier démarrage du poste principal, Windows peut demander d'autoriser l'application sur le réseau :
              cliquez sur « Autoriser » (réseau privé).
            </p>
          </div>
          <div className="bloc-reseau">
            <h4>🔍 Poste principal introuvable ?</h4>
            <p className="note-aide">
              Vérifiez que les deux appareils sont sur le même Wi-Fi (ou le même téléphone), que le poste principal est
              allumé avec l'application ouverte, puis tapez son adresse affichée sur le poste principal. Certains
              téléphones isolent les appareils de leur point d'accès : essayez alors un autre téléphone ou un routeur.
            </p>
          </div>
        </>
      );
    }

    // Rubrique Serveur sur une caisse ou un poste seul : le serveur est ailleurs (ou nulle part) — on guide.
    if (rubriqueActive === "serveur" && caisse) {
      return (
        <>
          <h4 className="titre-rubrique-reseau">⚙️ Serveur de la boutique</h4>
          <div className={`carte-etat-serveur carte-etat-serveur--${caisse.relie ? "marche" : "arrete"}`}>
            <div>
              <strong className="etat-serveur-titre">{caisse.relie ? "🟢 Relié" : "🟠 Injoignable"}</strong>
              <span className="sous-info ligne-detail-article">
                Serveur du poste principal « {caisse.nomPostePrincipal} » — cette caisse ne fait que s'y brancher.
              </span>
            </div>
            <div className="actions-code-reseau">
              <button type="button" disabled={enCours} onClick={async () => setEtat(await api.reseau.synchroniser())}>
                {caisse.relie ? "⟳ Échanger maintenant" : "⟳ Réessayer maintenant"}
              </button>
            </div>
          </div>
          {!caisse.relie && (
            <div className="bloc-reseau">
              <h4>Que vérifier ?</h4>
              <ul className="verifications-reseau">
                <li className="verif-info">Le poste principal « {caisse.nomPostePrincipal} » est allumé, avec l'application ouverte.</li>
                <li className="verif-info">Son serveur est en marche (sur le poste principal : Réseau de la boutique → ⚙️ Serveur).</li>
                <li className="verif-info">Cet appareil est sur le même Wi-Fi (ou le même téléphone) que lui.</li>
                <li className="verif-ok">
                  Si son adresse a changé, cette caisse le recherche toute seule sur le réseau et se reconnecte, sans
                  nouveau code.
                </li>
              </ul>
              <p className="note-aide">En attendant, les ventes continuent sur cette caisse et partiront dès le retour du serveur.</p>
            </div>
          )}
          <div className="grille-infos-serveur">
            <section className="bloc-reseau">
              <h4>🖥️ Le poste principal</h4>
              <dl className="infos-serveur">
                <dt>Nom</dt>
                <dd>« {caisse.nomPostePrincipal} »</dd>
                <dt>Adresse</dt>
                <dd>
                  <code className="adresse-reseau">{caisse.adresse}</code>
                </dd>
                <dt>Dernier échange</dt>
                <dd>{depuis(caisse.derniereSynchro)}</dd>
              </dl>
            </section>
            <section className="bloc-reseau">
              <h4>📶 Cette caisse</h4>
              <dl className="infos-serveur">
                <dt>Ordinateur</dt>
                <dd>{etat.nomOrdinateur}</dd>
                <dt>En attente d'envoi</dt>
                <dd>{caisse.enAttente > 0 ? `${caisse.enAttente} élément(s)` : "✓ rien"}</dd>
              </dl>
            </section>
            <section className="bloc-reseau">
              <h4>🌐 Envoi en ligne</h4>
              <dl className="infos-serveur">
                {!session.synchroAutorisee ? (
                  <>
                    <dt>Mode</dt>
                    <dd>🔒 100 % local : rien n'est envoyé en ligne</dd>
                  </>
                ) : caisse.internetPrincipal ? (
                  <>
                    <dt>Par le poste principal</dt>
                    <dd>
                      {caisse.internetPrincipal.enAttente > 0
                        ? `${caisse.internetPrincipal.enAttente} élément(s) en attente`
                        : "✓ tout est envoyé"}
                    </dd>
                    <dt>Dernier envoi</dt>
                    <dd>{depuis(caisse.internetPrincipal.derniereSynchro)}</dd>
                  </>
                ) : (
                  <>
                    <dt>Par le poste principal</dt>
                    <dd>inconnu pour l'instant</dd>
                  </>
                )}
              </dl>
            </section>
          </div>
          <p className="note-aide">
            On ne démarre, n'arrête ou ne redémarre le serveur que depuis le poste principal (Réseau de la boutique → ⚙️
            Serveur).
          </p>
        </>
      );
    }
    if (rubriqueActive === "serveur" && !principal) {
      return (
        <>
          <h4 className="titre-rubrique-reseau">⚙️ Serveur de la boutique</h4>
          <div className="carte-etat-serveur">
            <div>
              <strong className="etat-serveur-titre">⚪ Aucun serveur sur cet appareil</strong>
              <span className="sous-info ligne-detail-article">
                Cet appareil travaille seul : il ne partage ses ventes et son stock avec aucun autre.
              </span>
            </div>
          </div>
          <p className="note-aide">
            Le serveur de la boutique tourne sur <strong>un seul</strong> appareil, le poste principal : les autres (les
            caisses) s'y branchent et voient les mêmes ventes et le même stock, sans internet.
          </p>
          {!etat.reseauAutorise ? (
            <BlocActivationReseau session={session} peutGerer={peutGerer} onVerifie={rafraichir} />
          ) : peutGerer ? (
            <div className="grille-choix-reseau">
              <button type="button" className="carte-choix-reseau" onClick={() => setRubrique("devenirPrincipal")}>
                <span className="icone-choix-reseau">🖥️</span>
                <strong>Démarrer un serveur ici</strong>
                <span className="note-aide">
                  Cet appareil devient le poste principal (celui qui reste allumé toute la journée).
                </span>
              </button>
              <button type="button" className="carte-choix-reseau" onClick={() => setRubrique("seBrancher")}>
                <span className="icone-choix-reseau">📶</span>
                <strong>Se brancher à un serveur existant</strong>
                <span className="note-aide">Un poste principal est déjà en place : cet appareil devient une caisse.</span>
              </button>
            </div>
          ) : (
            reserve
          )}
        </>
      );
    }

    if (caisse) return vueEnsemble();

    if (principal) {
      if (rubriqueActive === "serveur") {
        const etatServeur = etat.enMarche ? "marche" : etat.enPause ? "arrete" : "panne";
        const derniereActivite = etat.appareils
          .map((a) => a.derniereConnexion)
          .filter((d): d is string => !!d)
          .sort()
          .pop() ?? null;
        return (
          <>
            <h4 className="titre-rubrique-reseau">⚙️ Serveur de la boutique</h4>
            <div className={`carte-etat-serveur carte-etat-serveur--${etatServeur}`}>
              <div>
                <strong className="etat-serveur-titre">
                  {etatServeur === "marche" ? "🟢 En marche" : etatServeur === "arrete" ? "⏹ Arrêté" : "🔴 En panne"}
                </strong>
                <span className="sous-info ligne-detail-article">
                  {etatServeur === "marche" && etat.demarreLe
                    ? `Démarré à ${new Date(etat.demarreLe).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })} · depuis ${duree(etat.demarreLe)}`
                    : etatServeur === "arrete"
                      ? "Arrêté à la main : les caisses restent branchées et vendent seules."
                      : etat.erreur ?? "Le serveur ne répond pas : essayez de le redémarrer."}
                </span>
              </div>
              {peutGerer && (
                <div className="actions-code-reseau">
                  {etatServeur === "marche" ? (
                    <>
                      <button type="button" disabled={enCours} onClick={redemarrer}>
                        {enCours ? "Redémarrage…" : "⟳ Redémarrer"}
                      </button>
                      <button type="button" className="bouton-danger" disabled={enCours} onClick={() => setConfirmerPause(true)}>
                        ⏹ Arrêter le serveur
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      className="bouton-primaire"
                      disabled={enCours}
                      onClick={etatServeur === "arrete" ? basculerPause : redemarrer}
                    >
                      {enCours ? "Démarrage…" : "▶ Démarrer le serveur"}
                    </button>
                  )}
                </div>
              )}
            </div>

            <div className="grille-infos-serveur">
              <section className="bloc-reseau">
                <h4>🖥️ Le poste</h4>
                <dl className="infos-serveur">
                  <dt>Nom</dt>
                  <dd>« {etat.nomPoste} »</dd>
                  <dt>Ordinateur</dt>
                  <dd>{etat.nomOrdinateur}</dd>
                  <dt>Adresse</dt>
                  <dd>
                    {etat.adresses.length === 0 ? (
                      <span className="texte-erreur">aucun réseau</span>
                    ) : (
                      etat.adresses.map((a) => (
                        <code key={a} className="adresse-reseau">
                          {a}
                          {etat.port ? `:${etat.port}` : ""}
                        </code>
                      ))
                    )}
                  </dd>
                  <dt>Port</dt>
                  <dd>{etat.port ?? "—"}</dd>
                  <dt>Annonce sur le réseau</dt>
                  <dd>{etat.annonceActive ? "✓ Active (les caisses le trouvent par « Rechercher »)" : "Inactive"}</dd>
                </dl>
              </section>
              <section className="bloc-reseau">
                <h4>📶 Les caisses</h4>
                <dl className="infos-serveur">
                  <dt>Reliées maintenant</dt>
                  <dd>
                    {caissesReliees} sur {etat.appareils.length} branchée{etat.appareils.length > 1 ? "s" : ""}
                  </dd>
                  <dt>Postes</dt>
                  <dd>
                    {etat.appareils.length + 1} / {etat.postesMax} (poste principal compris)
                  </dd>
                  <dt>Dernière activité</dt>
                  <dd>{depuis(derniereActivite)}</dd>
                  <dt>Échanges reçus</dt>
                  <dd>{etat.enMarche ? `${etat.requetesRecues.toLocaleString("fr-FR")} depuis le démarrage` : "—"}</dd>
                  <dt>Code de branchement</dt>
                  <dd>{etat.code ? `en cours (encore ${minutesRestantes(etat.code.expire)})` : "aucun"}</dd>
                </dl>
              </section>
              <section className="bloc-reseau">
                <h4>🌐 Envoi en ligne</h4>
                <dl className="infos-serveur">
                  {session.synchroAutorisee ? (
                    <>
                      <dt>Dernier envoi</dt>
                      <dd>{depuis(etat.internet?.derniereSynchro ?? null)}</dd>
                      <dt>En attente</dt>
                      <dd>
                        {(etat.internet?.enAttente ?? 0) > 0
                          ? `${etat.internet?.enAttente} élément(s) partiront au retour d'internet`
                          : "✓ tout est envoyé"}
                      </dd>
                    </>
                  ) : (
                    <>
                      <dt>Mode</dt>
                      <dd>🔒 100 % local : rien n'est envoyé en ligne</dd>
                    </>
                  )}
                </dl>
              </section>
            </div>

            <p className="note-aide">
              <strong>Arrêter</strong> coupe le réseau un moment (inventaire, maintenance) : les caisses restent branchées
              et se reconnectent seules au démarrage, sans nouveau code. L'arrêt prend fin aussi au redémarrage de
              l'application. <strong>Redémarrer</strong> sert si les caisses n'arrivent plus à se relier.
            </p>

            {peutGerer && (
              <div className="zone-danger-reseau">
                <div>
                  <strong>Arrêter d'être le poste principal</strong>
                  <p className="note-aide">Toutes les caisses seront débranchées et devront être rebranchées avec un nouveau code.</p>
                </div>
                <button type="button" className="bouton-danger" onClick={() => setConfirmerArret(true)}>
                  Arrêter d'être le poste principal
                </button>
              </div>
            )}
          </>
        );
      }
      if (rubriqueActive === "brancher") {
        return (
          <>
            <h4 className="titre-rubrique-reseau">🔑 Brancher une caisse</h4>
            {etat.enPause ? (
              <div className="bandeau-pause-reseau">
                <span>⏹ Le serveur est arrêté : démarrez-le pour brancher une caisse.</span>
                {peutGerer && (
                  <button type="button" className="bouton-primaire" disabled={enCours} onClick={basculerPause}>
                    ▶ Démarrer le serveur
                  </button>
                )}
              </div>
            ) : (
            <div className="carte-code-reseau">
              <div className="code-appairage">
                <span className="sous-info">Code à taper sur la caisse</span>
                {etat.code ? (
                  <>
                    <span className="code-appairage-chiffres">
                      {etat.code.valeur.slice(0, 3)} {etat.code.valeur.slice(3)}
                    </span>
                    <span className="sous-info">valable encore {minutesRestantes(etat.code.expire)} · une seule fois</span>
                  </>
                ) : (
                  <span className="code-appairage-vide">Aucun code en cours</span>
                )}
                {peutGerer && (
                  <div className="actions-code-reseau">
                    <button
                      type="button"
                      className="bouton-primaire"
                      onClick={async () => {
                        await api.reseau.nouveauCode();
                        rafraichir();
                      }}
                    >
                      {etat.code ? "Nouveau code" : "Afficher un code"}
                    </button>
                    {etat.code && (
                      <button
                        type="button"
                        className="bouton-danger"
                        onClick={async () => {
                          await api.reseau.annulerCode();
                          rafraichir();
                        }}
                      >
                        ✕ Arrêter le code
                      </button>
                    )}
                  </div>
                )}
              </div>
              <div className="adresses-poste-principal">
                <span className="sous-info">Adresse du poste principal</span>
                {etat.adresses.length === 0 ? (
                  <strong className="texte-erreur">aucun réseau — reliez cet appareil au Wi-Fi ou au câble</strong>
                ) : (
                  etat.adresses.map((a) => (
                    <code key={a} className="adresse-reseau">
                      {a}:{etat.port ?? "—"}
                    </code>
                  ))
                )}
              </div>
            </div>
            )}
            <ol className="etapes-reseau">
              <li>Reliez la caisse au même Wi-Fi (ou au même téléphone) que cet appareil.</li>
              <li>
                Sur la caisse : Informations boutique → Réseau de la boutique → <strong>Se brancher</strong>.
              </li>
              <li>« Rechercher le poste principal » (ou tapez l'adresse ci-dessus), puis tapez le code.</li>
            </ol>
            <p className="note-aide">
              Le code ne sert qu'à brancher <strong>une</strong> nouvelle caisse : il s'arrête tout seul après usage ou au
              bout de 10 minutes, et « Arrêter le code » le coupe tout de suite. Les caisses déjà branchées restent reliées ;
              pour en retirer une, passez par Appareils.
            </p>
          </>
        );
      }
      if (rubriqueActive === "appareils") {
        return (
          <>
            <h4 className="titre-rubrique-reseau">📋 Appareils branchés</h4>
            <div className="zone-tableau-scroll zone-appareils-reseau">
              <table className="tableau-catalogue tableau-appareils-reseau">
                <thead>
                  <tr>
                    <th className="colonne-numero-groupe">N°</th>
                    <th>Appareil</th>
                    <th>État</th>
                    <th>Dernière connexion</th>
                    <th>Branché le</th>
                    {peutGerer && <th className="colonne-action-reseau">Action</th>}
                  </tr>
                </thead>
                <tbody>
                  {etat.appareils.map((a, index) => (
                    <tr key={a.id}>
                      <td className="colonne-numero-groupe">{index + 1}</td>
                      <td>
                        <strong>{a.nom}</strong>
                      </td>
                      <td className="nowrap">
                        {a.relie ? (
                          <span className="pastille-etat-reseau pastille-etat-reseau--relie">🟢 Relié</span>
                        ) : (
                          <span className="pastille-etat-reseau">⚪ Pas vu récemment</span>
                        )}
                      </td>
                      <td className="nowrap">{depuis(a.derniereConnexion)}</td>
                      <td className="nowrap">
                        {new Date(a.dateBranchement).toLocaleDateString("fr-FR")}{" "}
                        <span className="sous-info">
                          {new Date(a.dateBranchement).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}
                        </span>
                      </td>
                      {peutGerer && (
                        <td className="colonne-action-reseau">
                          <button type="button" className="lien lien-danger" onClick={() => setADebrancher({ id: a.id, nom: a.nom })}>
                            Débrancher
                          </button>
                        </td>
                      )}
                    </tr>
                  ))}
                  {etat.appareils.length === 0 && (
                    <tr>
                      <td colSpan={colonnesAppareils} className="liste-vide">
                        Aucune caisse branchée pour l'instant.{" "}
                        <button type="button" className="lien" onClick={() => setRubrique("brancher")}>
                          Brancher une caisse
                        </button>
                      </td>
                    </tr>
                  )}
                  {/* Lignes vides : la grille reste visible jusqu'en bas, même avec peu d'appareils. */}
                  {Array.from({ length: Math.max(0, 10 - Math.max(1, etat.appareils.length)) }).map((_, i) => (
                    <tr key={`vide-${i}`} className="ligne-groupe-vide">
                      {Array.from({ length: colonnesAppareils }).map((__, j) => (
                        <td key={j}>&nbsp;</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="totaux">
              <div>
                {etat.appareils.length + 1} poste{etat.appareils.length > 0 ? "s" : ""} sur {etat.postesMax} au maximum
                (poste principal compris)
              </div>
            </div>
          </>
        );
      }
      return vueEnsemble();
    }

    // Poste seul.
    if (!etat.reseauAutorise && (rubriqueActive === "seBrancher" || rubriqueActive === "devenirPrincipal")) {
      return (
        <>
          <h4 className="titre-rubrique-reseau">
            {rubriqueActive === "seBrancher" ? "📶 Se brancher au poste principal" : "🖥️ Faire de cet appareil le poste principal"}
          </h4>
          <BlocActivationReseau session={session} peutGerer={peutGerer} onVerifie={rafraichir} />
        </>
      );
    }
    if (rubriqueActive === "seBrancher") {
      return (
        <>
          <h4 className="titre-rubrique-reseau">📶 Se brancher au poste principal</h4>
          <p className="note-aide">
            Cet appareil doit être connecté au même réseau que le poste principal (même box, même routeur ou même
            téléphone en point d'accès). Le code s'affiche sur le poste principal : Informations boutique → Réseau de la
            boutique → Brancher une caisse.
          </p>
          {peutGerer ? (
            <div className="formulaire-reseau">
              <div className="etape-reseau">
                <span className="numero-etape-reseau">1</span>
                <div className="champ-etape-reseau">
                  <strong>Choisir le poste principal</strong>
                  {saisieManuelle ? (
                    <>
                      <input
                        value={adresse}
                        placeholder="Adresse affichée sur le poste principal, ex. 192.168.1.10"
                        autoFocus
                        onChange={(e) => setAdresse(e.target.value)}
                      />
                      <span className="note-aide">
                        Sur le poste principal : Réseau de la boutique → Brancher une caisse → « Adresse du poste principal ».
                      </span>
                      <div>
                        <button
                          type="button"
                          onClick={() => {
                            setSaisieManuelle(false);
                            rechercherPostes();
                          }}
                        >
                          ← Revenir à la recherche automatique
                        </button>
                      </div>
                    </>
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
                              <strong>{t.nomPoste}</strong>
                              <span className="sous-info ligne-detail-article">
                                {t.boutiqueNom} · {t.adresse}
                              </span>
                            </span>
                            {adresse === t.adresse && <span className="coche-poste-trouve">✓</span>}
                          </button>
                        ))}
                      </div>
                      <span className="note-aide">
                        <button type="button" className="lien" onClick={rechercherPostes}>
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
                          Vérifiez que le poste principal est allumé avec l'application ouverte et que cet appareil est
                          sur le même Wi-Fi (ou le même téléphone). Certains téléphones bloquent la recherche : tapez alors
                          l'adresse.
                        </span>
                      </div>
                      <div className="actions-code-reseau">
                        <button type="button" className="bouton-primaire" onClick={rechercherPostes}>
                          ⟳ Relancer la recherche
                        </button>
                        <button type="button" onClick={() => setSaisieManuelle(true)}>
                          ⌨️ Taper l'adresse
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
              <div className="etape-reseau">
                <span className="numero-etape-reseau">2</span>
                <div className="champ-etape-reseau">
                  <strong>Taper le code à 6 chiffres</strong>
                  <input
                    className="champ-code-reseau"
                    value={code}
                    inputMode="numeric"
                    maxLength={7}
                    placeholder="123 456"
                    onChange={(e) => setCode(e.target.value)}
                  />
                </div>
              </div>
              <div className="actions-formulaire">
                <button
                  type="button"
                  className="bouton-primaire"
                  disabled={enCours || !adresse.trim() || code.replace(/\s/g, "").length !== 6}
                  onClick={seBrancher}
                >
                  {enCours ? "Branchement…" : "Se brancher"}
                </button>
              </div>
            </div>
          ) : (
            reserve
          )}
        </>
      );
    }
    if (rubriqueActive === "devenirPrincipal") {
      return (
        <>
          <h4 className="titre-rubrique-reseau">🖥️ Faire de cet appareil le poste principal</h4>
          <p className="note-aide">
            Le poste principal garde la version commune des ventes et du stock : les caisses se branchent sur lui. Il n'en
            faut qu'<strong>un</strong> par boutique.
          </p>
          {peutGerer ? (
            <div className="formulaire-reseau">
              <div className="etape-reseau">
                <span className="numero-etape-reseau">1</span>
                <div className="champ-etape-reseau">
                  <strong>Vérifier cet appareil</strong>
                  <ul className="verifications-reseau">
                    <li className={etat.adresses.length > 0 ? "verif-ok" : "verif-ko"}>
                      {etat.adresses.length > 0 ? (
                        <>
                          Relié à un réseau{" "}
                          <span className="sous-info">({etat.adresses.join(", ")})</span>
                        </>
                      ) : (
                        <>Aucun réseau : connectez cet appareil au Wi-Fi, au téléphone en point d'accès ou au câble.</>
                      )}
                    </li>
                    <li className="verif-info">Il reste allumé toute la journée, avec l'application ouverte (bureau du patron ou caisse principale).</li>
                    {estAppliMobile ? (
                      <>
                        <li className="verif-info">Téléphone ou tablette sur chargeur ; acceptez l'autorisation des notifications.</li>
                        <li className={batterieLibre ? "verif-ok" : "verif-ko"}>
                          {batterieLibre ? (
                            "Économie de batterie : sans restriction pour Gestion Stock."
                          ) : (
                            <>
                              Économie de batterie active : Android peut couper le serveur écran éteint.{" "}
                              <button type="button" className="lien" onClick={ouvrirReglagesBatterie}>
                                🔋 Régler la batterie
                              </button>
                            </>
                          )}
                        </li>
                      </>
                    ) : (
                      <li className="verif-info">
                        Au démarrage, si Windows demande d'autoriser l'application sur le réseau : cliquez sur « Autoriser ».
                      </li>
                    )}
                  </ul>
                </div>
              </div>
              <div className="etape-reseau">
                <span className="numero-etape-reseau">2</span>
                <div className="champ-etape-reseau">
                  <strong>Lui donner un nom</strong>
                  <input
                    value={nomPoste}
                    placeholder={`ex. Bureau (sinon : ${etat.nomOrdinateur})`}
                    maxLength={40}
                    onChange={(e) => setNomPoste(e.target.value)}
                  />
                  <span className="suggestions-nom-poste">
                    {["Bureau", "Caisse principale", "Comptoir", "Magasin"].map((nom) => (
                      <button
                        key={nom}
                        type="button"
                        className={`puce-nom-poste${nomPoste === nom ? " choisi" : ""}`}
                        onClick={() => setNomPoste(nom)}
                      >
                        {nom}
                      </button>
                    ))}
                  </span>
                  <span className="note-aide">C'est ce nom que les caisses verront en le recherchant.</span>
                </div>
              </div>
              <div className="etape-reseau">
                <span className="numero-etape-reseau">3</span>
                <div className="champ-etape-reseau">
                  <strong>Démarrer</strong>
                  <span className="note-aide">
                    Le serveur de la boutique démarre et un code à 6 chiffres s'affiche, à taper sur chaque caisse.
                  </span>
                  <div>
                    <button
                      type="button"
                      className="bouton-primaire"
                      disabled={enCours || etat.adresses.length === 0}
                      onClick={devenirPrincipal}
                    >
                      {enCours ? "Démarrage…" : "🖥️ Devenir le poste principal"}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            reserve
          )}
        </>
      );
    }
    return vueEnsemble();
  }

  return (
    <div className="fond-modale" onClick={onFermer}>
      <div className="modale-selection-produits modale-reseau-boutique" onClick={(e) => e.stopPropagation()}>
        <div className="modale-entete">
          <h3>📶 Réseau de la boutique</h3>
          <button type="button" className="lien bouton-retour" onClick={onFermer}>
            ← Retour
          </button>
        </div>
        <div className="modale-corps">
          <div className="disposition-parametres">
            <nav className="barre-laterale-parametres barre-laterale-reseau">
              <div className={`role-reseau role-reseau--${roleEtat}`}>
                <span className="sous-info">Cet appareil</span>
                <strong>{roleLibelle}</strong>
              </div>
              {etat && (
                <div className="autorisations-reseau" title="Réglés par votre administrateur">
                  <span className={session.synchroAutorisee ? "autorisation-oui" : "autorisation-non"}>
                    {session.synchroAutorisee ? "🌐 Envoi en ligne : autorisé" : "🔒 Envoi en ligne : non (100 % local)"}
                  </span>
                  <span className={etat.reseauAutorise ? "autorisation-oui" : "autorisation-non"}>
                    {etat.reseauAutorise ? "📶 Réseau : activé" : "📶 Réseau : non activé"}
                  </span>
                  <span className="sous-info">réglés par votre administrateur</span>
                </div>
              )}
              {rubriques.map((r) => (
                <button
                  key={r.cle}
                  type="button"
                  className={`item-nav-parametres${rubriqueActive === r.cle ? " actif" : ""}`}
                  onClick={() => {
                    setErreur(null);
                    setRubrique(r.cle);
                  }}
                >
                  {r.label}
                  {r.compteur && <span className="compteur-nav-reseau">{r.compteur}</span>}
                </button>
              ))}
            </nav>
            <div className="contenu-parametres contenu-reseau">
              {erreur && <div className="message-erreur">{erreur}</div>}
              {etat?.erreur && <div className="message-erreur">{etat.erreur}</div>}
              {contenu()}
            </div>
          </div>
        </div>
      </div>
      {sauvegardeOuverte && <ModaleEtatSauvegarde onFermer={() => setSauvegardeOuverte(false)} />}
      {confirmerPause && (
        <ModaleConfirmation
          titre="Arrêter le serveur ?"
          description="Les caisses restent branchées mais vendent seules : elles ne verront plus les ventes des autres postes jusqu'au démarrage du serveur. Aucune nouvelle caisse ne peut se brancher pendant l'arrêt."
          labelConfirmer="Arrêter le serveur"
          enCours={enCours}
          onAnnuler={() => setConfirmerPause(false)}
          onConfirmer={basculerPause}
        />
      )}
      {confirmerArret && (
        <ModaleConfirmation
          titre="Arrêter d'être le poste principal ?"
          description="Le serveur de la boutique s'arrête et toutes les caisses sont débranchées : elles continueront seules et devront être rebranchées avec un nouveau code."
          labelConfirmer="Arrêter"
          dangereux
          enCours={enCours}
          onAnnuler={() => setConfirmerArret(false)}
          onConfirmer={quitter}
        />
      )}
      {confirmerDebranchement && (
        <ModaleConfirmation
          titre="Débrancher cette caisse du poste principal ?"
          description="Cette caisse redevient un poste seul : ses données restent sur l'appareil, mais elle ne verra plus les ventes des autres postes. Pour la rebrancher, il faudra un nouveau code."
          labelConfirmer="Débrancher"
          dangereux
          onAnnuler={() => setConfirmerDebranchement(false)}
          onConfirmer={async () => {
            setEtat(await api.reseau.seDebrancher());
            setConfirmerDebranchement(false);
          }}
        />
      )}
      {aDebrancher && (
        <ModaleConfirmation
          titre={`Débrancher « ${aDebrancher.nom} » ?`}
          description="Cet appareil ne pourra plus échanger avec le poste principal. Pour le rebrancher, il faudra un nouveau code."
          labelConfirmer="Débrancher"
          dangereux
          onAnnuler={() => setADebrancher(null)}
          onConfirmer={async () => {
            setEtat(await api.reseau.debrancher(aDebrancher.id));
            setADebrancher(null);
          }}
        />
      )}
    </div>
  );
}
