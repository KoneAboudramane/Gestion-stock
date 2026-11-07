import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

import { obtenirLogoBoutique } from "../services/boutique";

// Port de client-electron/src/contexts/LogoContext.tsx : logo gardé sur
// l'appareil (jamais synchronisé), republié partout après enregistrement depuis
// Réglages > Informations boutique.
const LogoContext = createContext<{ logo: string; rafraichirLogo: () => void }>({
  logo: "",
  rafraichirLogo: () => {},
});

export function LogoProvider({ boutiqueId, children }: { boutiqueId: string; children: ReactNode }) {
  const [logo, setLogo] = useState("");

  function rafraichir() {
    setLogo(obtenirLogoBoutique(boutiqueId));
  }

  useEffect(rafraichir, [boutiqueId]);

  return <LogoContext.Provider value={{ logo, rafraichirLogo: rafraichir }}>{children}</LogoContext.Provider>;
}

export function useLogoBoutique(): string {
  return useContext(LogoContext).logo;
}

export function useRafraichirLogoBoutique(): () => void {
  return useContext(LogoContext).rafraichirLogo;
}
