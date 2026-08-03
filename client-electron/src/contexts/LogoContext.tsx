import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

import { api } from "../api/client";
import type { Session } from "../api/client";

// Logo boutique : local uniquement (jamais synchronisé, cf. electron/db/schema.ts).
// Même principe que DeviseContext — chargé une fois, republié partout après
// enregistrement depuis Réglages > Informations boutique.
const LogoContext = createContext<{ logo: string; rafraichirLogo: () => void }>({
  logo: "",
  rafraichirLogo: () => {},
});

export function LogoProvider({ session, children }: { session: Session; children: ReactNode }) {
  const [logo, setLogo] = useState("");

  function rafraichir() {
    api.reglages.obtenirLogoBoutique(session.boutiqueId).then(setLogo);
  }

  useEffect(rafraichir, [session.boutiqueId]);

  return <LogoContext.Provider value={{ logo, rafraichirLogo: rafraichir }}>{children}</LogoContext.Provider>;
}

export function useLogoBoutique(): string {
  return useContext(LogoContext).logo;
}

export function useRafraichirLogoBoutique(): () => void {
  return useContext(LogoContext).rafraichirLogo;
}
