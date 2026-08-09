import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

import { obtenirBoutique } from "../services/boutique";

// Port de client-electron/src/contexts/DeviseContext.tsx : même rôle, local
// d'abord (IndexedDB, voir services/boutique.ts) pour rester lisible hors-ligne.
const DeviseContext = createContext<{ devise: string; rafraichirDevise: () => void }>({
  devise: "FCFA",
  rafraichirDevise: () => {},
});

export function DeviseProvider({ boutiqueId, children }: { boutiqueId: string; children: ReactNode }) {
  const [devise, setDevise] = useState("FCFA");

  function rafraichir() {
    obtenirBoutique(boutiqueId).then((boutique) => {
      if (boutique) setDevise(boutique.devise);
    });
  }

  useEffect(rafraichir, [boutiqueId]);

  return <DeviseContext.Provider value={{ devise, rafraichirDevise: rafraichir }}>{children}</DeviseContext.Provider>;
}

export function useDevise(): string {
  return useContext(DeviseContext).devise;
}

/** Appelé après modification de la devise dans Réglages pour rafraîchir l'affichage partout (totaux, factures...). */
export function useRafraichirDevise(): () => void {
  return useContext(DeviseContext).rafraichirDevise;
}
