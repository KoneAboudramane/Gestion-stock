import { useEffect, useState, type ReactNode } from "react";

import { api } from "../api/client";
import { texteEssai } from "../components/BandeauAbonnement";
import PanneauOptions, { type CleOption, type EnregistrementOption } from "../components/PanneauOptions";
import type { AbonnementBoutique, AbonnementDetailAdmin, ChampsAbonnement, EtatAbonnement } from "../api/types";

const LIBELLES_FORMULE: Record<string, string> = {
  essentiel: "Essentiel",
  pro: "Pro",
};

// Ce que chaque formule inclut, en entier (voir comptes/views.py::UtilisateurViewSet,
// stock/views.py::DepotViewSet, comptabilite/views.py::_RapportComptableView
// pour les limites réellement appliquées côté serveur ; le reste — synchro,
// thème, format ticket... — est disponible pour les deux, sans distinction).
const FONCTIONNALITES_FORMULE: Record<string, string[]> = {
  essentiel: [
    "Catalogue, stock, ventes, clients, achats, fournisseurs",
    "1 dépôt",
    "Patron + 1 utilisateur",
    "Rapports de base (CA, bénéfices, top produits)",
    "Comptabilité : aperçu local uniquement",
    "Synchronisation cloud activable sur demande",
  ],
  pro: [
    "Tout Essentiel, plus :",
    "Dépôts illimités + transferts de stock entre dépôts",
    "Utilisateurs illimités",
    "Comptabilité : livre officiel SYSCOHADA (Journal, Grand livre, Balance, Bilan)",
    "Rapports avancés et export",
  ],
};

const MODES_PAIEMENT: [string, string][] = [
  ["wave", "Wave"],
  ["orange_money", "Orange Money"],
  ["mtn", "MTN Mobile Money"],
  ["moov", "Moov Money"],
  ["especes", "Espèces"],
  ["banque", "Banque"],
  ["autre", "Autre"],
];

const DUREES = [1, 3, 6, 12];
/** Durées proposées pour un essai gratuit, en jours. */
const DUREES_ESSAI = [7, 15, 30];

/** Fin d'un essai de `jours` jours qui commence aujourd'hui (fin de journée). */
function finEssaiDans(jours: number): Date {
  const fin = new Date();
  fin.setDate(fin.getDate() + jours);
  fin.setHours(23, 59, 59, 0);
  return fin;
}

type Rubrique = "apercu" | "renouveler" | "essai" | "options" | "paiements" | "historique" | "code";
type Ton = "ok" | "attention" | "alerte" | "neutre";
const CLASSE_TON: Record<Ton, string> = { ok: "marche", attention: "arrete", alerte: "panne", neutre: "neutre" };

function dateLongue(iso: string | null): string {
  return iso ? new Date(iso).toLocaleDateString("fr-FR", { day: "2-digit", month: "long", year: "numeric" }) : "sans limite";
}

function dateCourte(iso: string | null): string {
  return iso ? new Date(iso).toLocaleDateString("fr-FR") : "—";
}

function montant(valeur: string | number | null | undefined): string {
  const n = Number(valeur ?? 0);
  return n ? `${n.toLocaleString("fr-FR")} F` : "—";
}

/** Même calcul que le serveur (comptes/services.py::ajouter_mois) : même jour, ou dernier jour du mois. */
function ajouterMois(date: Date, mois: number): Date {
  const resultat = new Date(date);
  const jour = resultat.getDate();
  resultat.setDate(1);
  resultat.setMonth(resultat.getMonth() + mois);
  const dernier = new Date(resultat.getFullYear(), resultat.getMonth() + 1, 0).getDate();
  resultat.setDate(Math.min(jour, dernier));
  return resultat;
}

/**
 * Carte « Gérer abonnement » de l'Espace Admin (voir AccesCreationBoutique.tsx),
 * pour la boutique installée sur ce poste (un poste = une boutique). Barre
 * latérale : Vue d'ensemble, Renouveler (en 1 clic, prix selon vos tarifs),
 * Paiements déclarés (à valider), Historique, Code d'activation, Options.
 *
 * Les options (envoi en ligne, appli mobile) ont leur propre modale :
 * components/ModaleOptionsBoutique.tsx.
 *
 * Sans internet, renouveler s'applique tout de suite en local
 * et partent au serveur au retour de la connexion (Réglages > Synchronisation) ;
 * le détail (historique, paiements déclarés, tarifs, code) demande le serveur.
 * Identifiants de l'Espace Admin réutilisés, jamais redemandés.
 *
 * `masquerSynchro` : juste après une création hors ligne (voir Inscription.tsx),
 * la boutique n'existe pas encore sur le serveur — pas d'options en ligne.
 * `demarrerEnEdition` : ouvre directement « Renouveler ».
 */
