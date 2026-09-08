import { useEffect, useState } from "react";

import { api } from "./api";
import type { Session } from "./api";
import EcranVerrouillage from "./components/EcranVerrouillage";
import MiseAJourDisponible from "./components/MiseAJourDisponible";
import { DeviseProvider } from "./contexts/DeviseContext";
import { useSession } from "./contexts/SessionContext";
import { SynchroProvider } from "./contexts/SynchroContext";
import { useDelaiVerrouillage, VerrouillageProvider } from "./contexts/VerrouillageContext";
import { useInactivite } from "./hooks/useInactivite";
import AccesCreationBoutique from "./pages/AccesCreationBoutique";
import Connexion from "./pages/Connexion";
import Shell from "./pages/Shell";

type Ecran = "chargement" | "connexion" | "accesCreation" | "shell";

/** Ne rend rien : arme juste le minuteur d'inactivité pour verrouiller Shell (voir contexts/VerrouillageContext.tsx). */
function GestionnaireInactivite({ actif, onInactif }: { actif: boolean; onInactif: () => void }) {
  const delaiMinutes = useDelaiVerrouillage();
  useInactivite(delaiMinutes > 0 ? delaiMinutes * 60_000 : 0, actif, onInactif);
  return null;
}

export default function App() {
  const { session, definirSession } = useSession();
  const [ecran, setEcran] = useState<Ecran>("chargement");
  const [verrouille, setVerrouille] = useState(false);

  useEffect(() => {
    if (!session) {
      setEcran("connexion");
      return;
    }
    // Une session restaurée depuis localStorage peut être périmée (mot de passe
    // changé ailleurs, jeton de rafraîchissement expiré) : on la vérifie avant de
    // lui faire confiance — mais seulement si un réseau est disponible. Hors-ligne
    // au démarrage (ou serveur injoignable), on fait confiance à la session en
    // cache, comme le client Electron avec son repli identifiants-locaux.json.
    if (!navigator.onLine) {
      setEcran("shell");
      return;
    }
    // Profite du même appel pour rafraîchir rôle/permissions/dépôt (figés
    // dans le JWT depuis la dernière connexion) : un changement de
    // permission côté serveur s'applique ainsi sans déconnexion/reconnexion.
    api.auth
      .rafraichirPermissions(session)
      .then((sessionMiseAJour) => {
        if (sessionMiseAJour) {
          definirSession(sessionMiseAJour);
          setEcran("shell");
        } else {
          definirSession(null);
          setEcran("connexion");
        }
      })
      .catch(() => setEcran("shell"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function surConnecte(s: Session) {
    definirSession(s);
    setEcran("shell");
  }

  function surDeconnexion() {
    definirSession(null);
    setVerrouille(false);
    setEcran("connexion");
  }

  function surDeverrouille(s: Session) {
    definirSession(s);
    setVerrouille(false);
  }

  let contenu;
  if (ecran === "chargement") {
    contenu = <div className="ecran-chargement">Chargement…</div>;
  } else if (ecran === "connexion") {
    contenu = <Connexion onConnecte={surConnecte} allerAccesCreation={() => setEcran("accesCreation")} />;
  } else if (ecran === "accesCreation") {
    contenu = <AccesCreationBoutique allerConnexion={() => setEcran("connexion")} />;
  } else {
    contenu = (
      <DeviseProvider boutiqueId={session!.boutiqueId}>
        <VerrouillageProvider boutiqueId={session!.boutiqueId}>
          <SynchroProvider session={session!}>
            <GestionnaireInactivite actif={!verrouille} onInactif={() => setVerrouille(true)} />
            <Shell session={session!} onDeconnexion={surDeconnexion} onVerrouiller={() => setVerrouille(true)} />
            {verrouille && (
              <EcranVerrouillage session={session!} onDeverrouille={surDeverrouille} onDeconnexion={surDeconnexion} />
            )}
          </SynchroProvider>
        </VerrouillageProvider>
      </DeviseProvider>
    );
  }

  return (
    <>
      <MiseAJourDisponible />
      {contenu}
    </>
  );
}
