import { useEffect, useState } from "react";

import { api } from "./api/client";
import type { Session } from "./api/client";
import { DeviseProvider } from "./contexts/DeviseContext";
import { LogoProvider } from "./contexts/LogoContext";
import { NomBoutiqueProvider } from "./contexts/NomBoutiqueContext";
import Connexion from "./pages/Connexion";
import Inscription from "./pages/Inscription";
import MotDePasseOublie from "./pages/MotDePasseOublie";
import Shell from "./pages/Shell";

type Ecran = "chargement" | "connexion" | "inscription" | "motDePasseOublie" | "shell";

export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [ecran, setEcran] = useState<Ecran>("chargement");

  useEffect(() => {
    api.auth.session().then((s) => {
      setSession(s);
      setEcran(s ? "shell" : "connexion");
      // Rôle/permissions/dépôt sont figés dans le JWT depuis la dernière
      // connexion : on les rafraîchit en tâche de fond (sans bloquer l'écran
      // de chargement) pour qu'un changement de permission côté serveur
      // s'applique sans obliger l'utilisateur à se déconnecter/reconnecter.
      if (s) api.auth.rafraichirPermissions(s).then(setSession);
    });
  }, []);

  function surConnecte(s: Session) {
    setSession(s);
    setEcran("shell");
  }

  // Propage un changement de session (ex. dépôt de vente modifié dans
  // Informations boutique) à toutes les pages qui la reçoivent en prop —
  // sans quoi Trésorerie/Caisse gardaient l'ancien dépôt jusqu'au prochain
  // démarrage de l'appli (voir rafraichirPermissions, même mécanisme).
  function surSessionMiseAJour(s: Session) {
    setSession(s);
  }

  async function surDeconnexion() {
    await api.auth.deconnexion();
    setSession(null);
    setEcran("connexion");
  }

  if (ecran === "chargement") {
    return <div className="ecran-chargement">Chargement…</div>;
  }
  if (ecran === "connexion") {
    return (
      <Connexion
        onConnecte={surConnecte}
        allerInscription={() => setEcran("inscription")}
        allerMotDePasseOublie={() => setEcran("motDePasseOublie")}
      />
    );
  }
  if (ecran === "inscription") {
    return <Inscription allerConnexion={() => setEcran("connexion")} />;
  }
  if (ecran === "motDePasseOublie") {
    return <MotDePasseOublie allerConnexion={() => setEcran("connexion")} />;
  }
  return (
    <DeviseProvider session={session!}>
      <LogoProvider session={session!}>
        <NomBoutiqueProvider session={session!}>
          <Shell session={session!} onDeconnexion={surDeconnexion} onSessionMiseAJour={surSessionMiseAJour} />
        </NomBoutiqueProvider>
      </LogoProvider>
    </DeviseProvider>
  );
}
