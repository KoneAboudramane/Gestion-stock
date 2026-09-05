import { useEffect, useState } from "react";

import { api } from "./api";
import type { Session } from "./api";
import MiseAJourDisponible from "./components/MiseAJourDisponible";
import { DeviseProvider } from "./contexts/DeviseContext";
import { useSession } from "./contexts/SessionContext";
import { SynchroProvider } from "./contexts/SynchroContext";
import AccesCreationBoutique from "./pages/AccesCreationBoutique";
import Connexion from "./pages/Connexion";
import Shell from "./pages/Shell";

type Ecran = "chargement" | "connexion" | "accesCreation" | "shell";

export default function App() {
  const { session, definirSession } = useSession();
  const [ecran, setEcran] = useState<Ecran>("chargement");

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
    setEcran("connexion");
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
        <SynchroProvider session={session!}>
          <Shell session={session!} onDeconnexion={surDeconnexion} />
        </SynchroProvider>
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
