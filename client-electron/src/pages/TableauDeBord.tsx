import { useEffect, useState } from "react";

import { api } from "../api/client";
import type {
  CreditResume,
  LigneStock,
  LigneTopClient,
  LigneVentesParJour,
  Session,
  SyntheseVentes,
} from "../api/client";
import { useDevise } from "../contexts/DeviseContext";
import { formaterMontant } from "../lib/formatage";

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

/** Parse "AAAA-MM-JJ" en date locale à minuit (contrairement à `new Date("AAAA-MM-JJ")`,
 * qui est interprété comme minuit UTC et peut retomber sur la veille en heure locale). */
function parseJourLocal(chaineJour: string): Date {
  const [annee, mois, jour] = chaineJour.split("-").map(Number);
  return new Date(annee, mois - 1, jour);
}

/** Complète les jours sans vente (absents du résultat SQL) avec 0, pour une courbe continue. */
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

const OPTIONS_PERIODE_GRAPHIQUE = [
  { valeur: "14", label: "14 derniers jours" },
  { valeur: "30", label: "30 derniers jours" },
  { valeur: "90", label: "90 derniers jours" },
  { valeur: "personnalise", label: "Période personnalisée" },
] as const;

type PeriodeGraphique = (typeof OPTIONS_PERIODE_GRAPHIQUE)[number]["valeur"];

