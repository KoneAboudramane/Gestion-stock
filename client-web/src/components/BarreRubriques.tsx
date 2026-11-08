import type { ReactNode } from "react";

export interface RubriqueBarre<C extends string> {
  cle: C;
  label: ReactNode;
  /** Pastille de nombre (ex. demandes en attente). */
  compteur?: string | number;
}

/**
 * Barre de gauche des écrans d'administration : un encadré d'état en haut, puis
 * une rubrique par bouton. Même allure partout (Gérer abonnement, Options,
 * Réseau, Laissez-passer, Mots de passe, Créer une boutique, fiche boutique du site).
 *
 * COPIE de partage/composants/BarreRubriques.tsx dans chaque appli (le fichier
 * doit rester identique : `node partage/verifier-copies.mjs`). Styles : admin-base.css.
 */
export default function BarreRubriques<C extends string>({
  etiquette,
  etat,
  details,
  ton = "ok",
  rubriques,
  active,
  onChoisir,
}: {
  /** Petit libellé de l'encadré (ex. « Réseau »). */
  etiquette: string;
  /** Valeur principale de l'encadré (ex. « ✅ activé »). */
  etat: ReactNode;
  details?: ReactNode[];
  ton?: "ok" | "alerte";
  rubriques: RubriqueBarre<C>[];
  /** Rubrique en surbrillance (null : aucune, ex. écran de résultat). */
  active: C | null;
  onChoisir: (cle: C) => void;
}) {
  return (
    <nav className="barre-laterale-parametres barre-laterale-reseau">
      <div className={`role-reseau role-reseau--${ton}`}>
        <span className="sous-info">{etiquette}</span>
        <strong>{etat}</strong>
        {details?.filter(Boolean).map((d, i) => (
          <span key={i} className="sous-info">
            {d}
          </span>
        ))}
      </div>
      {rubriques.map((r) => (
        <button
          key={r.cle}
          type="button"
          className={`item-nav-parametres${active === r.cle ? " actif" : ""}`}
          onClick={() => onChoisir(r.cle)}
        >
          {r.label}
          {r.compteur !== undefined && r.compteur !== "" && r.compteur !== 0 && (
            <span className="compteur-nav-reseau">{r.compteur}</span>
          )}
        </button>
      ))}
    </nav>
  );
}
