import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

import { api } from "../api";

// Adapté de client-electron/src/contexts/DeviseContext.tsx : même rôle, mais lit
// /api/boutique/ directement (Django) au lieu du SQLite local — inexistant ici.
const DeviseContext = createContext<{ devise: string; rafraichirDevise: () => void }>({
  devise: "FCFA",
  rafraichirDevise: () => {},
});

export function DeviseProvider({ children }: { children: ReactNode }) {
  const [devise, setDevise] = useState("FCFA");

  function rafraichir() {
    api.reglages.obtenirBoutique().then((resultat) => {
      if (resultat.succes) setDevise(resultat.resultat.devise);
    });
  }

  useEffect(rafraichir, []);

  return <DeviseContext.Provider value={{ devise, rafraichirDevise: rafraichir }}>{children}</DeviseContext.Provider>;
}

export function useDevise(): string {
  return useContext(DeviseContext).devise;
}

/** Appelé après modification de la devise dans Réglages pour rafraîchir l'affichage partout (totaux, factures...). */
export function useRafraichirDevise(): () => void {
  return useContext(DeviseContext).rafraichirDevise;
}
