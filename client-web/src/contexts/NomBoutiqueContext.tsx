import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

import { obtenirBoutique } from "../services/boutique";

// Port de client-electron/src/contexts/NomBoutiqueContext.tsx : le nom de la
// boutique est modifiable à tout moment sans reconnexion (session.boutiqueNom
// reste figé à sa valeur de connexion) ; republié partout après enregistrement.
const NomBoutiqueContext = createContext<{ nomBoutique: string; rafraichirNomBoutique: () => void }>({
  nomBoutique: "",
  rafraichirNomBoutique: () => {},
});

export function NomBoutiqueProvider({
  boutiqueId,
  nomInitial,
  children,
}: {
  boutiqueId: string;
  nomInitial: string;
  children: ReactNode;
}) {
  const [nomBoutique, setNomBoutique] = useState(nomInitial);

  function rafraichir() {
    obtenirBoutique(boutiqueId).then((b) => {
      if (b) setNomBoutique(b.nom);
    });
  }

  useEffect(rafraichir, [boutiqueId]);

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
