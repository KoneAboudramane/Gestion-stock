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

// --- Onglet Synthèse ---

const COLONNES_SYNTHESE: ColonneExport[] = [
  { cle: "totalBrut", libelle: "Total brut" },
  { cle: "totalRemises", libelle: "Remises" },
  { cle: "totalNet", libelle: "Total net" },
  { cle: "nombreVentes", libelle: "Nombre de ventes" },
  { cle: "panierMoyen", libelle: "Panier moyen" },
  { cle: "beneficeTotal", libelle: "Bénéfice" },
];

function OngletSynthese({ session, plage }: { session: Session; plage: PlageDates | null }) {
  const [synthese, setSynthese] = useState<SyntheseVentes | null>(null);

  useEffect(() => {
    if (!plage) return;
    api.rapports.syntheseVentes(session.boutiqueId, plage.debut, plage.fin).then(setSynthese);
  }, [session.boutiqueId, plage]);

  if (!synthese) return <p>Chargement…</p>;

  return (
    <div>
      <div className="barre-actions">
        <BoutonsExport
          titre="Synthese des ventes"
          colonnes={COLONNES_SYNTHESE}
          lignes={[synthese as unknown as Record<string, unknown>]}
        />
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
              <td key={c.cle}>{(synthese as unknown as Record<string, unknown>)[c.cle] as number}</td>
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
  { cle: "produit", libelle: "Produit" },
  { cle: "reference", libelle: "Référence" },
  { cle: "quantiteVendue", libelle: "Quantité vendue" },
  { cle: "caGenere", libelle: "CA généré" },
];

function OngletTopProduits({ session, plage }: { session: Session; plage: PlageDates | null }) {
  const [ordre, setOrdre] = useState<"asc" | "desc">("desc");
  const [lignes, setLignes] = useState<LigneTopProduit[]>([]);

  useEffect(() => {
    if (!plage) return;
    api.rapports.topProduits(session.boutiqueId, plage.debut, plage.fin, 10, ordre).then(setLignes);
  }, [session.boutiqueId, plage, ordre]);

  return (
    <div>
      <div className="barre-actions">
        <select value={ordre} onChange={(e) => setOrdre(e.target.value as "asc" | "desc")}>
          <option value="desc">Les plus vendus</option>
          <option value="asc">Les moins vendus</option>
        </select>
        <BoutonsExport titre="Top produits" colonnes={COLONNES_TOP_PRODUITS} lignes={lignes as unknown as Record<string, unknown>[]} />
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
  );
}

// --- Onglet Top clients ---

const COLONNES_TOP_CLIENTS: ColonneExport[] = [
  { cle: "clientNom", libelle: "Client" },
  { cle: "nombreVentes", libelle: "Nombre de ventes" },
  { cle: "totalNet", libelle: "CA généré" },
];

function OngletTopClients({ session, plage }: { session: Session; plage: PlageDates | null }) {
  const [lignes, setLignes] = useState<LigneTopClient[]>([]);

  useEffect(() => {
    if (!plage) return;
    api.rapports.topClients(session.boutiqueId, plage.debut, plage.fin, 100).then(setLignes);
  }, [session.boutiqueId, plage]);

  return (
    <div>
      <div className="barre-actions">
        <BoutonsExport
          titre="Top clients"
          colonnes={COLONNES_TOP_CLIENTS}
          lignes={lignes as unknown as Record<string, unknown>[]}
        />
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
              <td>{l.totalNet}</td>
            </tr>
          ))}
          {lignes.length === 0 && (
            <tr>
              <td colSpan={3} className="liste-vide">
                Aucune vente à un client identifié sur la période.
              </td>
            </tr>
          )}
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

function OngletValeurStock({ session }: { session: Session }) {
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
      <div className="barre-actions">
        <select value={depotId} onChange={(e) => setDepotId(e.target.value)}>
          <option value="">Tous les dépôts</option>
          {depots.map((d) => (
            <option key={d.id} value={d.id}>
              {d.nom}
            </option>
          ))}
        </select>
        <BoutonsExport
          titre="Valeur du stock"
          colonnes={COLONNES_VALEUR_STOCK}
          lignes={[valeur as unknown as Record<string, unknown>]}
        />
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
              <td key={c.cle}>{(valeur as unknown as Record<string, unknown>)[c.cle] as number}</td>
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

function OngletVentesParVendeur({ session, plage }: { session: Session; plage: PlageDates | null }) {
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
      <div className="barre-actions">
        <BoutonsExport titre="Ventes par vendeur" colonnes={COLONNES_VENDEUR} lignes={lignesExport} />
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
              <td>{l.totalNet}</td>
            </tr>
          ))}
          {lignesExport.length === 0 && (
            <tr>
              <td colSpan={3} className="liste-vide">
                Aucune vente sur la période.
              </td>
            </tr>
          )}
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

