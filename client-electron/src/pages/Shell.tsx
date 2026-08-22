import { useEffect, useState } from "react";

import { api } from "../api/client";
import type { LigneAchatInitiale, Session } from "../api/client";
import BarreSynchro from "../components/BarreSynchro";
import { useLogoBoutique } from "../contexts/LogoContext";
import { useNomBoutique } from "../contexts/NomBoutiqueContext";
import Accueil from "./Accueil";
import Achats from "./Achats";
import Caisse from "./Caisse";
import Clients from "./Clients";
import type { OngletClients } from "./Clients";
import Comptabilite from "./Comptabilite";
import Depense from "./Depense";
import Produits from "./Produits";
import Messages from "./Messages";
import Notifications from "./Notifications";
import Rapports from "./Rapports";
import type { OngletRapports } from "./Rapports";
import type { Periode, StatutCredit } from "../api/client";
import Reglages from "./Reglages";
import Stock from "./Stock";
import TableauDeBord from "./TableauDeBord";
import Tresorerie from "./Tresorerie";
import Ventes from "./Ventes";

const ZONES = [
  { cle: "tableauDeBord", label: "Tableau de bord", icone: "📊", disponible: true },
  { cle: "caisse", label: "Caisse / Vente", icone: "🧾", disponible: true },
  { cle: "produits", label: "Articles", icone: "🏷️", disponible: true },
  { cle: "stock", label: "Stock", icone: "📦", disponible: true },
  { cle: "ventes", label: "Historique des ventes", icone: "📜", disponible: true },
  { cle: "achats", label: "Achats & fournisseurs", icone: "🚚", disponible: true },
  { cle: "clients", label: "Clients & crédit", icone: "👥", disponible: true },
  { cle: "tresorerie", label: "Trésorerie", icone: "💰", disponible: true },
  { cle: "depense", label: "Dépenses", icone: "💸", disponible: true },
  { cle: "rapports", label: "Rapports", icone: "📈", disponible: true },
  { cle: "comptabilite", label: "Comptabilité", icone: "📒", disponible: true },
  { cle: "notifications", label: "Notifications", icone: "🔔", disponible: true },
  { cle: "messages", label: "Messages", icone: "💬", disponible: true },
  { cle: "reglages", label: "Informations boutique", icone: "🏪", disponible: true },
] as const;

export type Zone = (typeof ZONES)[number]["cle"] | "accueil";

const TITRES_PAGE: Record<Zone, string> = {
  accueil: "Accueil",
  tableauDeBord: "Tableau de bord",
  caisse: "Caisse",
  produits: "Articles",
  stock: "Stock",
  ventes: "Historique des ventes",
  achats: "Achats & fournisseurs",
  clients: "Clients & crédit",
  tresorerie: "Trésorerie",
  depense: "Dépenses",
  rapports: "Rapports",
  comptabilite: "Comptabilité",
  notifications: "Notifications",
  messages: "Messages",
  reglages: "Informations boutique",
};

