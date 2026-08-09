import { useEffect, useState } from "react";

import { api } from "./api";
import type { Session } from "./api";
import { DeviseProvider } from "./contexts/DeviseContext";
import { useSession } from "./contexts/SessionContext";
import Connexion from "./pages/Connexion";
import MotDePasseOublie from "./pages/MotDePasseOublie";
import Shell from "./pages/Shell";

type Ecran = "chargement" | "connexion" | "motDePasseOublie" | "shell";

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
    api.auth
      .sessionValide()
      .then((valide) => {
        if (valide) {
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

  if (ecran === "chargement") {
    return <div className="ecran-chargement">Chargement…</div>;
  }
  if (ecran === "connexion") {
    return <Connexion onConnecte={surConnecte} allerMotDePasseOublie={() => setEcran("motDePasseOublie")} />;
  }
  if (ecran === "motDePasseOublie") {
    return <MotDePasseOublie allerConnexion={() => setEcran("connexion")} />;
  }
  return (
    <DeviseProvider>
      <Shell session={session!} onDeconnexion={surDeconnexion} />
    </DeviseProvider>
  );
}
