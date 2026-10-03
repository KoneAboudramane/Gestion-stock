import { useEffect, useState } from "react";

import { api } from "../api/client";
import type { EtatAbonnement, Session } from "../api/client";

/**
 * Bandeau en haut de l'appli quand l'abonnement approche de sa fin (7 derniers
 * jours, masquable pour la journée), pendant le délai de grâce puis une fois
 * la vente bloquée (rouge, non masquable). Voir services/abonnement.ts.
 */
const CLE_MASQUE = "gestion-stock:bandeau-abonnement-masque";

function aujourdhui(): string {
  return new Date().toISOString().slice(0, 10);
}

function masqueAujourdhui(boutiqueId: string): boolean {
  try {
    return localStorage.getItem(`${CLE_MASQUE}:${boutiqueId}`) === aujourdhui();
  } catch {
    return false;
  }
}

function date(iso: string | null): string {
  return iso ? new Date(iso).toLocaleDateString("fr-FR") : "";
}

export default function BandeauAbonnement({
  session,
  onVoirAbonnement,
}: {
  session: Session;
  onVoirAbonnement: () => void;
}) {
  const [etat, setEtat] = useState<EtatAbonnement | null>(null);
  const [masque, setMasque] = useState(() => masqueAujourdhui(session.boutiqueId));
  const responsable = !!session.permissions.gerer_utilisateurs_reglages;

  useEffect(() => {
    let actif = true;
    const lire = () => {
      api.abonnement.etat(session.boutiqueId)
        .then((e) => actif && setEtat(e))
        .catch(() => {});
    };
    lire();
    // Un poste peut rester ouvert plusieurs jours : on relit régulièrement.
    const minuteur = setInterval(lire, 30 * 60 * 1000);
    window.addEventListener("focus", lire);
    return () => {
      actif = false;
      clearInterval(minuteur);
      window.removeEventListener("focus", lire);
    };
  }, [session]);

  if (!etat || etat.niveau === "ok") return null;
  if (etat.niveau === "bientot" && masque) return null;

  const jours = etat.joursRestants ?? 0;
  const quand = jours <= 0 ? "aujourd'hui" : jours === 1 ? "demain" : `dans ${jours} jours`;
  const texte =
    etat.niveau === "bientot"
      ? `Votre abonnement se termine le ${date(etat.dateExpiration)} (${quand}).`
      : etat.niveau === "grace"
        ? `Abonnement expiré le ${date(etat.dateExpiration)}. La vente reste possible jusqu'au ${date(etat.finGrace)}, ensuite elle sera bloquée.`
        : `Abonnement expiré : la vente est bloquée depuis le ${date(etat.finGrace)}. Vos données restent consultables.`;
  const conseil = responsable ? "Renouvelez-le pour continuer à vendre." : "Prévenez le responsable de la boutique.";

  return (
    <div className={`bandeau-abonnement bandeau-abonnement--${etat.niveau}`} role="status">
      <span className="bandeau-abonnement-icone">{etat.niveau === "bientot" ? "⏳" : etat.niveau === "grace" ? "⚠️" : "⛔"}</span>
      <span className="bandeau-abonnement-texte">
        {texte} <strong>{conseil}</strong>
      </span>
      {responsable && (
        <button type="button" className="lien bandeau-abonnement-lien" onClick={onVoirAbonnement}>
          Voir l'abonnement
        </button>
      )}
      {etat.niveau === "bientot" && (
        <button
          type="button"
          className="lien-icone bandeau-abonnement-fermer"
          title="Masquer pour aujourd'hui"
          onClick={() => {
            try {
              localStorage.setItem(`${CLE_MASQUE}:${session.boutiqueId}`, aujourdhui());
            } catch {
              // stockage indisponible : masqué seulement jusqu'au prochain affichage
            }
            setMasque(true);
          }}
        >
          ×
        </button>
      )}
    </div>
  );
}
