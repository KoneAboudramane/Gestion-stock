import { useEffect, useState } from "react";

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

// --- Sélecteur de période partagé ---

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

// --- Sélecteur d'onglet (fusionné dans la barre d'actions de chaque onglet) ---

const ONGLETS = [
  { cle: "synthese", label: "Synthèse" },
  { cle: "topProduits", label: "Top articles" },
  { cle: "topClients", label: "Top clients" },
  { cle: "valeurStock", label: "Valeur du stock" },
  { cle: "vendeurs", label: "Ventes par vendeur" },
  { cle: "categories", label: "Ventes par catégorie" },
  { cle: "modePaiement", label: "Ventes par mode de paiement" },
] as const;

export type OngletRapports = (typeof ONGLETS)[number]["cle"];

function SelecteurOnglet({
  onglet,
  setOnglet,
}: {
  onglet: OngletRapports;
  setOnglet: (o: OngletRapports) => void;
}) {
  return (
    <div className="barre-onglets">
      {ONGLETS.map((o) => (
        <button
          key={o.cle}
          type="button"
          className={`onglet ${onglet === o.cle ? "actif" : ""}`}
          onClick={() => setOnglet(o.cle)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

// Props communes à un onglet basé sur une plage de dates (tous sauf Valeur du
// stock, qui n'a pas de filtre de période).
interface ProprietesFiltrePeriode {
  periode: Periode;
  setPeriode: (p: Periode) => void;
  dateDebutPerso: string;
  setDateDebutPerso: (v: string) => void;
  dateFinPerso: string;
  setDateFinPerso: (v: string) => void;
}

interface ProprietesOnglet {
  onglet: OngletRapports;
  setOnglet: (o: OngletRapports) => void;
}

// --- Onglet Synthèse ---

const COLONNES_SYNTHESE: ColonneExport[] = [
  { cle: "totalBrut", libelle: "Total brut" },
  { cle: "totalRemises", libelle: "Remises" },
  { cle: "totalNet", libelle: "Total net" },
  { cle: "nombreVentes", libelle: "Nombre de ventes" },
  { cle: "panierMoyen", libelle: "Panier moyen" },
  { cle: "beneficeTotal", libelle: "Bénéfice" },
];

function OngletSynthese({
  session,
  plage,
  onglet,
  setOnglet,
  periode,
  setPeriode,
  dateDebutPerso,
  setDateDebutPerso,
  dateFinPerso,
  setDateFinPerso,
}: { session: Session; plage: PlageDates | null } & ProprietesOnglet & ProprietesFiltrePeriode) {
  const [synthese, setSynthese] = useState<SyntheseVentes | null>(null);

  useEffect(() => {
    if (!plage) return;
    api.rapports.syntheseVentes(session.boutiqueId, plage.debut, plage.fin).then(setSynthese);
  }, [session.boutiqueId, plage]);

  if (!synthese) return <p>Chargement…</p>;

  return (
    <div>
      <div className="barre-actions barre-actions-avec-onglets">
        <SelecteurPeriode
          periode={periode}
          setPeriode={setPeriode}
          dateDebutPerso={dateDebutPerso}
          setDateDebutPerso={setDateDebutPerso}
          dateFinPerso={dateFinPerso}
          setDateFinPerso={setDateFinPerso}
        />
        <span className="actions-ligne">
          <BoutonsExport
            titre="Synthese des ventes"
            colonnes={COLONNES_SYNTHESE}
            lignes={[synthese as unknown as Record<string, unknown>]}
          />
        </span>
      </div>
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
    </div>
  );
}

// --- Onglet Top produits ---

const COLONNES_TOP_PRODUITS: ColonneExport[] = [
  { cle: "produit", libelle: "Désignation" },
  { cle: "reference", libelle: "Référence" },
  { cle: "quantiteVendue", libelle: "Quantité vendue" },
  { cle: "caGenere", libelle: "CA généré" },
];

function OngletTopProduits({
  session,
  plage,
  onglet,
  setOnglet,
  periode,
  setPeriode,
  dateDebutPerso,
  setDateDebutPerso,
  dateFinPerso,
  setDateFinPerso,
}: { session: Session; plage: PlageDates | null } & ProprietesOnglet & ProprietesFiltrePeriode) {
  const [ordre, setOrdre] = useState<"asc" | "desc">("desc");
  const [lignes, setLignes] = useState<LigneTopProduit[]>([]);

  useEffect(() => {
    if (!plage) return;
    api.rapports.topProduits(session.boutiqueId, plage.debut, plage.fin, 10, ordre).then(setLignes);
  }, [session.boutiqueId, plage, ordre]);

  return (
    <div>
      <div className="barre-actions barre-actions-avec-onglets">
        <SelecteurPeriode
          periode={periode}
          setPeriode={setPeriode}
          dateDebutPerso={dateDebutPerso}
          setDateDebutPerso={setDateDebutPerso}
          dateFinPerso={dateFinPerso}
          setDateFinPerso={setDateFinPerso}
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
  );
}

// --- Onglet Top clients ---

const COLONNES_TOP_CLIENTS: ColonneExport[] = [
  { cle: "clientNom", libelle: "Client" },
  { cle: "nombreVentes", libelle: "Nombre de ventes" },
  { cle: "totalNet", libelle: "CA généré" },
];

function OngletTopClients({
  session,
  plage,
  onglet,
  setOnglet,
  periode,
  setPeriode,
  dateDebutPerso,
  setDateDebutPerso,
  dateFinPerso,
  setDateFinPerso,
}: { session: Session; plage: PlageDates | null } & ProprietesOnglet & ProprietesFiltrePeriode) {
  const [lignes, setLignes] = useState<LigneTopClient[]>([]);

  useEffect(() => {
    if (!plage) return;
    api.rapports.topClients(session.boutiqueId, plage.debut, plage.fin, 100).then(setLignes);
  }, [session.boutiqueId, plage]);

  return (
    <div>
      <div className="barre-actions barre-actions-avec-onglets">
        <SelecteurPeriode
          periode={periode}
          setPeriode={setPeriode}
          dateDebutPerso={dateDebutPerso}
          setDateDebutPerso={setDateDebutPerso}
          dateFinPerso={dateFinPerso}
          setDateFinPerso={setDateFinPerso}
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
  );
}

// --- Onglet Valeur du stock ---

const COLONNES_VALEUR_STOCK: ColonneExport[] = [
  { cle: "valeurAchat", libelle: "Valeur au coût" },
  { cle: "valeurVentePotentielle", libelle: "Valeur au prix de vente" },
  { cle: "nombreVariantes", libelle: "Nombre de lignes de stock" },
  { cle: "nombreRuptures", libelle: "Variantes en rupture" },
];

function OngletValeurStock({ session, onglet, setOnglet }: { session: Session } & ProprietesOnglet) {
  const [depots, setDepots] = useState<Depot[]>([]);
  const [depotId, setDepotId] = useState("");
  const [valeur, setValeur] = useState<ValeurStock | null>(null);

  useEffect(() => {
    api.catalogue.listerDepots(session.boutiqueId).then(setDepots);
  }, [session.boutiqueId]);

  useEffect(() => {
    api.rapports.valeurStock(session.boutiqueId, depotId || undefined).then(setValeur);
  }, [session.boutiqueId, depotId]);

  if (!valeur) return <p>Chargement…</p>;

  return (
    <div>
      <div className="barre-actions barre-actions-avec-onglets">
        <select value={depotId} onChange={(e) => setDepotId(e.target.value)}>
          <option value="">Tous les dépôts</option>
          {depots.map((d) => (
            <option key={d.id} value={d.id}>
              {d.nom}
            </option>
          ))}
        </select>
        <span className="actions-ligne">
          <BoutonsExport
            titre="Valeur du stock"
            colonnes={COLONNES_VALEUR_STOCK}
            lignes={[valeur as unknown as Record<string, unknown>]}
          />
        </span>
      </div>
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
    </div>
  );
}

// --- Onglet Ventes par vendeur ---

const COLONNES_VENDEUR: ColonneExport[] = [
  { cle: "vendeur", libelle: "Vendeur" },
  { cle: "nombreVentes", libelle: "Nombre de ventes" },
  { cle: "totalNet", libelle: "Total net" },
];

function OngletVentesParVendeur({
  session,
  plage,
  onglet,
  setOnglet,
  periode,
  setPeriode,
  dateDebutPerso,
  setDateDebutPerso,
  dateFinPerso,
  setDateFinPerso,
}: { session: Session; plage: PlageDates | null } & ProprietesOnglet & ProprietesFiltrePeriode) {
  const [lignes, setLignes] = useState<LigneVentesVendeur[]>([]);

  useEffect(() => {
    if (!plage) return;
    api.rapports.ventesParVendeur(session.boutiqueId, plage.debut, plage.fin).then(setLignes);
  }, [session.boutiqueId, plage]);

  const lignesExport = lignes.map((l) => ({
    vendeur: libelleVendeur(l.utilisateurId, session),
    nombreVentes: l.nombreVentes,
    totalNet: l.totalNet,
  }));

  return (
    <div>
      <div className="barre-actions barre-actions-avec-onglets">
        <SelecteurPeriode
          periode={periode}
          setPeriode={setPeriode}
          dateDebutPerso={dateDebutPerso}
          setDateDebutPerso={setDateDebutPerso}
          dateFinPerso={dateFinPerso}
          setDateFinPerso={setDateFinPerso}
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
  );
}

// --- Onglet Ventes par catégorie ---

const COLONNES_CATEGORIE: ColonneExport[] = [
  { cle: "categorie", libelle: "Catégorie" },
  { cle: "quantiteVendue", libelle: "Quantité vendue" },
  { cle: "caGenere", libelle: "CA généré" },
];

function OngletVentesParCategorie({
  session,
  plage,
  onglet,
  setOnglet,
  periode,
  setPeriode,
  dateDebutPerso,
  setDateDebutPerso,
  dateFinPerso,
  setDateFinPerso,
}: { session: Session; plage: PlageDates | null } & ProprietesOnglet & ProprietesFiltrePeriode) {
  const [lignes, setLignes] = useState<LigneVentesCategorie[]>([]);

  useEffect(() => {
    if (!plage) return;
    api.rapports.ventesParCategorie(session.boutiqueId, plage.debut, plage.fin).then(setLignes);
  }, [session.boutiqueId, plage]);

  return (
    <div>
      <div className="barre-actions barre-actions-avec-onglets">
        <SelecteurPeriode
          periode={periode}
          setPeriode={setPeriode}
          dateDebutPerso={dateDebutPerso}
          setDateDebutPerso={setDateDebutPerso}
          dateFinPerso={dateFinPerso}
          setDateFinPerso={setDateFinPerso}
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
  );
}

// --- Onglet Ventes par mode de paiement ---

const COLONNES_MODE_PAIEMENT: ColonneExport[] = [
  { cle: "mode", libelle: "Mode de paiement" },
  { cle: "total", libelle: "Total" },
];

function OngletVentesParModePaiement({
  session,
  plage,
  onglet,
  setOnglet,
  periode,
  setPeriode,
  dateDebutPerso,
  setDateDebutPerso,
  dateFinPerso,
  setDateFinPerso,
}: { session: Session; plage: PlageDates | null } & ProprietesOnglet & ProprietesFiltrePeriode) {
  const [lignes, setLignes] = useState<LigneVentesModePaiement[]>([]);

  useEffect(() => {
    if (!plage) return;
    api.rapports.ventesParModePaiement(session.boutiqueId, plage.debut, plage.fin).then(setLignes);
  }, [session.boutiqueId, plage]);

  return (
    <div>
      <div className="barre-actions barre-actions-avec-onglets">
        <SelecteurPeriode
          periode={periode}
          setPeriode={setPeriode}
          dateDebutPerso={dateDebutPerso}
          setDateDebutPerso={setDateDebutPerso}
          dateFinPerso={dateFinPerso}
          setDateFinPerso={setDateFinPerso}
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
  );
}

// --- Page principale ---
// Contrairement aux autres pages à onglets, Rapports a trop d'onglets (7, aux
// libellés longs) pour tenir sur la même ligne que le filtre de période et les
// boutons d'export sans que ce soit encombré — la barre d'onglets reste donc
// sur sa propre ligne, en en-tête de page.

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
  const [onglet, setOnglet] = useState<OngletRapports>(ongletInitial ?? "synthese");
  const [periode, setPeriode] = useState<Periode>(periodeInitiale ?? "jour");
  const [dateDebutPerso, setDateDebutPerso] = useState(new Date().toISOString().slice(0, 10));
  const [dateFinPerso, setDateFinPerso] = useState(new Date().toISOString().slice(0, 10));
  const [plage, setPlage] = useState<PlageDates | null>(null);

  useEffect(() => {
    if (!peutVoir) return;
    api.rapports.plageDates(periode, dateDebutPerso, dateFinPerso).then(setPlage);
  }, [peutVoir, periode, dateDebutPerso, dateFinPerso]);

  if (!peutVoir) {
    return (
      <div className="page-produits">
        <p className="note-aide">Vous n'avez pas accès aux rapports.</p>
      </div>
    );
  }

  const proprietesPeriode: ProprietesFiltrePeriode = {
    periode,
    setPeriode,
    dateDebutPerso,
    setDateDebutPerso,
    dateFinPerso,
    setDateFinPerso,
  };
  const proprietesOnglet: ProprietesOnglet = { onglet, setOnglet };

  return (
    <div className="page-produits">
      <div className="entete-page-onglets">
        <SelecteurOnglet onglet={onglet} setOnglet={setOnglet} />
      </div>
      <div className="contenu-onglet">
        {onglet === "synthese" && (
          <OngletSynthese session={session} plage={plage} {...proprietesOnglet} {...proprietesPeriode} />
        )}
        {onglet === "topProduits" && (
          <OngletTopProduits session={session} plage={plage} {...proprietesOnglet} {...proprietesPeriode} />
        )}
        {onglet === "topClients" && (
          <OngletTopClients session={session} plage={plage} {...proprietesOnglet} {...proprietesPeriode} />
        )}
        {onglet === "valeurStock" && <OngletValeurStock session={session} {...proprietesOnglet} />}
        {onglet === "vendeurs" && (
          <OngletVentesParVendeur session={session} plage={plage} {...proprietesOnglet} {...proprietesPeriode} />
        )}
        {onglet === "categories" && (
          <OngletVentesParCategorie session={session} plage={plage} {...proprietesOnglet} {...proprietesPeriode} />
        )}
        {onglet === "modePaiement" && (
          <OngletVentesParModePaiement session={session} plage={plage} {...proprietesOnglet} {...proprietesPeriode} />
        )}
      </div>
    </div>
  );
}
