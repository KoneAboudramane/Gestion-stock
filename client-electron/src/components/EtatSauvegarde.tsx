import { useEffect, useState } from "react";

import { api } from "../api/client";
import type { EtatSauvegarde, Session } from "../api/client";
import { ModaleSauvegarde } from "./ModaleSauvegardeAdmin";

// Côté patron (docs/plan_reseau_local.md, lot 7) : il VOIT que la sauvegarde
// fonctionne (Réglages → Sauvegarde) et est alerté si elle ne marche plus, mais
// ne peut ni la débrancher ni la modifier — c'est l'admin, dans l'Espace Admin.

function depuisJours(iso: string | null): number | null {
  return iso ? Math.floor((Date.now() - new Date(iso).getTime()) / 86400000) : null;
}

/** Informations boutique → Sauvegarde : la même modale que l'Espace Admin, en consultation. */
export function ModaleEtatSauvegarde({ onFermer }: { onFermer: () => void }) {
  return <ModaleSauvegarde mode="patron" onFermer={onFermer} />;
}

/**
 * Bandeau (responsable de la boutique, hors caisses branchées) : sauvegarde en
 * échec ou trop ancienne ; ou boutique 100 % locale sans aucune sauvegarde.
 */
export function BandeauSauvegarde({ session, onVoir }: { session: Session; onVoir: () => void }) {
  const [etat, setEtat] = useState<EtatSauvegarde | null>(null);
  const [caisse, setCaisse] = useState(false);
  const responsable = !!session.permissions.gerer_utilisateurs_reglages;

  useEffect(() => {
    if (!responsable) return;
    const charger = () => {
      api.sauvegarde.etat().then(setEtat).catch(() => {});
      api.reseau.etat().then((r) => setCaisse(r.role === "caisse")).catch(() => {});
    };
    charger();
    const identifiant = setInterval(charger, 30 * 60 * 1000);
    return () => clearInterval(identifiant);
  }, [responsable]);

  if (!responsable || !etat || caisse) return null;
  let texte: string | null = null;
  if (etat.configuree && etat.alerte !== "aucune") {
    const jours = depuisJours(etat.derniereSauvegarde);
    texte = `⚠️ Sauvegarde : ${jours === null ? "aucune réussie" : `dernière réussie il y a ${jours} jour${jours > 1 ? "s" : ""}`}${etat.derniereErreur ? ` (${etat.derniereErreur})` : ""}. Prévenez votre administrateur.`;
  } else if (!etat.configuree && !session.synchroAutorisee) {
    texte = "⚠️ Aucune sauvegarde : en 100 % local, vos données n'existent que sur les ordinateurs de la boutique. Demandez à votre administrateur de paramétrer la sauvegarde.";
  }
  if (!texte) return null;
  return (
    <div className="bandeau-sauvegarde" role="alert">
      <span>{texte}</span>
      <button type="button" className="lien" onClick={onVoir}>
        Voir
      </button>
    </div>
  );
}
