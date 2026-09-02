import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";

import { rafraichirPermissions } from "../api/auth";
import type { Session } from "../api/auth";
import { useSession } from "./SessionContext";
import { etatSynchro, synchroniser as synchroniserSession } from "../sync";

/**
 * Port navigateur de client-electron/src/contexts/SynchroContext.tsx : moteur
 * de synchro monté une fois pour toute la durée de session (voir App.tsx),
 * indépendamment de l'écran affiché — la synchro automatique (toutes les 5
 * minutes + à la reconnexion réseau) doit continuer à tourner même si
 * l'utilisateur n'a pas Réglages > Synchronisation ouvert.
 */

const INTERVALLE_SYNCHRO_AUTO_MS = 5 * 60 * 1000;

interface EtatSynchro {
  derniereSynchro: string | null;
  enLigne: boolean;
}

interface ContexteSynchro {
  etat: EtatSynchro | null;
  enCours: boolean;
  erreur: string | null;
  synchroniser: () => void;
  verifierActivation: () => void;
}

const SynchroContext = createContext<ContexteSynchro>({
  etat: null,
  enCours: false,
  erreur: null,
  synchroniser: () => {},
  verifierActivation: () => {},
});

export function SynchroProvider({ session, children }: { session: Session; children: ReactNode }) {
  const { definirSession } = useSession();
  const [etat, setEtat] = useState<EtatSynchro | null>(null);
  const [enCours, setEnCours] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const enCoursRef = useRef(false);
  const sessionRef = useRef(session);
  sessionRef.current = session;

  async function synchroniser(silencieux: boolean) {
    if (enCoursRef.current || !sessionRef.current.synchroAutorisee) return;
    enCoursRef.current = true;
    setEnCours(true);
    if (!silencieux) setErreur(null);
    try {
      const resultat = await synchroniserSession(sessionRef.current);
      setEtat({ derniereSynchro: resultat.derniereSynchro, enLigne: true });
    } catch (e) {
      setEtat((etatActuel) => ({ derniereSynchro: etatActuel?.derniereSynchro ?? null, enLigne: false }));
      if (!silencieux) setErreur(e instanceof Error ? e.message : "Échec de la synchronisation.");
    } finally {
      enCoursRef.current = false;
      setEnCours(false);
    }
  }

  useEffect(() => {
    setEtat({ derniereSynchro: etatSynchro().derniereSynchro, enLigne: navigator.onLine });
    synchroniser(true);

    const intervalleSynchro = setInterval(() => synchroniser(true), INTERVALLE_SYNCHRO_AUTO_MS);
    const surReconnexion = () => {
      setEtat((etatActuel) => (etatActuel ? { ...etatActuel, enLigne: true } : etatActuel));
      synchroniser(true);
    };
    const surDeconnexion = () =>
      setEtat((etatActuel) => (etatActuel ? { ...etatActuel, enLigne: false } : etatActuel));
    window.addEventListener("online", surReconnexion);
    window.addEventListener("offline", surDeconnexion);
    return () => {
      clearInterval(intervalleSynchro);
      window.removeEventListener("online", surReconnexion);
      window.removeEventListener("offline", surDeconnexion);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Vérifie l'activation puis, si elle vient d'avoir lieu, tire immédiatement
  // les données existantes de la boutique — sans ça, l'utilisateur devrait
  // cliquer une seconde fois sur "Synchroniser" (ou attendre jusqu'à 5 min)
  // pour voir apparaître les données déjà présentes côté serveur.
  async function verifierActivation() {
    if (enCoursRef.current) return;
    enCoursRef.current = true;
    setEnCours(true);
    let sessionMiseAJour: Session | null;
    try {
      sessionMiseAJour = await rafraichirPermissions(sessionRef.current);
    } finally {
      enCoursRef.current = false;
      setEnCours(false);
    }
    if (!sessionMiseAJour) return;
    definirSession(sessionMiseAJour);
    sessionRef.current = sessionMiseAJour;
    if (sessionMiseAJour.synchroAutorisee) await synchroniser(false);
  }

  return (
    <SynchroContext.Provider
      value={{ etat, enCours, erreur, synchroniser: () => synchroniser(false), verifierActivation }}
    >
      {children}
    </SynchroContext.Provider>
  );
}

export function useSynchro(): ContexteSynchro {
  return useContext(SynchroContext);
}
