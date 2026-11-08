import { useState } from "react";

/**
 * Options payantes d'une boutique (formule Essentiel ; comprises dans Pro), pour
 * l'administrateur : état de chaque option, l'enregistrer (payée ou offerte, pour
 * une durée, jusqu'à une date ou liée à l'abonnement), la retirer, ou l'accorder
 * sans paiement (exception). Les appels au serveur sont fournis par l'écran
 * (Gérer abonnement du bureau/web, fiche boutique du site).
 *
 * COPIE de partage/composants/PanneauOptions.tsx dans chaque appli (le fichier doit
 * rester identique : `node partage/verifier-copies.mjs`). Styles : partage/styles/admin.css.
 */

export type CleOption = "en_ligne" | "reseau" | "mobile";

export interface EtatOption {
  libelle: string;
  droit: boolean;
  source: "pro" | "payee" | "suit" | "exception" | null;
  /** Fin de l'option (ou de l'abonnement si elle le suit) ; null : sans limite. */
  fin: string | null;
  suit: boolean;
  exception: boolean;
}

export interface TarifOption {
  option: string;
  duree_mois: number;
  prix: string | number;
  remise: string | number;
}

/** Ce que l'admin enregistre : une durée (en mois, depuis la fin en cours), une date, ou liée à l'abonnement. */
export interface EnregistrementOption {
  cle: CleOption;
  nature: "paiement" | "offert";
  dureeMois: number | null;
  dateFin: string | null;
  suitAbonnement: boolean;
  montant: number;
  mode: string;
  reference: string;
}

const DUREES = [1, 3, 6, 12];
const ORDRE: CleOption[] = ["en_ligne", "reseau", "mobile"];
const MODES: [string, string][] = [
  ["wave", "Wave"],
  ["orange_money", "Orange Money"],
  ["mtn", "MTN Mobile Money"],
  ["moov", "Moov Money"],
  ["especes", "Espèces"],
  ["banque", "Banque"],
  ["autre", "Autre"],
];
const AIDE: Record<CleOption, string> = {
  en_ligne: "Données envoyées au serveur (sauvegarde en ligne, accès web). L'envoi reste à allumer, à la demande du commerçant.",
  reseau: "Poste principal et caisses reliés sans internet.",
  mobile: "Appli Android : carte de téléchargement dans les Réglages de la boutique.",
};

function dateCourte(iso: string | null | undefined): string {
  return iso ? new Date(iso).toLocaleDateString("fr-FR") : "";
}

function prixLisible(valeur: string | number): string {
  return `${Number(valeur).toLocaleString("fr-FR")} F`;
}

function libelleEtat(o: EtatOption): string {
  switch (o.source) {
    case "pro":
      return "✅ Comprise dans Pro";
    case "suit":
      return o.fin ? `✅ Liée à l'abonnement (jusqu'au ${dateCourte(o.fin)})` : "✅ Liée à l'abonnement";
    case "payee":
      return `✅ Prise jusqu'au ${dateCourte(o.fin)}`;
    case "exception":
      return "✅ Accordée sans paiement";
    default:
      return "🔒 Non prise";
  }
}

