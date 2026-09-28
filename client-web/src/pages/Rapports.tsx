import { useEffect, useState } from "react";
import type { CSSProperties } from "react";

import type { Session } from "../api";
import { libelleModePaiement, libelleMotifPerte, libelleStatutDestockage } from "../lib/libelles";
import {
  calculerPlageDates,
  produitsDormants as produitsDormantsLocal,
  syntheseVentes as syntheseVentesLocale,
  topClients as topClientsLocal,
  topProduits as topProduitsLocal,
  valeurStock as valeurStockLocal,
  ventesParCategorie as ventesParCategorieLocal,
  ventesParModePaiement as ventesParModePaiementLocal,
  ventesParVendeur as ventesParVendeurLocal,
  type LigneProduitDormant,
  type LigneTopClient,
  type LigneTopProduit,
  type LigneVentesCategorie,
  type LigneVentesModePaiement,
  type LigneVentesVendeur,
  type Periode,
  type PlageDates,
  type SyntheseVentes,
  type ValeurStock,
} from "../services/rapports";
import {
  listerDepotsDetail,
  listerDestockages,
  listerPertes,
  type DepotResume,
  type DestockageResume,
  type PerteResume,
} from "../services/stock";
import BoutonsExport from "../components/BoutonsExport";
import { useDevise } from "../contexts/DeviseContext";
import type { ColonneExport } from "../lib/export";
import { useNomsUtilisateurs } from "../hooks/useNomsUtilisateurs";
import { FormulaireDestockage } from "./Stock";
import { formaterMontant } from "../lib/formatage";

/**
 * Port de client-electron/src/pages/Rapports.tsx, local d'abord (IndexedDB,
 * voir services/rapports.ts) : mêmes documents, mêmes agrégations recalculées
 * depuis les données locales pour rester consultables hors-ligne — y compris
 * "Ventes par vendeur", qui retombe comme sur le desktop sur un libellé
 * "Vous"/identifiant tronqué faute d'accès local à la table des utilisateurs
 * (comptes.Utilisateur reste hors synchronisation, voir CLAUDE.md).
 *
 * Chaque document s'ouvre dans sa propre modale (même principe que
 * Comptabilite.tsx), avec son propre filtre de période à l'intérieur.
 */

function libelleVendeur(utilisateurId: string | null, session: Session): string {
  if (!utilisateurId) return "";
  if (utilisateurId === session.utilisateurId) return "Vous";
  return `Utilisateur ${utilisateurId.slice(0, 8)}`;
}

// --- Sélecteur de période, à l'intérieur de chaque modale ---

function SelecteurPeriode({
  periode,
  setPeriode,
  dateDebutPerso,
  setDateDebutPerso,
  dateFinPerso,
  setDateFinPerso,
}: {
  periode: Periode;
  setPeriode: (p: Periode) => void;
  dateDebutPerso: string;
  setDateDebutPerso: (v: string) => void;
  dateFinPerso: string;
  setDateFinPerso: (v: string) => void;
}) {
  return (
    <div className="barre-actions">
      <select value={periode} onChange={(e) => setPeriode(e.target.value as Periode)}>
        <option value="jour">Aujourd'hui</option>
        <option value="semaine">Cette semaine</option>
        <option value="mois">Ce mois</option>
        <option value="mois_dernier">Mois dernier</option>
        <option value="annee">Cette année</option>
        <option value="tout">Toutes les dates</option>
        <option value="personnalise">Période personnalisée</option>
      </select>
      {periode === "personnalise" && (
        <>
          <input type="date" value={dateDebutPerso} onChange={(e) => setDateDebutPerso(e.target.value)} />
          <input type="date" value={dateFinPerso} onChange={(e) => setDateFinPerso(e.target.value)} />
        </>
      )}
    </div>
  );
}

function EnteteModale({ titre, onFermer }: { titre: string; onFermer: () => void }) {
  return (
    <div className="modale-entete">
      <h3>{titre}</h3>
      <button type="button" className="lien bouton-retour" onClick={onFermer}>
        ← Retour
      </button>
    </div>
  );
}

// Colonnes d'export (mêmes que client-electron/src/pages/Rapports.tsx).
const COLONNES_SYNTHESE: ColonneExport[] = [
  { cle: "totalBrut", libelle: "Total brut" },
  { cle: "totalRemises", libelle: "Remises" },
  { cle: "totalNet", libelle: "Total net" },
  { cle: "nombreVentes", libelle: "Nombre de ventes" },
  { cle: "panierMoyen", libelle: "Panier moyen" },
  { cle: "beneficeTotal", libelle: "Bénéfice" },
];

const COLONNES_TOP_PRODUITS: ColonneExport[] = [
  { cle: "produit", libelle: "Désignation" },
  { cle: "reference", libelle: "Référence" },
  { cle: "quantiteVendue", libelle: "Quantité vendue" },
  { cle: "caGenere", libelle: "CA généré" },
];

const COLONNES_TOP_CLIENTS: ColonneExport[] = [
  { cle: "clientNom", libelle: "Client" },
  { cle: "nombreVentes", libelle: "Nombre de ventes" },
  { cle: "totalNet", libelle: "CA généré" },
];

const COLONNES_VALEUR_STOCK: ColonneExport[] = [
  { cle: "valeurAchat", libelle: "Valeur au coût" },
  { cle: "valeurVentePotentielle", libelle: "Valeur au prix de vente" },
  { cle: "nombreVariantes", libelle: "Nombre de lignes de stock" },
  { cle: "nombreRuptures", libelle: "Variantes en rupture" },
];

const COLONNES_VENDEUR: ColonneExport[] = [
  { cle: "vendeur", libelle: "Vendeur" },
  { cle: "nombreVentes", libelle: "Nombre de ventes" },
  { cle: "totalNet", libelle: "Total net" },
];

const COLONNES_CATEGORIE: ColonneExport[] = [
  { cle: "categorie", libelle: "Catégorie" },
  { cle: "quantiteVendue", libelle: "Quantité vendue" },
  { cle: "caGenere", libelle: "CA généré" },
];

const COLONNES_MODE_PAIEMENT: ColonneExport[] = [
  { cle: "mode", libelle: "Mode de paiement" },
  { cle: "total", libelle: "Total" },
];

/** Rang d'un classement : médailles pour les trois premiers. */
function rangClassement(index: number): string {
  return index < 3 ? ["🥇", "🥈", "🥉"][index] : String(index + 1);
}

/** Part d'une ligne dans le total, avec une petite barre. */
function CellulePart({ valeur, total }: { valeur: number; total: number }) {
  const pourcentage = total > 0 ? Math.round((valeur / total) * 100) : 0;
  return (
    <span className="mini-progression">
      <span className="barre-progression">
        <span style={{ width: `${Math.max(0, Math.min(100, pourcentage))}%` }} />
      </span>
      <span className="sous-info">{pourcentage} %</span>
    </span>
  );
}

/** Tuiles de résumé en haut d'un rapport. */
function TuilesRapport({
  tuiles,
}: {
  tuiles: { icone: string; libelle: string; valeur: string; alerte?: boolean; note?: { texte: string; hausse: boolean | null } }[];
}) {
  return (
    <div className="tuiles-fiche">
      {tuiles.map((t) => (
        <div key={t.libelle} className={`tuile-fiche${t.alerte ? " tuile-fiche--alerte" : ""}`}>
          <span className="sous-info">
            {t.icone} {t.libelle}
          </span>
          <strong className="nowrap">{t.valeur}</strong>
          {t.note && (
            <span className={`sous-info nowrap${t.note.hausse === null ? "" : t.note.hausse ? " montant-entree" : " texte-erreur"}`}>
              {t.note.texte}
            </span>
          )}
        </div>
      ))}
    </div>
  );
}

