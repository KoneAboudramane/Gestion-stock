import type { CSSProperties } from "react";

import type { Session } from "../api";

const FORMATEUR_DATE_LONGUE = new Intl.DateTimeFormat("fr-FR", {
  weekday: "long",
  day: "numeric",
  month: "long",
  year: "numeric",
});

/**
 * Ronds défilants du fond de l'accueil : tailles/vitesses/délais variés pour
 * ne pas paraître synchronisés, chacun sa propre trajectoire (départ →
 * arrivée en vw/vh, pas tous dans le même sens), et une couleur --cercle-N
 * (voir index.css) — un cycle des teintes sémantiques par défaut, mais
 * certains thèmes (ex. Orange) réassortissent ces tokens à leur propre
 * identité de couleurs (orange/blanc/vert) plutôt que ce cycle générique.
 */
const CERCLES_FOND = [
  { taille: 90, couleur: "var(--cercle-1)", duree: 26, delai: -4, depart: ["-15vw", "10vh"], arrivee: ["115vw", "60vh"] },
  { taille: 60, couleur: "var(--cercle-2)", duree: 22, delai: -15, depart: ["115vw", "70vh"], arrivee: ["-15vw", "15vh"] },
  { taille: 120, couleur: "var(--cercle-3)", duree: 32, delai: -9, depart: ["20vw", "115vh"], arrivee: ["75vw", "-20vh"] },
  { taille: 50, couleur: "var(--cercle-4)", duree: 24, delai: -2, depart: ["70vw", "-15vh"], arrivee: ["15vw", "115vh"] },
  { taille: 75, couleur: "var(--cercle-5)", duree: 28, delai: -20, depart: ["-15vw", "90vh"], arrivee: ["110vw", "20vh"] },
  { taille: 100, couleur: "var(--cercle-6)", duree: 30, delai: -12, depart: ["110vw", "25vh"], arrivee: ["-15vw", "85vh"] },
  { taille: 40, couleur: "var(--cercle-1)", duree: 20, delai: -7, depart: ["40vw", "-15vh"], arrivee: ["85vw", "115vh"] },
  { taille: 65, couleur: "var(--cercle-3)", duree: 25, delai: -16, depart: ["105vw", "45vh"], arrivee: ["-10vw", "55vh"] },
  { taille: 85, couleur: "var(--cercle-4)", duree: 34, delai: -5, depart: ["85vw", "110vh"], arrivee: ["10vw", "-15vh"] },
  { taille: 55, couleur: "var(--cercle-6)", duree: 23, delai: -10, depart: ["-10vw", "35vh"], arrivee: ["105vw", "90vh"] },
] as const;

export default function Accueil({
  session,
  raccourcis,
  onNaviguer,
}: {
  session: Session;
  raccourcis: readonly { cle: string; label: string; icone: string }[];
  onNaviguer: (zone: string) => void;
}) {
  return (
    <div className="page-produits page-tableau-bord page-accueil">
      {CERCLES_FOND.map((c, i) => (
        <span
          key={i}
          aria-hidden="true"
          className="cercle-fond"
          style={
            {
              width: c.taille,
              height: c.taille,
              background: c.couleur,
              animationDuration: `${c.duree}s`,
              animationDelay: `${c.delai}s`,
              "--depart-x": c.depart[0],
              "--depart-y": c.depart[1],
              "--arrivee-x": c.arrivee[0],
              "--arrivee-y": c.arrivee[1],
            } as CSSProperties
          }
        />
      ))}
      <div className="entete-tableau-bord">
        <h2>
          Bonjour, {session.username} <span aria-hidden="true">👋</span>
        </h2>
        <span className="date-tableau-bord">{FORMATEUR_DATE_LONGUE.format(new Date())}</span>
      </div>

      <div className="grille-documents-comptables grille-accueil">
        {raccourcis.map((z, i) => (
          <button
            key={z.cle}
            type="button"
            className="carte-document-comptable"
            style={{ animationDelay: `${i * 40}ms` }}
            onClick={() => onNaviguer(z.cle)}
          >
            <span className="icone-document-comptable">{z.icone}</span>
            {z.label}
          </button>
        ))}
      </div>
    </div>
  );
}
