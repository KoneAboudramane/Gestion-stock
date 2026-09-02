import { useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";

import { api } from "../api";
import type { LigneStock, LigneTopClient, LigneVentesParJour, Session, SyntheseVentes } from "../api";
import { useDevise } from "../contexts/DeviseContext";

/**
 * Adapté de client-electron/src/pages/TableauDeBord.tsx : mêmes cartes/graphique,
 * mais sans la carte "Crédits en attente" (app clients non portée sur le web) ni
 * les raccourcis de navigation vers Caisse/Produits/Achats (zones absentes ici).
 */

/**
 * Ronds défilants du fond (même patron que Accueil.tsx) : tailles/vitesses/
 * délais variés, trajectoire propre à chacun (départ → arrivée en vw/vh),
 * couleur --cercle-N (index.css — cycle des teintes sémantiques par défaut,
 * réassorti à l'identité propre de certains thèmes comme Orange).
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

const FORMATEUR_DATE_LONGUE = new Intl.DateTimeFormat("fr-FR", {
  weekday: "long",
  day: "numeric",
  month: "long",
  year: "numeric",
});

function formatJour(date: Date): string {
  const annee = date.getFullYear();
  const mois = String(date.getMonth() + 1).padStart(2, "0");
  const jour = String(date.getDate()).padStart(2, "0");
  return `${annee}-${mois}-${jour}`;
}

function plageDerniersJours(nombreJours: number): { debut: string; fin: string } {
  const aujourdHui = new Date();
  const debut = new Date(aujourdHui);
  debut.setDate(aujourdHui.getDate() - (nombreJours - 1));
  return { debut: `${formatJour(debut)}T00:00:00.000Z`, fin: `${formatJour(aujourdHui)}T23:59:59.999Z` };
}

function parseJourLocal(chaineJour: string): Date {
  const [annee, mois, jour] = chaineJour.split("-").map(Number);
  return new Date(annee, mois - 1, jour);
}

function construireSerieJours(debut: string, fin: string, donnees: LigneVentesParJour[]): LigneVentesParJour[] {
  const parJour = new Map(donnees.map((d) => [d.jour, d.totalNet]));
  const serie: LigneVentesParJour[] = [];
  const curseur = parseJourLocal(debut.slice(0, 10));
  const finDate = parseJourLocal(fin.slice(0, 10));
  while (curseur <= finDate) {
    const jour = formatJour(curseur);
    serie.push({ jour, totalNet: parJour.get(jour) ?? 0 });
    curseur.setDate(curseur.getDate() + 1);
  }
  return serie;
}

/**
 * Fait défiler un nombre de 0 jusqu'à `valeurCible` (effet "compteur qui
 * tourne" sur les cartes de statistiques). Repart de 0 à chaque nouvelle
 * cible reçue (donc une seule fois par ouverture de page dans la pratique,
 * puisque la synthèse du jour n'est chargée qu'au montage). Respecte
 * prefers-reduced-motion en affichant directement la valeur finale.
 */
function useCompteurAnime(valeurCible: number | null, dureeMs = 900): number {
  const [valeurAffichee, setValeurAffichee] = useState(0);
  const reduireMouvement = useRef(
    typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );

  useEffect(() => {
    if (valeurCible === null) return;
    const cible = valeurCible;
    if (reduireMouvement.current) {
      setValeurAffichee(cible);
      return;
    }
    const depart = performance.now();
    let idAnimation: number;
    function etape(maintenant: number) {
      const progression = Math.min(1, (maintenant - depart) / dureeMs);
      const facilite = 1 - Math.pow(1 - progression, 3); // ease-out cubic
      setValeurAffichee(Math.round(cible * facilite));
      if (progression < 1) idAnimation = requestAnimationFrame(etape);
    }
    idAnimation = requestAnimationFrame(etape);
    return () => cancelAnimationFrame(idAnimation);
  }, [valeurCible, dureeMs]);

  return valeurCible === null ? 0 : valeurAffichee;
}

type SensVariation = "hausse" | "baisse" | "stable" | "nouveau";

/**
 * Variation du CA du jour vs hier, affichée en petit badge à côté de la
 * valeur. "précédent" à 0 est un cas particulier : un pourcentage n'a pas de
 * sens (division par zéro) — on affiche "Nouveau" plutôt qu'un % absurde. Si
 * les deux valent 0, rien à signaler (pas de badge).
 */
function calculerVariation(actuel: number | null, precedent: number | null): { texte: string; sens: SensVariation } | null {
  if (actuel === null || precedent === null) return null;
  if (precedent === 0) {
    if (actuel === 0) return null;
    return { texte: "Nouveau", sens: "nouveau" };
  }
  const pourcentage = Math.round(((actuel - precedent) / precedent) * 100);
  if (pourcentage === 0) return { texte: "0%", sens: "stable" };
  return { texte: `${pourcentage > 0 ? "+" : ""}${pourcentage}%`, sens: pourcentage > 0 ? "hausse" : "baisse" };
}

const OPTIONS_PERIODE_GRAPHIQUE = [
  { valeur: "14", label: "14 derniers jours" },
  { valeur: "30", label: "30 derniers jours" },
  { valeur: "90", label: "90 derniers jours" },
  { valeur: "personnalise", label: "Période personnalisée" },
] as const;

type PeriodeGraphique = (typeof OPTIONS_PERIODE_GRAPHIQUE)[number]["valeur"];

/**
 * Courbe lissée passant exactement par chaque point, via une spline cubique
 * monotone (méthode de Fritsch-Carlson, la même que la courbe "monotoneX" de
 * D3) : contrairement à un lissage de Catmull-Rom classique, les tangentes
 * sont ajustées pour que la courbe ne déborde jamais sous/au-dessus des
 * valeurs voisines — essentiel ici pour ne pas laisser la courbe plonger sous
 * l'axe 0 autour d'une suite de jours sans vente.
 */
function ligneLissee(points: { x: number; y: number }[]): string {
  const n = points.length;
  if (n === 0) return "";
  if (n === 1) return `M ${points[0].x} ${points[0].y}`;
  if (n === 2) return `M ${points[0].x} ${points[0].y} L ${points[1].x} ${points[1].y}`;

  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const dxs: number[] = [];
  const pentes: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    dxs.push(xs[i + 1] - xs[i]);
    pentes.push((ys[i + 1] - ys[i]) / dxs[i]);
  }

  const tangentes: number[] = [pentes[0]];
  for (let i = 1; i < n - 1; i++) {
    tangentes.push(pentes[i - 1] * pentes[i] <= 0 ? 0 : (pentes[i - 1] + pentes[i]) / 2);
  }
  tangentes.push(pentes[n - 2]);

  for (let i = 0; i < n - 1; i++) {
    if (pentes[i] === 0) {
      tangentes[i] = 0;
      tangentes[i + 1] = 0;
      continue;
    }
    const a = tangentes[i] / pentes[i];
    const b = tangentes[i + 1] / pentes[i];
    const h = Math.sqrt(a * a + b * b);
    if (h > 3) {
      const t = 3 / h;
      tangentes[i] = t * a * pentes[i];
      tangentes[i + 1] = t * b * pentes[i];
    }
  }

  let d = `M ${xs[0]} ${ys[0]}`;
  for (let i = 0; i < n - 1; i++) {
    const dx = dxs[i];
    const cp1x = xs[i] + dx / 3;
    const cp1y = ys[i] + (tangentes[i] * dx) / 3;
    const cp2x = xs[i + 1] - dx / 3;
    const cp2y = ys[i + 1] - (tangentes[i + 1] * dx) / 3;
    d += ` C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${xs[i + 1]} ${ys[i + 1]}`;
  }
  return d;
}

