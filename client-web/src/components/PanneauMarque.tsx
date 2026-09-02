import type { CSSProperties } from "react";
import { useEffect, useState } from "react";

const ATOUTS = [
  { icone: "📦", texte: "Stock à jour en temps réel, dépôt par dépôt" },
  { icone: "🧾", texte: "Caisse rapide, même sans connexion internet" },
  { icone: "📊", texte: "Rapports clairs sur vos ventes et bénéfices" },
];

const INTERVALLE_ROTATION_MS = 4500;

/**
 * Icônes du métier qui dérivent en arrière-plan du panneau, chacune sa
 * trajectoire (même mécanique que CERCLES_FOND/@keyframes defiler-cercle
 * déjà utilisée sur Accueil/Stock/Achats/Produits/Clients — voir index.css) :
 * pas un seul et même défilé, certaines montent, d'autres descendent ou
 * traversent en sens inverse.
 */
const ICONES_FLOTTANTES = [
  { icone: "📦", taille: 46, duree: 24, delai: -3, depart: ["-8vw", "10vh"], arrivee: ["38vw", "55vh"] },
  { icone: "🏷️", taille: 34, duree: 19, delai: -11, depart: ["40vw", "75vh"], arrivee: ["-8vw", "20vh"] },
  { icone: "🧾", taille: 40, duree: 27, delai: -6, depart: ["15vw", "105vh"], arrivee: ["30vw", "-15vh"] },
  { icone: "📊", taille: 30, duree: 21, delai: -16, depart: ["35vw", "-12vh"], arrivee: ["5vw", "110vh"] },
  { icone: "💰", taille: 38, duree: 25, delai: -8, depart: ["-8vw", "85vh"], arrivee: ["42vw", "25vh"] },
  { icone: "🛍️", taille: 44, duree: 30, delai: -19, depart: ["42vw", "40vh"], arrivee: ["-10vw", "70vh"] },
  { icone: "🔖", taille: 28, duree: 18, delai: -2, depart: ["10vw", "-10vh"], arrivee: ["25vw", "108vh"] },
  { icone: "📦", taille: 36, duree: 23, delai: -14, depart: ["44vw", "95vh"], arrivee: ["8vw", "-12vh"] },
] as const;

/**
 * Panneau de marque affiché à gauche des écrans de connexion/inscription/mot
 * de passe oublié. Les atouts défilent un par un (plutôt qu'empilés) pour
 * donner du mouvement à l'écran de connexion ; en pause si l'utilisateur a
 * demandé moins de mouvement (prefers-reduced-motion), et navigable au clic
 * sur les puces sans attendre la rotation automatique.
 */
export default function PanneauMarque() {
  const [index, setIndex] = useState(0);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const identifiant = setInterval(() => {
      setIndex((actuel) => (actuel + 1) % ATOUTS.length);
    }, INTERVALLE_ROTATION_MS);
    return () => clearInterval(identifiant);
  }, []);

  const atout = ATOUTS[index];

  return (
    <div className="panneau-marque">
      {ICONES_FLOTTANTES.map((f, i) => (
        <span
          key={i}
          aria-hidden="true"
          className="icone-flottante-marque"
          style={
            {
              width: f.taille,
              height: f.taille,
              fontSize: f.taille * 0.5,
              animationDuration: `${f.duree}s`,
              animationDelay: `${f.delai}s`,
              "--depart-x": f.depart[0],
              "--depart-y": f.depart[1],
              "--arrivee-x": f.arrivee[0],
              "--arrivee-y": f.arrivee[1],
            } as CSSProperties
          }
        >
          {f.icone}
        </span>
      ))}
      <h2 className="marque-titre">Pilotez votre boutique en toute simplicité.</h2>
      <p className="marque-sous-titre">
        Stock, ventes, achats et clients réunis dans une seule application, pensée pour fonctionner même hors-ligne.
      </p>
      <div className="marque-carrousel" key={index}>
        <span className="icone-atout icone-atout-grande">{atout.icone}</span>
        <p className="marque-carrousel-texte">{atout.texte}</p>
      </div>
      <div className="marque-carrousel-puces">
        {ATOUTS.map((a, i) => (
          <button
            key={a.texte}
            type="button"
            className={`puce-carrousel ${i === index ? "actif" : ""}`}
            aria-label={`Atout ${i + 1} sur ${ATOUTS.length}`}
            onClick={() => setIndex(i)}
          />
        ))}
      </div>
      <div className="marque-logo">
        <span className="marque-logo-pastille">GS</span>
        Gestion Stock
      </div>
    </div>
  );
}