export default function GererAbonnement({
  onFermer,
  username,
  password,
  masquerSynchro = false,
  demarrerEnEdition = false,
}: {
  onFermer: () => void;
  username: string;
  password: string;
  masquerSynchro?: boolean;
  demarrerEnEdition?: boolean;
}) {
  const [boutique, setBoutique] = useState<AbonnementBoutique | null | undefined>(undefined);
  const [etat, setEtat] = useState<EtatAbonnement | null>(null);
  const [detail, setDetail] = useState<AbonnementDetailAdmin | null>(null);
  const [horsLigne, setHorsLigne] = useState(false);
  const [rubrique, setRubrique] = useState<Rubrique>(demarrerEnEdition ? "renouveler" : "apercu");
  const [erreur, setErreur] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [enCours, setEnCours] = useState(false);
  // Renouveler
  const [formule, setFormule] = useState("essentiel");
  const [duree, setDuree] = useState<number | null>(1);
  const [illimite, setIllimite] = useState(false);
  const [dateManuelle, setDateManuelle] = useState("");
  const [nature, setNature] = useState<"paiement" | "offert" | "ajustement">("paiement");
  const [montantSaisi, setMontantSaisi] = useState("");
  const [mode, setMode] = useState("");
  const [reference, setReference] = useState("");
  // Paiements déclarés : rejet avec motif
  const [aRejeter, setARejeter] = useState<string | null>(null);
  const [motif, setMotif] = useState("");
  // Options
  // Essai gratuit
  const [essaiFormule, setEssaiFormule] = useState("pro");
  const [essaiJours, setEssaiJours] = useState<number | null>(15);
  const [essaiJoursSaisis, setEssaiJoursSaisis] = useState("");
  // Code d'activation
  const [code, setCode] = useState<string | null>(null);

  async function charger() {
    const b = await api.admin.boutiqueLocale();
    setBoutique(b);
    if (!b) return;
    setFormule(b.formule || "essentiel");
    setEtat(await api.abonnement.etat(b.boutiqueId).catch(() => null));
    const r = await api.admin.detailAbonnement(username, password, b.boutiqueId);
    if (r.succes) {
      setDetail(r.resultat);
      setHorsLigne(false);
      // Le serveur a une autre période (paiement validé, renouvellement fait dans l'admin Django) ou
      // d'autres options (synchronisation, réseau, appli mobile réglés sur le site admin ou un autre
      // poste) : ce poste s'aligne — sauf si une modification faite ici hors ligne attend d'y être envoyée.
      const serveur = r.resultat.boutique;
      const dateServeur = serveur.date_expiration_abonnement ? Date.parse(serveur.date_expiration_abonnement) : null;
      const dateLocale = b.dateExpirationAbonnement ? Date.parse(b.dateExpirationAbonnement) : null;
      const ecart: ChampsAbonnement = {};
      if (serveur.formule !== b.formule || dateServeur !== dateLocale) {
        ecart.formule = serveur.formule;
        ecart.dateExpirationAbonnement = serveur.date_expiration_abonnement;
      }
      if (serveur.synchro_autorisee !== b.synchroAutorisee) ecart.synchroAutorisee = serveur.synchro_autorisee;
      if (serveur.reseau_autorise !== b.reseauAutorise) ecart.reseauAutorise = serveur.reseau_autorise;
      if (serveur.appli_mobile_autorisee !== undefined && serveur.appli_mobile_autorisee !== b.appliMobileAutorisee) {
        ecart.appliMobileAutorisee = serveur.appli_mobile_autorisee;
      }
      if (serveur.essai_fin !== undefined) {
        const essaiServeur = serveur.essai_fin ? Date.parse(serveur.essai_fin) : null;
        const essaiLocal = b.essaiFin ? Date.parse(b.essaiFin) : null;
        if (essaiServeur !== essaiLocal || (serveur.essai_fin && (serveur.essai_formule ?? "") !== b.essaiFormule)) {
          ecart.essaiFin = serveur.essai_fin;
          ecart.essaiFormule = serveur.essai_formule ?? "";
        }
      }
      if (Object.keys(ecart).length > 0 && !(await api.admin.abonnementEnAttente())) {
        const alignement = await api.admin.soumettreAbonnement(username, password, b.boutiqueId, b.boutiqueNom, ecart);
        if (alignement.succes) {
          const alignee = await api.admin.boutiqueLocale();
          setBoutique(alignee);
          if (alignee) {
            setFormule(alignee.formule || "essentiel");
          }
          setEtat(await api.abonnement.etat(b.boutiqueId).catch(() => null));
        }
      }
    } else {
      setDetail(null);
      setHorsLigne(true);
    }
  }
  useEffect(() => {
    charger();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function aller(r: Rubrique) {
    setErreur(null);
    setMessage(null);
    setRubrique(r);
  }

  // --- Renouveler ---
  const finActuelle = boutique?.dateExpirationAbonnement ? new Date(boutique.dateExpirationAbonnement) : null;
  /** Les jours déjà payés ne sont pas perdus : on repart de la fin actuelle si elle est à venir. */
  const depart = finActuelle && finActuelle > new Date() ? finActuelle : new Date();
  const nouvelleFin: Date | null = illimite
    ? null
    : duree
      ? ajouterMois(depart, duree)
      : dateManuelle
        ? new Date(`${dateManuelle}T23:59:59`)
        : null;
  const tarif = detail?.tarifs.find((t) => t.formule === formule && t.duree_mois === duree) ?? null;

  function choisirDuree(mois: number) {
    setDuree(mois);
    setIllimite(false);
    const t = detail?.tarifs.find((x) => x.formule === formule && x.duree_mois === mois);
    if (t && nature === "paiement") setMontantSaisi(String(Number(t.prix)));
  }

  useEffect(() => {
    // Formule changée : le prix suit (s'il y a des tarifs).
    if (duree && nature === "paiement" && tarif) setMontantSaisi(String(Number(tarif.prix)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [formule]);

  async function soumettre(champs: ChampsAbonnement, succes: string) {
    if (!boutique) return;
    setErreur(null);
    setMessage(null);
    setEnCours(true);
    const r = await api.admin.soumettreAbonnement(username, password, boutique.boutiqueId, boutique.boutiqueNom, champs);
    setEnCours(false);
    if (!r.succes) return setErreur(r.message);
    setMessage(
      r.resultat.statut === "synchronise"
        ? `✅ ${succes} (sur ce poste et sur le serveur).`
        : `✅ ${succes} sur ce poste. Pas de connexion : le serveur sera prévenu au retour d'internet (Réglages → Synchronisation).`,
    );
    await charger();
  }

  async function renouveler() {
    if (!illimite && !nouvelleFin) return setErreur("Choisissez une durée ou une date de fin.");
    if (nature === "paiement" && !(Number(montantSaisi) > 0)) {
      return setErreur("Indiquez le montant reçu, ou choisissez « Offert » ou « Correction de date ».");
    }
    await soumettre(
      {
        formule,
        dateExpirationAbonnement: nouvelleFin ? nouvelleFin.toISOString() : null,
        nature,
        ...(nature === "paiement" ? { montant: Number(montantSaisi), mode, reference: reference.trim() } : {}),
      },
      illimite ? "Abonnement sans limite enregistré" : `Abonnement prolongé jusqu'au ${dateLongue(nouvelleFin!.toISOString())}`,
    );
    setReference("");
    setRubrique("apercu");
  }

  // --- Paiements déclarés ---
  async function traiterDemande(demandeId: string, action: "valider" | "rejeter") {
    if (!boutique) return;
    if (action === "rejeter" && !motif.trim()) return setErreur("Indiquez le motif du rejet (il sera visible par la boutique).");
    setErreur(null);
    setMessage(null);
    setEnCours(true);
    const r = await api.admin.detailAbonnement(username, password, boutique.boutiqueId, action, {
      demandeId,
      motif: action === "rejeter" ? motif.trim() : undefined,
    });
    setEnCours(false);
    if (!r.succes) return setErreur(r.message);
    setDetail(r.resultat);
    setARejeter(null);
    setMotif("");
    setMessage(action === "valider" ? "✅ Paiement validé : la période est ajoutée à l'abonnement." : "Paiement rejeté.");
    await charger(); // aligne aussi la nouvelle date sur ce poste
  }

  // --- Essai gratuit (à part de l'abonnement payé, voir comptes.Boutique.essai_fin) ---
  const joursEssai = essaiJours ?? (Number(essaiJoursSaisis) >= 1 ? Math.floor(Number(essaiJoursSaisis)) : null);
  const finEssai = joursEssai ? finEssaiDans(joursEssai) : null;

  async function accorderEssai() {
    if (!finEssai) return setErreur("Choisissez la durée de l'essai.");
    await soumettre(
      { essaiFormule, essaiFin: finEssai.toISOString() },
      `Essai gratuit ${LIBELLES_FORMULE[essaiFormule]} accordé jusqu'au ${dateLongue(finEssai.toISOString())}`,
    );
  }

  async function arreterEssai() {
    await soumettre({ essaiFin: null }, "Essai gratuit arrêté : l'abonnement payé s'applique de nouveau");
  }

  // --- Options payantes (formule Essentiel ; comprises dans Pro) ---
  async function enregistrerOption(e: EnregistrementOption) {
    if (!boutique) return;
    const etatOption = detail?.options?.[e.cle];
    let fin: string | null = null;
    if (!e.suitAbonnement) {
      if (e.dateFin) {
        fin = new Date(`${e.dateFin}T23:59:59`).toISOString();
      } else {
        // Une option encore valable se prolonge à partir de sa fin, sinon d'aujourd'hui.
        const finActuelleOption = etatOption?.source === "payee" && etatOption.fin ? new Date(etatOption.fin) : null;
        const departOption = finActuelleOption && finActuelleOption > new Date() ? finActuelleOption : new Date();
        fin = ajouterMois(departOption, e.dureeMois ?? 1).toISOString();
      }
    }
    await soumettre(
      {
        optionCle: e.cle,
        optionFin: fin,
        optionSuit: e.suitAbonnement,
        optionNature: e.nature,
        ...(e.nature === "paiement" ? { optionMontant: e.montant, optionMode: e.mode, optionReference: e.reference } : {}),
      },
      `${etatOption?.libelle ?? "Option"} ${e.suitAbonnement ? "liée à l'abonnement" : `jusqu'au ${dateLongue(fin)}`}`,
    );
  }

  async function retirerOption(cle: CleOption) {
    await soumettre({ optionCle: cle, optionRetirer: true }, `${detail?.options?.[cle]?.libelle ?? "Option"} retirée`);
  }

  async function exceptionOption(cle: CleOption, valeur: boolean) {
    const champs: ChampsAbonnement =
      cle === "en_ligne" ? { optionEnLigneOfferte: valeur } : cle === "reseau" ? { reseauAutorise: valeur } : { appliMobileAutorisee: valeur };
    await soumettre(champs, `${detail?.options?.[cle]?.libelle ?? "Option"} ${valeur ? "accordée sans paiement" : ": exception retirée"}`);
  }

  // --- Code d'activation ---
  async function genererCode() {
    if (!boutique) return;
    setErreur(null);
    setEnCours(true);
    const r = await api.admin.detailAbonnement(username, password, boutique.boutiqueId, "code");
    setEnCours(false);
    if (!r.succes) return setErreur(r.message);
    setDetail(r.resultat);
    setCode(r.resultat.code);
  }

  // ---------------------------------------------------------------------------

  const enAttente = detail?.demandes.filter((d) => d.statut === "en_attente") ?? [];
  const rubriques: { cle: Rubrique; label: string; compteur?: string }[] = [
    { cle: "apercu", label: "💳 Vue d'ensemble" },
    { cle: "renouveler", label: "🔄 Renouveler" },
    { cle: "essai", label: "🧪 Essai gratuit" },
    { cle: "options", label: "🧩 Options" },
    { cle: "paiements", label: "📨 Paiements déclarés", compteur: enAttente.length ? String(enAttente.length) : undefined },
    { cle: "historique", label: "🧾 Historique" },
    { cle: "code", label: "🔑 Code d'activation" },
  ];

  const blocHorsLigne = (texte: string) => (
    <div className="prochaine-etape prochaine-etape--neutre">
      <div>
        <span className="libelle-prochaine-etape">Sans connexion au serveur</span>
        <p>{texte}</p>
      </div>
      <button type="button" disabled={enCours} onClick={() => charger()}>
        ⟳ Réessayer
      </button>
    </div>
  );

  function vueEnsemble() {
    if (!boutique) return null;
    const niveau = etat?.niveau ?? "ok";
    const sansLimite = !boutique.dateExpirationAbonnement;
    let icone: string;
    let titre: string;
    let sousTitre: string;
    let ton: Ton;
    if (etat?.essai && (niveau === "ok" || niveau === "bientot")) {
      icone = "🧪";
      titre = `Essai gratuit ${LIBELLES_FORMULE[etat.essai.formule] ?? etat.essai.formule}`;
      sousTitre = texteEssai(etat.essai);
      ton = niveau === "bientot" ? "attention" : "ok";
    } else if (sansLimite) {
      icone = "♾️";
      titre = "Abonnement sans limite";
      sousTitre = `Formule ${LIBELLES_FORMULE[boutique.formule] ?? boutique.formule}`;
      ton = "ok";
    } else if (niveau === "bloque") {
      icone = "🔴";
      titre = "Vente bloquée";
      sousTitre = `Abonnement terminé le ${dateLongue(boutique.dateExpirationAbonnement)}, délai de grâce dépassé`;
      ton = "alerte";
    } else if (niveau === "grace") {
      icone = "🟠";
      titre = "Délai de grâce";
      sousTitre = `Terminé le ${dateLongue(boutique.dateExpirationAbonnement)} · vente encore permise jusqu'au ${dateLongue(etat?.finGrace ?? null)}`;
      ton = "alerte";
    } else {
      icone = niveau === "bientot" ? "⏳" : "✅";
      titre = niveau === "bientot" ? `Se termine dans ${etat?.joursRestants ?? "?"} jour(s)` : "Abonnement actif";
      sousTitre = `Formule ${LIBELLES_FORMULE[boutique.formule] ?? boutique.formule} · jusqu'au ${dateLongue(boutique.dateExpirationAbonnement)}${etat?.joursRestants != null && niveau === "ok" ? ` (${etat.joursRestants} jours)` : ""}`;
      ton = niveau === "bientot" ? "attention" : "ok";
    }

    let etape: { ton: Ton; texte: ReactNode; action?: { libelle: string; onClick: () => void } };
    if (enAttente.length > 0) {
      etape = {
        ton: "attention",
        texte: `${enAttente.length} paiement(s) Mobile Money déclaré(s) par la boutique à vérifier.`,
        action: { libelle: "📨 Vérifier", onClick: () => aller("paiements") },
      };
    } else if (!sansLimite && (niveau === "bloque" || niveau === "grace" || niveau === "bientot")) {
      etape = {
        ton: niveau === "bientot" ? "attention" : "alerte",
        texte: niveau === "bientot" ? "Proposez le renouvellement à la boutique." : "Renouvelez l'abonnement pour que la boutique continue de vendre.",
        action: { libelle: "🔄 Renouveler", onClick: () => aller("renouveler") },
      };
    } else {
      etape = { ton: "ok", texte: "Rien à faire : l'abonnement est à jour." };
    }

    const dernier = detail?.historique[0] ?? null;
    const cartes: { cle: string; titre: string; lignes: ReactNode[]; onClick?: () => void }[] = [
      {
        cle: "formule",
        titre: "📦 Formule",
        onClick: () => aller("renouveler"),
        lignes: [
          <strong key="f">{LIBELLES_FORMULE[boutique.formule] ?? boutique.formule}</strong>,
          <span key="d" className="sous-info">{FONCTIONNALITES_FORMULE[boutique.formule]?.[1] ?? ""}</span>,
        ],
      },
      {
        cle: "fin",
        titre: "📅 Fin de l'abonnement",
        lignes: [
          <strong key="f">{dateLongue(boutique.dateExpirationAbonnement)}</strong>,
          <span key="g" className="sous-info">délai de grâce de 3 jours ensuite</span>,
        ],
      },
      {
        cle: "paiements",
        titre: "📨 Paiements déclarés",
        onClick: () => aller("paiements"),
        lignes: [
          <strong key="n">{horsLigne ? "—" : enAttente.length ? `${enAttente.length} à vérifier` : "aucun en attente"}</strong>,
          <span key="d" className="sous-info">Mobile Money déclarés dans l'appli</span>,
        ],
      },
      {
        cle: "dernier",
        titre: "🧾 Dernier enregistrement",
        onClick: () => aller("historique"),
        lignes: dernier
          ? [
              <strong key="n">{dernier.nature_libelle}</strong>,
              <span key="d" className="sous-info">
                {dateCourte(dernier.date)} · {montant(dernier.montant)}
              </span>,
            ]
          : [<strong key="v">{horsLigne ? "—" : "aucun"}</strong>],
      },
      ...(masquerSynchro
        ? []
        : [
            {
              cle: "enligne",
              titre: "🌐 Envoi en ligne",
              lignes: [
                <strong key="s">{boutique.synchroAutorisee ? "Autorisé" : "🔒 100 % local"}</strong>,
                <span key="d" className="sous-info">réglable dans 🌐 Envoi en ligne</span>,
              ],
            },
          ]),
    ];

    return (
      <>
        <div className={`carte-etat-serveur carte-etat-serveur--${CLASSE_TON[ton]}`}>
          <div className="entete-vue-ensemble">
            <span className="icone-vue-ensemble">{icone}</span>
            <div>
              <strong className="etat-serveur-titre">{titre}</strong>
              <span className="sous-info ligne-detail-article">{sousTitre}</span>
            </div>
          </div>
          <button type="button" className="bouton-primaire" onClick={() => aller("renouveler")}>
            🔄 Renouveler
          </button>
        </div>
        <div className={`prochaine-etape prochaine-etape--${etape.ton}`}>
          <div>
            <span className="libelle-prochaine-etape">{etape.ton === "ok" ? "✓ État" : "👉 Prochaine étape"}</span>
            <p>{etape.texte}</p>
          </div>
          {etape.action && (
            <button type="button" className="bouton-primaire" onClick={etape.action.onClick}>
              {etape.action.libelle}
            </button>
          )}
        </div>
        {horsLigne && blocHorsLigne("L'historique et les paiements déclarés ne peuvent pas être lus. Renouveler reste possible : c'est appliqué sur ce poste et transmis au serveur au retour d'internet.")}
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
        <div className="grille-cartes-reseau">
          {(["essentiel", "pro"] as const).map((cle) => (
            <div key={cle} className={`carte-info-reseau${boutique.formule === cle ? " carte-formule-actuelle" : ""}`}>
              <span className="titre-carte-reseau">
                {LIBELLES_FORMULE[cle]}
                {boutique.formule === cle ? " · formule actuelle" : ""}
              </span>
              <ul className="liste-fonctionnalites-formule">
                {FONCTIONNALITES_FORMULE[cle].map((ligne) => (
                  <li key={ligne}>{ligne}</li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </>
    );
  }

  function contenu() {
    if (!boutique) return null;
    switch (rubrique) {
      case "renouveler":
        return (
          <>
            <h4 className="titre-rubrique-reseau">🔄 Renouveler l'abonnement</h4>
            <div className="etape-reseau">
              <span className="numero-etape-reseau">1</span>
              <div className="champ-etape-reseau">
                <strong>Formule</strong>
                <div className="choix-formule-abonnement">
                  {(["essentiel", "pro"] as const).map((cle) => (
                    <button
                      key={cle}
                      type="button"
                      className={`puce-nom-poste${formule === cle ? " choisi" : ""}`}
                      onClick={() => setFormule(cle)}
                    >
                      {LIBELLES_FORMULE[cle]}
                    </button>
                  ))}
                </div>
              </div>
            </div>
            <div className="etape-reseau">
              <span className="numero-etape-reseau">2</span>
              <div className="champ-etape-reseau">
                <strong>Durée</strong>
                <div className="grille-durees-abonnement">
                  {DUREES.map((mois) => {
                    const t = detail?.tarifs.find((x) => x.formule === formule && x.duree_mois === mois);
                    return (
                      <button
                        key={mois}
                        type="button"
                        className={`carte-duree-abonnement${duree === mois && !illimite ? " choisi" : ""}`}
                        onClick={() => choisirDuree(mois)}
                      >
                        <strong>+{mois} mois</strong>
                        <span className="sous-info">jusqu'au {dateCourte(ajouterMois(depart, mois).toISOString())}</span>
                        {t && <span className="prix-duree-abonnement">{montant(t.prix)}</span>}
                        {t && Number(t.remise) > 0 && <span className="sous-info">−{Number(t.remise)} %</span>}
                      </button>
                    );
                  })}
                </div>
                <span className="note-aide">
                  {finActuelle && finActuelle > new Date()
                    ? `Part de la fin actuelle (${dateCourte(finActuelle.toISOString())}) : les jours déjà payés ne sont pas perdus.`
                    : "Part d'aujourd'hui (l'abonnement est terminé)."}
                </span>
                <details className="details-abonnement">
                  <summary>Autre date, ou sans limite</summary>
                  <div className="champs-sauvegarde">
                    <label>
                      Date de fin choisie
                      <input
                        type="date"
                        value={dateManuelle}
                        onChange={(e) => {
                          setDateManuelle(e.target.value);
                          setDuree(null);
                          setIllimite(false);
                        }}
                      />
                    </label>
                    <label className="case-secours-sauvegarde">
                      <span>
                        <input
                          type="checkbox"
                          checked={illimite}
                          onChange={(e) => {
                            setIllimite(e.target.checked);
                            if (e.target.checked) setDuree(null);
                          }}
                        />{" "}
                        Sans limite (pas de date de fin)
                      </span>
                    </label>
                  </div>
                </details>
              </div>
            </div>
            <div className="etape-reseau">
              <span className="numero-etape-reseau">3</span>
              <div className="champ-etape-reseau champs-sauvegarde">
                <strong>Paiement</strong>
                <div className="choix-methode-restauration">
                  {(
                    [
                      ["paiement", "💵 Paiement reçu"],
                      ["offert", "🎁 Offert"],
                      ["ajustement", "✏️ Correction de date"],
                    ] as const
                  ).map(([cle, libelle]) => (
                    <label key={cle}>
                      <input type="radio" checked={nature === cle} onChange={() => setNature(cle)} /> {libelle}
                    </label>
                  ))}
                </div>
                {nature === "paiement" && (
                  <div className="grille-paiement-abonnement">
                    <label>
                      Montant reçu
                      <input type="number" min={0} step="any" value={montantSaisi} onChange={(e) => setMontantSaisi(e.target.value)} />
                      <span className="note-aide">
                        {tarif ? `Tarif : ${montant(tarif.prix)}` : detail ? "Pas de tarif saisi pour ce choix." : "Tarifs indisponibles sans connexion."}
                      </span>
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
                      Référence de la transaction
                      <input value={reference} onChange={(e) => setReference(e.target.value)} placeholder="ex. MP2410…" />
                    </label>
                  </div>
                )}
              </div>
            </div>
            <div className="prochaine-etape prochaine-etape--neutre">
              <div>
                <span className="libelle-prochaine-etape">Récapitulatif</span>
                <p>
                  {LIBELLES_FORMULE[formule]} {illimite ? "sans limite" : nouvelleFin ? `jusqu'au ${dateLongue(nouvelleFin.toISOString())}` : "— choisissez une durée"}
                  {nature === "paiement" ? ` · ${montant(montantSaisi)} reçus` : nature === "offert" ? " · offert" : " · correction"}
                </p>
              </div>
              <button type="button" className="bouton-primaire" disabled={enCours} onClick={renouveler}>
                {enCours ? "Enregistrement…" : "✅ Enregistrer"}
              </button>
            </div>
          </>
        );
      case "paiements":
        return (
          <>
            <h4 className="titre-rubrique-reseau">📨 Paiements déclarés par la boutique</h4>
            <p className="note-aide">
              La boutique envoie l'argent par Mobile Money puis déclare la référence dans l'appli. Vérifiez la référence
              sur votre téléphone, puis validez (la période est ajoutée) ou rejetez avec un motif.
            </p>
            {horsLigne ? (
              blocHorsLigne("Les paiements déclarés sont sur le serveur : reconnectez-vous pour les voir.")
            ) : (
              <div className="zone-tableau-scroll zone-appareils-reseau">
                <table className="tableau-catalogue tableau-appareils-reseau">
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Formule</th>
                      <th>Durée</th>
                      <th>Montant</th>
                      <th>Mode</th>
                      <th>Référence</th>
                      <th>Statut</th>
                      <th className="colonne-action-reseau">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(detail?.demandes ?? []).map((d) => (
                      <tr key={d.id ?? d.date}>
                        <td className="nowrap">{dateCourte(d.date)}</td>
                        <td>{LIBELLES_FORMULE[d.formule] ?? d.formule}</td>
                        <td>{d.duree_libelle}</td>
                        <td className="nowrap">{montant(d.montant)}</td>
                        <td>{d.mode_libelle}</td>
                        <td>
                          <code>{d.reference}</code>
                        </td>
                        <td>
                          <span
                            className={`pastille-etat-reseau${d.statut === "validee" ? " pastille-etat-reseau--relie" : ""}`}
                            title={d.motif_rejet || undefined}
                          >
                            {d.statut_libelle}
                          </span>
                        </td>
                        <td className="colonne-action-reseau">
                          {d.statut === "en_attente" && d.id ? (
                            aRejeter === d.id ? (
                              <span className="ligne-dossier-sauvegarde">
                                <input value={motif} onChange={(e) => setMotif(e.target.value)} placeholder="Motif du rejet" autoFocus />
                                <button type="button" className="bouton-danger" disabled={enCours} onClick={() => traiterDemande(d.id!, "rejeter")}>
                                  Rejeter
                                </button>
                                <button type="button" className="lien" onClick={() => setARejeter(null)}>
                                  Annuler
                                </button>
                              </span>
                            ) : (
                              <span className="actions-code-reseau">
                                <button type="button" className="bouton-primaire" disabled={enCours} onClick={() => traiterDemande(d.id!, "valider")}>
                                  Valider
                                </button>
                                <button type="button" className="lien lien-danger" onClick={() => setARejeter(d.id!)}>
                                  Rejeter
                                </button>
                              </span>
                            )
                          ) : (
                            <span className="sous-info">{d.motif_rejet || "—"}</span>
                          )}
                        </td>
                      </tr>
                    ))}
                    {(detail?.demandes.length ?? 0) === 0 && (
                      <tr>
                        <td colSpan={8} className="liste-vide">
                          Aucun paiement déclaré.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </>
        );
      case "historique":
        return (
          <>
            <h4 className="titre-rubrique-reseau">🧾 Historique de l'abonnement</h4>
            {horsLigne ? (
              blocHorsLigne("L'historique est sur le serveur : reconnectez-vous pour le voir.")
            ) : (
              <>
                <div className="zone-tableau-scroll zone-appareils-reseau">
                  <table className="tableau-catalogue tableau-appareils-reseau">
                    <thead>
                      <tr>
                        <th>Enregistré le</th>
                        <th>Nature</th>
                        <th>Formule</th>
                        <th>Période</th>
                        <th>Montant</th>
                        <th>Mode</th>
                        <th>Référence</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(detail?.historique ?? []).map((h, i) => (
                        <tr key={`${h.date}-${i}`}>
                          <td className="nowrap">{dateCourte(h.date)}</td>
                          <td>{h.nature_libelle}</td>
                          <td>{LIBELLES_FORMULE[h.formule] ?? h.formule}</td>
                          <td className="nowrap">
                            {dateCourte(h.date_debut)} → {dateCourte(h.date_fin)}
                          </td>
                          <td className="nowrap">{montant(h.montant)}</td>
                          <td>{h.mode_libelle || "—"}</td>
                          <td>{h.reference || "—"}</td>
                        </tr>
                      ))}
                      {(detail?.historique.length ?? 0) === 0 && (
                        <tr>
                          <td colSpan={7} className="liste-vide">
                            Aucun enregistrement.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
                <div className="totaux">
                  <div>
                    Total encaissé :{" "}
                    <strong>{montant((detail?.historique ?? []).reduce((t, h) => t + Number(h.montant || 0), 0))}</strong>
                  </div>
                </div>
              </>
            )}
          </>
        );
      case "code":
        return (
          <>
            <h4 className="titre-rubrique-reseau">🔑 Code d'activation hors ligne</h4>
            <p className="note-aide">
              Pour une boutique sans internet : le code reprend la formule et la date de fin <strong>actuelles</strong>{" "}
              (renouvelez d'abord, puis générez le code). La boutique le colle dans « Gérer l'abonnement → 🔑 Code
              d'activation » ; il se vérifie sans internet et ne marche que pour elle.
            </p>
            <div className="carte-info-reseau">
              <span className="titre-carte-reseau">Abonnement actuel</span>
              <strong>
                {LIBELLES_FORMULE[boutique.formule] ?? boutique.formule} · jusqu'au {dateLongue(boutique.dateExpirationAbonnement)}
              </strong>
            </div>
            {horsLigne ? (
              blocHorsLigne("Le code est signé par votre serveur : il faut une connexion pour le générer.")
            ) : (
              <div className="actions-formulaire">
                <button type="button" className="bouton-primaire" disabled={enCours || !boutique.dateExpirationAbonnement} onClick={genererCode}>
                  {enCours ? "Génération…" : "Générer le code"}
                </button>
              </div>
            )}
            {code && (
              <div className="carte-code-reseau">
                <code className="code-activation-genere">{code}</code>
                <div className="actions-code-reseau">
                  <button type="button" onClick={() => navigator.clipboard?.writeText(code)}>
                    📋 Copier
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      api.systeme.ouvrirExterne(
                        `https://wa.me/?text=${encodeURIComponent(`Code d'activation de « ${boutique.boutiqueNom} » (jusqu'au ${dateLongue(boutique.dateExpirationAbonnement)}) :\n${code}`)}`,
                      )
                    }
                  >
                    💬 Envoyer par WhatsApp
                  </button>
                </div>
              </div>
            )}
          </>
        );
      case "options":
        return (
          <>
            <h4 className="titre-rubrique-reseau">🧩 Options payantes</h4>
            <p className="note-aide">
              Pour la formule Essentiel : chaque option se prend à part (payée ou offerte), pour une durée, jusqu'à une date ou
              liée à l'abonnement. Toutes sont comprises dans Pro. L'envoi en ligne reste à allumer dans « 🌐 Envoi en ligne ».
            </p>
            {horsLigne || !detail?.options ? (
              blocHorsLigne("L'état des options est sur le serveur : reconnectez-vous pour le voir et le modifier.")
            ) : (
              <PanneauOptions
                options={detail.options}
                tarifs={detail.tarifs_options ?? []}
                enCours={enCours}
                onEnregistrer={enregistrerOption}
                onRetirer={retirerOption}
                onException={exceptionOption}
              />
            )}
          </>
        );
      case "essai": {
        const essai = etat?.essai ?? null;
        const finPayee = boutique.dateExpirationAbonnement;
        const apres = !finPayee
          ? `${LIBELLES_FORMULE[boutique.formule] ?? boutique.formule}, sans limite`
          : finEssai && Date.parse(finPayee) > finEssai.getTime()
            ? `${LIBELLES_FORMULE[boutique.formule] ?? boutique.formule} jusqu'au ${dateLongue(finPayee)}`
            : "abonnement à renouveler";
        return (
          <>
            <h4 className="titre-rubrique-reseau">🧪 Essai gratuit</h4>
            <p className="note-aide">
              L'essai commence aujourd'hui et passe devant l'abonnement payé, qui n'est pas touché : à la fin de l'essai,
              la boutique retrouve d'elle-même sa formule et sa date. Inscrit à l'historique comme « Essai gratuit ».
            </p>
            {essai && (
              <div className="prochaine-etape prochaine-etape--neutre">
                <div>
                  <span className="libelle-prochaine-etape">Essai en cours</span>
                  <p>{texteEssai(essai)}</p>
                </div>
                <button type="button" disabled={enCours} onClick={arreterEssai}>
                  ⏹ Arrêter l'essai
                </button>
              </div>
            )}
            <div className="etape-reseau">
              <span className="numero-etape-reseau">1</span>
              <div className="champ-etape-reseau">
                <strong>Formule de l'essai</strong>
                <div className="choix-formule-abonnement">
                  {(["essentiel", "pro"] as const).map((cle) => (
                    <button
                      key={cle}
                      type="button"
                      className={`puce-nom-poste${essaiFormule === cle ? " choisi" : ""}`}
                      onClick={() => setEssaiFormule(cle)}
                    >
                      {LIBELLES_FORMULE[cle]}
                    </button>
                  ))}
                </div>
              </div>
            </div>
            <div className="etape-reseau">
              <span className="numero-etape-reseau">2</span>
              <div className="champ-etape-reseau">
                <strong>Durée</strong>
                <div className="grille-durees-abonnement">
                  {DUREES_ESSAI.map((jours) => (
                    <button
                      key={jours}
                      type="button"
                      className={`carte-duree-abonnement${essaiJours === jours ? " choisi" : ""}`}
                      onClick={() => {
                        setEssaiJours(jours);
                        setEssaiJoursSaisis("");
                      }}
                    >
                      <strong>{jours} jours</strong>
                      <span className="sous-info">jusqu'au {dateCourte(finEssaiDans(jours).toISOString())}</span>
                    </button>
                  ))}
                </div>
                <label className="champs-sauvegarde">
                  Autre durée (en jours)
                  <input
                    type="number"
                    min={1}
                    step={1}
                    value={essaiJoursSaisis}
                    placeholder="ex. 45"
                    onChange={(e) => {
                      setEssaiJoursSaisis(e.target.value);
                      setEssaiJours(null);
                    }}
                  />
                </label>
              </div>
            </div>
            <div className="prochaine-etape prochaine-etape--neutre">
              <div>
                <span className="libelle-prochaine-etape">Récapitulatif</span>
                <p>
                  {finEssai
                    ? `Essai ${LIBELLES_FORMULE[essaiFormule]} du ${dateCourte(new Date().toISOString())} au ${dateLongue(finEssai.toISOString())}, puis ${apres}.`
                    : "Choisissez la durée de l'essai."}
                </p>
              </div>
              <button type="button" className="bouton-primaire" disabled={enCours || !finEssai} onClick={accorderEssai}>
                {essai ? "🧪 Remplacer l'essai" : "🧪 Accorder l'essai"}
              </button>
            </div>
          </>
        );
      }
      default:
        return vueEnsemble();
    }
  }

  return (
    <div className="fond-modale" onClick={onFermer}>
      <div className="modale-selection-produits modale-abonnement-admin" onClick={(e) => e.stopPropagation()}>
        <div className="modale-entete">
          <h3>💳 Gérer abonnement{boutique ? ` — ${boutique.boutiqueNom}` : ""}</h3>
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
                <div className={`role-reseau role-reseau--${etat?.niveau === "bloque" || etat?.niveau === "grace" ? "alerte" : "ok"}`}>
                  <span className="sous-info">Abonnement</span>
                  <strong>
                    {LIBELLES_FORMULE[boutique.formule] ?? boutique.formule} ·{" "}
                    {boutique.dateExpirationAbonnement ? dateCourte(boutique.dateExpirationAbonnement) : "sans limite"}
                  </strong>
                </div>
                {rubriques.map((r) => (
                  <button
                    key={r.cle}
                    type="button"
                    className={`item-nav-parametres${rubrique === r.cle ? " actif" : ""}`}
                    onClick={() => aller(r.cle)}
                  >
                    {r.label}
                    {r.compteur && <span className="compteur-nav-reseau">{r.compteur}</span>}
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
