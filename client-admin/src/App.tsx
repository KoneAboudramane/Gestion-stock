import { useCallback, useEffect, useState } from "react";

import { aDesJetons, chargerMoi, deconnexion, ErreurApi, type Moi, quandSessionTerminee } from "./api";
import Coquille from "./composants/Coquille";
import Connexion from "./pages/Connexion";
import { appliquerThemeDuCompte } from "./theme";

type Etat = { phase: "chargement" } | { phase: "deconnecte"; message?: string } | { phase: "connecte"; moi: Moi };

export default function App() {
  const [etat, setEtat] = useState<Etat>(aDesJetons() ? { phase: "chargement" } : { phase: "deconnecte" });

  const chargerProfil = useCallback(async () => {
    try {
      const moi = await chargerMoi();
      appliquerThemeDuCompte(moi.theme);
      setEtat({ phase: "connecte", moi });
    } catch (erreur) {
      // Une fin de session passe déjà par quandSessionTerminee ; le reste (serveur injoignable…) est affiché ici.
      if (!(erreur instanceof ErreurApi && erreur.statut === 401)) {
        setEtat({ phase: "deconnecte", message: (erreur as Error).message });
      }
    }
  }, []);

  useEffect(() => {
    quandSessionTerminee((message) => setEtat({ phase: "deconnecte", message }));
    if (aDesJetons()) void chargerProfil();
  }, [chargerProfil]);

  if (etat.phase === "chargement") return <div className="ecran-chargement">Chargement…</div>;
  if (etat.phase === "deconnecte") return <Connexion message={etat.message} surConnecte={chargerProfil} />;
  return (
    <Coquille
      moi={etat.moi}
      surProfilChange={chargerProfil}
      surDeconnexion={async () => {
        await deconnexion();
        setEtat({ phase: "deconnecte" });
      }}
    />
  );
}
