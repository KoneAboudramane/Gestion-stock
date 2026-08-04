import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

import { api } from "../api/client";
import type { Session } from "../api/client";

// Boutique.nom (Réglages > Informations boutique) est modifiable à tout moment
// sans reconnexion — session.boutiqueNom vient du JWT et reste figé à sa valeur
// de connexion. Même principe que DeviseContext : chargé une fois, republié
// partout après enregistrement depuis Réglages > Informations boutique.
const NomBoutiqueContext = createContext<{ nomBoutique: string; rafraichirNomBoutique: () => void }>({
  nomBoutique: "",
  rafraichirNomBoutique: () => {},
});

export function NomBoutiqueProvider({ session, children }: { session: Session; children: ReactNode }) {
  const [nomBoutique, setNomBoutique] = useState(session.boutiqueNom);

  function rafraichir() {
    api.reglages.obtenirBoutique(session.boutiqueId).then((b) => {
      if (b) setNomBoutique(b.nom);
    });
  }

  useEffect(rafraichir, [session.boutiqueId]);

  return (
    <NomBoutiqueContext.Provider value={{ nomBoutique, rafraichirNomBoutique: rafraichir }}>
      {children}
    </NomBoutiqueContext.Provider>
  );
}

export function useNomBoutique(): string {
  return useContext(NomBoutiqueContext).nomBoutique;
}

export function useRafraichirNomBoutique(): () => void {
  return useContext(NomBoutiqueContext).rafraichirNomBoutique;
}
