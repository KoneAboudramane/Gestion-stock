import { useCallback, useEffect, useState } from "react";

/** Charge une donnée au montage (et à chaque changement de `cle`), avec erreur et rechargement. */
export function useChargement<T>(charger: () => Promise<T>, cle: unknown[] = []) {
  const [donnees, setDonnees] = useState<T | null>(null);
  const [erreur, setErreur] = useState("");
  const [enCours, setEnCours] = useState(true);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const recharger = useCallback(async () => {
    setEnCours(true);
    setErreur("");
    try {
      setDonnees(await charger());
    } catch (e) {
      setErreur((e as Error).message);
    } finally {
      setEnCours(false);
    }
  }, cle);

  useEffect(() => {
    void recharger();
  }, [recharger]);

  return { donnees, setDonnees, erreur, enCours, recharger };
}
