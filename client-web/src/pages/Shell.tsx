import { useEffect, useState } from "react";

import type { Session } from "../api";
import { listerFournisseurs } from "../services/achats";
import type { Periode } from "../services/rapports";
import { compterNotificationsNonLues } from "../services/notifications";
import type { LigneAchatInitiale } from "../services/stock";
import Accueil from "./Accueil";
import Achats from "./Achats";
import Caisse from "./Caisse";
import Clients from "./Clients";
import Comptabilite from "./Comptabilite";
import Depense from "./Depense";
import Messages from "./Messages";
import Notifications from "./Notifications";
import Produits from "./Produits";
import Rapports, { type DocumentRapport } from "./Rapports";
import Reglages from "./Reglages";
import Stock from "./Stock";
import TableauDeBord from "./TableauDeBord";
import Tresorerie from "./Tresorerie";
import Ventes from "./Ventes";

const ZONES = [
  { cle: "tableauDeBord", label: "Tableau de bord", icone: "📊" },
  { cle: "caisse", label: "Caisse / Vente", icone: "🧾" },
  { cle: "produits", label: "Articles", icone: "🏷️" },
  { cle: "stock", label: "Stock", icone: "📦" },
  { cle: "ventes", label: "Historique des ventes", icone: "📜" },
  { cle: "achats", label: "Achats & fournisseurs", icone: "🚚", permission: "gerer_produits_stock_achats" },
  { cle: "clients", label: "Clients & crédit", icone: "👤" },
  { cle: "tresorerie", label: "Trésorerie", icone: "💰", permission: "consulter_tresorerie" },
  { cle: "depense", label: "Dépenses", icone: "💸" },
  { cle: "rapports", label: "Rapports", icone: "📈" },
  { cle: "comptabilite", label: "Comptabilité", icone: "📒", permission: "consulter_comptabilite" },
  { cle: "notifications", label: "Notifications", icone: "🔔" },
  { cle: "messages", label: "Messages", icone: "💬" },
  { cle: "reglages", label: "Informations boutique", icone: "🏪" },
] as const;

export type Zone = (typeof ZONES)[number]["cle"] | "accueil";

