import type { ReactNode } from "react";

import type { RubriqueBarre } from "./BarreRubriques";

/**
 * Rubriques d'une PAGE du site en onglets, en haut (plus de place que la barre
 * de gauche des modales) : Créer une boutique, Comptes, Laissez-passer,
 * Paiements. Même props que BarreRubriques, pour passer de l'une à l'autre ;
 * l'encadré d'état devient un résumé discret à droite des onglets.
 */
export default function OngletsRubriques<C extends string>({
  etiquette,
  etat,
  details,
  ton = "ok",
  rubriques,
  active,
  onChoisir,
}: {
  etiquette: string;
  etat: ReactNode;
  details?: ReactNode[];
  ton?: "ok" | "alerte";
  rubriques: RubriqueBarre<C>[];
  active: C | null;
  onChoisir: (cle: C) => void;
}) {
  const resume = [etat, ...(details ?? [])].filter(Boolean);
  return (
    <div className="barre-onglets-page">
      <div className="onglets" role="tablist">
        {rubriques.map((r) => (
          <button
            key={r.cle}
            type="button"
            role="tab"
            aria-selected={active === r.cle}
            className={`onglet${active === r.cle ? " actif" : ""}`}
            onClick={() => onChoisir(r.cle)}
          >
            {r.label}
            {r.compteur !== undefined && r.compteur !== "" && r.compteur !== 0 && (
              <span className="compteur-nav-reseau">{r.compteur}</span>
            )}
          </button>
        ))}
      </div>
      <p className={`resume-onglets resume-onglets--${ton}`}>
        <span className="sous-info">{etiquette}</span>
        {resume.map((d, i) => (
          <span key={i}>{d}</span>
        ))}
      </p>
    </div>
  );
}
