import { useEffect, useState } from "react";

import { CLE_PARAMETRE_FABRICATION_PROPRE, fabricationPropreActive } from "../services/stock";

export { CLE_PARAMETRE_FABRICATION_PROPRE };

/**
 * Réglage boutique "fabrication propre" (Réglages → Informations boutique) :
 * affiche ou masque les entrées de stock hors Achats (ajout depuis la fiche
 * produit, entrée manuelle, entrée de production). Le service refuse de toute
 * façon ces opérations si le réglage est désactivé — ce hook ne sert qu'à ne
 * pas proposer des boutons qui échoueraient. null tant que non chargé.
 * Port de client-electron/src/hooks/useFabricationPropre.ts.
 */
export function useFabricationPropre(boutiqueId: string): boolean | null {
  const [active, setActive] = useState<boolean | null>(null);
  useEffect(() => {
    fabricationPropreActive(boutiqueId).then(setActive);
  }, [boutiqueId]);
  return active;
}
