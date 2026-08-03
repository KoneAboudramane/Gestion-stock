import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

import { api } from "../api/client";
import type { Session } from "../api/client";

// Boutique.devise (Réglages > Informations boutique) est modifiable à tout moment
// sans reconnexion — contrairement à boutiqueNom/role, elle ne transite pas
// par le JWT. Ce contexte la charge une fois et permet à Réglages de la
// republier immédiatement partout après enregistrement.
const DeviseContext = createContext<{ devise: string; rafraichirDevise: () => void }>({
  devise: "FCFA",
  rafraichirDevise: () => {},
});

export function DeviseProvider({ session, children }: { session: Session; children: ReactNode }) {
  const [devise, setDevise] = useState("FCFA");

  function rafraichir() {
    api.reglages.obtenirBoutique(session.boutiqueId).then((b) => {
      if (b) setDevise(b.devise);
    });
  }

  useEffect(rafraichir, [session.boutiqueId]);

  return <DeviseContext.Provider value={{ devise, rafraichirDevise: rafraichir }}>{children}</DeviseContext.Provider>;
}

export function useDevise(): string {
  return useContext(DeviseContext).devise;
}

export function useRafraichirDevise(): () => void {
  return useContext(DeviseContext).rafraichirDevise;
}