function OngletVentesParCategorie({ session, plage }: { session: Session; plage: PlageDates | null }) {
  const [lignes, setLignes] = useState<LigneVentesCategorie[]>([]);

  useEffect(() => {
    if (!plage) return;
    api.rapports.ventesParCategorie(session.boutiqueId, plage.debut, plage.fin).then(setLignes);
  }, [session.boutiqueId, plage]);

  return (
    <div>
      <div className="barre-actions">
        <BoutonsExport titre="Ventes par categorie" colonnes={COLONNES_CATEGORIE} lignes={lignes as unknown as Record<string, unknown>[]} />
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
              <td>{l.caGenere}</td>
            </tr>
          ))}
          {lignes.length === 0 && (
            <tr>
              <td colSpan={3} className="liste-vide">
                Aucune vente sur la période.
              </td>
            </tr>
          )}
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

function OngletVentesParModePaiement({ session, plage }: { session: Session; plage: PlageDates | null }) {
  const [lignes, setLignes] = useState<LigneVentesModePaiement[]>([]);

  useEffect(() => {
    if (!plage) return;
    api.rapports.ventesParModePaiement(session.boutiqueId, plage.debut, plage.fin).then(setLignes);
  }, [session.boutiqueId, plage]);

  return (
    <div>
      <div className="barre-actions">
        <BoutonsExport
          titre="Ventes par mode de paiement"
          colonnes={COLONNES_MODE_PAIEMENT}
          lignes={lignes.map((l) => ({ mode: libelleModePaiement(l.mode), total: l.total }))}
        />
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
              <td>{l.total}</td>
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

const ONGLETS = [
  { cle: "synthese", label: "Synthèse" },
  { cle: "topProduits", label: "Top produits" },
  { cle: "topClients", label: "Top clients" },
  { cle: "valeurStock", label: "Valeur du stock" },
  { cle: "vendeurs", label: "Ventes par vendeur" },
  { cle: "categories", label: "Ventes par catégorie" },
  { cle: "modePaiement", label: "Ventes par mode de paiement" },
] as const;

export type OngletRapports = (typeof ONGLETS)[number]["cle"];

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
        <h2>Rapports</h2>
        <p className="note-aide">Vous n'avez pas accès aux rapports.</p>
      </div>
    );
  }

  return (
    <div className="page-produits">
      <div className="entete-page-onglets">
        <h2>Rapports</h2>
        <div className="barre-onglets">
          {ONGLETS.map((o) => (
            <button key={o.cle} className={`onglet ${onglet === o.cle ? "actif" : ""}`} onClick={() => setOnglet(o.cle)}>
              {o.label}
            </button>
          ))}
        </div>
      </div>
      {onglet !== "valeurStock" && (
        <SelecteurPeriode
          periode={periode}
          setPeriode={setPeriode}
          dateDebutPerso={dateDebutPerso}
          setDateDebutPerso={setDateDebutPerso}
          dateFinPerso={dateFinPerso}
          setDateFinPerso={setDateFinPerso}
        />
      )}
      <div className="contenu-onglet">
        {onglet === "synthese" && <OngletSynthese session={session} plage={plage} />}
        {onglet === "topProduits" && <OngletTopProduits session={session} plage={plage} />}
        {onglet === "topClients" && <OngletTopClients session={session} plage={plage} />}
        {onglet === "valeurStock" && <OngletValeurStock session={session} />}
        {onglet === "vendeurs" && <OngletVentesParVendeur session={session} plage={plage} />}
        {onglet === "categories" && <OngletVentesParCategorie session={session} plage={plage} />}
        {onglet === "modePaiement" && <OngletVentesParModePaiement session={session} plage={plage} />}
      </div>
    </div>
  );
}