export default function PanneauOptions({
  options,
  tarifs,
  enCours,
  onEnregistrer,
  onRetirer,
  onException,
}: {
  options: Record<string, EtatOption>;
  tarifs: TarifOption[];
  enCours: boolean;
  onEnregistrer: (e: EnregistrementOption) => void | Promise<void>;
  onRetirer: (cle: CleOption) => void | Promise<void>;
  onException: (cle: CleOption, valeur: boolean) => void | Promise<void>;
}) {
  const [ouverte, setOuverte] = useState<CleOption | null>(null);
  const [nature, setNature] = useState<"paiement" | "offert">("paiement");
  const [duree, setDuree] = useState<number | null>(1);
  const [dateFin, setDateFin] = useState("");
  const [suit, setSuit] = useState(false);
  const [montant, setMontant] = useState("");
  const [mode, setMode] = useState("");
  const [reference, setReference] = useState("");
  const [aConfirmer, setAConfirmer] = useState<string | null>(null);

  const tarif = (cle: CleOption, mois: number) => tarifs.find((t) => t.option === cle && t.duree_mois === mois);

  function ouvrir(cle: CleOption) {
    setOuverte(ouverte === cle ? null : cle);
    setNature("paiement");
    setDuree(1);
    setDateFin("");
    setSuit(false);
    const t = tarif(cle, 1);
    setMontant(t ? String(Number(t.prix)) : "");
    setMode("");
    setReference("");
  }

  function choisirDuree(cle: CleOption, mois: number) {
    setDuree(mois);
    setSuit(false);
    setDateFin("");
    const t = tarif(cle, mois);
    if (t && nature === "paiement") setMontant(String(Number(t.prix)));
  }

  async function enregistrer(cle: CleOption) {
    await onEnregistrer({
      cle,
      nature,
      dureeMois: suit || dateFin ? null : duree,
      dateFin: suit ? null : dateFin || null,
      suitAbonnement: suit,
      montant: nature === "paiement" ? Number(montant) || 0 : 0,
      mode: nature === "paiement" ? mode : "",
      reference: nature === "paiement" ? reference.trim() : "",
    });
    setOuverte(null);
  }

  const pret = (suit || dateFin || duree) && (nature === "offert" || (Number(montant) > 0 && mode));

  return (
    <div className="panneau-options">
      {ORDRE.filter((cle) => options[cle]).map((cle) => {
        const o = options[cle];
        const prixMois = tarif(cle, 1)?.prix;
        return (
          <div key={cle} className={`carte-option-admin${o.droit ? " carte-option-admin--active" : ""}`}>
            <div className="entete-option-admin">
              <div className="textes-option-admin">
                <strong>{o.libelle}</strong>
                <span className={`badge-lp ${o.droit ? "badge-lp--actif" : ""}`}>{libelleEtat(o)}</span>
              </div>
              {prixMois !== undefined && <span className="prix-option-admin">{prixLisible(prixMois)} / mois</span>}
            </div>
            <p className="note-aide">
              {AIDE[cle]}
              {o.source === "pro" && " Rien à payer tant que la boutique est en Pro."}
            </p>
            <div className="actions-option-admin">
              <button type="button" className={ouverte === cle ? "" : "bouton-primaire"} disabled={enCours} onClick={() => ouvrir(cle)}>
                {ouverte === cle ? "Fermer" : o.source === "payee" || o.source === "suit" ? "🔄 Prolonger / changer" : "➕ Prendre l'option"}
              </button>
              {(o.source === "payee" || o.source === "suit" || (o.source === "pro" && (o.fin || o.suit))) &&
                (aConfirmer === `retirer-${cle}` ? (
                  <span className="actions-ligne-lp">
                    <button
                      type="button"
                      className="bouton-danger"
                      disabled={enCours}
                      onClick={async () => {
                        await onRetirer(cle);
                        setAConfirmer(null);
                      }}
                    >
                      Confirmer le retrait
                    </button>
                    <button type="button" className="lien" onClick={() => setAConfirmer(null)}>
                      Annuler
                    </button>
                  </span>
                ) : (
                  <button type="button" className="lien" onClick={() => setAConfirmer(`retirer-${cle}`)}>
                    ⛔ Retirer
                  </button>
                ))}
              <label className="case-exception-option">
                <input
                  type="checkbox"
                  checked={o.exception}
                  disabled={enCours}
                  onChange={(e) => onException(cle, e.target.checked)}
                />{" "}
                Accordée sans paiement (exception)
              </label>
            </div>
            {ouverte === cle && (
              <div className="formulaire-option-admin">
                <div className="choix-methode-restauration">
                  <label>
                    <input
                      type="radio"
                      checked={nature === "paiement"}
                      onChange={() => {
                        setNature("paiement");
                        const t = duree ? tarif(cle, duree) : undefined;
                        if (t) setMontant(String(Number(t.prix)));
                      }}
                    />{" "}
                    💵 Paiement reçu
                  </label>
                  <label>
                    <input type="radio" checked={nature === "offert"} onChange={() => setNature("offert")} /> 🎁 Offert
                  </label>
                </div>
                <div className="grille-durees-abonnement">
                  {DUREES.map((mois) => {
                    const t = tarif(cle, mois);
                    return (
                      <button
                        key={mois}
                        type="button"
                        className={`carte-duree-abonnement${!suit && !dateFin && duree === mois ? " choisi" : ""}`}
                        onClick={() => choisirDuree(cle, mois)}
                      >
                        <strong>+{mois} mois</strong>
                        {t && <span className="prix-duree-abonnement">{prixLisible(t.prix)}</span>}
                        {t && Number(t.remise) > 0 && <span className="sous-info">−{Number(t.remise)} %</span>}
                      </button>
                    );
                  })}
                  <button
                    type="button"
                    className={`carte-duree-abonnement${suit ? " choisi" : ""}`}
                    onClick={() => {
                      setSuit(true);
                      setDateFin("");
                    }}
                  >
                    <strong>🔗 Liée</strong>
                    <span className="sous-info">à l'abonnement</span>
                  </button>
                </div>
                <label className="champ-date-option">
                  Ou une date de fin précise
                  <input
                    type="date"
                    value={dateFin}
                    onChange={(e) => {
                      setDateFin(e.target.value);
                      setSuit(false);
                    }}
                  />
                </label>
                <span className="note-aide">
                  {suit
                    ? "Valable tant que l'abonnement payé l'est, et prolongée avec lui."
                    : dateFin
                      ? `Jusqu'au ${dateCourte(`${dateFin}T12:00:00`)}.`
                      : o.source === "payee" && o.fin && new Date(o.fin) > new Date()
                        ? `S'ajoute à la fin actuelle (${dateCourte(o.fin)}).`
                        : "À partir d'aujourd'hui."}
                </span>
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
                        {MODES.map(([cleMode, libelle]) => (
                          <option key={cleMode} value={cleMode}>
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
                <div className="actions-formulaire">
                  <button type="button" className="bouton-primaire" disabled={enCours || !pret} onClick={() => enregistrer(cle)}>
                    {enCours ? "Enregistrement…" : `✅ Enregistrer ${o.libelle}`}
                  </button>
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
