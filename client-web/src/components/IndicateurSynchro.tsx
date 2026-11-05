import { useEffect, useRef, useState } from "react";

import type { Session } from "../api";
import { compterEnAttente } from "../sync";
import { useSynchro } from "../contexts/SynchroContext";
import { LIBELLES_TABLES_SYNCHRO } from "../pages/Reglages";

/**
 * Indicateur permanent de la barre du haut : PAR OÙ passe la synchronisation
 * (docs/plan_reseau_local.md, §4.9), avec un panneau détaillé au clic.
 * Lot 1 : en ligne / hors ligne ; le réseau de la boutique (📶 / 🖥️) et le
 * mode 100 % local (🔒) s'y ajoutent aux lots suivants.
 */
export default function IndicateurSynchro({ session }: { session: Session }) {
  const { etat, enCours, erreur, synchroniser } = useSynchro();
  const [enAttente, setEnAttente] = useState<{ table: string; nombre: number }[]>([]);
  const [ouvert, setOuvert] = useState(false);
  const zone = useRef<HTMLDivElement>(null);

  function charger() {
    compterEnAttente().then(setEnAttente).catch(() => {});
  }
  useEffect(() => {
    charger();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.boutiqueId, etat?.derniereSynchro, enCours]);
  useEffect(() => {
    const identifiant = setInterval(charger, 20000);
    return () => clearInterval(identifiant);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.boutiqueId]);
  useEffect(() => {
    if (!ouvert) return;
    const fermer = (e: MouseEvent) => {
      if (zone.current && !zone.current.contains(e.target as Node)) setOuvert(false);
    };
    document.addEventListener("mousedown", fermer);
    return () => document.removeEventListener("mousedown", fermer);
  }, [ouvert]);

  const total = enAttente.reduce((t, e) => t + e.nombre, 0);
  const derniere = etat?.derniereSynchro ? new Date(etat.derniereSynchro) : null;
  const heure = derniere?.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });

  let icone: string;
  let libelle: string;
  let detail: string;
  let classe: "neutre" | "ok" | "alerte" | "encours";
  if (!session.synchroAutorisee) {
    icone = "🔒";
    libelle = "100 % local";
    detail = "rien n'est envoyé en ligne";
    classe = "neutre";
  } else if (enCours) {
    icone = "⟳";
    libelle = "Synchronisation…";
    detail = "envoi et réception en cours";
    classe = "encours";
  } else if (etat?.enLigne) {
    icone = "🌐";
    libelle = "En ligne";
    detail = (heure ? `synchronisé à ${heure}` : "pas encore synchronisé") + (total > 0 ? ` · ${total} en attente` : "");
    classe = "ok";
  } else {
    icone = "🟠";
    libelle = "Hors ligne";
    detail = total > 0 ? `${total} en attente d'envoi` : "rien en attente";
    classe = "alerte";
  }

  return (
    <div className="indicateur-synchro-zone" ref={zone}>
      <button
        type="button"
        className={`indicateur-synchro indicateur-synchro--${classe}`}
        title="Par où passe la synchronisation ? (cliquer pour le détail)"
        onClick={() => setOuvert(!ouvert)}
      >
        <span className="indicateur-synchro-icone">{icone}</span>
        <span className="indicateur-synchro-textes">
          <strong>{libelle}</strong>
          <span className="sous-info">{detail}</span>
        </span>
      </button>
      {ouvert && (
        <div className="panneau-synchro">
          <h4>Synchronisation</h4>
          <p className="chemin-synchro">
            {session.synchroAutorisee
              ? "Cet ordinateur → Serveur en ligne"
              : "Cet ordinateur → rien en ligne (100 % local : les données restent dans ce navigateur)"}
          </p>
          <dl className="details-mouvement">
            <dt>Canal</dt>
            <dd>{session.synchroAutorisee ? (etat?.enLigne ? "🌐 En ligne" : "🟠 Hors ligne (pas d'internet)") : "—"}</dd>
            <dt>Dernière synchro en ligne</dt>
            <dd>{derniere ? derniere.toLocaleString("fr-FR") : "jamais"}</dd>
            <dt>En attente d'envoi</dt>
            <dd>{total === 0 ? "rien" : `${total} élément${total > 1 ? "s" : ""}`}</dd>
          </dl>
          {enAttente.length > 0 && (
            <ul className="liste-en-attente-synchro">
              {enAttente.slice(0, 8).map((e) => (
                <li key={e.table}>
                  {LIBELLES_TABLES_SYNCHRO[e.table] ?? e.table} : <strong>{e.nombre}</strong>
                </li>
              ))}
            </ul>
          )}
          {erreur && <div className="message-erreur">{erreur}</div>}
          {session.synchroAutorisee && (
            <button type="button" className="bouton-primaire" disabled={enCours} onClick={synchroniser}>
              {enCours ? "Synchronisation…" : "⟳ Synchroniser maintenant"}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