function GraphiqueVentesJournalieres({ serie, devise }: { serie: LigneVentesParJour[]; devise: string }) {
  const largeur = 700;
  const hauteur = 200;
  const margeBasse = 22;
  const margeHaute = 12;
  // Marge gauche pour les étiquettes de l'axe Y, marge droite pour que l'étiquette du
  // dernier point (centrée via text-anchor=middle) ne déborde pas hors du viewBox.
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

  const chemin = points.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x} ${p.y}`).join(" ");
  const bas = hauteur - margeBasse;
  const cheminAire =
    points.length > 0 ? `${chemin} L ${points[points.length - 1].x} ${bas} L ${points[0].x} ${bas} Z` : "";

  // Affiche au plus ~15 étiquettes de date, quelle que soit la longueur de la période.
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
        {niveauxY.map((n) => {
          const valeur = Math.round((maximum * n) / nombreNiveauxY);
          const y = margeHaute + hauteurDisponible - (n / nombreNiveauxY) * hauteurDisponible;
          return (
            <g key={n}>
              <line x1={margeGauche} y1={y} x2={largeur - margeDroite} y2={y} className="grille-graphique-ventes" />
              <text x={margeGauche - 6} y={y + 3} textAnchor="end" className="etiquette-axe-graphique">
                {formaterMontant(valeur)}
              </text>
            </g>
          );
        })}

        {cheminAire && <path d={cheminAire} className="aire-vente-jour" />}
        <path d={chemin} className="ligne-vente-jour" fill="none" />

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
            {formaterMontant(pointActif.totalNet)} {devise}
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
  const [ruptures, setRuptures] = useState<LigneStock[]>([]);
  const [creditsEnCours, setCreditsEnCours] = useState<CreditResume[]>([]);
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
      api.rapports.syntheseVentes(session.boutiqueId, plage.debut, plage.fin).then(setSynthese);
    });
    api.stock.lister(session.boutiqueId).then((lignes) => setRuptures(lignes.filter((l) => l.enRupture)));
    api.credits.lister(session.boutiqueId, undefined, "en_cours").then(setCreditsEnCours);
  }, [session.boutiqueId]);

  useEffect(() => {
    const plage =
      periodeGraphique === "personnalise"
        ? { debut: `${debutPerso}T00:00:00.000Z`, fin: `${finPerso}T23:59:59.999Z` }
        : plageDerniersJours(Number(periodeGraphique));
    api.rapports
      .ventesParJour(session.boutiqueId, plage.debut, plage.fin)
      .then((donnees) => setSerieVentes(construireSerieJours(plage.debut, plage.fin, donnees)));
  }, [session.boutiqueId, periodeGraphique, debutPerso, finPerso]);

  useEffect(() => {
    const plage =
      periodeClients === "personnalise"
        ? { debut: `${debutClientsPerso}T00:00:00.000Z`, fin: `${finClientsPerso}T23:59:59.999Z` }
        : plageDerniersJours(Number(periodeClients));
    api.rapports.topClients(session.boutiqueId, plage.debut, plage.fin, 5).then(setMeilleursClients);
  }, [session.boutiqueId, periodeClients, debutClientsPerso, finClientsPerso]);

  const soldeTotalDu = creditsEnCours.reduce((somme, c) => somme + Number(c.solde), 0);

  return (
    <div className="page-produits">
      <div className="grille-tableau-bord">
        <div className="carte-stat">
          <span className="carte-stat-label">Ventes du jour</span>
          <span className="carte-stat-valeur">{synthese ? synthese.nombreVentes : ""}</span>
        </div>
        <div className="carte-stat">
          <span className="carte-stat-label">CA du jour</span>
          <span className="carte-stat-valeur">{synthese ? `${formaterMontant(synthese.totalNet)} ${devise}` : ""}</span>
        </div>
        {peutVoirBenefices && (
          <div className="carte-stat">
            <span className="carte-stat-label">Bénéfice du jour</span>
            <span className="carte-stat-valeur">
              {synthese ? `${formaterMontant(synthese.beneficeTotal)} ${devise}` : ""}
            </span>
          </div>
        )}
        <div className="carte-stat">
          <span className="carte-stat-label">Alertes de rupture</span>
          <span className={`carte-stat-valeur ${ruptures.length > 0 ? "carte-stat-alerte" : ""}`}>
            {ruptures.length}
          </span>
        </div>
        <div className="carte-stat">
          <span className="carte-stat-label">Crédits en attente</span>
          <span className={`carte-stat-valeur ${soldeTotalDu > 0 ? "carte-stat-alerte" : ""}`}>
            {formaterMontant(soldeTotalDu)} {devise}
          </span>
        </div>
      </div>

      <div className="barre-actions">
        <button type="button" onClick={() => onNaviguer("caisse")}>
          Nouvelle vente
        </button>
        <button type="button" onClick={() => onNaviguer("produits")}>
          Gérer les articles
        </button>
        <button type="button" onClick={() => onNaviguer("stock")}>
          Voir le stock
        </button>
        <button type="button" onClick={() => onNaviguer("achats:nouveau")}>
          Nouvel achat
        </button>
        <button type="button" onClick={() => onNaviguer("clients")}>
          Clients & crédit
        </button>
      </div>

      <div className="detail-produit">
        <div className="entete-detail">
          <h3>
            <button type="button" className="lien-titre-carte" onClick={() => onNaviguer("rapports:tout")}>
              Chiffre d'affaires <span aria-hidden="true">→</span>
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
        {serieVentes.length > 0 ? (
          <GraphiqueVentesJournalieres serie={serieVentes} devise={devise} />
        ) : (
          <p className="note-aide">Chargement…</p>
        )}
      </div>

      <div className="deux-colonnes">
        <div className="detail-produit">
          <h3>
            <button type="button" className="lien-titre-carte" onClick={() => onNaviguer("stock:rupture")}>
              Alertes de rupture <span aria-hidden="true">→</span>
            </button>
          </h3>
          <table className="tableau-catalogue">
            <thead>
              <tr>
                <th>Désignation</th>
                <th>Dépôt</th>
                <th>Quantité</th>
                <th>Seuil</th>
              </tr>
            </thead>
            <tbody>
              {ruptures.slice(0, 5).map((l) => (
                <tr key={l.id} onClick={() => onNaviguer("stock:rupture")}>
                  <td>{l.produitNom}</td>
                  <td>{l.depotNom}</td>
                  <td>{l.quantite}</td>
                  <td>{l.seuilAlerte}</td>
                </tr>
              ))}
              {ruptures.length === 0 && (
                <tr>
                  <td colSpan={4} className="liste-vide">
                    Aucune rupture de stock.
                  </td>
                </tr>
              )}
              {ruptures.length > 0 &&
                Array.from({ length: Math.max(0, 5 - Math.min(ruptures.length, 5)) }).map((_, i) => (
                  <tr key={`vide-${i}`} className="ligne-groupe-vide">
                    <td>&nbsp;</td>
                    <td>&nbsp;</td>
                    <td>&nbsp;</td>
                    <td>&nbsp;</td>
                  </tr>
                ))}
            </tbody>
          </table>
          {ruptures.length > 5 && (
            <p className="note-aide">
              {ruptures.length - 5} autre(s). Voir l'écran Stock pour la liste complète.
            </p>
          )}
        </div>

        <div className="detail-produit">
          <div className="entete-detail">
            <h3>
              <button type="button" className="lien-titre-carte" onClick={() => onNaviguer("rapports:topClients")}>
                Meilleurs clients <span aria-hidden="true">→</span>
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
          <table className="tableau-catalogue">
            <thead>
              <tr>
                <th>Client</th>
                <th>Ventes</th>
                <th>CA généré</th>
              </tr>
            </thead>
            <tbody>
              {meilleursClients.map((c) => (
                <tr key={c.clientId} onClick={() => onNaviguer("clients")}>
                  <td>{c.clientNom}</td>
                  <td>{c.nombreVentes}</td>
                  <td>{formaterMontant(c.totalNet)} {devise}</td>
                </tr>
              ))}
              {meilleursClients.length === 0 && (
                <tr>
                  <td colSpan={3} className="liste-vide">
                    Aucune vente à un client identifié sur la période.
                  </td>
                </tr>
              )}
              {meilleursClients.length > 0 &&
                Array.from({ length: Math.max(0, 10 - meilleursClients.length) }).map((_, i) => (
                  <tr key={`vide-${i}`} className="ligne-groupe-vide">
                    <td>&nbsp;</td>
                    <td>&nbsp;</td>
                    <td>&nbsp;</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="detail-produit">
        <h3>
          <button type="button" className="lien-titre-carte" onClick={() => onNaviguer("clients:credits")}>
            Crédits en attente <span aria-hidden="true">→</span>
          </button>
        </h3>
        <table className="tableau-catalogue">
          <thead>
            <tr>
              <th>Client</th>
              <th>Vente</th>
              <th>Solde</th>
            </tr>
          </thead>
          <tbody>
            {creditsEnCours.slice(0, 5).map((c) => (
              <tr key={c.id} onClick={() => onNaviguer("clients:credits")}>
                <td>{c.clientNom}</td>
                <td>{c.venteNumero ?? ""}</td>
                <td>{formaterMontant(c.solde)} {devise}</td>
              </tr>
            ))}
            {creditsEnCours.length === 0 && (
              <tr>
                <td colSpan={3} className="liste-vide">
                  Aucun crédit en attente.
                </td>
              </tr>
            )}
            {creditsEnCours.length > 0 &&
              Array.from({ length: Math.max(0, 5 - Math.min(creditsEnCours.length, 5)) }).map((_, i) => (
                <tr key={`vide-${i}`} className="ligne-groupe-vide">
                  <td>&nbsp;</td>
                  <td>&nbsp;</td>
                  <td>&nbsp;</td>
                </tr>
              ))}
          </tbody>
        </table>
        {creditsEnCours.length > 5 && (
          <p className="note-aide">
            {creditsEnCours.length - 5} autre(s). Voir l'écran Clients & crédit.
          </p>
        )}
      </div>
    </div>
  );
}