function GraphiqueVentesJournalieres({ serie, devise }: { serie: LigneVentesParJour[]; devise: string }) {
  const largeur = 700;
  const hauteur = 200;
  const margeBasse = 22;
  const margeHaute = 12;
  const margeGauche = 48;
  const margeDroite = 16;
  const largeurUtile = largeur - margeGauche - margeDroite;
  const hauteurDisponible = hauteur - margeBasse - margeHaute;
  const maximum = Math.max(1, ...serie.map((j) => j.totalNet));
  const pas = serie.length > 1 ? largeurUtile / (serie.length - 1) : 0;
  const [indexSurvole, setIndexSurvole] = useState<number | null>(null);

  const points = serie.map((j, i) => ({
    x: serie.length > 1 ? margeGauche + i * pas : margeGauche + largeurUtile / 2,
    y: margeHaute + hauteurDisponible - (j.totalNet / maximum) * hauteurDisponible,
    jour: j.jour,
    totalNet: j.totalNet,
  }));

  const chemin = ligneLissee(points);
  const bas = hauteur - margeBasse;
  const cheminAire =
    points.length > 0 ? `${chemin} L ${points[points.length - 1].x} ${bas} L ${points[0].x} ${bas} Z` : "";

  const pasEtiquette = Math.max(1, Math.ceil(serie.length / 15));
  const nombreNiveauxY = 4;
  const niveauxY = Array.from({ length: nombreNiveauxY + 1 }, (_, i) => i);

  function gererSurvol(evenement: React.MouseEvent<SVGSVGElement>) {
    if (points.length === 0 || pas <= 0) return;
    const svg = evenement.currentTarget;
    const point = svg.createSVGPoint();
    point.x = evenement.clientX;
    point.y = evenement.clientY;
    const ctm = svg.getScreenCTM();
    if (!ctm) return;
    const position = point.matrixTransform(ctm.inverse());
    const indexApprox = Math.round((position.x - margeGauche) / pas);
    setIndexSurvole(Math.min(points.length - 1, Math.max(0, indexApprox)));
  }

  const pointActif = indexSurvole !== null ? points[indexSurvole] : null;

  return (
    <div className="conteneur-graphique-ventes">
      <svg
        viewBox={`0 0 ${largeur} ${hauteur}`}
        className="graphique-ventes"
        role="img"
        aria-label="Chiffre d'affaires par jour"
        preserveAspectRatio="none"
        onMouseMove={gererSurvol}
        onMouseLeave={() => setIndexSurvole(null)}
      >
        {niveauxY.map((n, index) => {
          const valeur = Math.round((maximum * n) / nombreNiveauxY);
          const valeurPrecedente =
            index > 0 ? Math.round((maximum * niveauxY[index - 1]) / nombreNiveauxY) : null;
          const y = margeHaute + hauteurDisponible - (n / nombreNiveauxY) * hauteurDisponible;
          return (
            <g key={n}>
              <line x1={margeGauche} y1={y} x2={largeur - margeDroite} y2={y} className="grille-graphique-ventes" />
              {valeur !== valeurPrecedente && (
                <text x={margeGauche - 6} y={y + 3} textAnchor="end" className="etiquette-axe-graphique">
                  {valeur}
                </text>
              )}
            </g>
          );
        })}

        {cheminAire && <path d={cheminAire} className="aire-vente-jour" />}
        {/* pathLength=1 : normalise la longueur du tracé à 1 quelle que soit sa
            géométrie réelle, pour piloter l'animation de "dessin" en CSS
            (stroke-dasharray/-dashoffset) sans avoir à mesurer le chemin en JS. */}
        <path d={chemin} className="ligne-vente-jour" fill="none" pathLength={1} />

        {pointActif && (
          <line x1={pointActif.x} y1={margeHaute} x2={pointActif.x} y2={bas} className="ligne-survol-graphique" />
        )}

        {points.map((p, i) => (
          <g key={p.jour}>
            <circle cx={p.x} cy={p.y} r={i === indexSurvole ? 4 : 2.5} className="point-vente-jour" />
            {i % pasEtiquette === 0 && (
              <text x={p.x} y={hauteur - 6} textAnchor="middle" className="etiquette-jour-graphique">
                {new Date(`${p.jour}T00:00:00`).getDate()}
              </text>
            )}
          </g>
        ))}
      </svg>
      {pointActif && (
        <div className="infobulle-graphique-ventes" style={{ left: `${(pointActif.x / largeur) * 100}%` }}>
          <strong>
            {pointActif.totalNet} {devise}
          </strong>
          <span>{new Date(`${pointActif.jour}T00:00:00`).toLocaleDateString("fr-FR")}</span>
        </div>
      )}
    </div>
  );
}

