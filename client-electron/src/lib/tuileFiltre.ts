import type { HTMLAttributes } from "react";

/**
 * Carte de statistique (.tuile-fiche) qui filtre le tableau de sa fenêtre — même
 * geste partout : un clic applique le filtre, un second clic le retire ; la carte
 * active est mise en évidence. S'étale sur la carte existante :
 *   <div {...tuileFiltre(filtre === "retard", () => basculer("retard"))}>…</div>
 */
export function tuileFiltre(
  actif: boolean,
  basculer: () => void,
  autresClasses = "",
): HTMLAttributes<HTMLDivElement> {
  return {
    className: ["tuile-fiche", "tuile-filtre", actif ? "tuile-filtre--active" : "", autresClasses].filter(Boolean).join(" "),
    role: "button",
    tabIndex: 0,
    "aria-pressed": actif,
    title: actif ? "Cliquer pour retirer ce filtre" : "Cliquer pour filtrer le tableau",
    onClick: basculer,
    onKeyDown: (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        basculer();
      }
    },
  };
}

/** Bascule d'un filtre de carte : le même clic l'applique ou le retire. */
export function basculerFiltre<T>(setFiltre: (f: (actuel: T | null) => T | null) => void, valeur: T): void {
  setFiltre((actuel) => (actuel === valeur ? null : valeur));
}
