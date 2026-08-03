import { useState } from "react";

import type { Session } from "../api";
import Rapports from "./Rapports";
import Stock from "./Stock";
import TableauDeBord from "./TableauDeBord";
import UtilisateursRoles from "./UtilisateursRoles";

const ZONES = [
  { cle: "tableauDeBord", label: "Tableau de bord", icone: "📊" },
  { cle: "rapports", label: "Rapports", icone: "📈" },
  { cle: "stock", label: "Stock", icone: "📦" },
  { cle: "utilisateurs", label: "Utilisateurs & rôles", icone: "👥" },
] as const;

export type Zone = (typeof ZONES)[number]["cle"];

export default function Shell({ session, onDeconnexion }: { session: Session; onDeconnexion: () => void }) {
  const [zone, setZone] = useState<Zone>("tableauDeBord");

  return (
    <div className="shell">
      <aside className="barre-laterale">
        <div className="logo">
          <span className="logo-boutique-entete logo-boutique-nav-vide">
            {session.boutiqueNom.charAt(0).toUpperCase()}
          </span>
          Gestion Stock
        </div>
        <nav>
          {ZONES.map((z) => (
            <button
              key={z.cle}
              className={`item-nav ${zone === z.cle ? "actif" : ""}`}
              onClick={() => setZone(z.cle)}
            >
              <span className="item-nav-libelle">
                <span className="icone-nav">{z.icone}</span>
                {z.label}
              </span>
            </button>
          ))}
        </nav>
        <button className="lien-deconnexion" onClick={onDeconnexion}>
          Déconnexion
        </button>
      </aside>
      <div className="contenu-principal">
        <header className="entete">
          <div>
            <strong>{session.boutiqueNom}</strong>
            <span className="sous-info"> · {session.username} ({session.role})</span>
          </div>
        </header>
        <main className="zone-contenu">
          {zone === "tableauDeBord" && <TableauDeBord session={session} />}
          {zone === "rapports" && <Rapports session={session} />}
          {zone === "stock" && <Stock session={session} />}
          {zone === "utilisateurs" && <UtilisateursRoles session={session} />}
        </main>
      </div>
    </div>
  );
}