/** Fabrique le state période + la plage recalculée, commun à tous les documents sauf Valeur du stock. */
function useFiltrePeriode(periodeInitiale?: Periode) {
  const [periode, setPeriode] = useState<Periode>(periodeInitiale ?? "mois");
  const [dateDebutPerso, setDateDebutPerso] = useState(new Date().toISOString().slice(0, 10));
  const [dateFinPerso, setDateFinPerso] = useState(new Date().toISOString().slice(0, 10));
  const [plage, setPlage] = useState<PlageDates | null>(null);

  useEffect(() => {
    setPlage(calculerPlageDates(periode, dateDebutPerso, dateFinPerso));
  }, [periode, dateDebutPerso, dateFinPerso]);

  return { periode, setPeriode, dateDebutPerso, setDateDebutPerso, dateFinPerso, setDateFinPerso, plage };
}

// --- Modale Synthèse ---

function ModaleSynthese({ session, periodeInitiale, onFermer }: { session: Session; periodeInitiale?: Periode; onFermer: () => void }) {
  const f = useFiltrePeriode(periodeInitiale);
  const devise = useDevise();
  const [synthese, setSynthese] = useState<SyntheseVentes | null>(null);
  const [precedente, setPrecedente] = useState<SyntheseVentes | null>(null);

  useEffect(() => {
    if (!f.plage) return;
    syntheseVentesLocale(session.boutiqueId, f.plage.debut, f.plage.fin).then(setSynthese);
    // Période précédente de même durée, juste avant (pas de comparaison pour « Toutes les dates »).
    if (f.periode === "tout") {
      setPrecedente(null);
      return;
    }
    const debut = new Date(f.plage.debut).getTime();
    const fin = new Date(f.plage.fin).getTime();
    const finAvant = new Date(debut - 1);
    const debutAvant = new Date(debut - 1 - (fin - debut));
    syntheseVentesLocale(session.boutiqueId, debutAvant.toISOString(), finAvant.toISOString()).then(setPrecedente);
  }, [session.boutiqueId, f.plage, f.periode]);

  function comparaison(actuel: number, avant: number | undefined) {
    if (avant === undefined || f.periode === "tout") return undefined;
    if (avant === 0) return { texte: actuel > 0 ? "▲ nouveau par rapport à avant" : "= comme avant", hausse: actuel > 0 ? true : null };
    const variation = Math.round(((actuel - avant) / Math.abs(avant)) * 100);
    if (variation === 0) return { texte: "= comme la période précédente", hausse: null };
    return {
      texte: `${variation > 0 ? "▲ +" : "▼ "}${variation} % vs période précédente`,
      hausse: variation > 0,
    };
  }
  const s = synthese;
  const p = precedente ?? undefined;
  const tauxMarge = s && s.totalNet > 0 ? Math.round((s.beneficeTotal / s.totalNet) * 100) : 0;

  return (
    <div className="fond-modale" onClick={onFermer}>
      <div className="modale-selection-produits" onClick={(e) => e.stopPropagation()}>
        <EnteteModale titre="Synthèse" onFermer={onFermer} />
        <div className="modale-corps">
          <div className="barre-actions barre-filtres-historique">
            <SelecteurPeriode
              periode={f.periode} setPeriode={f.setPeriode}
              dateDebutPerso={f.dateDebutPerso} setDateDebutPerso={f.setDateDebutPerso}
              dateFinPerso={f.dateFinPerso} setDateFinPerso={f.setDateFinPerso}
            />
            {s && (
              <span className="actions-ligne">
                <BoutonsExport titre="Synthese des ventes" colonnes={COLONNES_SYNTHESE} lignes={[s as unknown as Record<string, unknown>]} compact />
              </span>
            )}
          </div>
          {!s ? (
            <p>Chargement…</p>
          ) : (
            <div className="tuiles-synthese">
              <TuilesRapport
                tuiles={[
                  { icone: "💰", libelle: "Chiffre d'affaires net", valeur: `${formaterMontant(s.totalNet)} ${devise}`, note: comparaison(s.totalNet, p?.totalNet) },
                  { icone: "🧾", libelle: "Nombre de ventes", valeur: String(s.nombreVentes), note: comparaison(s.nombreVentes, p?.nombreVentes) },
                  { icone: "🧺", libelle: "Panier moyen", valeur: `${formaterMontant(s.panierMoyen)} ${devise}`, note: comparaison(s.panierMoyen, p?.panierMoyen) },
                  {
                    icone: "📈",
                    libelle: `Bénéfice (marge ${tauxMarge} %)`,
                    valeur: `${formaterMontant(s.beneficeTotal)} ${devise}`,
                    alerte: s.beneficeTotal < 0,
                    note: comparaison(s.beneficeTotal, p?.beneficeTotal),
                  },
                  { icone: "🏷️", libelle: "Remises accordées", valeur: `${formaterMontant(s.totalRemises)} ${devise}`, note: comparaison(s.totalRemises, p?.totalRemises) },
                  { icone: "🧮", libelle: "Total brut (avant remises)", valeur: `${formaterMontant(s.totalBrut)} ${devise}` },
                ]}
              />
              {f.periode !== "tout" && (
                <p className="note-aide">
                  Les flèches comparent avec la période précédente de même durée, juste avant celle choisie.
                </p>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// --- Modale Top produits ---

function ModaleTopProduits({ session, periodeInitiale, onFermer }: { session: Session; periodeInitiale?: Periode; onFermer: () => void }) {
  const f = useFiltrePeriode(periodeInitiale);
  const devise = useDevise();

  const [ordre, setOrdre] = useState<"asc" | "desc">("desc");
  const [lignes, setLignes] = useState<LigneTopProduit[]>([]);

  useEffect(() => {
    if (!f.plage) return;
    topProduitsLocal(session.boutiqueId, f.plage.debut, f.plage.fin, 50, ordre).then(setLignes);
  }, [session.boutiqueId, f.plage, ordre]);

  const total = lignes.reduce((t, l) => t + l.caGenere, 0);
  const quantite = lignes.reduce((t, l) => t + l.quantiteVendue, 0);

  return (
    <div className="fond-modale" onClick={onFermer}>
      <div className="modale-selection-produits" onClick={(e) => e.stopPropagation()}>
        <EnteteModale titre="Top articles" onFermer={onFermer} />
        <div className="modale-corps">
          <TuilesRapport tuiles={[
            { icone: "🏷️", libelle: "Articles classés", valeur: String(lignes.length) },
            { icone: "📦", libelle: "Quantité vendue", valeur: formaterMontant(quantite) },
            { icone: "💰", libelle: "Chiffre d'affaires", valeur: `${formaterMontant(total)} ${devise}` },
            { icone: "🏆", libelle: ordre === "desc" ? "Le plus vendu" : "Le moins vendu", valeur: lignes[0]?.produit ?? "—" },
          ]} />
          <div className="barre-actions barre-filtres-historique">
            <SelecteurPeriode
              periode={f.periode} setPeriode={f.setPeriode}
              dateDebutPerso={f.dateDebutPerso} setDateDebutPerso={f.setDateDebutPerso}
              dateFinPerso={f.dateFinPerso} setDateFinPerso={f.setDateFinPerso}
            />
            <select value={ordre} onChange={(e) => setOrdre(e.target.value as "asc" | "desc")}>
              <option value="desc">Les plus vendus</option>
              <option value="asc">Les moins vendus</option>
            </select>
            <span className="actions-ligne">
              <BoutonsExport titre="Top articles" colonnes={COLONNES_TOP_PRODUITS} lignes={lignes as unknown as Record<string, unknown>[]} compact />
            </span>
          </div>
          <div className="zone-tableau-scroll zone-commandes-fiche">
            <table className="tableau-catalogue carte-mobile">
              <thead>
                <tr>
                  <th>Rang</th>
                  <th>Désignation</th>
                  <th>Référence</th>
                  <th>Quantité vendue</th>
                  <th>CA généré</th>
                  <th>Part du CA</th>
                </tr>
              </thead>
              <tbody>
                {lignes.map((l, index) => (
                  <tr key={l.varianteId}>
                    <td data-label="Rang">{ordre === "desc" ? rangClassement(index) : index + 1}</td>
                    <td data-label="Désignation">{l.produit}</td>
                    <td data-label="Référence">{l.reference || "—"}</td>
                    <td data-label="Quantité vendue">{formaterMontant(l.quantiteVendue)}</td>
                    <td data-label="CA généré" className="nowrap">
                      {formaterMontant(l.caGenere)} {devise}
                    </td>
                    <td data-label="Part du CA">
                      <CellulePart valeur={l.caGenere} total={total} />
                    </td>
                  </tr>
                ))}
                {lignes.length === 0 && (
                  <tr>
                    <td colSpan={6} className="liste-vide">
                      Aucune vente sur la période.
                    </td>
                  </tr>
                )}
                {Array.from({ length: Math.max(0, 10 - Math.max(1, lignes.length)) }).map((_, i) => (
                  <tr key={`vide-${i}`} className="ligne-groupe-vide">
                    {Array.from({ length: 6 }).map((_, j) => (
                      <td key={j}>&nbsp;</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {lignes.length > 0 && (
            <div className="totaux">
              <div>
                {lignes.length} ligne{lignes.length > 1 ? "s" : ""}
              </div>
              <div className="total-net">
                Total : {formaterMontant(total)} {devise}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// --- Modale Top clients ---

function ModaleTopClients({ session, periodeInitiale, onFermer }: { session: Session; periodeInitiale?: Periode; onFermer: () => void }) {
  const f = useFiltrePeriode(periodeInitiale);
  const devise = useDevise();

  const [lignes, setLignes] = useState<LigneTopClient[]>([]);

  useEffect(() => {
    if (!f.plage) return;
    topClientsLocal(session.boutiqueId, f.plage.debut, f.plage.fin, 100).then(setLignes);
  }, [session.boutiqueId, f.plage]);

  const total = lignes.reduce((t, l) => t + l.totalNet, 0);
  const ventes = lignes.reduce((t, l) => t + l.nombreVentes, 0);

  return (
    <div className="fond-modale" onClick={onFermer}>
      <div className="modale-selection-produits" onClick={(e) => e.stopPropagation()}>
        <EnteteModale titre="Top clients" onFermer={onFermer} />
        <div className="modale-corps">
          <TuilesRapport tuiles={[
            { icone: "👥", libelle: "Clients", valeur: String(lignes.length) },
            { icone: "🧾", libelle: "Ventes", valeur: String(ventes) },
            { icone: "💰", libelle: "Chiffre d'affaires", valeur: `${formaterMontant(total)} ${devise}` },
            { icone: "🏆", libelle: "Meilleur client", valeur: lignes[0]?.clientNom ?? "—" },
          ]} />
          <div className="barre-actions barre-filtres-historique">
            <SelecteurPeriode
              periode={f.periode} setPeriode={f.setPeriode}
              dateDebutPerso={f.dateDebutPerso} setDateDebutPerso={f.setDateDebutPerso}
              dateFinPerso={f.dateFinPerso} setDateFinPerso={f.setDateFinPerso}
            />
            <span className="actions-ligne">
              <BoutonsExport titre="Top clients" colonnes={COLONNES_TOP_CLIENTS} lignes={lignes as unknown as Record<string, unknown>[]} compact />
            </span>
          </div>
          <div className="zone-tableau-scroll zone-commandes-fiche">
            <table className="tableau-catalogue carte-mobile">
              <thead>
                <tr>
                  <th>Rang</th>
                  <th>Client</th>
                  <th>Nombre de ventes</th>
                  <th>CA généré</th>
                  <th>Part du CA</th>
                </tr>
              </thead>
              <tbody>
                {lignes.map((l, index) => (
                  <tr key={l.clientId}>
                    <td data-label="Rang">{rangClassement(index)}</td>
                    <td data-label="Client">{l.clientNom}</td>
                    <td data-label="Nombre de ventes">{l.nombreVentes}</td>
                    <td data-label="CA généré" className="nowrap">
                      {formaterMontant(l.totalNet)} {devise}
                    </td>
                    <td data-label="Part du CA">
                      <CellulePart valeur={l.totalNet} total={total} />
                    </td>
                  </tr>
                ))}
                {lignes.length === 0 && (
                  <tr>
                    <td colSpan={5} className="liste-vide">
                      Aucune vente à un client identifié sur la période.
                    </td>
                  </tr>
                )}
                {Array.from({ length: Math.max(0, 10 - Math.max(1, lignes.length)) }).map((_, i) => (
                  <tr key={`vide-${i}`} className="ligne-groupe-vide">
                    {Array.from({ length: 5 }).map((_, j) => (
                      <td key={j}>&nbsp;</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {lignes.length > 0 && (
            <div className="totaux">
              <div>
                {lignes.length} ligne{lignes.length > 1 ? "s" : ""}
              </div>
              <div className="total-net">
                Total : {formaterMontant(total)} {devise}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// --- Modale Valeur du stock ---

function ModaleValeurStock({ session, onFermer }: { session: Session; onFermer: () => void }) {
  const devise = useDevise();
  const [depots, setDepots] = useState<{ id: string; nom: string }[]>([]);
  const [depotId, setDepotId] = useState("");
  const [valeur, setValeur] = useState<ValeurStock | null>(null);
  const [parDepot, setParDepot] = useState<{ id: string; nom: string; valeur: ValeurStock }[]>([]);

  useEffect(() => {
    listerDepotsDetail(session.boutiqueId).then(async (liste) => {
      setDepots(liste);
      // Répartition par dépôt : où se trouve l'argent du stock.
      const lignes = await Promise.all(
        liste.map(async (d) => ({ id: d.id, nom: d.nom, valeur: await valeurStockLocal(session.boutiqueId, d.id) })),
      );
      setParDepot(lignes.sort((a, b) => b.valeur.valeurAchat - a.valeur.valeurAchat));
    });
  }, [session.boutiqueId]);

  useEffect(() => {
    valeurStockLocal(session.boutiqueId, depotId || undefined).then(setValeur);
  }, [session.boutiqueId, depotId]);

  const lignesDepots = parDepot.filter((d) => !depotId || d.id === depotId);
  // Stock encore rattaché à un dépôt supprimé : compté dans le total, montré à part.
  const reste = (cle: keyof ValeurStock) =>
    (valeur?.[cle] ?? 0) - parDepot.reduce((t, d) => t + d.valeur[cle], 0);
  const lignes =
    !depotId && valeur && reste("nombreVariantes") > 0
      ? [
          ...lignesDepots,
          {
            id: "supprimes",
            nom: "Dépôts supprimés",
            valeur: {
              valeurAchat: reste("valeurAchat"),
              valeurVentePotentielle: reste("valeurVentePotentielle"),
              nombreVariantes: reste("nombreVariantes"),
              nombreRuptures: reste("nombreRuptures"),
            },
          },
        ]
      : lignesDepots;
  const total = lignes.reduce((t, d) => t + d.valeur.valeurAchat, 0);
  const benefice = valeur ? valeur.valeurVentePotentielle - valeur.valeurAchat : 0;

  return (
    <div className="fond-modale" onClick={onFermer}>
      <div className="modale-selection-produits" onClick={(e) => e.stopPropagation()}>
        <EnteteModale titre="Valeur du stock" onFermer={onFermer} />
        <div className="modale-corps">
          <div className="barre-actions barre-filtres-historique">
            <select value={depotId} onChange={(e) => setDepotId(e.target.value)}>
              <option value="">Tous les dépôts</option>
              {depots.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.nom}
                </option>
              ))}
            </select>
            {valeur && (
              <span className="actions-ligne">
                <BoutonsExport titre="Valeur du stock" colonnes={COLONNES_VALEUR_STOCK} lignes={[valeur as unknown as Record<string, unknown>]} compact />
              </span>
            )}
          </div>
          {!valeur ? (
            <p>Chargement…</p>
          ) : (
            <TuilesRapport
              tuiles={[
                { icone: "💰", libelle: "Valeur au coût (prix d'achat)", valeur: `${formaterMontant(valeur.valeurAchat)} ${devise}` },
                { icone: "🏷️", libelle: "Valeur au prix de vente", valeur: `${formaterMontant(valeur.valeurVentePotentielle)} ${devise}` },
                {
                  icone: "📈",
                  libelle: "Bénéfice potentiel",
                  valeur: `${formaterMontant(benefice)} ${devise}`,
                  alerte: benefice < 0,
                },
                { icone: "📦", libelle: "Lignes de stock", valeur: String(valeur.nombreVariantes) },
                { icone: "⚠️", libelle: "En rupture", valeur: String(valeur.nombreRuptures), alerte: valeur.nombreRuptures > 0 },
              ]}
            />
          )}
          <h4 className="titre-section-rapport">Par dépôt</h4>
          <div className="zone-tableau-scroll zone-commandes-fiche">
            <table className="tableau-catalogue carte-mobile">
              <thead>
                <tr>
                  <th>Dépôt</th>
                  <th>Valeur au coût</th>
                  <th>Valeur au prix de vente</th>
                  <th>Bénéfice potentiel</th>
                  <th>Lignes</th>
                  <th>Ruptures</th>
                  <th>Part</th>
                </tr>
              </thead>
              <tbody>
                {lignes.map((d) => (
                  <tr key={d.id}>
                    <td data-label="Dépôt">{d.nom}</td>
                    <td data-label="Valeur au coût" className="nowrap">
                      {formaterMontant(d.valeur.valeurAchat)} {devise}
                    </td>
                    <td data-label="Valeur au prix de vente" className="nowrap">
                      {formaterMontant(d.valeur.valeurVentePotentielle)} {devise}
                    </td>
                    <td data-label="Bénéfice potentiel" className="nowrap">
                      {formaterMontant(d.valeur.valeurVentePotentielle - d.valeur.valeurAchat)} {devise}
                    </td>
                    <td data-label="Lignes">{d.valeur.nombreVariantes}</td>
                    <td data-label="Ruptures">
                      {d.valeur.nombreRuptures > 0 ? <strong className="texte-erreur">{d.valeur.nombreRuptures}</strong> : "0"}
                    </td>
                    <td data-label="Part">
                      <CellulePart valeur={d.valeur.valeurAchat} total={total} />
                    </td>
                  </tr>
                ))}
                {lignes.length === 0 && (
                  <tr>
                    <td colSpan={7} className="liste-vide">
                      Aucun dépôt.
                    </td>
                  </tr>
                )}
                {Array.from({ length: Math.max(0, 10 - Math.max(1, lignes.length)) }).map((_, i) => (
                  <tr key={`vide-${i}`} className="ligne-groupe-vide">
                    {Array.from({ length: 7 }).map((_, j) => (
                      <td key={j}>&nbsp;</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}

// --- Modale Ventes par vendeur ---

function ModaleVentesParVendeur({ session, periodeInitiale, onFermer }: { session: Session; periodeInitiale?: Periode; onFermer: () => void }) {
  const f = useFiltrePeriode(periodeInitiale);
  const devise = useDevise();
  const nomUtilisateur = useNomsUtilisateurs(session);
  const [brutes, setBrutes] = useState<LigneVentesVendeur[]>([]);

  useEffect(() => {
    if (!f.plage) return;
    ventesParVendeurLocal(session.boutiqueId, f.plage.debut, f.plage.fin).then(setBrutes);
  }, [session.boutiqueId, f.plage]);

  const lignes = [...brutes].sort((a, b) => b.totalNet - a.totalNet);
  const total = lignes.reduce((t, l) => t + l.totalNet, 0);
  const ventes = lignes.reduce((t, l) => t + l.nombreVentes, 0);
  const lignesExport = lignes.map((l) => ({
    vendeur: nomUtilisateur(l.utilisateurId),
    nombreVentes: l.nombreVentes,
    totalNet: l.totalNet,
  }));

  return (
    <div className="fond-modale" onClick={onFermer}>
      <div className="modale-selection-produits" onClick={(e) => e.stopPropagation()}>
        <EnteteModale titre="Ventes par vendeur" onFermer={onFermer} />
        <div className="modale-corps">
          <TuilesRapport tuiles={[
            { icone: "🧑‍💼", libelle: "Vendeurs", valeur: String(lignes.length) },
            { icone: "🧾", libelle: "Ventes", valeur: String(ventes) },
            { icone: "💰", libelle: "Chiffre d'affaires", valeur: `${formaterMontant(total)} ${devise}` },
            { icone: "🏆", libelle: "Meilleur vendeur", valeur: lignes[0] ? nomUtilisateur(lignes[0].utilisateurId) : "—" },
          ]} />
          <div className="barre-actions barre-filtres-historique">
            <SelecteurPeriode
              periode={f.periode} setPeriode={f.setPeriode}
              dateDebutPerso={f.dateDebutPerso} setDateDebutPerso={f.setDateDebutPerso}
              dateFinPerso={f.dateFinPerso} setDateFinPerso={f.setDateFinPerso}
            />
            <span className="actions-ligne">
              <BoutonsExport titre="Ventes par vendeur" colonnes={COLONNES_VENDEUR} lignes={lignesExport} compact />
            </span>
          </div>
          <div className="zone-tableau-scroll zone-commandes-fiche">
            <table className="tableau-catalogue carte-mobile">
              <thead>
                <tr>
                  <th>Rang</th>
                  <th>Vendeur</th>
                  <th>Nombre de ventes</th>
                  <th>Panier moyen</th>
                  <th>Total net</th>
                  <th>Part</th>
                </tr>
              </thead>
              <tbody>
                {lignes.map((l, index) => (
                  <tr key={l.utilisateurId ?? index}>
                    <td data-label="Rang">{rangClassement(index)}</td>
                    <td data-label="Vendeur">{nomUtilisateur(l.utilisateurId)}</td>
                    <td data-label="Nombre de ventes">{l.nombreVentes}</td>
                    <td data-label="Panier moyen" className="nowrap">
                      {formaterMontant(l.nombreVentes > 0 ? Math.round(l.totalNet / l.nombreVentes) : 0)} {devise}
                    </td>
                    <td data-label="Total net" className="nowrap">
                      {formaterMontant(l.totalNet)} {devise}
                    </td>
                    <td data-label="Part">
                      <CellulePart valeur={l.totalNet} total={total} />
                    </td>
                  </tr>
                ))}
                {lignes.length === 0 && (
                  <tr>
                    <td colSpan={6} className="liste-vide">
                      Aucune vente sur la période.
                    </td>
                  </tr>
                )}
                {Array.from({ length: Math.max(0, 10 - Math.max(1, lignes.length)) }).map((_, i) => (
                  <tr key={`vide-${i}`} className="ligne-groupe-vide">
                    {Array.from({ length: 6 }).map((_, j) => (
                      <td key={j}>&nbsp;</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {lignes.length > 0 && (
            <div className="totaux">
              <div>
                {lignes.length} ligne{lignes.length > 1 ? "s" : ""}
              </div>
              <div className="total-net">
                Total : {formaterMontant(total)} {devise}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// --- Modale Ventes par catégorie ---

function ModaleVentesParCategorie({ session, periodeInitiale, onFermer }: { session: Session; periodeInitiale?: Periode; onFermer: () => void }) {
  const f = useFiltrePeriode(periodeInitiale);
  const devise = useDevise();

  const [brutes, setBrutes] = useState<LigneVentesCategorie[]>([]);

  useEffect(() => {
    if (!f.plage) return;
    ventesParCategorieLocal(session.boutiqueId, f.plage.debut, f.plage.fin).then(setBrutes);
  }, [session.boutiqueId, f.plage]);

  const lignes = [...brutes].sort((a, b) => b.caGenere - a.caGenere);
  const total = lignes.reduce((t, l) => t + l.caGenere, 0);
  const quantite = lignes.reduce((t, l) => t + l.quantiteVendue, 0);

  return (
    <div className="fond-modale" onClick={onFermer}>
      <div className="modale-selection-produits" onClick={(e) => e.stopPropagation()}>
        <EnteteModale titre="Ventes par catégorie" onFermer={onFermer} />
        <div className="modale-corps">
          <TuilesRapport tuiles={[
            { icone: "🗂️", libelle: "Catégories", valeur: String(lignes.length) },
            { icone: "📦", libelle: "Quantité vendue", valeur: formaterMontant(quantite) },
            { icone: "💰", libelle: "Chiffre d'affaires", valeur: `${formaterMontant(total)} ${devise}` },
            { icone: "🏆", libelle: "Catégorie qui vend le plus", valeur: lignes[0]?.categorie ?? "—" },
          ]} />
          <div className="barre-actions barre-filtres-historique">
            <SelecteurPeriode
              periode={f.periode} setPeriode={f.setPeriode}
              dateDebutPerso={f.dateDebutPerso} setDateDebutPerso={f.setDateDebutPerso}
              dateFinPerso={f.dateFinPerso} setDateFinPerso={f.setDateFinPerso}
            />
            <span className="actions-ligne">
              <BoutonsExport titre="Ventes par catégorie" colonnes={COLONNES_CATEGORIE} lignes={lignes as unknown as Record<string, unknown>[]} compact />
            </span>
          </div>
          <div className="zone-tableau-scroll zone-commandes-fiche">
            <table className="tableau-catalogue carte-mobile">
              <thead>
                <tr>
                  <th>Rang</th>
                  <th>Catégorie</th>
                  <th>Quantité vendue</th>
                  <th>CA généré</th>
                  <th>Part du CA</th>
                </tr>
              </thead>
              <tbody>
                {lignes.map((l, index) => (
                  <tr key={l.categorieId ?? `sans-${index}`}>
                    <td data-label="Rang">{rangClassement(index)}</td>
                    <td data-label="Catégorie">{l.categorie}</td>
                    <td data-label="Quantité vendue">{formaterMontant(l.quantiteVendue)}</td>
                    <td data-label="CA généré" className="nowrap">
                      {formaterMontant(l.caGenere)} {devise}
                    </td>
                    <td data-label="Part du CA">
                      <CellulePart valeur={l.caGenere} total={total} />
                    </td>
                  </tr>
                ))}
                {lignes.length === 0 && (
                  <tr>
                    <td colSpan={5} className="liste-vide">
                      Aucune vente sur la période.
                    </td>
                  </tr>
                )}
                {Array.from({ length: Math.max(0, 10 - Math.max(1, lignes.length)) }).map((_, i) => (
                  <tr key={`vide-${i}`} className="ligne-groupe-vide">
                    {Array.from({ length: 5 }).map((_, j) => (
                      <td key={j}>&nbsp;</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {lignes.length > 0 && (
            <div className="totaux">
              <div>
                {lignes.length} ligne{lignes.length > 1 ? "s" : ""}
              </div>
              <div className="total-net">
                Total : {formaterMontant(total)} {devise}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// --- Modale Ventes par mode de paiement ---

function ModaleVentesParModePaiement({ session, periodeInitiale, onFermer }: { session: Session; periodeInitiale?: Periode; onFermer: () => void }) {
  const f = useFiltrePeriode(periodeInitiale);
  const devise = useDevise();

  const [brutes, setBrutes] = useState<LigneVentesModePaiement[]>([]);

  useEffect(() => {
    if (!f.plage) return;
    ventesParModePaiementLocal(session.boutiqueId, f.plage.debut, f.plage.fin).then(setBrutes);
  }, [session.boutiqueId, f.plage]);

  const lignes = [...brutes].sort((a, b) => b.total - a.total);
  const total = lignes.reduce((t, l) => t + l.total, 0);

  return (
    <div className="fond-modale" onClick={onFermer}>
      <div className="modale-selection-produits" onClick={(e) => e.stopPropagation()}>
        <EnteteModale titre="Ventes par mode de paiement" onFermer={onFermer} />
        <div className="modale-corps">
          <TuilesRapport tuiles={[
            { icone: "💰", libelle: "Total encaissé", valeur: `${formaterMontant(total)} ${devise}` },
            { icone: "💳", libelle: "Modes utilisés", valeur: String(lignes.length) },
            {
              icone: "🏆",
              libelle: "Mode principal",
              valeur: lignes[0] ? `${libelleModePaiement(lignes[0].mode)} (${total > 0 ? Math.round((lignes[0].total / total) * 100) : 0} %)` : "—",
            },
          ]} />
          <div className="barre-actions barre-filtres-historique">
            <SelecteurPeriode
              periode={f.periode} setPeriode={f.setPeriode}
              dateDebutPerso={f.dateDebutPerso} setDateDebutPerso={f.setDateDebutPerso}
              dateFinPerso={f.dateFinPerso} setDateFinPerso={f.setDateFinPerso}
            />
            <span className="actions-ligne">
              <BoutonsExport titre="Ventes par mode de paiement" colonnes={COLONNES_MODE_PAIEMENT} lignes={lignes.map((l) => ({ mode: libelleModePaiement(l.mode), total: l.total }))} compact />
            </span>
          </div>
          <div className="zone-tableau-scroll zone-commandes-fiche">
            <table className="tableau-catalogue carte-mobile">
              <thead>
                <tr>
                  <th>Rang</th>
                  <th>Mode de paiement</th>
                  <th>Total</th>
                  <th>Part</th>
                </tr>
              </thead>
              <tbody>
                {lignes.map((l, index) => (
                  <tr key={l.mode}>
                    <td data-label="Rang">{rangClassement(index)}</td>
                    <td data-label="Mode de paiement">{libelleModePaiement(l.mode)}</td>
                    <td data-label="Total" className="nowrap">
                      {formaterMontant(l.total)} {devise}
                    </td>
                    <td data-label="Part">
                      <CellulePart valeur={l.total} total={total} />
                    </td>
                  </tr>
                ))}
                {lignes.length === 0 && (
                  <tr>
                    <td colSpan={4} className="liste-vide">
                      Aucun paiement sur la période.
                    </td>
                  </tr>
                )}
                {Array.from({ length: Math.max(0, 10 - Math.max(1, lignes.length)) }).map((_, i) => (
                  <tr key={`vide-${i}`} className="ligne-groupe-vide">
                    {Array.from({ length: 4 }).map((_, j) => (
                      <td key={j}>&nbsp;</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {lignes.length > 0 && (
            <div className="totaux">
              <div>
                {lignes.length} ligne{lignes.length > 1 ? "s" : ""}
              </div>
              <div className="total-net">
                Total : {formaterMontant(total)} {devise}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// --- Page principale ---

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

const DOCUMENTS = [
  { cle: "synthese", label: "Synthèse", icone: "📊" },
  { cle: "topProduits", label: "Top articles", icone: "🏷️" },
  { cle: "topClients", label: "Top clients", icone: "🏆" },
  { cle: "valeurStock", label: "Valeur du stock", icone: "📦" },
  { cle: "dormants", label: "Produits dormants", icone: "😴" },
  { cle: "pertes", label: "Pertes", icone: "🗑️" },
  { cle: "destockages", label: "Déstockages", icone: "🏷️" },
  { cle: "vendeurs", label: "Ventes par vendeur", icone: "🧑‍💼" },
  { cle: "categories", label: "Ventes par catégorie", icone: "🗂️" },
  { cle: "modePaiement", label: "Ventes par mode de paiement", icone: "💳" },
] as const;

export type DocumentRapport = (typeof DOCUMENTS)[number]["cle"];

// --- Modale Pertes (sorties sans vente, voir Stock → Pertes) ---

const COLONNES_PERTES: { cle: string; libelle: string }[] = [
  { cle: "motif", libelle: "Motif" },
  { cle: "nombre", libelle: "Déclarations" },
  { cle: "quantite", libelle: "Quantité" },
  { cle: "valeur", libelle: "Valeur perdue" },
];

function ModalePertes({ session, periodeInitiale, onFermer }: { session: Session; periodeInitiale?: Periode; onFermer: () => void }) {
  const f = useFiltrePeriode(periodeInitiale);
  const devise = useDevise();

  const [pertes, setPertes] = useState<PerteResume[]>([]);

  useEffect(() => {
    if (!f.plage) return;
    listerPertes(session.boutiqueId, f.plage.debut, f.plage.fin).then(setPertes);
  }, [session.boutiqueId, f.plage]);

  // Regroupement par motif, du plus coûteux au moins coûteux (pertes annulées exclues).
  const parMotif = new Map<string, { motif: string; nombre: number; quantite: number; valeur: number }>();
  for (const perte of pertes) {
    if (perte.annulee) continue;
    const ligne = parMotif.get(perte.motif) ?? { motif: libelleMotifPerte(perte.motif), nombre: 0, quantite: 0, valeur: 0 };
    ligne.nombre += 1;
    ligne.quantite += perte.quantite;
    ligne.valeur += perte.valeur;
    parMotif.set(perte.motif, ligne);
  }
  const lignes = [...parMotif.values()].sort((a, b) => b.valeur - a.valeur);
  const total = lignes.reduce((somme, l) => somme + l.valeur, 0);
  const declarations = lignes.reduce((somme, l) => somme + l.nombre, 0);
  const quantite = lignes.reduce((somme, l) => somme + l.quantite, 0);

  return (
    <div className="fond-modale" onClick={onFermer}>
      <div className="modale-selection-produits" onClick={(e) => e.stopPropagation()}>
        <EnteteModale titre="Pertes" onFermer={onFermer} />
        <div className="modale-corps">
          <TuilesRapport tuiles={[
            { icone: "💸", libelle: "Valeur perdue", valeur: `${formaterMontant(total)} ${devise}`, alerte: total > 0 },
            { icone: "🧾", libelle: "Déclarations", valeur: String(declarations) },
            { icone: "📦", libelle: "Quantité perdue", valeur: formaterMontant(quantite) },
            { icone: "🔎", libelle: "Motif principal", valeur: lignes[0]?.motif ?? "—" },
          ]} />
          <div className="barre-actions barre-filtres-historique">
            <SelecteurPeriode
              periode={f.periode} setPeriode={f.setPeriode}
              dateDebutPerso={f.dateDebutPerso} setDateDebutPerso={f.setDateDebutPerso}
              dateFinPerso={f.dateFinPerso} setDateFinPerso={f.setDateFinPerso}
            />
            <span className="actions-ligne">
              <BoutonsExport titre="Pertes" colonnes={COLONNES_PERTES} lignes={lignes as unknown as Record<string, unknown>[]} compact />
            </span>
          </div>
          <div className="zone-tableau-scroll zone-commandes-fiche">
            <table className="tableau-catalogue carte-mobile">
              <thead>
                <tr>
                  <th>Motif</th>
                  <th>Déclarations</th>
                  <th>Quantité</th>
                  <th>Valeur perdue</th>
                  <th>Part</th>
                </tr>
              </thead>
              <tbody>
                {lignes.map((l) => (
                  <tr key={l.motif}>
                    <td data-label="Motif">{l.motif}</td>
                    <td data-label="Déclarations">{l.nombre}</td>
                    <td data-label="Quantité">{formaterMontant(l.quantite)}</td>
                    <td data-label="Valeur perdue" className="nowrap texte-erreur">
                      {formaterMontant(l.valeur)} {devise}
                    </td>
                    <td data-label="Part">
                      <CellulePart valeur={l.valeur} total={total} />
                    </td>
                  </tr>
                ))}
                {lignes.length === 0 && (
                  <tr>
                    <td colSpan={5} className="liste-vide">
                      Aucune perte sur la période.
                    </td>
                  </tr>
                )}
                {Array.from({ length: Math.max(0, 10 - Math.max(1, lignes.length)) }).map((_, i) => (
                  <tr key={`vide-${i}`} className="ligne-groupe-vide">
                    {Array.from({ length: 5 }).map((_, j) => (
                      <td key={j}>&nbsp;</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {lignes.length > 0 && (
            <div className="totaux">
              <div>
                {lignes.length} ligne{lignes.length > 1 ? "s" : ""}
              </div>
              <div className="total-net">
                Total : {formaterMontant(total)} {devise}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// --- Modale Déstockages : bilan de chaque déstockage (voir Stock → Déstockage) ---

const COLONNES_DESTOCKAGES: { cle: string; libelle: string }[] = [
  { cle: "article", libelle: "Article" },
  { cle: "operation", libelle: "Opération" },
  { cle: "prix", libelle: "Prix normal → déstockage" },
  { cle: "periode", libelle: "Période" },
  { cle: "statut", libelle: "Statut" },
  { cle: "quantiteVendue", libelle: "Vendus" },
  { cle: "chiffreAffaires", libelle: "Argent récupéré" },
  { cle: "marge", libelle: "Marge" },
  { cle: "manqueAGagner", libelle: "Manque à gagner" },
  { cle: "stockRestant", libelle: "Stock restant" },
];

function ModaleDestockages({ session, onFermer }: { session: Session; onFermer: () => void }) {
  const devise = useDevise();
  const [destockages, setDestockages] = useState<DestockageResume[]>([]);
  const [filtre, setFiltre] = useState<"tous" | "en_cours" | "termine">("tous");
  const [vue, setVue] = useState<"article" | "operation">("article");

  useEffect(() => {
    listerDestockages(session.boutiqueId).then(setDestockages);
  }, [session.boutiqueId]);

  const lignes = destockages.filter((d) => filtre === "tous" || d.statut === filtre);
  const total = (cle: "chiffreAffaires" | "marge" | "manqueAGagner") => lignes.reduce((somme, d) => somme + d[cle], 0);
  const periode = (d: DestockageResume) => {
    const debut = new Date(d.dateCreation).toLocaleDateString("fr-FR");
    const fin = d.dateArret
      ? new Date(d.dateArret).toLocaleDateString("fr-FR")
      : d.dateFin
        ? new Date(`${d.dateFin}T00:00:00`).toLocaleDateString("fr-FR")
        : "…";
    return `${debut} → ${fin}`;
  };
  // Vue par opération : les articles d'une même opération sont additionnés ;
  // un article déstocké seul reste une ligne à part.
  const operations = [
    ...lignes
      .reduce((parCle, d) => {
        const cle = d.operationId ?? `article-${d.id}`;
        const op = parCle.get(cle) ?? {
          cle,
          nom: d.operationNom ?? d.produitNom,
          seul: !d.operationId,
          articles: 0,
          enCours: false,
          debut: d.dateCreation,
          quantiteVendue: 0,
          chiffreAffaires: 0,
          marge: 0,
          manqueAGagner: 0,
          stockRestant: 0,
        };
        op.articles += 1;
        op.enCours = op.enCours || d.statut === "en_cours";
        op.debut = d.dateCreation < op.debut ? d.dateCreation : op.debut;
        op.quantiteVendue += d.quantiteVendue;
        op.chiffreAffaires += d.chiffreAffaires;
        op.marge += d.marge;
        op.manqueAGagner += d.manqueAGagner;
        op.stockRestant += d.stockRestant;
        return parCle.set(cle, op);
      }, new Map<string, { cle: string; nom: string; seul: boolean; articles: number; enCours: boolean; debut: string; quantiteVendue: number; chiffreAffaires: number; marge: number; manqueAGagner: number; stockRestant: number }>())
      .values(),
  ];

  const lignesExport = lignes.map((d) => ({
    article: `${d.produitNom}${d.reference ? ` (${d.reference})` : ""}`,
    operation: d.operationNom ?? "",
    prix: `${d.prixNormal} → ${d.prixDestockage}`,
    periode: periode(d),
    statut: libelleStatutDestockage(d.statut, d.motifFin),
    quantiteVendue: d.quantiteVendue,
    chiffreAffaires: d.chiffreAffaires,
    marge: d.marge,
    manqueAGagner: d.manqueAGagner,
    stockRestant: d.stockRestant,
  }));

  return (
    <div className="fond-modale" onClick={onFermer}>
      <div className="modale-selection-produits" onClick={(e) => e.stopPropagation()}>
        <EnteteModale titre="Déstockages" onFermer={onFermer} />
        <div className="modale-corps">
          <TuilesRapport
            tuiles={[
              { icone: "🏷️", libelle: "Déstockages", valeur: `${lignes.length} (${lignes.filter((d) => d.statut === "en_cours").length} en cours)` },
              { icone: "💰", libelle: "Argent récupéré", valeur: `${formaterMontant(total("chiffreAffaires"))} ${devise}` },
              { icone: "📈", libelle: "Marge", valeur: `${formaterMontant(total("marge"))} ${devise}`, alerte: total("marge") < 0 },
              { icone: "📉", libelle: "Manque à gagner", valeur: `${formaterMontant(total("manqueAGagner"))} ${devise}` },
            ]}
          />
          <div className="barre-actions barre-filtres-historique">
            <select value={filtre} onChange={(e) => setFiltre(e.target.value as typeof filtre)}>
              <option value="tous">Tous les déstockages</option>
              <option value="en_cours">En cours</option>
              <option value="termine">Terminés</option>
            </select>
            <select value={vue} onChange={(e) => setVue(e.target.value as typeof vue)}>
              <option value="article">Par article</option>
              <option value="operation">Par opération</option>
            </select>
            <span className="actions-ligne">
            <BoutonsExport
                compact
              titre="Destockages"
              colonnes={COLONNES_DESTOCKAGES}
              lignes={lignesExport}
            />
            </span>
          </div>
          {vue === "article" ? (
            <>
            <div className="zone-tableau-scroll zone-commandes-fiche">
              <table className="tableau-catalogue carte-mobile">
                <thead>
                  <tr>
                    {COLONNES_DESTOCKAGES.map((c) => (
                      <th key={c.cle}>{c.libelle}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {lignes.map((d) => (
                    <tr key={d.id}>
                      <td data-label="Article">
                        {d.produitNom} {d.reference && <span className="sous-info">({d.reference})</span>}
                      </td>
                      <td data-label="Opération">{d.operationNom ?? "—"}</td>
                    <td data-label="Prix normal → déstockage">
                        <s className="prix-barre">{formaterMontant(d.prixNormal)}</s>
                        {formaterMontant(d.prixDestockage)}
                      </td>
                      <td data-label="Période">{periode(d)}</td>
                      <td data-label="Statut">
                        <span className={d.statut === "en_cours" ? "badge-destockage" : "badge-brouillon"}>
                          {libelleStatutDestockage(d.statut, d.motifFin)}
                        </span>
                      </td>
                      <td data-label="Vendus">{d.quantiteVendue}</td>
                      <td data-label="Argent récupéré">{formaterMontant(d.chiffreAffaires)}</td>
                      <td data-label="Marge" className={d.marge < 0 ? "montant-negatif" : undefined}>
                        {formaterMontant(d.marge)}
                      </td>
                      <td data-label="Manque à gagner">{formaterMontant(d.manqueAGagner)}</td>
                      <td data-label="Stock restant">{d.stockRestant}</td>
                    </tr>
                  ))}
                  {lignes.length === 0 && (
                    <tr>
                      <td colSpan={10} className="liste-vide">
                        Aucun déstockage.
                      </td>
                    </tr>
                  )}
                  {Array.from({ length: Math.max(0, 10 - Math.max(1, lignes.length)) }).map((_, i) => (
                    <tr key={`vide-${i}`} className="ligne-groupe-vide">
                      {COLONNES_DESTOCKAGES.map((c) => (
                        <td key={c.cle}>&nbsp;</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            </>
          ) : (
            <>
            <div className="zone-tableau-scroll zone-commandes-fiche">
              <table className="tableau-catalogue carte-mobile">
                <thead>
                  <tr>
                    <th>Opération</th>
                    <th>Articles</th>
                    <th>Début</th>
                    <th>Statut</th>
                    <th>Vendus</th>
                    <th>Argent récupéré</th>
                    <th>Marge</th>
                    <th>Manque à gagner</th>
                    <th>Stock restant</th>
                  </tr>
                </thead>
                <tbody>
                  {operations.map((op) => (
                    <tr key={op.cle}>
                      <td data-label="Opération">
                        {op.seul ? <span className="sous-info">{op.nom} (article seul)</span> : <strong>{op.nom}</strong>}
                      </td>
                      <td data-label="Articles">{op.articles}</td>
                      <td data-label="Début">{new Date(op.debut).toLocaleDateString("fr-FR")}</td>
                      <td data-label="Statut">
                        <span className={op.enCours ? "badge-destockage" : "badge-brouillon"}>
                          {op.enCours ? "En cours" : "Terminée"}
                        </span>
                      </td>
                      <td data-label="Vendus">{op.quantiteVendue}</td>
                      <td data-label="Argent récupéré">{formaterMontant(op.chiffreAffaires)}</td>
                      <td data-label="Marge" className={op.marge < 0 ? "montant-negatif" : undefined}>
                        {formaterMontant(op.marge)}
                      </td>
                      <td data-label="Manque à gagner">{formaterMontant(op.manqueAGagner)}</td>
                      <td data-label="Stock restant">{op.stockRestant}</td>
                    </tr>
                  ))}
                  {operations.length === 0 && (
                    <tr>
                      <td colSpan={9} className="liste-vide">
                        Aucun déstockage.
                      </td>
                    </tr>
                  )}
                  {Array.from({ length: Math.max(0, 10 - Math.max(1, operations.length)) }).map((_, i) => (
                    <tr key={`vide-${i}`} className="ligne-groupe-vide">
                      <td>&nbsp;</td>
                      <td>&nbsp;</td>
                      <td>&nbsp;</td>
                      <td>&nbsp;</td>
                      <td>&nbsp;</td>
                      <td>&nbsp;</td>
                      <td>&nbsp;</td>
                      <td>&nbsp;</td>
                      <td>&nbsp;</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            </>
          )}
          {lignes.length > 0 && (
            <div className="totaux">
              <div>
                Argent récupéré : {formaterMontant(total("chiffreAffaires"))} {devise}
              </div>
              <div>
                Marge : {formaterMontant(total("marge"))} {devise}
              </div>
              <div className="total-net">
                Manque à gagner : {formaterMontant(total("manqueAGagner"))} {devise}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// --- Modale Produits dormants : du stock qui ne se vend plus (argent qui dort) ---

const DUREES_DORMANCE = [30, 60, 90, 180] as const;

const COLONNES_DORMANTS: { cle: string; libelle: string }[] = [
  { cle: "article", libelle: "Article" },
  { cle: "quantiteStock", libelle: "En stock" },
  { cle: "derniereVente", libelle: "Dernière vente" },
  { cle: "joursSansVente", libelle: "Jours sans vente" },
  { cle: "valeurImmobilisee", libelle: "Argent immobilisé" },
];

export function ModaleProduitsDormants({ session, onFermer }: { session: Session; onFermer: () => void }) {
  const devise = useDevise();
  const peutDestocker = !!session.permissions.gerer_produits_stock_achats;
  const [jours, setJours] = useState<number>(60);
  const [lignes, setLignes] = useState<LigneProduitDormant[]>([]);
  const [articleADestocker, setArticleADestocker] = useState<LigneProduitDormant | null>(null);

  function rafraichir() {
    produitsDormantsLocal(session.boutiqueId, jours).then(setLignes);
  }
  useEffect(() => {
    rafraichir();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.boutiqueId, jours]);

  const valeurTotale = lignes.reduce((somme, l) => somme + l.valeurImmobilisee, 0);
  const derniereVente = (l: LigneProduitDormant) =>
    l.derniereVente ? new Date(l.derniereVente).toLocaleDateString("fr-FR") : "Jamais vendu";
  const lignesExport = lignes.map((l) => ({
    article: `${l.produitNom}${l.reference ? ` (${l.reference})` : ""}`,
    quantiteStock: l.quantiteStock,
    derniereVente: derniereVente(l),
    joursSansVente: l.joursSansVente,
    valeurImmobilisee: l.valeurImmobilisee,
  }));

  return (
    <div className="fond-modale" onClick={onFermer}>
      <div className="modale-selection-produits" onClick={(e) => e.stopPropagation()}>
        <EnteteModale titre="Produits dormants" onFermer={onFermer} />
        <div className="modale-corps">
          <TuilesRapport
            tuiles={[
              { icone: "😴", libelle: "Articles dormants", valeur: String(lignes.length), alerte: lignes.length > 0 },
              { icone: "💰", libelle: "Argent qui dort", valeur: `${formaterMontant(valeurTotale)} ${devise}`, alerte: valeurTotale > 0 },
              { icone: "⏳", libelle: "Le plus ancien", valeur: lignes.length > 0 ? `${Math.max(...lignes.map((l) => l.joursSansVente))} jours` : "—" },
              { icone: "🏷️", libelle: "Déjà en déstockage", valeur: String(lignes.filter((l) => l.enDestockage).length) },
            ]}
          />
          <div className="barre-actions barre-filtres-historique">
            <label className="case-a-cocher">
              Sans vente depuis
              <select value={jours} onChange={(e) => setJours(Number(e.target.value))}>
                {DUREES_DORMANCE.map((d) => (
                  <option key={d} value={d}>
                    {d} jours
                  </option>
                ))}
              </select>
            </label>
            <span className="actions-ligne">
            <BoutonsExport compact
              titre="Produits dormants"
              colonnes={COLONNES_DORMANTS}
              lignes={lignesExport}
            />
            </span>
          </div>
          <p className="note-aide">
            Articles en stock qui ne se sont pas vendus depuis {jours} jours ou plus (un article jamais vendu compte depuis
            son entrée en stock). Pensez à les mettre en déstockage pour récupérer cet argent.
          </p>
          <div className="zone-tableau-scroll zone-commandes-fiche">
            <table className="tableau-catalogue carte-mobile">
              <thead>
                <tr>
                  {COLONNES_DORMANTS.map((c) => (
                    <th key={c.cle}>{c.libelle}</th>
                  ))}
                  {peutDestocker && <th />}
                </tr>
              </thead>
              <tbody>
                {lignes.map((l) => (
                  <tr key={l.varianteId}>
                    <td data-label="Article">
                      {l.produitNom} {l.reference && <span className="sous-info">({l.reference})</span>}
                    </td>
                    <td data-label="En stock">{l.quantiteStock}</td>
                    <td data-label="Dernière vente">{derniereVente(l)}</td>
                    <td data-label="Jours sans vente">{l.joursSansVente}</td>
                    <td data-label="Argent immobilisé">
                      {formaterMontant(l.valeurImmobilisee)} {devise}
                    </td>
                    {peutDestocker && (
                      <td data-label="">
                        {l.enDestockage ? (
                          <span className="badge-destockage">En déstockage</span>
                        ) : (
                          <button type="button" onClick={() => setArticleADestocker(l)}>
                            🏷️ Mettre en déstockage
                          </button>
                        )}
                      </td>
                    )}
                  </tr>
                ))}
                {lignes.length === 0 && (
                  <tr>
                    <td colSpan={6} className="liste-vide">
                      Aucun produit dormant : tout votre stock s'est vendu dans les {jours} derniers jours.
                    </td>
                  </tr>
                )}
                {Array.from({ length: Math.max(0, 10 - Math.max(1, lignes.length)) }).map((_, i) => (
                  <tr key={`vide-${i}`} className="ligne-groupe-vide">
                    {COLONNES_DORMANTS.map((c) => (
                      <td key={c.cle}>&nbsp;</td>
                    ))}
                    {peutDestocker && <td>&nbsp;</td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {lignes.length > 0 && (
            <div className="totaux">
              <div>
                {lignes.length} article{lignes.length > 1 ? "s" : ""} dormant{lignes.length > 1 ? "s" : ""}
              </div>
              <div className="total-net">
                Argent qui dort : {formaterMontant(valeurTotale)} {devise}
              </div>
            </div>
          )}
        </div>
      </div>
      {articleADestocker && (
        <div className="fond-modale" onClick={(e) => {
            e.stopPropagation();
            setArticleADestocker(null);
          }}>
          <div className="modale-selection-produits" onClick={(e) => e.stopPropagation()}>
            <FormulaireDestockage
              session={session}
              articleInitial={{
                id: articleADestocker.varianteId,
                produitNom: articleADestocker.produitNom,
                reference: articleADestocker.reference,
                prixVente: articleADestocker.prixVente,
                prixAchat: articleADestocker.prixAchat,
                quantiteStock: articleADestocker.quantiteStock,
              }}
              onAnnuler={() => setArticleADestocker(null)}
              onCree={() => {
                setArticleADestocker(null);
                rafraichir();
              }}
            />
          </div>
        </div>
      )}
    </div>
  );
}

export default function Rapports({
  session,
  ongletInitial,
  periodeInitiale,
}: {
  session: Session;
  ongletInitial?: DocumentRapport;
  periodeInitiale?: Periode;
}) {
  const peutVoir = !!session.permissions.voir_rapports_complets;
  const [documentOuvert, setDocumentOuvert] = useState<DocumentRapport | null>(
    ongletInitial ?? (periodeInitiale ? "synthese" : null),
  );

  if (!peutVoir) {
    return (
      <div className="page-produits">
        <h2>Rapports</h2>
        <p className="note-aide">Vous n'avez pas accès aux rapports.</p>
      </div>
    );
  }

  return (
    <div className="page-produits page-accueil">
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
      <h2>Rapports</h2>
      <div className="grille-documents-comptables">
        {DOCUMENTS.map((d) => (
          <button
            key={d.cle}
            type="button"
            className="carte-document-comptable"
            onClick={() => setDocumentOuvert(d.cle)}
          >
            <span className="icone-document-comptable">{d.icone}</span>
            {d.label}
          </button>
        ))}
      </div>
      {documentOuvert === "synthese" && (
        <ModaleSynthese session={session} periodeInitiale={periodeInitiale} onFermer={() => setDocumentOuvert(null)} />
      )}
      {documentOuvert === "topProduits" && (
        <ModaleTopProduits session={session} periodeInitiale={periodeInitiale} onFermer={() => setDocumentOuvert(null)} />
      )}
      {documentOuvert === "topClients" && (
        <ModaleTopClients session={session} periodeInitiale={periodeInitiale} onFermer={() => setDocumentOuvert(null)} />
      )}
      {documentOuvert === "valeurStock" && <ModaleValeurStock session={session} onFermer={() => setDocumentOuvert(null)} />}
      {documentOuvert === "dormants" && (
        <ModaleProduitsDormants session={session} onFermer={() => setDocumentOuvert(null)} />
      )}
      {documentOuvert === "destockages" && (
        <ModaleDestockages session={session} onFermer={() => setDocumentOuvert(null)} />
      )}
      {documentOuvert === "pertes" && (
        <ModalePertes session={session} periodeInitiale={periodeInitiale} onFermer={() => setDocumentOuvert(null)} />
      )}
      {documentOuvert === "vendeurs" && (
        <ModaleVentesParVendeur session={session} periodeInitiale={periodeInitiale} onFermer={() => setDocumentOuvert(null)} />
      )}
      {documentOuvert === "categories" && (
        <ModaleVentesParCategorie session={session} periodeInitiale={periodeInitiale} onFermer={() => setDocumentOuvert(null)} />
      )}
      {documentOuvert === "modePaiement" && (
        <ModaleVentesParModePaiement session={session} periodeInitiale={periodeInitiale} onFermer={() => setDocumentOuvert(null)} />
      )}
    </div>
  );
}
