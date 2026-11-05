import { type ReactNode, useEffect } from "react";

import type { EtatAbonnement } from "../types";

export function BadgeAbonnement({ etat, actif = true }: { etat: EtatAbonnement; actif?: boolean }) {
  if (!actif) return <span className="badge badge-gris">Désactivée</span>;
  const classe = {
    ok: "badge-vert",
    bientot: "badge-orange",
    grace: "badge-rouge",
    bloque: "badge-rouge-fort",
    illimite: "badge-bleu",
  }[etat.niveau];
  return <span className={`badge ${classe}`}>{etat.libelle}</span>;
}

export function Chargement() {
  return <p className="chargement">Chargement…</p>;
}

export function Erreur({ message, reessayer }: { message: string; reessayer?: () => void }) {
  return (
    <div className="message-erreur" role="alert">
      {message}{" "}
      {reessayer && (
        <button type="button" className="lien" onClick={reessayer}>
          Réessayer
        </button>
      )}
    </div>
  );
}

export function Modale({ titre, surFermer, children }: { titre: string; surFermer: () => void; children: ReactNode }) {
  useEffect(() => {
    const echap = (e: KeyboardEvent) => e.key === "Escape" && surFermer();
    window.addEventListener("keydown", echap);
    return () => window.removeEventListener("keydown", echap);
  }, [surFermer]);

  return (
    <div className="fond-modale" onMouseDown={(e) => e.target === e.currentTarget && surFermer()}>
      <div className="modale" role="dialog" aria-modal="true" aria-label={titre}>
        <header className="entete-modale">
          <h2>{titre}</h2>
          <button type="button" className="fermer" onClick={surFermer} aria-label="Fermer">
            ✕
          </button>
        </header>
        <div className="corps-modale">{children}</div>
      </div>
    </div>
  );
}

/** Ligne « libellé : valeur » des fiches. */
export function Info({ libelle, children }: { libelle: string; children: ReactNode }) {
  return (
    <div className="info">
      <dt>{libelle}</dt>
      <dd>{children || "—"}</dd>
    </div>
  );
}
