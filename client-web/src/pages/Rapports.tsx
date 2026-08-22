import { useEffect, useState } from "react";
import type { CSSProperties } from "react";

import type { Session } from "../api";
import { libelleModePaiement } from "../lib/libelles";
import {
  calculerPlageDates,
  syntheseVentes as syntheseVentesLocale,
  topClients as topClientsLocal,
  topProduits as topProduitsLocal,
  valeurStock as valeurStockLocal,
  ventesParCategorie as ventesParCategorieLocal,
  ventesParModePaiement as ventesParModePaiementLocal,
  ventesParVendeur as ventesParVendeurLocal,
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
import { listerDepotsDetail, type DepotResume } from "../services/stock";

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
              <table className="tableau-catalogue">
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
                      <td key={c.cle}>{synthese[c.cle]}</td>
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
            <table className="tableau-catalogue">
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
                    <td>{index + 1}</td>
                    <td>{l.produit}</td>
                    <td>{l.reference || ""}</td>
                    <td>{l.quantiteVendue}</td>
                    <td>{l.caGenere}</td>
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
            <table className="tableau-catalogue">
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
                    <td>{index + 1}</td>
                    <td>{l.clientNom}</td>
                    <td>{l.nombreVentes}</td>
                    <td>{l.totalNet}</td>
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
              <table className="tableau-catalogue">
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
                      <td key={c.cle}>{valeur[c.cle]}</td>
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
            <table className="tableau-catalogue">
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
                    <td>{i + 1}</td>
                    <td>{libelleVendeur(l.utilisateurId, session)}</td>
                    <td>{l.nombreVentes}</td>
                    <td>{l.totalNet}</td>
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
            <table className="tableau-catalogue">
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
                    <td>{i + 1}</td>
                    <td>{l.categorie}</td>
                    <td>{l.quantiteVendue}</td>
                    <td>{l.caGenere}</td>
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
            <table className="tableau-catalogue">
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
                    <td>{i + 1}</td>
                    <td>{libelleModePaiement(l.mode)}</td>
                    <td>{l.total}</td>
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
  { cle: "vendeurs", label: "Ventes par vendeur", icone: "🧑‍💼" },
  { cle: "categories", label: "Ventes par catégorie", icone: "🗂️" },
  { cle: "modePaiement", label: "Ventes par mode de paiement", icone: "💳" },
] as const;

export type DocumentRapport = (typeof DOCUMENTS)[number]["cle"];

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
