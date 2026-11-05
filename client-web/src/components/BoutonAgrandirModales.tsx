import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

const CLE_STOCKAGE = "modalesAgrandies";
const CLASSE_AGRANDIES = "modales-agrandies";
const CLASSE_BOUTON = "bouton-agrandir-modale";

function libelle(agrandies: boolean) {
  return agrandies ? "⤡ Réduire" : "⤢ Plein écran";
}

/**
 * Bouton « ⤢ Plein écran / ⤡ Réduire » des grandes fenêtres (.modale-selection-produits).
 * Placé juste avant le « ← Retour » de l'en-tête de la fenêtre du dessus, sur la même
 * ligne ; sans « ← Retour », dans le coin haut-droit. Le choix vaut pour toutes les
 * grandes fenêtres et reste mémorisé : elles gardent toutes la même taille.
 * Monté une fois (main.tsx) : aucune fenêtre n'a à l'intégrer elle-même.
 */
export default function BoutonAgrandirModales() {
  const [agrandies, setAgrandies] = useState(() => localStorage.getItem(CLE_STOCKAGE) === "1");
  const [coin, setCoin] = useState<{ top: number; right: number } | null>(null);

  useEffect(() => {
    document.body.classList.toggle(CLASSE_AGRANDIES, agrandies);
    localStorage.setItem(CLE_STOCKAGE, agrandies ? "1" : "0");
  }, [agrandies]);

  useEffect(() => {
    // Bouton natif glissé dans l'en-tête de la fenêtre (hors de l'arbre React de la page).
    const bouton = document.createElement("button");
    bouton.type = "button";
    bouton.className = `lien bouton-retour ${CLASSE_BOUTON}`;
    bouton.textContent = libelle(agrandies);
    bouton.title = agrandies ? "Revenir à la taille normale (toutes les fenêtres)" : "Plein écran (toutes les fenêtres)";
    bouton.addEventListener("click", () => setAgrandies((a) => !a));

    let image = 0;
    function placer() {
      cancelAnimationFrame(image);
      image = requestAnimationFrame(() => {
        // Seule la fenêtre du dessus compte : une petite confirmation ouverte par-dessus masque le bouton.
        const fonds = document.querySelectorAll(".fond-modale");
        const modale = fonds[fonds.length - 1]?.querySelector(".modale-selection-produits");
        if (!modale) {
          bouton.remove();
          setCoin((actuel) => (actuel === null ? actuel : null));
          return;
        }
        // Le « ← Retour » le plus haut de la fenêtre : celui de son en-tête.
        const retour = [...modale.querySelectorAll<HTMLElement>(`.bouton-retour:not(.${CLASSE_BOUTON})`)]
          .filter((b) => b.offsetParent !== null)
          .sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top)[0];
        if (retour) {
          if (retour.previousElementSibling !== bouton) retour.before(bouton);
          setCoin((actuel) => (actuel === null ? actuel : null));
          return;
        }
        bouton.remove();
        const cadre = modale.getBoundingClientRect();
        const top = Math.round(cadre.top) + 10;
        const right = Math.round(window.innerWidth - cadre.right) + 12;
        setCoin((actuel) => (actuel && actuel.top === top && actuel.right === right ? actuel : { top, right }));
      });
    }
    placer();
    const observateur = new MutationObserver(placer);
    observateur.observe(document.body, { childList: true, subtree: true });
    window.addEventListener("resize", placer);
    return () => {
      cancelAnimationFrame(image);
      observateur.disconnect();
      window.removeEventListener("resize", placer);
      bouton.remove();
    };
  }, [agrandies]);

  if (!coin) return null;
  return createPortal(
    <button
      type="button"
      className={`lien bouton-retour ${CLASSE_BOUTON} ${CLASSE_BOUTON}-coin`}
      style={{ top: coin.top, right: coin.right }}
      onClick={() => setAgrandies((a) => !a)}
    >
      {libelle(agrandies)}
    </button>,
    document.body,
  );
}
