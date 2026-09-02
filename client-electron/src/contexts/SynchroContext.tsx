import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";

import { api } from "../api/client";
import type { EtatSynchro, Session } from "../api/client";

/**
 * Moteur de synchro monté une fois pour toute la durée de session (voir
 * App.tsx), indépendamment de l'écran affiché : la synchro automatique
 * (toutes les 5 minutes + à la reconnexion réseau, voir cahier des charges)
 * doit continuer à tourner même si l'utilisateur n'a pas Réglages > Synchronisation
 * ouvert — seul l'affichage (statut, bouton) a déménagé là-bas.
 */

const INTERVALLE_SYNCHRO_AUTO_MS = 5 * 60 * 1000;

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

export function SynchroProvider({
  session,
  onSessionMiseAJour,
  children,
}: {
  session: Session;
  onSessionMiseAJour: (session: Session) => void;
  children: ReactNode;
}) {
  const [etat, setEtat] = useState<EtatSynchro | null>(null);
  const [enCours, setEnCours] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  // Garde synchrone (pas de state) pour ignorer un déclenchement automatique
  // si une synchro (manuelle ou auto) est déjà en cours.
  const enCoursRef = useRef(false);
  const sessionRef = useRef(session);
  sessionRef.current = session;

  async function rafraichirEtat() {
    setEtat(await api.sync.etat());
  }

  async function synchroniser(silencieux: boolean) {
    if (enCoursRef.current || !sessionRef.current.synchroAutorisee) return;
    enCoursRef.current = true;
    setEnCours(true);
    if (!silencieux) setErreur(null);
    try {
      const resultat = await api.sync.executer(sessionRef.current);
      if (!resultat.succes && !silencieux) setErreur(resultat.message);
    } catch (e) {
      if (!silencieux) setErreur(e instanceof Error ? e.message : "Échec de la synchronisation.");
    } finally {
      enCoursRef.current = false;
      setEnCours(false);
      rafraichirEtat();
    }
  }

  useEffect(() => {
    rafraichirEtat();
    const intervalleEtat = setInterval(rafraichirEtat, 20000);
    const intervalleSynchro = setInterval(() => synchroniser(true), INTERVALLE_SYNCHRO_AUTO_MS);
    const surReconnexion = () => synchroniser(true);
    window.addEventListener("online", surReconnexion);
    return () => {
      clearInterval(intervalleEtat);
      clearInterval(intervalleSynchro);
      window.removeEventListener("online", surReconnexion);
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
    let sessionMiseAJour: Session;
    try {
      sessionMiseAJour = await api.auth.rafraichirPermissions(sessionRef.current);
    } finally {
      enCoursRef.current = false;
      setEnCours(false);
    }
    onSessionMiseAJour(sessionMiseAJour);
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
