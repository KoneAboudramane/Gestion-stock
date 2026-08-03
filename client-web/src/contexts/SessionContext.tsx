import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

import type { Session } from "../api/auth";
import { definirJetons, surDeconnexionForcee, surRafraichissementJetons } from "../api/transport";

/**
 * Équivalent web de session.json (client-electron/electron/services/auth.ts) :
 * un seul objet Session, mais persisté en localStorage plutôt que sur disque —
 * pas d'accès au système de fichiers depuis un navigateur, et pas de repli
 * hors-ligne (identifiants-locaux.json) puisque ce client suppose toujours une connexion.
 */
const CLE_STOCKAGE = "gestion-stock:session";

function chargerSession(): Session | null {
  try {
    const brut = localStorage.getItem(CLE_STOCKAGE);
    return brut ? (JSON.parse(brut) as Session) : null;
  } catch {
    return null;
  }
}

interface ContexteSession {
  session: Session | null;
  definirSession: (session: Session | null) => void;
}

const SessionContext = createContext<ContexteSession>({ session: null, definirSession: () => {} });

export function SessionProvider({ children }: { children: ReactNode }) {
  const [session, setSessionInterne] = useState<Session | null>(() => {
    const restauree = chargerSession();
    if (restauree) definirJetons({ accessToken: restauree.accessToken, refreshToken: restauree.refreshToken });
    return restauree;
  });

  function definirSession(nouvelleSession: Session | null) {
    setSessionInterne(nouvelleSession);
    if (nouvelleSession) {
      localStorage.setItem(CLE_STOCKAGE, JSON.stringify(nouvelleSession));
      definirJetons({ accessToken: nouvelleSession.accessToken, refreshToken: nouvelleSession.refreshToken });
    } else {
      localStorage.removeItem(CLE_STOCKAGE);
      definirJetons(null);
    }
  }

  useEffect(() => {
    // Refresh token invalide/expiré : déconnexion forcée (cas nouveau pour ce client web —
    // Electron n'a jamais à gérer ça puisqu'il retombe sur son cache local hors-ligne).
    surDeconnexionForcee(() => definirSession(null));

    // Rafraîchissement de jeton réussi en cours de session : garder la session persistée à jour.
    surRafraichissementJetons((jetons) => {
      setSessionInterne((actuelle) => {
        if (!actuelle) return actuelle;
        const misAJour: Session = { ...actuelle, accessToken: jetons.accessToken, refreshToken: jetons.refreshToken };
        localStorage.setItem(CLE_STOCKAGE, JSON.stringify(misAJour));
        return misAJour;
      });
    });

    // Déconnexion faite dans un autre onglet : se déconnecter ici aussi.
    function surStockage(evenement: StorageEvent) {
      if (evenement.key === CLE_STOCKAGE && !evenement.newValue) setSessionInterne(null);
    }
    window.addEventListener("storage", surStockage);
    return () => window.removeEventListener("storage", surStockage);
  }, []);

  const valeur = useMemo(() => ({ session, definirSession }), [session]);

  return <SessionContext.Provider value={valeur}>{children}</SessionContext.Provider>;
}

export function useSession(): ContexteSession {
  return useContext(SessionContext);
}