export default function Shell({
  session,
  onDeconnexion,
  onSessionMiseAJour,
}: {
  session: Session;
  onDeconnexion: () => void;
  onSessionMiseAJour: (session: Session) => void;
}) {
  const [zone, setZone] = useState<Zone>("accueil");
  const [barreReduite, setBarreReduite] = useState(
    () => localStorage.getItem("gs_barre_laterale_reduite") === "1",
  );
  const [version, setVersion] = useState("");

  useEffect(() => {
    api.systeme.version().then(setVersion);
  }, []);
  const [notificationsNonLues, setNotificationsNonLues] = useState(0);
  const [ouvrirNouvelleCommande, setOuvrirNouvelleCommande] = useState(false);
  const [ongletRapportsInitial, setOngletRapportsInitial] = useState<OngletRapports | undefined>(undefined);
  const [periodeRapportsInitiale, setPeriodeRapportsInitiale] = useState<Periode | undefined>(undefined);
  const [ongletClientsInitial, setOngletClientsInitial] = useState<OngletClients | undefined>(undefined);
  const [statutCreditsInitial, setStatutCreditsInitial] = useState<StatutCredit | "" | undefined>(undefined);
  const [filtreRuptureInitial, setFiltreRuptureInitial] = useState(false);
  const [lignesAchatInitiales, setLignesAchatInitiales] = useState<LigneAchatInitiale[]>([]);
  const [lignesEntreeInitiales, setLignesEntreeInitiales] = useState<LigneAchatInitiale[]>([]);
  const logo = useLogoBoutique();
  const nomBoutique = useNomBoutique();

  /**
   * Bouton "Commander" sur une/des ligne(s) en rupture (Stock ou détail d'une
   * notification) : une boutique sans fournisseur fabrique elle-même ses
   * produits — pas de commande possible, on l'emmène directement enregistrer
   * une entrée de stock à la place.
   */
  async function commanderProduit(lignes: LigneAchatInitiale[]) {
    const fournisseurs = await api.fournisseurs.lister(session.boutiqueId);
    if (fournisseurs.length === 0) {
      setZone("stock");
      setLignesEntreeInitiales(lignes);
    } else {
      setZone("achats");
      setOuvrirNouvelleCommande(true);
      setLignesAchatInitiales(lignes);
    }
  }

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
    } else if (cible === "clients:credits") {
      setZone("clients");
      setOngletClientsInitial("credits");
      setStatutCreditsInitial("en_cours");
    } else if (cible === "stock:rupture") {
      setZone("stock");
      setFiltreRuptureInitial(true);
    } else {
      setZone(cible as Zone);
    }
  }

  async function rafraichirNonLues() {
    setNotificationsNonLues(
      await api.notifications.compterNonLues(session.boutiqueId, session.depotId ?? undefined),
    );
  }

  // Clic sur le popup système d'alerte de rupture : amène direct sur la page Notifications.
  useEffect(() => api.systeme.onNaviguerNotifications(() => setZone("notifications")), []);

  useEffect(() => {
    rafraichirNonLues();
    // Une intention de sous-onglet ne doit servir qu'une fois : si l'utilisateur quitte
    // la zone concernée, on l'oublie pour ne pas rouvrir le même sous-onglet plus tard
    // via la navigation normale (clic direct dans la barre latérale).
    if (zone !== "rapports") {
      setOngletRapportsInitial(undefined);
      setPeriodeRapportsInitiale(undefined);
    }
    if (zone !== "clients") {
      setOngletClientsInitial(undefined);
      setStatutCreditsInitial(undefined);
    }
    if (zone !== "stock") {
      setFiltreRuptureInitial(false);
      // lignesEntreeInitiales doit rester présent jusqu'au rendu où Stock le
      // capture dans son propre état local (pas avant) : le vider plus tôt
      // ferait grouper les mises à jour par React et viderait l'écran avant
      // même qu'il apparaisse (voir la même remarque pour lignesAchatInitiales).
      setLignesEntreeInitiales([]);
    }
    if (zone !== "achats") setLignesAchatInitiales([]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
            {logo ? (
              <img src={logo} alt="" className="logo-boutique-entete" />
            ) : (
              <span className="logo-boutique-entete logo-boutique-nav-vide">
                {nomBoutique.charAt(0).toUpperCase()}
              </span>
            )}
            <span className="texte-logo">
              Gestion Stock
              {version && <span className="version-app">v{version}</span>}
            </span>
          </button>
          <button
            className="bouton-reduire-barre"
            onClick={basculerBarreLaterale}
            title={barreReduite ? "Ouvrir le menu" : "Réduire le menu"}
          >
            {barreReduite ? "»" : "«"}
          </button>
        </div>
        <nav>
          {ZONES.map((z) => (
            <button
              key={z.cle}
              className={`item-nav ${zone === z.cle ? "actif" : ""}`}
              disabled={!z.disponible}
              onClick={() => setZone(z.cle)}
              title={!z.disponible ? "Bientôt disponible" : barreReduite ? z.label : undefined}
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
              {!z.disponible && <span className="badge">à venir</span>}
            </button>
          ))}
        </nav>
        <button
          className="lien-deconnexion"
          onClick={onDeconnexion}
          title={barreReduite ? "Déconnexion" : undefined}
        >
          <span className="icone-deconnexion">🚪</span>
          <span className="texte-deconnexion">Déconnexion</span>
        </button>
      </aside>
      )}
      <div className="contenu-principal">
        <header className="entete">
          <div className="entete-gauche">
            <h1 className="titre-page">{TITRES_PAGE[zone]}</h1>
            <div className="entete-infos-boutique">
              <strong>{nomBoutique}</strong>
              <span className="sous-info"> · {session.username} ({session.role})</span>
            </div>
          </div>
          <BarreSynchro session={session} />
        </header>
        <main className="zone-contenu">
          {zone === "accueil" && (
            <Accueil session={session} raccourcis={ZONES} onNaviguer={naviguer} />
          )}
          {zone === "tableauDeBord" && (
            <TableauDeBord session={session} onNaviguer={naviguer} />
          )}
          {zone === "caisse" && <Caisse session={session} />}
          {zone === "produits" && <Produits session={session} />}
          {zone === "stock" && (
            <Stock
              session={session}
              filtreRuptureInitial={filtreRuptureInitial}
              lignesEntreeInitiales={lignesEntreeInitiales}
              onCommander={commanderProduit}
            />
          )}
          {zone === "ventes" && <Ventes session={session} />}
          {zone === "achats" && (
            <Achats
              session={session}
              ouvrirNouvelleCommande={ouvrirNouvelleCommande}
              lignesAchatInitiales={lignesAchatInitiales}
              onOuvertureConsommee={() => setOuvrirNouvelleCommande(false)}
            />
          )}
          {zone === "clients" && (
            <Clients
              session={session}
              ongletInitial={ongletClientsInitial}
              statutCreditsInitial={statutCreditsInitial}
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
          {zone === "reglages" && <Reglages session={session} onSessionMiseAJour={onSessionMiseAJour} />}
          {zone === "notifications" && (
            <Notifications
              session={session}
              onLues={rafraichirNonLues}
              onNaviguer={naviguer}
              onCommander={commanderProduit}
            />
          )}
          {zone === "messages" && <Messages session={session} />}
        </main>
      </div>
    </div>
  );
}
