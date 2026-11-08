import { useEffect, useMemo, useState } from "react";

import type { Moi } from "../api";
import { GROUPES, type Rubrique, rubriquesVisibles } from "../menu";
import { choisirTheme, THEMES, type Theme } from "../theme";

const CLE_MENU = "gs_admin_menu";
import Administrateurs from "../pages/Administrateurs";
import Boutiques from "../pages/Boutiques";
import Comptes from "../pages/Comptes";
import CreerBoutique from "../pages/CreerBoutique";
import DemandesReseau from "../pages/DemandesReseau";
import EnPreparation from "../pages/EnPreparation";
import Inscriptions from "../pages/Inscriptions";
import Journal from "../pages/Journal";
import MonMotDePasse from "../pages/MonMotDePasse";
import Paiements from "../pages/Paiements";
import Reglages from "../pages/Reglages";
import Signalements from "../pages/Signalements";
import LaissezPasser from "../pages/LaissezPasser";
import TableauDeBord from "../pages/TableauDeBord";

interface Props {
  moi: Moi;
  surDeconnexion: () => void;
  /** Recharge le profil (après le changement d'un mot de passe provisoire). */
  surProfilChange: () => void;
}

const PAGES: Record<string, (moi: Moi) => JSX.Element> = {
  "tableau-de-bord": () => <TableauDeBord />,
  boutiques: () => <Boutiques />,
  inscriptions: () => <Inscriptions />,
  "creer-boutique": () => <CreerBoutique />,
  comptes: () => <Comptes />,
  paiements: () => <Paiements />,
  "demandes-reseau": () => <DemandesReseau />,
  signalements: () => <Signalements />,
  "laissez-passer": () => <LaissezPasser />,
  administrateurs: (moi) => <Administrateurs moi={moi} />,
  reglages: () => <Reglages />,
  journal: () => <Journal />,
  "mon-mot-de-passe": () => <MonMotDePasse />,
};

// Hors menu principal : accessible à tout administrateur depuis le pied de la barre.
const MON_MOT_DE_PASSE: Rubrique = {
  id: "mon-mot-de-passe",
  libelle: "Mon mot de passe",
  icone: "🔑",
  droit: null,
  groupe: "suivi",
  lot: 5,
};

/** Adresse « #/boutiques/<id> » : la rubrique est le premier segment. */
function rubriqueDeLAdresse(visibles: Rubrique[]): Rubrique {
  const id = window.location.hash.replace(/^#\/?/, "").split("/")[0];
  if (id === MON_MOT_DE_PASSE.id) return MON_MOT_DE_PASSE;
  return visibles.find((r) => r.id === id) ?? visibles[0];
}

export default function Coquille({ moi, surDeconnexion, surProfilChange }: Props) {
  const visibles = useMemo(() => rubriquesVisibles(moi.droits), [moi.droits]);
  const [active, setActive] = useState<Rubrique>(() => rubriqueDeLAdresse(visibles));

  useEffect(() => {
    const suivre = () => setActive(rubriqueDeLAdresse(visibles));
    window.addEventListener("hashchange", suivre);
    return () => window.removeEventListener("hashchange", suivre);
  }, [visibles]);

  const groupes = (Object.keys(GROUPES) as Rubrique["groupe"][])
    .map((g) => ({ groupe: g, rubriques: visibles.filter((r) => r.groupe === g) }))
    .filter((g) => g.rubriques.length > 0);

  // Menu principal masquable (plus de place pour les tableaux) ; retenu dans ce navigateur.
  const [menuVisible, setMenuVisible] = useState(() => {
    try {
      return localStorage.getItem(CLE_MENU) !== "masque";
    } catch {
      return true;
    }
  });
  function basculerMenu() {
    setMenuVisible((visible) => {
      try {
        localStorage.setItem(CLE_MENU, visible ? "masque" : "visible");
      } catch {
        // stockage indisponible : le choix vaut pour cette page seulement
      }
      return !visible;
    });
  }

  // Mot de passe provisoire : il faut d'abord choisir le sien, rien d'autre n'est accessible.
  const impose = moi.doit_changer_mot_de_passe;
  const affichee = impose ? MON_MOT_DE_PASSE : active;

  return (
    <div className={`coquille${menuVisible ? "" : " menu-masque"}`}>
      <nav className="barre-laterale" aria-label="Menu" hidden={!menuVisible}>
        <div className="barre-marque">
          <span className="barre-pastille">GS</span>
          <span>
            <strong>Gestion Stock</strong>
            <small>Administration</small>
          </span>
        </div>

        {!impose &&
          groupes.map(({ groupe, rubriques }) => (
            <div key={groupe} className="groupe-menu">
              <p className="titre-groupe">{GROUPES[groupe]}</p>
              {rubriques.map((r) => (
                <a key={r.id} href={`#/${r.id}`} className={`lien-menu${r.id === active.id ? " actif" : ""}`}>
                  <span className="icone-menu" aria-hidden>
                    {r.icone}
                  </span>
                  {r.libelle}
                </a>
              ))}
            </div>
          ))}

        <div className="barre-pied">
          <div className="compte-connecte">
            <strong>{moi.nom || moi.username}</strong>
            <small>{moi.superuser ? "Administrateur principal" : "Administrateur"}</small>
            {moi.double_verification_active && <small className="pastille-2fa">🔒 Double vérification</small>}
          </div>
          <ChoixTheme initial={moi.theme} />
          {!impose && (
            <a href="#/mon-mot-de-passe" className={`lien-menu${active.id === MON_MOT_DE_PASSE.id ? " actif" : ""}`}>
              <span className="icone-menu" aria-hidden>
                🔑
              </span>
              Mon mot de passe
            </a>
          )}
          <button type="button" className="bouton-secondaire" onClick={surDeconnexion}>
            Se déconnecter
          </button>
        </div>
      </nav>

      <main className="contenu">
        <header className="entete-page">
          <button
            type="button"
            className="bouton-menu"
            onClick={basculerMenu}
            aria-expanded={menuVisible}
            title={menuVisible ? "Masquer le menu" : "Afficher le menu"}
          >
            {menuVisible ? "⟨" : "☰"}
            <span className="libelle-bouton-menu">{menuVisible ? "Masquer le menu" : "Menu"}</span>
          </button>
          <h1>
            <span aria-hidden>{affichee.icone}</span> {affichee.libelle}
          </h1>
        </header>
        {impose ? (
          <MonMotDePasse impose surChange={surProfilChange} />
        ) : PAGES[affichee.id] ? (
          PAGES[affichee.id](moi)
        ) : (
          <EnPreparation rubrique={affichee} />
        )}
      </main>
    </div>
  );
}

/** Thème du site, attaché au compte : appliqué tout de suite, enregistré sur le serveur. */
function ChoixTheme({ initial }: { initial: string }) {
  const [theme, setTheme] = useState<Theme>(() => (THEMES.some((t) => t.valeur === initial) ? (initial as Theme) : "clair"));
  const [erreur, setErreur] = useState(false);
  return (
    <label className="choix-theme">
      <span>🎨 Thème</span>
      <select
        value={theme}
        onChange={async (e) => {
          const valeur = e.target.value as Theme;
          setTheme(valeur);
          setErreur(false);
          try {
            await choisirTheme(valeur);
          } catch {
            setErreur(true);
          }
        }}
      >
        {THEMES.map((t) => (
          <option key={t.valeur} value={t.valeur}>
            {t.icone} {t.libelle}
          </option>
        ))}
      </select>
      {erreur && <small className="erreur-champ">Non enregistré sur votre compte (réessayez).</small>}
    </label>
  );
}
