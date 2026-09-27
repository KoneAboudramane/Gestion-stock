import { useEffect, useState } from "react";

import { api } from "../api/client";

/** Doit rester identique à electron/services/stock.ts::CLE_PARAMETRE_FABRICATION_PROPRE. */
export const CLE_PARAMETRE_FABRICATION_PROPRE = "fabrication_propre";

/**
 * Réglage boutique "fabrication propre" (Réglages → Informations boutique) :
 * affiche ou masque les entrées de stock hors Achats (ajout depuis la fiche
 * produit, entrée manuelle, entrée de production). Le service refuse de toute
 * façon ces opérations si le réglage est désactivé — ce hook ne sert qu'à ne
 * pas proposer des boutons qui échoueraient. null tant que non chargé.
 */
export function useFabricationPropre(boutiqueId: string): boolean | null {
  const [active, setActive] = useState<boolean | null>(null);
  useEffect(() => {
    api.reglages
      .listerParametres(boutiqueId)
      .then((parametres) =>
        setActive(parametres.some((p) => p.cle === CLE_PARAMETRE_FABRICATION_PROPRE && p.valeur === "1")),
      );
  }, [boutiqueId]);
  return active;
}