export default function TableauDeBord({
  session,
  onNaviguer,
}: {
  session: Session;
  onNaviguer: (zone: string) => void;
}) {
  const peutVoirBenefices = !!session.permissions.voir_benefices_achat;
  const devise = useDevise();
  const [synthese, setSynthese] = useState<SyntheseVentes | null>(null);
  const [totalNetVeille, setTotalNetVeille] = useState<number | null>(null);
  const [ruptures, setRuptures] = useState<LigneStock[]>([]);
  const [serieVentes, setSerieVentes] = useState<LigneVentesParJour[]>([]);
  const [meilleursClients, setMeilleursClients] = useState<LigneTopClient[]>([]);
  const [periodeGraphique, setPeriodeGraphique] = useState<PeriodeGraphique>("14");
  const [debutPerso, setDebutPerso] = useState(() => plageDerniersJours(14).debut.slice(0, 10));
  const [finPerso, setFinPerso] = useState(() => plageDerniersJours(14).fin.slice(0, 10));
  const [periodeClients, setPeriodeClients] = useState<PeriodeGraphique>("90");
  const [debutClientsPerso, setDebutClientsPerso] = useState(() => plageDerniersJours(90).debut.slice(0, 10));
  const [finClientsPerso, setFinClientsPerso] = useState(() => plageDerniersJours(90).fin.slice(0, 10));

  useEffect(() => {
    api.rapports.plageDates("jour").then((plage) => {
      api.rapports.syntheseVentes(plage.debut, plage.fin).then((r) => r.succes && setSynthese(r.resultat));
    });
    api.stock.lister().then((r) => r.succes && setRuptures(r.resultat.filter((l) => l.enRupture)));

    const hier = new Date();
    hier.setDate(hier.getDate() - 1);
    const jourHier = formatJour(hier);
    api.rapports
      .syntheseVentes(`${jourHier}T00:00:00.000Z`, `${jourHier}T23:59:59.999Z`)
      .then((r) => r.succes && setTotalNetVeille(r.resultat.totalNet));
  }, []);

  useEffect(() => {
    const plage =
      periodeGraphique === "personnalise"
        ? { debut: `${debutPerso}T00:00:00.000Z`, fin: `${finPerso}T23:59:59.999Z` }
        : plageDerniersJours(Number(periodeGraphique));
    api.rapports.ventesParJour(plage.debut, plage.fin).then((r) => {
      if (r.succes) setSerieVentes(construireSerieJours(plage.debut, plage.fin, r.resultat));
    });
  }, [periodeGraphique, debutPerso, finPerso]);

  useEffect(() => {
    const plage =
      periodeClients === "personnalise"
        ? { debut: `${debutClientsPerso}T00:00:00.000Z`, fin: `${finClientsPerso}T23:59:59.999Z` }
        : plageDerniersJours(Number(periodeClients));
    api.rapports.topClients(plage.debut, plage.fin, 5).then((r) => r.succes && setMeilleursClients(r.resultat));
  }, [periodeClients, debutClientsPerso, finClientsPerso]);

  const nombreVentesAnime = useCompteurAnime(synthese?.nombreVentes ?? null);
  const totalNetAnime = useCompteurAnime(synthese?.totalNet ?? null);
  const beneficeAnime = useCompteurAnime(synthese?.beneficeTotal ?? null);
  const ruptureAnimee = useCompteurAnime(ruptures.length);
  const variationCA = calculerVariation(synthese?.totalNet ?? null, totalNetVeille);

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
        <h2>Bonjour, {session.username}</h2>
        <span className="date-tableau-bord">{FORMATEUR_DATE_LONGUE.format(new Date())}</span>
      </div>

      <div className="grille-tableau-bord">
        <div className="carte-stat carte-stat--bleu">
          <span className="carte-stat-icone" aria-hidden="true">🧾</span>
          <span className="carte-stat-corps">
            <span className="carte-stat-label">
              Ventes du jour
              <span className="point-vivant" title="Chiffre du jour, mis à jour en direct" />
            </span>
            <span className="carte-stat-valeur">{synthese ? nombreVentesAnime : ""}</span>
          </span>
        </div>
        <div className="carte-stat carte-stat--vert">
          <span className="carte-stat-icone" aria-hidden="true">💵</span>
          <span className="carte-stat-corps">
            <span className="carte-stat-label">CA du jour</span>
            <span className="carte-stat-valeur-ligne">
              <span className="carte-stat-valeur">{synthese ? `${totalNetAnime} ${devise}` : ""}</span>
              {variationCA && (
                <span className={`badge-variation badge-variation--${variationCA.sens}`}>
                  {variationCA.sens === "hausse" && "▲ "}
                  {variationCA.sens === "baisse" && "▼ "}
                  {variationCA.texte}
                </span>
              )}
            </span>
          </span>
        </div>
        {peutVoirBenefices && (
          <div className="carte-stat carte-stat--violet">
            <span className="carte-stat-icone" aria-hidden="true">📈</span>
            <span className="carte-stat-corps">
              <span className="carte-stat-label">Bénéfice du jour</span>
              <span className="carte-stat-valeur">{synthese ? `${beneficeAnime} ${devise}` : ""}</span>
            </span>
          </div>
        )}
        <div className={`carte-stat carte-stat--ambre ${ruptures.length > 0 ? "carte-stat--alerte" : ""}`}>
          <span className="carte-stat-icone" aria-hidden="true">📦</span>
          <span className="carte-stat-corps">
            <span className="carte-stat-label">Alertes de rupture</span>
            <span className={`carte-stat-valeur ${ruptures.length > 0 ? "carte-stat-alerte" : ""}`}>
              {ruptureAnimee}
            </span>
          </span>
        </div>
      </div>

      <div className="detail-produit">
        <h3>⚡ Actions rapides</h3>
        <div className="grille-documents-comptables">
          <button type="button" className="carte-document-comptable" onClick={() => onNaviguer("caisse")}>
            <span className="icone-document-comptable">🧾</span>
            Nouvelle vente
          </button>
          <button type="button" className="carte-document-comptable" onClick={() => onNaviguer("produits")}>
            <span className="icone-document-comptable">🏷️</span>
            Gérer les articles
          </button>
          <button type="button" className="carte-document-comptable" onClick={() => onNaviguer("stock")}>
            <span className="icone-document-comptable">📦</span>
            Voir le stock
          </button>
          <button type="button" className="carte-document-comptable" onClick={() => onNaviguer("achats:nouveau")}>
            <span className="icone-document-comptable">🚚</span>
            Nouvel achat
          </button>
          <button type="button" className="carte-document-comptable" onClick={() => onNaviguer("clients")}>
            <span className="icone-document-comptable">👥</span>
            Clients & crédit
          </button>
        </div>
      </div>

      <div className="detail-produit detail-produit--hero">
        <div className="entete-detail">
          <h3>
            <button type="button" className="lien-titre-carte" onClick={() => onNaviguer("rapports:tout")}>
              📈 Chiffre d'affaires <span aria-hidden="true">→</span>
            </button>
          </h3>
          <div className="barre-actions">
            <select
              value={periodeGraphique}
              onChange={(e) => setPeriodeGraphique(e.target.value as PeriodeGraphique)}
            >
              {OPTIONS_PERIODE_GRAPHIQUE.map((o) => (
                <option key={o.valeur} value={o.valeur}>
                  {o.label}
                </option>
              ))}
            </select>
            {periodeGraphique === "personnalise" && (
              <>
                <input type="date" value={debutPerso} onChange={(e) => setDebutPerso(e.target.value)} />
                <input type="date" value={finPerso} onChange={(e) => setFinPerso(e.target.value)} />
              </>
            )}
          </div>
        </div>
        {serieVentes.length === 0 ? (
          <p className="note-aide">Chargement…</p>
        ) : serieVentes.every((j) => j.totalNet === 0) ? (
          <p className="note-aide">Aucune vente sur cette période.</p>
        ) : (
          <GraphiqueVentesJournalieres serie={serieVentes} devise={devise} />
        )}
      </div>

      <div className="deux-colonnes">
        <div className="detail-produit">
          <h3>
            <button type="button" className="lien-titre-carte" onClick={() => onNaviguer("stock:rupture")}>
              📦 Alertes de rupture <span aria-hidden="true">→</span>
            </button>
          </h3>
          <div className="zone-tableau-scroll">
            <table className="tableau-catalogue carte-mobile">
              <thead>
                <tr>
                  <th>N°</th>
                  <th>Désignation</th>
                  <th>Dépôt</th>
                  <th>Quantité</th>
                  <th>Seuil</th>
                </tr>
              </thead>
              <tbody>
                {ruptures.slice(0, 5).map((l, index) => (
                  <tr key={l.id} onClick={() => onNaviguer("stock:rupture")}>
                    <td data-label="N°">{index + 1}</td>
                    <td data-label="Désignation">{l.produitNom}</td>
                    <td data-label="Dépôt">{l.depotNom}</td>
                    <td data-label="Quantité">{l.quantite}</td>
                    <td data-label="Seuil">{l.seuilAlerte}</td>
                  </tr>
                ))}
                {ruptures.length === 0 && (
                  <tr>
                    <td colSpan={5} className="liste-vide">
                      Aucune rupture de stock.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          {ruptures.length > 5 && (
            <p className="note-aide">{ruptures.length - 5} autre(s). Voir l'écran Stock pour la liste complète.</p>
          )}
        </div>

        <div className="detail-produit">
          <div className="entete-detail">
            <h3>
              <button type="button" className="lien-titre-carte" onClick={() => onNaviguer("rapports:topClients")}>
                🏆 Meilleurs clients <span aria-hidden="true">→</span>
              </button>
            </h3>
            <div className="barre-actions">
              <select value={periodeClients} onChange={(e) => setPeriodeClients(e.target.value as PeriodeGraphique)}>
                {OPTIONS_PERIODE_GRAPHIQUE.map((o) => (
                  <option key={o.valeur} value={o.valeur}>
                    {o.label}
                  </option>
                ))}
              </select>
              {periodeClients === "personnalise" && (
                <>
                  <input
                    type="date"
                    value={debutClientsPerso}
                    onChange={(e) => setDebutClientsPerso(e.target.value)}
                  />
                  <input type="date" value={finClientsPerso} onChange={(e) => setFinClientsPerso(e.target.value)} />
                </>
              )}
            </div>
          </div>
          <div className="zone-tableau-scroll">
            <table className="tableau-catalogue carte-mobile">
              <thead>
                <tr>
                  <th>N°</th>
                  <th>Client</th>
                  <th>Ventes</th>
                  <th>CA généré</th>
                </tr>
              </thead>
              <tbody>
                {meilleursClients.map((c, index) => (
                  <tr key={c.clientId} onClick={() => onNaviguer("clients")}>
                    <td data-label="N°">{index + 1}</td>
                    <td data-label="Client">{c.clientNom}</td>
                    <td data-label="Ventes">{c.nombreVentes}</td>
                    <td data-label="CA généré">
                      {c.totalNet} {devise}
                    </td>
                  </tr>
                ))}
                {meilleursClients.length === 0 && (
                  <tr>
                    <td colSpan={4} className="liste-vide">
                      Aucune vente à un client identifié sur la période.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
