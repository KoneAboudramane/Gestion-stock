import { useEffect, useState } from "react";

import { api } from "./api/client";
import type { Session } from "./api/client";
import EcranVerrouillage from "./components/EcranVerrouillage";
import { DeviseProvider } from "./contexts/DeviseContext";
import { LogoProvider } from "./contexts/LogoContext";
import { NomBoutiqueProvider } from "./contexts/NomBoutiqueContext";
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
  const [session, setSession] = useState<Session | null>(null);
  const [ecran, setEcran] = useState<Ecran>("chargement");
  const [verrouille, setVerrouille] = useState(false);

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
    setVerrouille(false);
    setEcran("connexion");
  }

  function surDeverrouille(s: Session) {
    setSession(s);
    setVerrouille(false);
  }

  if (ecran === "chargement") {
    return <div className="ecran-chargement">Chargement…</div>;
  }
  if (ecran === "connexion") {
    return <Connexion onConnecte={surConnecte} allerAccesCreation={() => setEcran("accesCreation")} />;
  }
  if (ecran === "accesCreation") {
    return <AccesCreationBoutique allerConnexion={() => setEcran("connexion")} />;
  }
  return (
    <DeviseProvider session={session!}>
      <LogoProvider session={session!}>
        <NomBoutiqueProvider session={session!}>
          <VerrouillageProvider session={session!}>
            <SynchroProvider session={session!} onSessionMiseAJour={surSessionMiseAJour}>
              <GestionnaireInactivite actif={!verrouille} onInactif={() => setVerrouille(true)} />
              <Shell
                session={session!}
                onDeconnexion={surDeconnexion}
                onSessionMiseAJour={surSessionMiseAJour}
                onVerrouiller={() => setVerrouille(true)}
              />
              {verrouille && (
                <EcranVerrouillage session={session!} onDeverrouille={surDeverrouille} onDeconnexion={surDeconnexion} />
              )}
            </SynchroProvider>
          </VerrouillageProvider>
        </NomBoutiqueProvider>
      </LogoProvider>
    </DeviseProvider>
  );
}
