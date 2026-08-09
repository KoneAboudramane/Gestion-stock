import { useEffect, useRef, useState } from "react";

import { api } from "../api/client";
import type { EtatSynchro, Session } from "../api/client";

const INTERVALLE_SYNCHRO_AUTO_MS = 5 * 60 * 1000;

function formaterDate(iso: string | null): string {
  if (!iso) return "jamais";
  return new Date(iso).toLocaleString("fr-FR");
}

export default function BarreSynchro({ session }: { session: Session }) {
  const [etat, setEtat] = useState<EtatSynchro | null>(null);
  const [enCours, setEnCours] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  // Garde synchrone (pas de state) pour ignorer un déclenchement automatique
  // si une synchro (manuelle ou auto) est déjà en cours.
  const enCoursRef = useRef(false);

  async function rafraichirEtat() {
    const nouvelEtat = await api.sync.etat();
    setEtat(nouvelEtat);
  }

  async function synchroniser(silencieux: boolean) {
    if (enCoursRef.current) return;
    enCoursRef.current = true;
    setEnCours(true);
    if (!silencieux) setErreur(null);
    try {
      const resultat = await api.sync.executer(session);
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
    // Synchro automatique tant que l'appli est ouverte : toutes les 5 minutes,
    // et immédiatement à la reconnexion réseau. Silencieuse (pas de message
    // d'erreur affiché si ça échoue) — le badge "En ligne / dernière synchro"
    // suffit à montrer que ça tourne.
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

  return (
    <div className="barre-synchro" title={erreur ?? undefined}>
      <span className={`point ${etat?.enLigne ? "point-en-ligne" : "point-hors-ligne"}`} />
      {etat?.enLigne ? "En ligne" : "Hors-ligne"} · dernière synchro : {formaterDate(etat?.derniereSynchro ?? null)}
      <button className="bouton-synchro" onClick={() => synchroniser(false)} disabled={enCours}>
        {enCours ? "Synchronisation…" : "Synchroniser"}
      </button>
    </div>
  );
}
