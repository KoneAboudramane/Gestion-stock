import { useEffect, useState } from "react";

import { api } from "../api";
import type {
  DepotResume,
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
} from "../api";
import { libelleModePaiement } from "../lib/libelles";

/**
 * Adapté de client-electron/src/pages/Rapports.tsx : mêmes onglets (y compris Top
 * clients, désormais possible côté web grâce à la route Django ajoutée pour ce
 * portail), mais sans les boutons d'export (v1, voir le plan) et avec le vrai nom
 * d'utilisateur pour "Ventes par vendeur" (Django le fournit, Electron devait s'en
 * passer faute d'accès local à la table des utilisateurs).
 */

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

function OngletSynthese({ plage }: { plage: PlageDates | null }) {
  const [synthese, setSynthese] = useState<SyntheseVentes | null>(null);

  useEffect(() => {
    if (!plage) return;
    api.rapports.syntheseVentes(plage.debut, plage.fin).then((r) => r.succes && setSynthese(r.resultat));
  }, [plage]);

  if (!synthese) return <p>Chargement…</p>;

  const colonnes: { cle: keyof SyntheseVentes; libelle: string }[] = [
    { cle: "totalBrut", libelle: "Total brut" },
    { cle: "totalRemises", libelle: "Remises" },
    { cle: "totalNet", libelle: "Total net" },
    { cle: "nombreVentes", libelle: "Nombre de ventes" },
    { cle: "panierMoyen", libelle: "Panier moyen" },
    { cle: "beneficeTotal", libelle: "Bénéfice" },
  ];

  return (
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
  );
}

// --- Onglet Top produits ---

function OngletTopProduits({ plage }: { plage: PlageDates | null }) {
  const [ordre, setOrdre] = useState<"asc" | "desc">("desc");
  const [lignes, setLignes] = useState<LigneTopProduit[]>([]);

  useEffect(() => {
    if (!plage) return;
    api.rapports.topProduits(plage.debut, plage.fin, 10, ordre).then((r) => r.succes && setLignes(r.resultat));
  }, [plage, ordre]);

  return (
    <div>
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
              <th>Produit</th>
              <th>Référence</th>
              <th>Quantité vendue</th>
              <th>CA généré</th>
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

function OngletTopClients({ plage }: { plage: PlageDates | null }) {
  const [lignes, setLignes] = useState<LigneTopClient[]>([]);

  useEffect(() => {
    if (!plage) return;
    api.rapports.topClients(plage.debut, plage.fin, 100).then((r) => r.succes && setLignes(r.resultat));
  }, [plage]);

  return (
    <div className="zone-tableau-scroll">
      <table className="tableau-catalogue">
        <thead>
          <tr>
            <th>Client</th>
            <th>Nombre de ventes</th>
            <th>CA généré</th>
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
  );
}

// --- Onglet Valeur du stock ---

function OngletValeurStock() {
  const [depots, setDepots] = useState<DepotResume[]>([]);
  const [depotId, setDepotId] = useState("");
  const [valeur, setValeur] = useState<ValeurStock | null>(null);

  useEffect(() => {
    api.depots.lister().then((r) => r.succes && setDepots(r.resultat));
  }, []);

  useEffect(() => {
    api.rapports.valeurStock(depotId || undefined).then((r) => r.succes && setValeur(r.resultat));
  }, [depotId]);

  if (!valeur) return <p>Chargement…</p>;

  const colonnes: { cle: keyof ValeurStock; libelle: string }[] = [
    { cle: "valeurAchat", libelle: "Valeur au coût" },
    { cle: "valeurVentePotentielle", libelle: "Valeur au prix de vente" },
    { cle: "nombreVariantes", libelle: "Nombre de lignes de stock" },
    { cle: "nombreRuptures", libelle: "Variantes en rupture" },
  ];

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
      </div>
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
    </div>
  );
}

// --- Onglet Ventes par vendeur ---

function OngletVentesParVendeur({ plage }: { plage: PlageDates | null }) {
  const [lignes, setLignes] = useState<LigneVentesVendeur[]>([]);

  useEffect(() => {
    if (!plage) return;
    api.rapports.ventesParVendeur(plage.debut, plage.fin).then((r) => r.succes && setLignes(r.resultat));
  }, [plage]);

  return (
    <div className="zone-tableau-scroll">
      <table className="tableau-catalogue">
        <thead>
          <tr>
            <th>Vendeur</th>
            <th>Nombre de ventes</th>
            <th>Total net</th>
          </tr>
        </thead>
        <tbody>
          {lignes.map((l, i) => (
            <tr key={i}>
              <td>{l.utilisateur || ""}</td>
              <td>{l.nombreVentes}</td>
              <td>{l.totalNet}</td>
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
  );
}

// --- Onglet Ventes par catégorie ---

function OngletVentesParCategorie({ plage }: { plage: PlageDates | null }) {
  const [lignes, setLignes] = useState<LigneVentesCategorie[]>([]);

  useEffect(() => {
    if (!plage) return;
    api.rapports.ventesParCategorie(plage.debut, plage.fin).then((r) => r.succes && setLignes(r.resultat));
  }, [plage]);

  return (
    <div className="zone-tableau-scroll">
      <table className="tableau-catalogue">
        <thead>
          <tr>
            <th>Catégorie</th>
            <th>Quantité vendue</th>
            <th>CA généré</th>
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
  );
}

// --- Onglet Ventes par mode de paiement ---

function OngletVentesParModePaiement({ plage }: { plage: PlageDates | null }) {
  const [lignes, setLignes] = useState<LigneVentesModePaiement[]>([]);

  useEffect(() => {
    if (!plage) return;
    api.rapports.ventesParModePaiement(plage.debut, plage.fin).then((r) => r.succes && setLignes(r.resultat));
  }, [plage]);

  return (
    <div className="zone-tableau-scroll">
      <table className="tableau-catalogue">
        <thead>
          <tr>
            <th>Mode de paiement</th>
            <th>Total</th>
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

type OngletRapports = (typeof ONGLETS)[number]["cle"];

export default function Rapports({ session }: { session: Session }) {
  const peutVoir = !!session.permissions.voir_rapports_complets;
  const [onglet, setOnglet] = useState<OngletRapports>("synthese");
  const [periode, setPeriode] = useState<Periode>("jour");
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
        {onglet === "synthese" && <OngletSynthese plage={plage} />}
        {onglet === "topProduits" && <OngletTopProduits plage={plage} />}
        {onglet === "topClients" && <OngletTopClients plage={plage} />}
        {onglet === "valeurStock" && <OngletValeurStock />}
        {onglet === "vendeurs" && <OngletVentesParVendeur plage={plage} />}
        {onglet === "categories" && <OngletVentesParCategorie plage={plage} />}
        {onglet === "modePaiement" && <OngletVentesParModePaiement plage={plage} />}
      </div>
    </div>
  );
}
