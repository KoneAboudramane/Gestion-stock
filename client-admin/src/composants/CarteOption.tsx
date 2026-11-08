import { useState, type ReactNode } from "react";

/**
 * Carte d'une option des écrans d'administration : icône, titre, badge d'état,
 * grand interrupteur ON/OFF. Avec `confirmation`, un clic sur l'interrupteur
 * affiche d'abord ce texte et « Confirmer / Annuler » ; sans, il bascule tout de
 * suite (formulaire non encore enregistré, ex. « Créer une boutique »).
 *
 * COPIE de partage/composants/CarteOption.tsx dans chaque appli (le fichier doit
 * rester identique : `node partage/verifier-copies.mjs`). Styles : partage/styles/admin.css.
 */
export default function CarteOption({
  icone,
  titre,
  actif,
  libelleOui,
  libelleNon,
  detail,
  onBasculer,
  confirmation,
  dangereuxSiActif = false,
  enCours = false,
  onDetail,
}: {
  icone: string;
  titre: string;
  actif: boolean;
  libelleOui: string;
  libelleNon: string;
  detail?: ReactNode;
  /** Reçoit la nouvelle valeur. Peut être asynchrone (la carte se referme ensuite). */
  onBasculer: (valeur: boolean) => void | Promise<void>;
  /** Texte à confirmer avant de basculer (reçoit la valeur visée). */
  confirmation?: (valeur: boolean) => string;
  /** Bouton « Confirmer » rouge quand on désactive (ex. réseau). */
  dangereuxSiActif?: boolean;
  enCours?: boolean;
  onDetail?: () => void;
}) {
  const [aConfirmer, setAConfirmer] = useState(false);

  async function valider() {
    await onBasculer(!actif);
    setAConfirmer(false);
  }

  return (
    <div className={`carte-option-admin${actif ? " carte-option-admin--active" : ""}`}>
      <div className="entete-option-admin">
        <span className="icone-option-admin">{icone}</span>
        <div className="textes-option-admin">
          <strong>{titre}</strong>
          <span className={`badge-lp ${actif ? "badge-lp--actif" : ""}`}>{actif ? `✅ ${libelleOui}` : `🔒 ${libelleNon}`}</span>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={actif}
          aria-label={titre}
          className={`interrupteur-option${actif ? " interrupteur-option--actif" : ""}`}
          disabled={enCours}
          onClick={() => (confirmation ? setAConfirmer(!aConfirmer) : onBasculer(!actif))}
        >
          <span className="curseur-interrupteur-option" />
        </button>
      </div>
      {detail && <p className="note-aide">{detail}</p>}
      {confirmation && aConfirmer && (
        <div className="confirmation-option-admin">
          <p>{confirmation(!actif)}</p>
          <div className="actions-formulaire">
            <button
              type="button"
              className={actif && dangereuxSiActif ? "bouton-danger" : "bouton-primaire"}
              disabled={enCours}
              onClick={valider}
            >
              {enCours ? "Enregistrement…" : "Confirmer"}
            </button>
            <button type="button" className="lien" onClick={() => setAConfirmer(false)}>
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
