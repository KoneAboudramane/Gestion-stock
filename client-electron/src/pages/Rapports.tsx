import { useEffect, useState } from "react";
import type { CSSProperties } from "react";

import { api } from "../api/client";
import type {
  ColonneExport,
  Depot,
  FormatExport,
  LigneTopClient,
  LigneTopProduit,
  LigneVentesCategorie,
  LigneVentesModePaiement,
  LigneVentesVendeur,
  Periode,
  PlageDates,
  Session,
  SyntheseVentes,
  ValeurStock,
} from "../api/client";
import { formaterMontant } from "../lib/formatage";
import { libelleModePaiement } from "../lib/libelles";

/**
 * Chaque document s'ouvre dans sa propre modale (même principe que
 * Comptabilite.tsx), avec son propre filtre de période à l'intérieur. Les
 * props ongletInitial/periodeInitiale (venant de Shell.tsx, ex. lien "Voir
 * tout" du tableau de bord) ouvrent directement la modale correspondante.
 */

function libelleVendeur(utilisateurId: string | null, session: Session): string {
  if (!utilisateurId) return "";
  if (utilisateurId === session.utilisateurId) return "Vous";
  return `Utilisateur ${utilisateurId.slice(0, 8)}`;
}

// --- Export ---

function BoutonsExport({
  titre,
  colonnes,
  lignes,
}: {
  titre: string;
  colonnes: ColonneExport[];
  lignes: Record<string, unknown>[];
}) {
  const [message, setMessage] = useState<string | null>(null);
  const [enCours, setEnCours] = useState<FormatExport | null>(null);

  async function exporter(format: FormatExport) {
    setMessage(null);
    setEnCours(format);
    try {
      const resultat = await api.rapports.exporter(titre, colonnes, lignes, format);
      if (!resultat.succes) {
        setMessage(resultat.message);
      } else if (!resultat.resultat.annule) {
        setMessage(`Enregistré : ${resultat.resultat.chemin}`);
      }
    } finally {
      setEnCours(null);
    }
  }

  return (
    <div className="barre-export">
      <button type="button" onClick={() => exporter("csv")} disabled={enCours !== null}>
        Export CSV
      </button>
      <button type="button" onClick={() => exporter("xlsx")} disabled={enCours !== null}>
        Export Excel
      </button>
      <button type="button" onClick={() => exporter("pdf")} disabled={enCours !== null}>
        Export PDF
      </button>
      {message && <span className="note-aide">{message}</span>}
    </div>
  );
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
    <>
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
    </>
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

const DOCUMENTS = [
  { cle: "synthese", label: "Synthèse", icone: "📊" },
  { cle: "topProduits", label: "Top articles", icone: "🏷️" },
  { cle: "topClients", label: "Top clients", icone: "🏆" },
  { cle: "valeurStock", label: "Valeur du stock", icone: "📦" },
  { cle: "vendeurs", label: "Ventes par vendeur", icone: "🧑‍💼" },
  { cle: "categories", label: "Ventes par catégorie", icone: "🗂️" },
  { cle: "modePaiement", label: "Ventes par mode de paiement", icone: "💳" },
] as const;

export type OngletRapports = (typeof DOCUMENTS)[number]["cle"];

/** Fabrique le state période + la plage recalculée, commun à tous les documents sauf Valeur du stock. */
function useFiltrePeriode(session: Session, periodeInitiale?: Periode) {
  const [periode, setPeriode] = useState<Periode>(periodeInitiale ?? "jour");
  const [dateDebutPerso, setDateDebutPerso] = useState(new Date().toISOString().slice(0, 10));
  const [dateFinPerso, setDateFinPerso] = useState(new Date().toISOString().slice(0, 10));
  const [plage, setPlage] = useState<PlageDates | null>(null);

  useEffect(() => {
    api.rapports.plageDates(periode, dateDebutPerso, dateFinPerso).then(setPlage);
  }, [periode, dateDebutPerso, dateFinPerso]);

  return { periode, setPeriode, dateDebutPerso, setDateDebutPerso, dateFinPerso, setDateFinPerso, plage };
}

// --- Modale Synthèse ---

const COLONNES_SYNTHESE: ColonneExport[] = [
  { cle: "totalBrut", libelle: "Total brut" },
  { cle: "totalRemises", libelle: "Remises" },
  { cle: "totalNet", libelle: "Total net" },
  { cle: "nombreVentes", libelle: "Nombre de ventes" },
  { cle: "panierMoyen", libelle: "Panier moyen" },
  { cle: "beneficeTotal", libelle: "Bénéfice" },
];

function ModaleSynthese({ session, periodeInitiale, onFermer }: { session: Session; periodeInitiale?: Periode; onFermer: () => void }) {
  const f = useFiltrePeriode(session, periodeInitiale);
  const [synthese, setSynthese] = useState<SyntheseVentes | null>(null);

  useEffect(() => {
    if (!f.plage) return;
    api.rapports.syntheseVentes(session.boutiqueId, f.plage.debut, f.plage.fin).then(setSynthese);
  }, [session.boutiqueId, f.plage]);

  return (
    <div className="fond-modale" onClick={onFermer}>
      <div className="modale-selection-produits" onClick={(e) => e.stopPropagation()}>
        <EnteteModale titre="Synthèse" onFermer={onFermer} />
        <div className="modale-corps">
          <div className="barre-actions">
            <SelecteurPeriode
              periode={f.periode} setPeriode={f.setPeriode}
              dateDebutPerso={f.dateDebutPerso} setDateDebutPerso={f.setDateDebutPerso}
              dateFinPerso={f.dateFinPerso} setDateFinPerso={f.setDateFinPerso}
            />
            {synthese && (
              <span className="actions-ligne">
                <BoutonsExport
                  titre="Synthese des ventes"
                  colonnes={COLONNES_SYNTHESE}
                  lignes={[synthese as unknown as Record<string, unknown>]}
                />
              </span>
            )}
          </div>
          {!synthese ? (
            <p>Chargement…</p>
          ) : (
            <div className="zone-tableau-scroll">
              <table className="tableau-catalogue">
                <thead>
                  <tr>
                    {COLONNES_SYNTHESE.map((c) => (
                      <th key={c.cle}>{c.libelle}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    {COLONNES_SYNTHESE.map((c) => (
                      <td key={c.cle}>{formaterMontant((synthese as unknown as Record<string, unknown>)[c.cle] as number)}</td>
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

const COLONNES_TOP_PRODUITS: ColonneExport[] = [
  { cle: "produit", libelle: "Désignation" },
  { cle: "reference", libelle: "Référence" },
  { cle: "quantiteVendue", libelle: "Quantité vendue" },
  { cle: "caGenere", libelle: "CA généré" },
];

function ModaleTopProduits({ session, periodeInitiale, onFermer }: { session: Session; periodeInitiale?: Periode; onFermer: () => void }) {
  const f = useFiltrePeriode(session, periodeInitiale);
  const [ordre, setOrdre] = useState<"asc" | "desc">("desc");
  const [lignes, setLignes] = useState<LigneTopProduit[]>([]);

  useEffect(() => {
    if (!f.plage) return;
    api.rapports.topProduits(session.boutiqueId, f.plage.debut, f.plage.fin, 10, ordre).then(setLignes);
  }, [session.boutiqueId, f.plage, ordre]);

  return (
    <div className="fond-modale" onClick={onFermer}>
      <div className="modale-selection-produits" onClick={(e) => e.stopPropagation()}>
        <EnteteModale titre="Top articles" onFermer={onFermer} />
        <div className="modale-corps">
          <div className="barre-actions">
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
              <BoutonsExport
                titre="Top articles"
                colonnes={COLONNES_TOP_PRODUITS}
                lignes={lignes as unknown as Record<string, unknown>[]}
              />
            </span>
          </div>
          <div className="zone-tableau-scroll">
            <table className="tableau-catalogue">
              <thead>
                <tr>
                  {COLONNES_TOP_PRODUITS.map((c) => (
                    <th key={c.cle}>{c.libelle}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {lignes.map((l) => (
                  <tr key={l.varianteId}>
                    <td>{l.produit}</td>
                    <td>{l.reference || ""}</td>
                    <td>{l.quantiteVendue}</td>
                    <td>{formaterMontant(l.caGenere)}</td>
                  </tr>
                ))}
                {lignes.length === 0 && (
                  <tr>
                    <td colSpan={4} className="liste-vide">
                      Aucune vente sur la période.
                    </td>
                  </tr>
                )}
                {lignes.length > 0 &&
                  Array.from({ length: Math.max(0, 10 - lignes.length) }).map((_, i) => (
                    <tr key={`vide-${i}`} className="ligne-groupe-vide">
                      {COLONNES_TOP_PRODUITS.map((c) => (
                        <td key={c.cle}>&nbsp;</td>
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

// --- Modale Top clients ---

const COLONNES_TOP_CLIENTS: ColonneExport[] = [
  { cle: "clientNom", libelle: "Client" },
  { cle: "nombreVentes", libelle: "Nombre de ventes" },
  { cle: "totalNet", libelle: "CA généré" },
];

function ModaleTopClients({ session, periodeInitiale, onFermer }: { session: Session; periodeInitiale?: Periode; onFermer: () => void }) {
  const f = useFiltrePeriode(session, periodeInitiale);
  const [lignes, setLignes] = useState<LigneTopClient[]>([]);

  useEffect(() => {
    if (!f.plage) return;
    api.rapports.topClients(session.boutiqueId, f.plage.debut, f.plage.fin, 100).then(setLignes);
  }, [session.boutiqueId, f.plage]);

  return (
    <div className="fond-modale" onClick={onFermer}>
      <div className="modale-selection-produits" onClick={(e) => e.stopPropagation()}>
        <EnteteModale titre="Top clients" onFermer={onFermer} />
        <div className="modale-corps">
          <div className="barre-actions">
            <SelecteurPeriode
              periode={f.periode} setPeriode={f.setPeriode}
              dateDebutPerso={f.dateDebutPerso} setDateDebutPerso={f.setDateDebutPerso}
              dateFinPerso={f.dateFinPerso} setDateFinPerso={f.setDateFinPerso}
            />
            <span className="actions-ligne">
              <BoutonsExport
                titre="Top clients"
                colonnes={COLONNES_TOP_CLIENTS}
                lignes={lignes as unknown as Record<string, unknown>[]}
              />
            </span>
          </div>
          <div className="zone-tableau-scroll">
            <table className="tableau-catalogue">
              <thead>
                <tr>
                  {COLONNES_TOP_CLIENTS.map((c) => (
                    <th key={c.cle}>{c.libelle}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {lignes.map((l) => (
                  <tr key={l.clientId}>
                    <td>{l.clientNom}</td>
                    <td>{l.nombreVentes}</td>
                    <td>{formaterMontant(l.totalNet)}</td>
                  </tr>
                ))}
                {lignes.length === 0 && (
                  <tr>
                    <td colSpan={3} className="liste-vide">
                      Aucune vente à un client identifié sur la période.
                    </td>
                  </tr>
                )}
                {lignes.length > 0 &&
                  Array.from({ length: Math.max(0, 10 - lignes.length) }).map((_, i) => (
                    <tr key={`vide-${i}`} className="ligne-groupe-vide">
                      {COLONNES_TOP_CLIENTS.map((c) => (
                        <td key={c.cle}>&nbsp;</td>
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

// --- Modale Valeur du stock ---

const COLONNES_VALEUR_STOCK: ColonneExport[] = [
  { cle: "valeurAchat", libelle: "Valeur au coût" },
  { cle: "valeurVentePotentielle", libelle: "Valeur au prix de vente" },
  { cle: "nombreVariantes", libelle: "Nombre de lignes de stock" },
  { cle: "nombreRuptures", libelle: "Variantes en rupture" },
];

function ModaleValeurStock({ session, onFermer }: { session: Session; onFermer: () => void }) {
  const [depots, setDepots] = useState<Depot[]>([]);
  const [depotId, setDepotId] = useState("");
  const [valeur, setValeur] = useState<ValeurStock | null>(null);

  useEffect(() => {
    api.catalogue.listerDepots(session.boutiqueId).then(setDepots);
  }, [session.boutiqueId]);

  useEffect(() => {
    api.rapports.valeurStock(session.boutiqueId, depotId || undefined).then(setValeur);
  }, [session.boutiqueId, depotId]);

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
            {valeur && (
              <span className="actions-ligne">
                <BoutonsExport
                  titre="Valeur du stock"
                  colonnes={COLONNES_VALEUR_STOCK}
                  lignes={[valeur as unknown as Record<string, unknown>]}
                />
              </span>
            )}
          </div>
          {!valeur ? (
            <p>Chargement…</p>
          ) : (
            <div className="zone-tableau-scroll">
              <table className="tableau-catalogue">
                <thead>
                  <tr>
                    {COLONNES_VALEUR_STOCK.map((c) => (
                      <th key={c.cle}>{c.libelle}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    {COLONNES_VALEUR_STOCK.map((c) => (
                      <td key={c.cle}>{formaterMontant((valeur as unknown as Record<string, unknown>)[c.cle] as number)}</td>
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

const COLONNES_VENDEUR: ColonneExport[] = [
  { cle: "vendeur", libelle: "Vendeur" },
  { cle: "nombreVentes", libelle: "Nombre de ventes" },
  { cle: "totalNet", libelle: "Total net" },
];

function ModaleVentesParVendeur({ session, periodeInitiale, onFermer }: { session: Session; periodeInitiale?: Periode; onFermer: () => void }) {
  const f = useFiltrePeriode(session, periodeInitiale);
  const [lignes, setLignes] = useState<LigneVentesVendeur[]>([]);

  useEffect(() => {
    if (!f.plage) return;
    api.rapports.ventesParVendeur(session.boutiqueId, f.plage.debut, f.plage.fin).then(setLignes);
  }, [session.boutiqueId, f.plage]);

  const lignesExport = lignes.map((l) => ({
    vendeur: libelleVendeur(l.utilisateurId, session),
    nombreVentes: l.nombreVentes,
    totalNet: l.totalNet,
  }));

  return (
    <div className="fond-modale" onClick={onFermer}>
      <div className="modale-selection-produits" onClick={(e) => e.stopPropagation()}>
        <EnteteModale titre="Ventes par vendeur" onFermer={onFermer} />
        <div className="modale-corps">
          <div className="barre-actions">
            <SelecteurPeriode
              periode={f.periode} setPeriode={f.setPeriode}
              dateDebutPerso={f.dateDebutPerso} setDateDebutPerso={f.setDateDebutPerso}
              dateFinPerso={f.dateFinPerso} setDateFinPerso={f.setDateFinPerso}
            />
            <span className="actions-ligne">
              <BoutonsExport titre="Ventes par vendeur" colonnes={COLONNES_VENDEUR} lignes={lignesExport} />
            </span>
          </div>
          <div className="zone-tableau-scroll">
            <table className="tableau-catalogue">
              <thead>
                <tr>
                  {COLONNES_VENDEUR.map((c) => (
                    <th key={c.cle}>{c.libelle}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {lignesExport.map((l, i) => (
                  <tr key={i}>
                    <td>{l.vendeur}</td>
                    <td>{l.nombreVentes}</td>
                    <td>{formaterMontant(l.totalNet)}</td>
                  </tr>
                ))}
                {lignesExport.length === 0 && (
                  <tr>
                    <td colSpan={3} className="liste-vide">
                      Aucune vente sur la période.
                    </td>
                  </tr>
                )}
                {lignesExport.length > 0 &&
                  Array.from({ length: Math.max(0, 10 - lignesExport.length) }).map((_, i) => (
                    <tr key={`vide-${i}`} className="ligne-groupe-vide">
                      {COLONNES_VENDEUR.map((c) => (
                        <td key={c.cle}>&nbsp;</td>
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

// --- Modale Ventes par catégorie ---

const COLONNES_CATEGORIE: ColonneExport[] = [
  { cle: "categorie", libelle: "Catégorie" },
  { cle: "quantiteVendue", libelle: "Quantité vendue" },
  { cle: "caGenere", libelle: "CA généré" },
];

function ModaleVentesParCategorie({ session, periodeInitiale, onFermer }: { session: Session; periodeInitiale?: Periode; onFermer: () => void }) {
  const f = useFiltrePeriode(session, periodeInitiale);
  const [lignes, setLignes] = useState<LigneVentesCategorie[]>([]);

  useEffect(() => {
    if (!f.plage) return;
    api.rapports.ventesParCategorie(session.boutiqueId, f.plage.debut, f.plage.fin).then(setLignes);
  }, [session.boutiqueId, f.plage]);

  return (
    <div className="fond-modale" onClick={onFermer}>
      <div className="modale-selection-produits" onClick={(e) => e.stopPropagation()}>
        <EnteteModale titre="Ventes par catégorie" onFermer={onFermer} />
        <div className="modale-corps">
          <div className="barre-actions">
            <SelecteurPeriode
              periode={f.periode} setPeriode={f.setPeriode}
              dateDebutPerso={f.dateDebutPerso} setDateDebutPerso={f.setDateDebutPerso}
              dateFinPerso={f.dateFinPerso} setDateFinPerso={f.setDateFinPerso}
            />
            <span className="actions-ligne">
              <BoutonsExport
                titre="Ventes par categorie"
                colonnes={COLONNES_CATEGORIE}
                lignes={lignes as unknown as Record<string, unknown>[]}
              />
            </span>
          </div>
          <div className="zone-tableau-scroll">
            <table className="tableau-catalogue">
              <thead>
                <tr>
                  {COLONNES_CATEGORIE.map((c) => (
                    <th key={c.cle}>{c.libelle}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {lignes.map((l, i) => (
                  <tr key={i}>
                    <td>{l.categorie}</td>
                    <td>{l.quantiteVendue}</td>
                    <td>{formaterMontant(l.caGenere)}</td>
                  </tr>
                ))}
                {lignes.length === 0 && (
                  <tr>
                    <td colSpan={3} className="liste-vide">
                      Aucune vente sur la période.
                    </td>
                  </tr>
                )}
                {lignes.length > 0 &&
                  Array.from({ length: Math.max(0, 10 - lignes.length) }).map((_, i) => (
                    <tr key={`vide-${i}`} className="ligne-groupe-vide">
                      {COLONNES_CATEGORIE.map((c) => (
                        <td key={c.cle}>&nbsp;</td>
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

// --- Modale Ventes par mode de paiement ---

const COLONNES_MODE_PAIEMENT: ColonneExport[] = [
  { cle: "mode", libelle: "Mode de paiement" },
  { cle: "total", libelle: "Total" },
];

function ModaleVentesParModePaiement({ session, periodeInitiale, onFermer }: { session: Session; periodeInitiale?: Periode; onFermer: () => void }) {
  const f = useFiltrePeriode(session, periodeInitiale);
  const [lignes, setLignes] = useState<LigneVentesModePaiement[]>([]);

  useEffect(() => {
    if (!f.plage) return;
    api.rapports.ventesParModePaiement(session.boutiqueId, f.plage.debut, f.plage.fin).then(setLignes);
  }, [session.boutiqueId, f.plage]);

  return (
    <div className="fond-modale" onClick={onFermer}>
      <div className="modale-selection-produits" onClick={(e) => e.stopPropagation()}>
        <EnteteModale titre="Ventes par mode de paiement" onFermer={onFermer} />
        <div className="modale-corps">
          <div className="barre-actions">
            <SelecteurPeriode
              periode={f.periode} setPeriode={f.setPeriode}
              dateDebutPerso={f.dateDebutPerso} setDateDebutPerso={f.setDateDebutPerso}
              dateFinPerso={f.dateFinPerso} setDateFinPerso={f.setDateFinPerso}
            />
            <span className="actions-ligne">
              <BoutonsExport
                titre="Ventes par mode de paiement"
                colonnes={COLONNES_MODE_PAIEMENT}
                lignes={lignes.map((l) => ({ mode: libelleModePaiement(l.mode), total: l.total }))}
              />
            </span>
          </div>
          <div className="zone-tableau-scroll">
            <table className="tableau-catalogue">
              <thead>
                <tr>
                  {COLONNES_MODE_PAIEMENT.map((c) => (
                    <th key={c.cle}>{c.libelle}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {lignes.map((l, i) => (
                  <tr key={i}>
                    <td>{libelleModePaiement(l.mode)}</td>
                    <td>{formaterMontant(l.total)}</td>
                  </tr>
                ))}
                {lignes.length > 0 &&
                  Array.from({ length: Math.max(0, 10 - lignes.length) }).map((_, i) => (
                    <tr key={`vide-${i}`} className="ligne-groupe-vide">
                      {COLONNES_MODE_PAIEMENT.map((c) => (
                        <td key={c.cle}>&nbsp;</td>
                      ))}
                    </tr>
                  ))}
                {lignes.length === 0 && (
                  <tr>
                    <td colSpan={2} className="liste-vide">
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

export default function Rapports({
  session,
  ongletInitial,
  periodeInitiale,
}: {
  session: Session;
  ongletInitial?: OngletRapports;
  periodeInitiale?: Periode;
}) {
  const peutVoir = !!session.permissions.voir_rapports_complets;
  const [documentOuvert, setDocumentOuvert] = useState<OngletRapports | null>(
    ongletInitial ?? (periodeInitiale ? "synthese" : null),
  );

  if (!peutVoir) {
    return (
      <div className="page-produits">
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
      {documentOuvert === "valeurStock" && (
        <ModaleValeurStock session={session} onFermer={() => setDocumentOuvert(null)} />
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
