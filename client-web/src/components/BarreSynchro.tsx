import { useEffect, useRef, useState } from "react";

import type { Session } from "../api/auth";
import { etatSynchro, synchroniser as synchroniserSession } from "../sync";

/**
 * Port navigateur de client-electron/src/components/BarreSynchro.tsx : déclenche
 * le push+pull (au montage/login, toutes les 5 minutes, à la reconnexion réseau,
 * ou manuellement) — sans cette barre, les données locales (IndexedDB) ne
 * seraient jamais alimentées depuis le serveur.
 */

const INTERVALLE_SYNCHRO_AUTO_MS = 5 * 60 * 1000;

function formaterDate(iso: string | null): string {
  if (!iso) return "jamais";
  return new Date(iso).toLocaleString("fr-FR");
}

export default function BarreSynchro({ session }: { session: Session }) {
  const [derniereSynchro, setDerniereSynchro] = useState<string | null>(null);
  const [enLigne, setEnLigne] = useState(navigator.onLine);
  const [enCours, setEnCours] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const enCoursRef = useRef(false);

  async function synchroniser(silencieux: boolean) {
    if (enCoursRef.current) return;
    enCoursRef.current = true;
    setEnCours(true);
    if (!silencieux) setErreur(null);
    try {
      const resultat = await synchroniserSession(session);
      setDerniereSynchro(resultat.derniereSynchro);
      setEnLigne(true);
    } catch (e) {
      setEnLigne(false);
      if (!silencieux) setErreur(e instanceof Error ? e.message : "Échec de la synchronisation.");
    } finally {
      enCoursRef.current = false;
      setEnCours(false);
    }
  }

  useEffect(() => {
    setDerniereSynchro(etatSynchro().derniereSynchro);
    synchroniser(true);

    const intervalleSynchro = setInterval(() => synchroniser(true), INTERVALLE_SYNCHRO_AUTO_MS);
    const surReconnexion = () => {
      setEnLigne(true);
      synchroniser(true);
    };
    const surDeconnexion = () => setEnLigne(false);
    window.addEventListener("online", surReconnexion);
    window.addEventListener("offline", surDeconnexion);
    return () => {
      clearInterval(intervalleSynchro);
      window.removeEventListener("online", surReconnexion);
      window.removeEventListener("offline", surDeconnexion);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="barre-synchro" title={erreur ?? undefined}>
      <span className={`point ${enLigne ? "point-en-ligne" : "point-hors-ligne"}`} />
      {enLigne ? "En ligne" : "Hors-ligne"} · dernière synchro : {formaterDate(derniereSynchro)}
      <button className="bouton-synchro" onClick={() => synchroniser(false)} disabled={enCours}>
        {enCours ? "Synchronisation…" : "Synchroniser"}
      </button>
    </div>
  );
}
