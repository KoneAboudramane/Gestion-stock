import { useEffect, useRef } from "react";

/**
 * Écran de verrouillage automatique : voir contexts/VerrouillageContext.tsx
 * (délai) et components/EcranVerrouillage.tsx (écran affiché à l'expiration).
 */
const EVENEMENTS_ACTIVITE = ["mousemove", "mousedown", "keydown", "touchstart", "scroll", "wheel"] as const;

export function useInactivite(delaiMs: number, actif: boolean, onInactif: () => void): void {
  const minuteur = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Réf plutôt que dépendance d'effet : onInactif est recréée à chaque rendu
  // de l'appelant, ne doit pas réarmer les écouteurs ni perdre le décompte en cours.
  const callbackRef = useRef(onInactif);
  callbackRef.current = onInactif;

  useEffect(() => {
    if (!actif || delaiMs <= 0) return;

    function reinitialiser() {
      if (minuteur.current) clearTimeout(minuteur.current);
      minuteur.current = setTimeout(() => callbackRef.current(), delaiMs);
    }

    reinitialiser();
    EVENEMENTS_ACTIVITE.forEach((e) => window.addEventListener(e, reinitialiser, { passive: true }));
    return () => {
      if (minuteur.current) clearTimeout(minuteur.current);
      EVENEMENTS_ACTIVITE.forEach((e) => window.removeEventListener(e, reinitialiser));
    };
  }, [actif, delaiMs]);
}
