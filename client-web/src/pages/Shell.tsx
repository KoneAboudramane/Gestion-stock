import { useState } from "react";

import type { Session } from "../api";
import BarreSynchro from "../components/BarreSynchro";
import Achats from "./Achats";
import Caisse from "./Caisse";
import Clients from "./Clients";
import Messages from "./Messages";
import Notifications from "./Notifications";
import Produits from "./Produits";
import Rapports from "./Rapports";
import Reglages from "./Reglages";
import Stock from "./Stock";
import TableauDeBord from "./TableauDeBord";
import Ventes from "./Ventes";

const ZONES = [
  { cle: "tableauDeBord", label: "Tableau de bord", icone: "📊" },
  { cle: "caisse", label: "Caisse / Vente", icone: "🧾" },
  { cle: "produits", label: "Articles", icone: "🏷️" },
  { cle: "stock", label: "Stock", icone: "📦" },
  { cle: "ventes", label: "Historique des ventes", icone: "📜" },
  { cle: "achats", label: "Achats & fournisseurs", icone: "🚚", permission: "gerer_produits_stock_achats" },
  { cle: "clients", label: "Clients & crédit", icone: "👤" },
  { cle: "rapports", label: "Rapports", icone: "📈" },
  { cle: "notifications", label: "Notifications", icone: "🔔" },
  { cle: "messages", label: "Messages", icone: "💬" },
  { cle: "reglages", label: "Informations boutique", icone: "🏪" },
] as const;

export type Zone = (typeof ZONES)[number]["cle"];

export default function Shell({ session, onDeconnexion }: { session: Session; onDeconnexion: () => void }) {
  const [zone, setZone] = useState<Zone>("tableauDeBord");
  const [barreReduite, setBarreReduite] = useState(() => localStorage.getItem("gs_barre_laterale_reduite") === "1");
  const zonesAccessibles = ZONES.filter((z) => !("permission" in z) || session.permissions[z.permission]);

  function basculerBarreLaterale() {
    setBarreReduite((valeur) => {
      const nouvelleValeur = !valeur;
      localStorage.setItem("gs_barre_laterale_reduite", nouvelleValeur ? "1" : "0");
      return nouvelleValeur;
    });
  }

  return (
    <div className="shell">
      <aside className={`barre-laterale ${barreReduite ? "reduite" : ""}`}>
        <div className="logo">
          <span className="logo-boutique-entete logo-boutique-nav-vide">
            {session.boutiqueNom.charAt(0).toUpperCase()}
          </span>
          <span className="texte-logo">Gestion Stock</span>
          <button
            type="button"
            className="bouton-reduire-barre"
            onClick={basculerBarreLaterale}
            title={barreReduite ? "Ouvrir le menu" : "Réduire le menu"}
          >
            {barreReduite ? "»" : "«"}
          </button>
        </div>
        <nav>
          {zonesAccessibles.map((z) => (
            <button
              key={z.cle}
              className={`item-nav ${zone === z.cle ? "actif" : ""}`}
              onClick={() => setZone(z.cle)}
              title={barreReduite ? z.label : undefined}
            >
              <span className="item-nav-libelle">
                <span className="icone-nav">{z.icone}</span>
                <span className="texte-nav">{z.label}</span>
              </span>
            </button>
          ))}
        </nav>
        <button className="lien-deconnexion" onClick={onDeconnexion} title={barreReduite ? "Déconnexion" : undefined}>
          <span className="icone-deconnexion">🚪</span>
          <span className="texte-deconnexion">Déconnexion</span>
        </button>
      </aside>
      <div className="contenu-principal">
        <header className="entete">
          <div>
            <strong>{session.boutiqueNom}</strong>
            <span className="sous-info"> · {session.username} ({session.role})</span>
          </div>
          <BarreSynchro session={session} />
        </header>
        <main className="zone-contenu">
          {zone === "tableauDeBord" && <TableauDeBord session={session} />}
          {zone === "caisse" && <Caisse session={session} />}
          {zone === "ventes" && <Ventes session={session} />}
          {zone === "produits" && <Produits session={session} />}
          {zone === "clients" && <Clients session={session} />}
          {zone === "achats" && <Achats session={session} />}
          {zone === "rapports" && <Rapports session={session} />}
          {zone === "stock" && <Stock session={session} />}
          {zone === "notifications" && <Notifications session={session} />}
          {zone === "messages" && <Messages session={session} />}
          {zone === "reglages" && <Reglages session={session} />}
        </main>
      </div>
    </div>
  );
}
