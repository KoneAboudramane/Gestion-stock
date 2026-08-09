import { useEffect, useState } from "react";

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
 * voir services/rapports.ts) : mêmes onglets, mêmes agrégations recalculées
 * depuis les données locales pour rester consultables hors-ligne — y compris
 * "Ventes par vendeur", qui retombe comme sur le desktop sur un libellé
 * "Vous"/identifiant tronqué faute d'accès local à la table des utilisateurs
 * (comptes.Utilisateur reste hors synchronisation, voir CLAUDE.md).
 */

function libelleVendeur(utilisateurId: string | null, session: Session): string {
  if (!utilisateurId) return "";
  if (utilisateurId === session.utilisateurId) return "Vous";
  return `Utilisateur ${utilisateurId.slice(0, 8)}`;
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

function OngletSynthese({ session, plage }: { session: Session; plage: PlageDates | null }) {
  const [synthese, setSynthese] = useState<SyntheseVentes | null>(null);

  useEffect(() => {
    if (!plage) return;
    syntheseVentesLocale(session.boutiqueId, plage.debut, plage.fin).then(setSynthese);
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

function OngletTopProduits({ session, plage }: { session: Session; plage: PlageDates | null }) {
  const [ordre, setOrdre] = useState<"asc" | "desc">("desc");
  const [lignes, setLignes] = useState<LigneTopProduit[]>([]);

  useEffect(() => {
    if (!plage) return;
    topProduitsLocal(session.boutiqueId, plage.debut, plage.fin, 10, ordre).then(setLignes);
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
  );
}

// --- Onglet Top clients ---

function OngletTopClients({ session, plage }: { session: Session; plage: PlageDates | null }) {
  const [lignes, setLignes] = useState<LigneTopClient[]>([]);

  useEffect(() => {
    if (!plage) return;
    topClientsLocal(session.boutiqueId, plage.debut, plage.fin, 100).then(setLignes);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plage]);

  return (
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
  );
}

// --- Onglet Valeur du stock ---

function OngletValeurStock({ session }: { session: Session }) {
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

function OngletVentesParVendeur({ session, plage }: { session: Session; plage: PlageDates | null }) {
  const [lignes, setLignes] = useState<LigneVentesVendeur[]>([]);

  useEffect(() => {
    if (!plage) return;
    ventesParVendeurLocal(session.boutiqueId, plage.debut, plage.fin).then(setLignes);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plage]);

  return (
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
  );
}

// --- Onglet Ventes par catégorie ---

function OngletVentesParCategorie({ session, plage }: { session: Session; plage: PlageDates | null }) {
  const [lignes, setLignes] = useState<LigneVentesCategorie[]>([]);

  useEffect(() => {
    if (!plage) return;
    ventesParCategorieLocal(session.boutiqueId, plage.debut, plage.fin).then(setLignes);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plage]);

  return (
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
  );
}

// --- Onglet Ventes par mode de paiement ---

function OngletVentesParModePaiement({ session, plage }: { session: Session; plage: PlageDates | null }) {
  const [lignes, setLignes] = useState<LigneVentesModePaiement[]>([]);

  useEffect(() => {
    if (!plage) return;
    ventesParModePaiementLocal(session.boutiqueId, plage.debut, plage.fin).then(setLignes);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plage]);

  return (
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
  );
}

// --- Page principale ---

const ONGLETS = [
  { cle: "synthese", label: "Synthèse" },
  { cle: "topProduits", label: "Top articles" },
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
    setPlage(calculerPlageDates(periode, dateDebutPerso, dateFinPerso));
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
