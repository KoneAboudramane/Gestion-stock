import { useEffect, useRef, useState } from "react";

import { api } from "../api/reseauBoutique";
import type { EtatReseau, Session } from "../api/reseauBoutique";
import { estAppliMobile } from "../lib/appliAndroid";
import { surChangementReseau } from "../services/reseau";
import { useSynchro } from "../contexts/SynchroContext";
import { LIBELLES_TABLES_SYNCHRO } from "../pages/Reglages";
import ModaleReseauBoutique from "./ModaleReseauBoutique";

/**
 * Indicateur permanent de la barre du haut : PAR OÙ passe la synchronisation
 * (docs/plan_reseau_local.md, §4.9), avec un panneau détaillé au clic.
 * Copie de client-electron/src/components/IndicateurSynchro.tsx (docs/plan_mobile_complet.md,
 * lot 2) : seuls les appels (api/reseauBoutique.ts) et le mot « appareil » diffèrent ; dans un
 * navigateur (pas de réseau local possible), « Relier cet appareil » n'est pas proposé.
 */
export default function IndicateurSynchro({ session }: { session: Session }) {
  const { etat, enCours, erreur, synchroniser } = useSynchro();
  const [enAttente, setEnAttente] = useState<{ table: string; nombre: number }[]>([]);
  const [ouvert, setOuvert] = useState(false);
  const [reseau, setReseau] = useState<EtatReseau | null>(null);
  const [reseauOuvert, setReseauOuvert] = useState(false);
  const zone = useRef<HTMLDivElement>(null);

  function charger() {
    api.sync.enAttente(session.boutiqueId).then(setEnAttente).catch(() => {});
    api.reseau.etat().then(setReseau).catch(() => {});
  }
  useEffect(() => {
    charger();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.boutiqueId, etat?.derniereSynchro, enCours]);
  useEffect(() => {
    // Toutes les 5 s : « relié il y a 3 s » doit rester juste sur une caisse.
    const identifiant = setInterval(charger, 5000);
    // Caisse : rafraîchi aussi après chaque échange avec le poste principal.
    const desabonner = surChangementReseau(charger);
    return () => {
      clearInterval(identifiant);
      desabonner();
    };
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
  const principal = reseau?.role === "principal";
  const caisse = reseau?.role === "caisse" ? reseau.caisse : undefined;
  const ilYA = (iso: string | null | undefined) =>
    iso ? `il y a ${Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000))} s` : "jamais";
  const caissesReliees = reseau?.appareils.filter((a) => a.relie).length ?? 0;
  /** Ni poste principal ni caisse : ne voit pas les ventes des autres appareils (on le dit, sans alarmer). */
  const posteSeul = reseau?.role === "seul" && estAppliMobile;
  const suffixeSeul = posteSeul ? " · poste seul" : "";
  /** État d'internet, en une ligne (sous l'indicateur du poste principal). */
  const ligneInternet = !session.synchroAutorisee
    ? "🔒 100 % local — rien n'est envoyé en ligne"
    : etat?.enLigne
      ? `🌐 en ligne${heure ? ` — envoyé à ${heure}` : ""}`
      : `✗ pas d'internet${total > 0 ? ` — ${total} en attente` : ""}`;

  let icone: string;
  let libelle: string;
  let detail: string;
  let classe: "neutre" | "ok" | "alerte" | "encours";
  if (caisse) {
    if (caisse.relie) {
      icone = "📶";
      libelle = `Réseau de la boutique (poste « ${caisse.nomPostePrincipal} »)`;
      detail = `échangé ${ilYA(caisse.derniereSynchro)}${caisse.enAttente > 0 ? ` · ${caisse.enAttente} en attente` : ""}`;
      classe = "ok";
    } else {
      icone = "🟠";
      libelle = "Poste principal injoignable";
      detail = caisse.enAttente > 0 ? `${caisse.enAttente} en attente d'envoi` : "les ventes continuent sur cette caisse";
      classe = "alerte";
    }
  } else if (principal) {
    icone = reseau?.enPause ? "⏹" : "🖥️";
    libelle = reseau?.enPause
      ? "Serveur du poste principal arrêté"
      : `Poste principal · ${caissesReliees} caisse${caissesReliees > 1 ? "s" : ""} reliée${caissesReliees > 1 ? "s" : ""}`;
    detail = reseau?.enPause ? "les caisses vendent seules" : ligneInternet;
    classe = reseau?.enMarche ? "ok" : "alerte";
  } else if (!session.synchroAutorisee) {
    icone = "🔒";
    libelle = "100 % local";
    detail = `rien n'est envoyé en ligne${suffixeSeul}`;
    classe = "neutre";
  } else if (enCours) {
    icone = "⟳";
    libelle = "Synchronisation…";
    detail = "envoi et réception en cours";
    classe = "encours";
  } else if (etat?.enLigne) {
    icone = "🌐";
    libelle = "En ligne";
    detail = (heure ? `synchronisé à ${heure}` : "pas encore synchronisé") + (total > 0 ? ` · ${total} en attente` : "") + suffixeSeul;
    classe = "ok";
  } else {
    icone = "🟠";
    libelle = "Hors ligne";
    detail = (total > 0 ? `${total} en attente d'envoi` : "rien en attente") + suffixeSeul;
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
          <div className="autorisations-reseau autorisations-reseau--panneau" title="Réglés par votre administrateur">
            <span className={session.synchroAutorisee ? "autorisation-oui" : "autorisation-non"}>
              {session.synchroAutorisee ? "🌐 Envoi en ligne : autorisé" : "🔒 Envoi en ligne : non (100 % local)"}
            </span>
            <span className={reseau?.reseauAutorise ? "autorisation-oui" : "autorisation-non"}>
              {reseau?.reseauAutorise ? "📶 Réseau de la boutique : activé" : "📶 Réseau de la boutique : non activé"}
            </span>
            <span className="sous-info">réglés par votre administrateur</span>
          </div>
          <p className="chemin-synchro">
            {caisse
              ? `Cette caisse → Poste principal « ${caisse.nomPostePrincipal} » → ${session.synchroAutorisee ? "Serveur en ligne" : "rien en ligne (100 % local)"}`
              : principal
              ? `Caisses (${reseau?.appareils.length ?? 0}) → Ce poste principal « ${reseau?.nomPoste ?? ""} » → ${session.synchroAutorisee ? "Serveur en ligne" : "rien en ligne (100 % local)"}`
              : session.synchroAutorisee
                ? "Cet appareil → Serveur en ligne"
                : "Cet appareil → rien en ligne (100 % local : les données restent sur les appareils de la boutique)"}
          </p>
          {principal && (
            <dl className="details-mouvement">
              <dt>Réseau de la boutique</dt>
              <dd>
                {reseau?.enMarche ? "🟢 Serveur en marche" : reseau?.enPause ? "⏹ Serveur arrêté (caisses gardées)" : "🔴 Serveur arrêté"} · {caissesReliees} /{" "}
                {reseau?.appareils.length ?? 0} caisse{(reseau?.appareils.length ?? 0) > 1 ? "s" : ""} reliée
                {caissesReliees > 1 ? "s" : ""}
              </dd>
            </dl>
          )}
          {caisse && (
            <>
              <dl className="details-mouvement">
                <dt>Canal</dt>
                <dd>{caisse.relie ? "📶 Réseau de la boutique" : "🟠 Poste principal injoignable"}</dd>
                <dt>Dernier échange</dt>
                <dd>{caisse.derniereSynchro ? new Date(caisse.derniereSynchro).toLocaleString("fr-FR") : "jamais"}</dd>
                <dt>En attente (vers le poste principal)</dt>
                <dd>{caisse.enAttente === 0 ? "rien" : caisse.enAttente}</dd>
                <dt>Internet (par le poste principal)</dt>
                <dd>
                  {!caisse.internetPrincipal
                    ? "inconnu"
                    : caisse.internetPrincipal.enAttente > 0
                      ? `✗ ${caisse.internetPrincipal.enAttente} en attente d'envoi en ligne`
                      : `🌐 tout est envoyé${caisse.internetPrincipal.derniereSynchro ? ` (${new Date(caisse.internetPrincipal.derniereSynchro).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })})` : ""}`}
                </dd>
              </dl>
              {caisse.erreur && <div className="message-erreur">{caisse.erreur}</div>}
              <button type="button" className="bouton-primaire" onClick={async () => setReseau(await api.reseau.synchroniser())}>
                ⟳ Échanger maintenant
              </button>
            </>
          )}
          {posteSeul && (
            <div className="bloc-poste-seul">
              <p>
                <strong>Poste seul :</strong> cet appareil n'est relié à aucun autre appareil de la boutique. S'il y en
                a plusieurs, chacun ne voit que ses propres ventes et son propre stock.
              </p>
              <button
                type="button"
                onClick={() => {
                  setOuvert(false);
                  setReseauOuvert(true);
                }}
              >
                📶 Relier cet appareil
              </button>
            </div>
          )}
          {!caisse && (
          <dl className="details-mouvement">
            <dt>Canal</dt>
            <dd>{session.synchroAutorisee ? (etat?.enLigne ? "🌐 En ligne" : "🟠 Hors ligne (pas d'internet)") : "—"}</dd>
            <dt>Dernière synchro en ligne</dt>
            <dd>{derniere ? derniere.toLocaleString("fr-FR") : "jamais"}</dd>
            <dt>En attente d'envoi</dt>
            <dd>{total === 0 ? "rien" : `${total} élément${total > 1 ? "s" : ""}`}</dd>
          </dl>
          )}
          {!caisse && enAttente.length > 0 && (
            <ul className="liste-en-attente-synchro">
              {enAttente.slice(0, 8).map((e) => (
                <li key={e.table}>
                  {LIBELLES_TABLES_SYNCHRO[e.table] ?? e.table} : <strong>{e.nombre}</strong>
                </li>
              ))}
            </ul>
          )}
          {!caisse && erreur && <div className="message-erreur">{erreur}</div>}
          {!caisse && session.synchroAutorisee && (
            <button type="button" className="bouton-primaire" disabled={enCours} onClick={synchroniser}>
              {enCours ? "Synchronisation…" : "⟳ Synchroniser maintenant"}
            </button>
          )}
        </div>
      )}
      {reseauOuvert && (
        <ModaleReseauBoutique
          session={session}
          onFermer={() => {
            setReseauOuvert(false);
            charger();
          }}
        />
      )}
    </div>
  );
}
