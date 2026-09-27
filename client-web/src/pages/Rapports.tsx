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
import { useDevise } from "../contexts/DeviseContext";
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

/** Fabrique le state période + la plage recalculée, commun à tous les documents sauf Valeur du stock. */
function useFiltrePeriode(periodeInitiale?: Periode) {
  const [periode, setPeriode] = useState<Periode>(periodeInitiale ?? "jour");
  const [dateDebutPerso, setDateDebutPerso] = useState(new Date().toISOString().slice(0, 10));
  const [dateFinPerso, setDateFinPerso] = useState(new Date().toISOString().slice(0, 10));
  const [plage, setPlage] = useState<PlageDates | null>(null);

  useEffect(() => {
    setPlage(calculerPlageDates(periode, dateDebutPerso, dateFinPerso));
  }, [periode, dateDebutPerso, dateFinPerso]);

  return { periode, setPeriode, dateDebutPerso, setDateDebutPerso, dateFinPerso, setDateFinPerso, plage };
}

// --- Modale Synthèse ---

function ModaleSynthese({
  session,
  periodeInitiale,
  onFermer,
}: {
  session: Session;
  periodeInitiale?: Periode;
  onFermer: () => void;
}) {
  const f = useFiltrePeriode(periodeInitiale);
  const [synthese, setSynthese] = useState<SyntheseVentes | null>(null);

  useEffect(() => {
    if (!f.plage) return;
    syntheseVentesLocale(session.boutiqueId, f.plage.debut, f.plage.fin).then(setSynthese);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [f.plage]);

  const colonnes: { cle: keyof SyntheseVentes; libelle: string }[] = [
    { cle: "totalBrut", libelle: "Total brut" },
    { cle: "totalRemises", libelle: "Remises" },
    { cle: "totalNet", libelle: "Total net" },
    { cle: "nombreVentes", libelle: "Nombre de ventes" },
    { cle: "panierMoyen", libelle: "Panier moyen" },
    { cle: "beneficeTotal", libelle: "Bénéfice" },
  ];

  return (
    <div className="fond-modale" onClick={onFermer}>
      <div className="modale-selection-produits" onClick={(e) => e.stopPropagation()}>
        <EnteteModale titre="Synthèse" onFermer={onFermer} />
        <div className="modale-corps">
          <SelecteurPeriode
            periode={f.periode} setPeriode={f.setPeriode}
            dateDebutPerso={f.dateDebutPerso} setDateDebutPerso={f.setDateDebutPerso}
            dateFinPerso={f.dateFinPerso} setDateFinPerso={f.setDateFinPerso}
          />
          {!synthese ? (
            <p>Chargement…</p>
          ) : (
            <div className="zone-tableau-scroll">
              <table className="tableau-catalogue carte-mobile">
                <thead>
                  <tr>
                    {colonnes.map((c) => (
                      <th key={c.cle}>{c.libelle}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    {colonnes.map((c) => (
                      <td key={c.cle} data-label={c.libelle}>{synthese[c.cle]}</td>
                    ))}
                  </tr>
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// --- Modale Top produits ---

function ModaleTopProduits({
  session,
  periodeInitiale,
  onFermer,
}: {
  session: Session;
  periodeInitiale?: Periode;
  onFermer: () => void;
}) {
  const f = useFiltrePeriode(periodeInitiale);
  const [ordre, setOrdre] = useState<"asc" | "desc">("desc");
  const [lignes, setLignes] = useState<LigneTopProduit[]>([]);

  useEffect(() => {
    if (!f.plage) return;
    topProduitsLocal(session.boutiqueId, f.plage.debut, f.plage.fin, 10, ordre).then(setLignes);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [f.plage, ordre]);

  return (
    <div className="fond-modale" onClick={onFermer}>
      <div className="modale-selection-produits" onClick={(e) => e.stopPropagation()}>
        <EnteteModale titre="Top articles" onFermer={onFermer} />
        <div className="modale-corps">
          <SelecteurPeriode
            periode={f.periode} setPeriode={f.setPeriode}
            dateDebutPerso={f.dateDebutPerso} setDateDebutPerso={f.setDateDebutPerso}
            dateFinPerso={f.dateFinPerso} setDateFinPerso={f.setDateFinPerso}
          />
          <div className="barre-actions">
            <select value={ordre} onChange={(e) => setOrdre(e.target.value as "asc" | "desc")}>
              <option value="desc">Les plus vendus</option>
              <option value="asc">Les moins vendus</option>
            </select>
          </div>
          <div className="zone-tableau-scroll">
            <table className="tableau-catalogue carte-mobile">
              <thead>
                <tr>
                  <th>N°</th>
                  <th>Désignation</th>
                  <th>Référence</th>
                  <th>Quantité vendue</th>
                  <th>CA généré</th>
                </tr>
              </thead>
              <tbody>
                {lignes.map((l, index) => (
                  <tr key={l.varianteId}>
                    <td data-label="N°">{index + 1}</td>
                    <td data-label="Désignation">{l.produit}</td>
                    <td data-label="Référence">{l.reference || ""}</td>
                    <td data-label="Quantité vendue">{l.quantiteVendue}</td>
                    <td data-label="CA généré">{l.caGenere}</td>
                  </tr>
                ))}
                {lignes.length === 0 && (
                  <tr>
                    <td colSpan={5} className="liste-vide">
                      Aucune vente sur la période.
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

// --- Modale Top clients ---

function ModaleTopClients({
  session,
  periodeInitiale,
  onFermer,
}: {
  session: Session;
  periodeInitiale?: Periode;
  onFermer: () => void;
}) {
  const f = useFiltrePeriode(periodeInitiale);
  const [lignes, setLignes] = useState<LigneTopClient[]>([]);

  useEffect(() => {
    if (!f.plage) return;
    topClientsLocal(session.boutiqueId, f.plage.debut, f.plage.fin, 100).then(setLignes);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [f.plage]);

  return (
    <div className="fond-modale" onClick={onFermer}>
      <div className="modale-selection-produits" onClick={(e) => e.stopPropagation()}>
        <EnteteModale titre="Top clients" onFermer={onFermer} />
        <div className="modale-corps">
          <SelecteurPeriode
            periode={f.periode} setPeriode={f.setPeriode}
            dateDebutPerso={f.dateDebutPerso} setDateDebutPerso={f.setDateDebutPerso}
            dateFinPerso={f.dateFinPerso} setDateFinPerso={f.setDateFinPerso}
          />
          <div className="zone-tableau-scroll">
            <table className="tableau-catalogue carte-mobile">
              <thead>
                <tr>
                  <th>N°</th>
                  <th>Client</th>
                  <th>Nombre de ventes</th>
                  <th>CA généré</th>
                </tr>
              </thead>
              <tbody>
                {lignes.map((l, index) => (
                  <tr key={l.clientId}>
                    <td data-label="N°">{index + 1}</td>
                    <td data-label="Client">{l.clientNom}</td>
                    <td data-label="Nombre de ventes">{l.nombreVentes}</td>
                    <td data-label="CA généré">{l.totalNet}</td>
                  </tr>
                ))}
                {lignes.length === 0 && (
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

// --- Modale Valeur du stock ---

function ModaleValeurStock({ session, onFermer }: { session: Session; onFermer: () => void }) {
  const [depots, setDepots] = useState<DepotResume[]>([]);
  const [depotId, setDepotId] = useState("");
  const [valeur, setValeur] = useState<ValeurStock | null>(null);

  useEffect(() => {
    listerDepotsDetail(session.boutiqueId).then(setDepots);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    valeurStockLocal(session.boutiqueId, depotId || undefined).then(setValeur);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [depotId]);

  const colonnes: { cle: keyof ValeurStock; libelle: string }[] = [
    { cle: "valeurAchat", libelle: "Valeur au coût" },
    { cle: "valeurVentePotentielle", libelle: "Valeur au prix de vente" },
    { cle: "nombreVariantes", libelle: "Nombre de lignes de stock" },
    { cle: "nombreRuptures", libelle: "Variantes en rupture" },
  ];

  return (
    <div className="fond-modale" onClick={onFermer}>
      <div className="modale-selection-produits" onClick={(e) => e.stopPropagation()}>
        <EnteteModale titre="Valeur du stock" onFermer={onFermer} />
        <div className="modale-corps">
          <div className="barre-actions">
            <select value={depotId} onChange={(e) => setDepotId(e.target.value)}>
              <option value="">Tous les dépôts</option>
              {depots.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.nom}
                </option>
              ))}
            </select>
          </div>
          {!valeur ? (
            <p>Chargement…</p>
          ) : (
            <div className="zone-tableau-scroll">
              <table className="tableau-catalogue carte-mobile">
                <thead>
                  <tr>
                    {colonnes.map((c) => (
                      <th key={c.cle}>{c.libelle}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    {colonnes.map((c) => (
                      <td key={c.cle} data-label={c.libelle}>{valeur[c.cle]}</td>
                    ))}
                  </tr>
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// --- Modale Ventes par vendeur ---

function ModaleVentesParVendeur({
  session,
  periodeInitiale,
  onFermer,
}: {
  session: Session;
  periodeInitiale?: Periode;
  onFermer: () => void;
}) {
  const f = useFiltrePeriode(periodeInitiale);
  const [lignes, setLignes] = useState<LigneVentesVendeur[]>([]);

  useEffect(() => {
    if (!f.plage) return;
    ventesParVendeurLocal(session.boutiqueId, f.plage.debut, f.plage.fin).then(setLignes);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [f.plage]);

  return (
    <div className="fond-modale" onClick={onFermer}>
      <div className="modale-selection-produits" onClick={(e) => e.stopPropagation()}>
        <EnteteModale titre="Ventes par vendeur" onFermer={onFermer} />
        <div className="modale-corps">
          <SelecteurPeriode
            periode={f.periode} setPeriode={f.setPeriode}
            dateDebutPerso={f.dateDebutPerso} setDateDebutPerso={f.setDateDebutPerso}
            dateFinPerso={f.dateFinPerso} setDateFinPerso={f.setDateFinPerso}
          />
          <div className="zone-tableau-scroll">
            <table className="tableau-catalogue carte-mobile">
              <thead>
                <tr>
                  <th>N°</th>
                  <th>Vendeur</th>
                  <th>Nombre de ventes</th>
                  <th>Total net</th>
                </tr>
              </thead>
              <tbody>
                {lignes.map((l, i) => (
                  <tr key={i}>
                    <td data-label="N°">{i + 1}</td>
                    <td data-label="Vendeur">{libelleVendeur(l.utilisateurId, session)}</td>
                    <td data-label="Nombre de ventes">{l.nombreVentes}</td>
                    <td data-label="Total net">{l.totalNet}</td>
                  </tr>
                ))}
                {lignes.length === 0 && (
                  <tr>
                    <td colSpan={4} className="liste-vide">
                      Aucune vente sur la période.
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

// --- Modale Ventes par catégorie ---

function ModaleVentesParCategorie({
  session,
  periodeInitiale,
  onFermer,
}: {
  session: Session;
  periodeInitiale?: Periode;
  onFermer: () => void;
}) {
  const f = useFiltrePeriode(periodeInitiale);
  const [lignes, setLignes] = useState<LigneVentesCategorie[]>([]);

  useEffect(() => {
    if (!f.plage) return;
    ventesParCategorieLocal(session.boutiqueId, f.plage.debut, f.plage.fin).then(setLignes);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [f.plage]);

  return (
    <div className="fond-modale" onClick={onFermer}>
      <div className="modale-selection-produits" onClick={(e) => e.stopPropagation()}>
        <EnteteModale titre="Ventes par catégorie" onFermer={onFermer} />
        <div className="modale-corps">
          <SelecteurPeriode
            periode={f.periode} setPeriode={f.setPeriode}
            dateDebutPerso={f.dateDebutPerso} setDateDebutPerso={f.setDateDebutPerso}
            dateFinPerso={f.dateFinPerso} setDateFinPerso={f.setDateFinPerso}
          />
          <div className="zone-tableau-scroll">
            <table className="tableau-catalogue carte-mobile">
              <thead>
                <tr>
                  <th>N°</th>
                  <th>Catégorie</th>
                  <th>Quantité vendue</th>
                  <th>CA généré</th>
                </tr>
              </thead>
              <tbody>
                {lignes.map((l, i) => (
                  <tr key={i}>
                    <td data-label="N°">{i + 1}</td>
                    <td data-label="Catégorie">{l.categorie}</td>
                    <td data-label="Quantité vendue">{l.quantiteVendue}</td>
                    <td data-label="CA généré">{l.caGenere}</td>
                  </tr>
                ))}
                {lignes.length === 0 && (
                  <tr>
                    <td colSpan={4} className="liste-vide">
                      Aucune vente sur la période.
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

// --- Modale Ventes par mode de paiement ---

function ModaleVentesParModePaiement({
  session,
  periodeInitiale,
  onFermer,
}: {
  session: Session;
  periodeInitiale?: Periode;
  onFermer: () => void;
}) {
  const f = useFiltrePeriode(periodeInitiale);
  const [lignes, setLignes] = useState<LigneVentesModePaiement[]>([]);

  useEffect(() => {
    if (!f.plage) return;
    ventesParModePaiementLocal(session.boutiqueId, f.plage.debut, f.plage.fin).then(setLignes);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [f.plage]);

  return (
    <div className="fond-modale" onClick={onFermer}>
      <div className="modale-selection-produits" onClick={(e) => e.stopPropagation()}>
        <EnteteModale titre="Ventes par mode de paiement" onFermer={onFermer} />
        <div className="modale-corps">
          <SelecteurPeriode
            periode={f.periode} setPeriode={f.setPeriode}
            dateDebutPerso={f.dateDebutPerso} setDateDebutPerso={f.setDateDebutPerso}
            dateFinPerso={f.dateFinPerso} setDateFinPerso={f.setDateFinPerso}
          />
          <div className="zone-tableau-scroll">
            <table className="tableau-catalogue carte-mobile">
              <thead>
                <tr>
                  <th>N°</th>
                  <th>Mode de paiement</th>
                  <th>Total</th>
                </tr>
              </thead>
              <tbody>
                {lignes.map((l, i) => (
                  <tr key={i}>
                    <td data-label="N°">{i + 1}</td>
                    <td data-label="Mode de paiement">{libelleModePaiement(l.mode)}</td>
                    <td data-label="Total">{l.total}</td>
                  </tr>
                ))}
                {lignes.length === 0 && (
                  <tr>
                    <td colSpan={3} className="liste-vide">
                      Aucun paiement sur la période.
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
  const f = useFiltrePeriode(periodeInitiale ?? "mois");
  const devise = useDevise();
  const [pertes, setPertes] = useState<PerteResume[]>([]);

  useEffect(() => {
    if (!f.plage) return;
    listerPertes(session.boutiqueId, f.plage.debut, f.plage.fin).then(setPertes);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [f.plage]);

  // Regroupement par motif, du plus coûteux au moins coûteux.
  const parMotif = new Map<string, { motif: string; nombre: number; quantite: number; valeur: number }>();
  for (const perte of pertes) {
    const ligne = parMotif.get(perte.motif) ?? { motif: libelleMotifPerte(perte.motif), nombre: 0, quantite: 0, valeur: 0 };
    ligne.nombre += 1;
    ligne.quantite += perte.quantite;
    ligne.valeur += perte.valeur;
    parMotif.set(perte.motif, ligne);
  }
  const lignes = [...parMotif.values()].sort((a, b) => b.valeur - a.valeur);
  const valeurTotale = lignes.reduce((somme, l) => somme + l.valeur, 0);

  return (
    <div className="fond-modale" onClick={onFermer}>
      <div className="modale-selection-produits" onClick={(e) => e.stopPropagation()}>
        <EnteteModale titre="Pertes" onFermer={onFermer} />
        <div className="modale-corps">
          <SelecteurPeriode
            periode={f.periode} setPeriode={f.setPeriode}
            dateDebutPerso={f.dateDebutPerso} setDateDebutPerso={f.setDateDebutPerso}
            dateFinPerso={f.dateFinPerso} setDateFinPerso={f.setDateFinPerso}
          />
          <div className="zone-tableau-scroll">
            <table className="tableau-catalogue carte-mobile">
              <thead>
                <tr>
                  {COLONNES_PERTES.map((c) => (
                    <th key={c.cle}>{c.libelle}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {lignes.map((l) => (
                  <tr key={l.motif}>
                    <td data-label="Motif">{l.motif}</td>
                    <td data-label="Déclarations">{l.nombre}</td>
                    <td data-label="Quantité">{l.quantite}</td>
                    <td data-label="Valeur perdue">
                      {formaterMontant(l.valeur)} {devise}
                    </td>
                  </tr>
                ))}
                {lignes.length === 0 && (
                  <tr>
                    <td colSpan={4} className="liste-vide">
                      Aucune perte sur la période.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          {lignes.length > 0 && (
            <div className="totaux">
              <div className="total-net">
                Valeur totale perdue : {formaterMontant(valeurTotale)} {devise}
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
          <div className="barre-actions">
            <select value={filtre} onChange={(e) => setFiltre(e.target.value as typeof filtre)}>
              <option value="tous">Tous les déstockages</option>
              <option value="en_cours">En cours</option>
              <option value="termine">Terminés</option>
            </select>
            <select value={vue} onChange={(e) => setVue(e.target.value as typeof vue)}>
              <option value="article">Par article</option>
              <option value="operation">Par opération</option>
            </select>
          </div>
          {vue === "article" ? (
            <>
            <div className="zone-tableau-scroll">
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
                </tbody>
              </table>
            </div>
            </>
          ) : (
            <>
            <div className="zone-tableau-scroll">
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
          <div className="barre-actions">
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
          </div>
          <p className="note-aide">
            Articles en stock qui ne se sont pas vendus depuis {jours} jours ou plus (un article jamais vendu compte depuis
            son entrée en stock). Pensez à les mettre en déstockage pour récupérer cet argent.
          </p>
          <div className="zone-tableau-scroll">
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
