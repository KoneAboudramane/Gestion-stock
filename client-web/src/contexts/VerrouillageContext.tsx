import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

import { listerParametres } from "../services/configuration";

// Délai avant verrouillage automatique (configuration.Parametre, cle
// "delai_verrouillage_minutes") : réglé par le Patron dans Réglages >
// Paramètres > Général (voir Reglages.tsx). 0 = jamais.
export const DELAI_VERROUILLAGE_PAR_DEFAUT = 5;
export const CLE_PARAMETRE_DELAI_VERROUILLAGE = "delai_verrouillage_minutes";

const VerrouillageContext = createContext<{ delaiMinutes: number; rafraichirDelaiVerrouillage: () => void }>({
  delaiMinutes: DELAI_VERROUILLAGE_PAR_DEFAUT,
  rafraichirDelaiVerrouillage: () => {},
});

export function VerrouillageProvider({ boutiqueId, children }: { boutiqueId: string; children: ReactNode }) {
  const [delaiMinutes, setDelaiMinutes] = useState(DELAI_VERROUILLAGE_PAR_DEFAUT);

  function rafraichir() {
    listerParametres(boutiqueId).then((parametres) => {
      const brut = parametres.find((p) => p.cle === CLE_PARAMETRE_DELAI_VERROUILLAGE)?.valeur;
      const nombre = brut !== undefined ? Number(brut) : DELAI_VERROUILLAGE_PAR_DEFAUT;
      setDelaiMinutes(Number.isFinite(nombre) && nombre >= 0 ? nombre : DELAI_VERROUILLAGE_PAR_DEFAUT);
    });
  }

  useEffect(rafraichir, [boutiqueId]);

  return (
    <VerrouillageContext.Provider value={{ delaiMinutes, rafraichirDelaiVerrouillage: rafraichir }}>
      {children}
    </VerrouillageContext.Provider>
  );
}

export function useDelaiVerrouillage(): number {
  return useContext(VerrouillageContext).delaiMinutes;
}

/** Appelé après modification du délai dans Réglages pour l'appliquer immédiatement, sans redémarrage. */
export function useRafraichirDelaiVerrouillage(): () => void {
  return useContext(VerrouillageContext).rafraichirDelaiVerrouillage;
}