export default function Shell({ session, onDeconnexion }: { session: Session; onDeconnexion: () => void }) {
  const [zone, setZone] = useState<Zone>("accueil");
  const [barreReduite, setBarreReduite] = useState(() => localStorage.getItem("gs_barre_laterale_reduite") === "1");
  const zonesAccessibles = ZONES.filter((z) => !("permission" in z) || session.permissions[z.permission]);

  // État de navigation croisée (ex. "voir les ruptures dans le Stock" depuis
  // le Tableau de bord ou une notification) : porté de Shell.tsx Electron,
  // limité aux cibles qui ont un point d'entrée réel côté web pour l'instant
  // (pas de "clients:credits" — la section "Crédits en attente" du tableau
  // de bord n'est pas encore portée ici).
  const [filtreRuptureInitial, setFiltreRuptureInitial] = useState(false);
  const [lignesEntreeInitiales, setLignesEntreeInitiales] = useState<LigneAchatInitiale[]>([]);
  const [ouvrirNouvelleCommande, setOuvrirNouvelleCommande] = useState(false);
  const [lignesAchatInitiales, setLignesAchatInitiales] = useState<LigneAchatInitiale[]>([]);
  const [ongletRapportsInitial, setOngletRapportsInitial] = useState<DocumentRapport | undefined>(undefined);
  const [periodeRapportsInitiale, setPeriodeRapportsInitiale] = useState<Periode | undefined>(undefined);
  const [notificationsNonLues, setNotificationsNonLues] = useState(0);

  async function rafraichirNonLues() {
    setNotificationsNonLues(await compterNotificationsNonLues(session.boutiqueId, session.depotId ?? undefined));
  }

  /**
   * Bouton "Commander" sur une/des ligne(s) en rupture (Stock) : une boutique
   * sans fournisseur fabrique elle-même ses produits — pas de commande
   * possible, on l'emmène directement enregistrer une entrée de stock à la
   * place. Porté de Shell.tsx Electron ; la boutique avec fournisseur rouvre
   * Achats sur l'aperçu de commandes groupées, pré-rempli avec les lignes
   * choisies (voir ApercuCommandesGroupees dans Achats.tsx).
   */
  async function commanderProduit(lignes: LigneAchatInitiale[]) {
    const fournisseurs = await listerFournisseurs(session.boutiqueId);
    if (fournisseurs.length === 0) {
      setZone("stock");
      setLignesEntreeInitiales(lignes);
    } else {
      setZone("achats");
      setOuvrirNouvelleCommande(true);
      setLignesAchatInitiales(lignes);
    }
  }

  useEffect(() => {
    rafraichirNonLues();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zone]);

  function naviguer(cible: string) {
    if (cible === "achats:nouveau") {
      setZone("achats");
      setOuvrirNouvelleCommande(true);
    } else if (cible === "rapports:topClients") {
      setZone("rapports");
      setOngletRapportsInitial("topClients");
      setPeriodeRapportsInitiale("tout");
    } else if (cible === "rapports:tout") {
      setZone("rapports");
      setPeriodeRapportsInitiale("tout");
    } else if (cible === "stock:rupture") {
      setZone("stock");
      setFiltreRuptureInitial(true);
    } else {
      setZone(cible as Zone);
    }
  }

  useEffect(() => {
    // Une intention de sous-état ne doit servir qu'une fois : si l'utilisateur
    // quitte la zone concernée, on l'oublie pour ne pas la rouvrir plus tard
    // via la navigation normale (clic direct dans la barre latérale).
    if (zone !== "stock") {
      setFiltreRuptureInitial(false);
      // Voir la remarque équivalente côté Electron : ne pas vider avant que
      // Stock ait eu l'occasion de capturer ces lignes dans son propre état.
      setLignesEntreeInitiales([]);
    }
    if (zone !== "achats") {
      setOuvrirNouvelleCommande(false);
      // lignesAchatInitiales doit rester présent jusqu'au rendu où Achats le
      // capture dans son propre état local — même remarque que
      // lignesEntreeInitiales/Stock ci-dessus.
      setLignesAchatInitiales([]);
    }
    if (zone !== "rapports") {
      setOngletRapportsInitial(undefined);
      setPeriodeRapportsInitiale(undefined);
    }
  }, [zone]);

  function basculerBarreLaterale() {
    setBarreReduite((valeur) => {
      const nouvelleValeur = !valeur;
      localStorage.setItem("gs_barre_laterale_reduite", nouvelleValeur ? "1" : "0");
      return nouvelleValeur;
    });
  }

  return (
    <div className="shell">
      {zone !== "accueil" && (
      <aside className={`barre-laterale ${barreReduite ? "reduite" : ""}`}>
        <div className="logo">
          <button type="button" className="bouton-logo-accueil" onClick={() => setZone("accueil")} title="Accueil">
            <span className="logo-boutique-entete logo-boutique-nav-vide">
              {session.boutiqueNom.charAt(0).toUpperCase()}
            </span>
            <span className="texte-logo">Gestion Stock</span>
          </button>
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
                {z.cle === "notifications" ? (
                  <span className={`cloche ${notificationsNonLues > 0 ? "cloche-agitee" : ""}`}>
                    🔔
                    {notificationsNonLues > 0 && <span className="badge-cloche">{notificationsNonLues}</span>}
                  </span>
                ) : (
                  <span className="icone-nav">{z.icone}</span>
                )}
                <span className="texte-nav">{z.label}</span>
              </span>
            </button>
          ))}
        </nav>
      </aside>
      )}
      <div className="contenu-principal">
        <header className="entete">
          <div>
            <strong>{session.boutiqueNom}</strong>
            <span className="sous-info"> · {session.username} ({session.role})</span>
          </div>
          <div className="entete-droite">
            <button className="lien-deconnexion lien-deconnexion-entete" onClick={onDeconnexion}>
              <span className="icone-deconnexion">🚪</span>
              <span className="texte-deconnexion">Déconnexion</span>
            </button>
          </div>
        </header>
        <main className="zone-contenu">
          {zone === "accueil" && (
            <Accueil session={session} raccourcis={zonesAccessibles} onNaviguer={naviguer} />
          )}
          {zone === "tableauDeBord" && <TableauDeBord session={session} onNaviguer={naviguer} />}
          {zone === "caisse" && <Caisse session={session} />}
          {zone === "ventes" && <Ventes session={session} />}
          {zone === "produits" && <Produits session={session} />}
          {zone === "clients" && <Clients session={session} />}
          {zone === "achats" && (
            <Achats
              session={session}
              ouvrirNouvelleCommande={ouvrirNouvelleCommande}
              lignesAchatInitiales={lignesAchatInitiales}
              onOuvertureConsommee={() => setOuvrirNouvelleCommande(false)}
            />
          )}
          {zone === "tresorerie" && <Tresorerie session={session} />}
          {zone === "depense" && <Depense session={session} />}
          {zone === "rapports" && (
            <Rapports
              session={session}
              ongletInitial={ongletRapportsInitial}
              periodeInitiale={periodeRapportsInitiale}
            />
          )}
          {zone === "comptabilite" && <Comptabilite session={session} />}
          {zone === "stock" && (
            <Stock
              session={session}
              filtreRuptureInitial={filtreRuptureInitial}
              lignesEntreeInitiales={lignesEntreeInitiales}
              onCommander={commanderProduit}
            />
          )}
          {zone === "notifications" && (
            <Notifications session={session} onNaviguer={naviguer} onLues={rafraichirNonLues} />
          )}
          {zone === "messages" && <Messages session={session} />}
          {zone === "reglages" && <Reglages session={session} />}
        </main>
      </div>
    </div>
  );
}
