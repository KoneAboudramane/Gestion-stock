import { useEffect, useState } from "react";
import type { CSSProperties } from "react";

import { api } from "../api/client";
import type { CompteSyscohada, Session } from "../api/client";
import { formaterMontant } from "../lib/formatage";

/**
 * Port de client-web/src/pages/Comptabilite.tsx : deux sources au choix.
 * "Aperçu local" (electron/services/comptabilite.ts, miroir de
 * comptabilite/signals.py + rapports.py) fonctionne hors-ligne mais n'a
 * aucune valeur légale (pas de numérotation séquentielle fiable sur
 * plusieurs appareils) ; "Livre officiel" appelle l'API Django en direct
 * (source de vérité, numérotée) et nécessite une connexion.
 *
 * Chaque document s'ouvre dans sa propre modale (demande explicite de
 * l'utilisateur, plutôt que des onglets), avec ses propres filtres source +
 * période à l'intérieur — chaque document reste indépendant des autres.
 */

type Source = "local" | "officiel";

function dateAujourdhui(): string {
  return new Date().toISOString().slice(0, 10);
}

function debutAnnee(): string {
  return `${new Date().getFullYear()}-01-01`;
}

// --- Sélecteur de source + période, à l'intérieur de chaque modale ---

function BarreControles({
  source, setSource, dateDebut, setDateDebut, dateFin, setDateFin, masquerDateDebut,
}: {
  source: Source;
  setSource: (s: Source) => void;
  dateDebut?: string;
  setDateDebut?: (v: string) => void;
  dateFin: string;
  setDateFin: (v: string) => void;
  masquerDateDebut?: boolean;
}) {
  return (
    <div className="barre-actions">
      <select value={source} onChange={(e) => setSource(e.target.value as Source)}>
        <option value="local">Aperçu local (non officiel)</option>
        <option value="officiel">Livre officiel (en ligne)</option>
      </select>
      {!masquerDateDebut && dateDebut !== undefined && setDateDebut && (
        <input type="date" value={dateDebut} onChange={(e) => setDateDebut(e.target.value)} />
      )}
      <input type="date" value={dateFin} onChange={(e) => setDateFin(e.target.value)} />
    </div>
  );
}

function NoteSourceLocale({ source }: { source: Source }) {
  if (source !== "local") return null;
  return (
    <p className="note-aide">
      Aperçu non officiel, recalculé depuis les données de cet appareil, sans numérotation légale. Passez sur
      « Livre officiel » (connexion requise) pour le document réel, numéroté.
    </p>
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

// --- Modale Journal ---

interface LigneJournalAffichage {
  date: string;
  journal: string;
  libelleEcriture: string;
  compte: string;
  libelleCompte: string;
  debit: number;
  credit: number;
}

function ModaleJournal({
  session, boutiqueId, onFermer,
}: { session: Session; boutiqueId: string; onFermer: () => void }) {
  const [source, setSource] = useState<Source>("local");
  const [dateDebut, setDateDebut] = useState(debutAnnee());
  const [dateFin, setDateFin] = useState(dateAujourdhui());
  const [lignes, setLignes] = useState<LigneJournalAffichage[]>([]);
  const [erreur, setErreur] = useState("");

  useEffect(() => {
    if (source === "local") {
      api.comptabilite.journal(boutiqueId, dateDebut, dateFin).then((r) => { setLignes(r); setErreur(""); });
      return;
    }
    api.comptabilite.journalOfficiel(session, dateDebut, dateFin).then((r) => {
      if (r.succes) { setLignes(r.resultat); setErreur(""); } else { setLignes([]); setErreur(r.message); }
    });
  }, [source, boutiqueId, dateDebut, dateFin, session]);

  return (
    <div className="fond-modale" onClick={onFermer}>
      <div className="modale-selection-produits" onClick={(e) => e.stopPropagation()}>
        <EnteteModale titre="Journal" onFermer={onFermer} />
        <div className="modale-corps">
          <BarreControles
            source={source} setSource={setSource}
            dateDebut={dateDebut} setDateDebut={setDateDebut}
            dateFin={dateFin} setDateFin={setDateFin}
          />
          <NoteSourceLocale source={source} />
          {erreur ? (
            <p className="message-erreur">{erreur}</p>
          ) : (
            <div className="zone-tableau-scroll">
              <table className="tableau-catalogue">
                <thead>
                  <tr><th>Date</th><th>Journal</th><th>Écriture</th><th>Compte</th><th>Libellé</th><th>Débit</th><th>Crédit</th></tr>
                </thead>
                <tbody>
                  {lignes.map((l, i) => (
                    <tr key={i}>
                      <td>{l.date}</td><td>{l.journal}</td><td>{l.libelleEcriture}</td>
                      <td>{l.compte}</td><td>{l.libelleCompte}</td>
                      <td>{l.debit ? formaterMontant(l.debit) : ""}</td><td>{l.credit ? formaterMontant(l.credit) : ""}</td>
                    </tr>
                  ))}
                  {lignes.length === 0 && (
                    <tr><td colSpan={7} className="liste-vide">Aucune écriture sur la période.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// --- Modale Grand livre ---

function ModaleGrandLivre({
  session, boutiqueId, onFermer,
}: { session: Session; boutiqueId: string; onFermer: () => void }) {
  const [source, setSource] = useState<Source>("local");
  const [dateDebut, setDateDebut] = useState(debutAnnee());
  const [dateFin, setDateFin] = useState(dateAujourdhui());
  const [comptes, setComptes] = useState<CompteSyscohada[]>([]);
  const [compte, setCompte] = useState("571");
  const [libelleCompte, setLibelleCompte] = useState("");
  const [lignes, setLignes] = useState<{ date: string; journal: string; libelle: string; debit: number; credit: number; soldeCumule: number }[]>([]);
  const [soldeFinal, setSoldeFinal] = useState(0);
  const [erreur, setErreur] = useState("");

  useEffect(() => {
    api.comptabilite.planComptable().then(setComptes);
  }, []);

  useEffect(() => {
    if (source === "local") {
      api.comptabilite.grandLivre(boutiqueId, compte, dateDebut, dateFin).then((r) => {
        setLibelleCompte(r.libelle); setLignes(r.lignes); setSoldeFinal(r.soldeFinal); setErreur("");
      });
      return;
    }
    api.comptabilite.grandLivreOfficiel(session, compte, dateDebut, dateFin).then((r) => {
      if (r.succes) {
        setLibelleCompte(r.resultat.libelle); setLignes(r.resultat.lignes); setSoldeFinal(r.resultat.soldeFinal); setErreur("");
      } else {
        setLignes([]); setErreur(r.message);
      }
    });
  }, [source, boutiqueId, compte, dateDebut, dateFin, session]);

  return (
    <div className="fond-modale" onClick={onFermer}>
      <div className="modale-selection-produits" onClick={(e) => e.stopPropagation()}>
        <EnteteModale titre="Grand livre" onFermer={onFermer} />
        <div className="modale-corps">
          <BarreControles
            source={source} setSource={setSource}
            dateDebut={dateDebut} setDateDebut={setDateDebut}
            dateFin={dateFin} setDateFin={setDateFin}
          />
          <NoteSourceLocale source={source} />
          <div className="barre-actions">
            <select value={compte} onChange={(e) => setCompte(e.target.value)}>
              {comptes.map((c) => (
                <option key={c.numero} value={c.numero}>{c.numero} · {c.libelle}</option>
              ))}
            </select>
            <span>{libelleCompte}</span>
          </div>
          {erreur ? (
            <p className="message-erreur">{erreur}</p>
          ) : (
            <div className="zone-tableau-scroll">
              <table className="tableau-catalogue">
                <thead>
                  <tr><th>Date</th><th>Journal</th><th>Libellé</th><th>Débit</th><th>Crédit</th><th>Solde cumulé</th></tr>
                </thead>
                <tbody>
                  {lignes.map((l, i) => (
                    <tr key={i}>
                      <td>{l.date}</td><td>{l.journal}</td><td>{l.libelle}</td>
                      <td>{l.debit ? formaterMontant(l.debit) : ""}</td><td>{l.credit ? formaterMontant(l.credit) : ""}</td>
                      <td>{formaterMontant(l.soldeCumule)}</td>
                    </tr>
                  ))}
                  {lignes.length === 0 && (
                    <tr><td colSpan={6} className="liste-vide">Aucun mouvement sur ce compte.</td></tr>
                  )}
                </tbody>
                {lignes.length > 0 && (
                  <tfoot>
                    <tr><td colSpan={5}>Solde final</td><td>{formaterMontant(soldeFinal)}</td></tr>
                  </tfoot>
                )}
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// --- Modale Balance générale ---

function ModaleBalance({
  session, boutiqueId, onFermer,
}: { session: Session; boutiqueId: string; onFermer: () => void }) {
  const [source, setSource] = useState<Source>("local");
  const [dateDebut, setDateDebut] = useState(debutAnnee());
  const [dateFin, setDateFin] = useState(dateAujourdhui());
  const [lignes, setLignes] = useState<{ compte: string; libelle: string; totalDebit: number; totalCredit: number; soldeDebiteur: number; soldeCrediteur: number }[]>([]);
  const [totaux, setTotaux] = useState({ totalDebit: 0, totalCredit: 0 });
  const [erreur, setErreur] = useState("");

  useEffect(() => {
    if (source === "local") {
      api.comptabilite.balance(boutiqueId, dateDebut, dateFin).then((r) => {
        setLignes(r.lignes); setTotaux({ totalDebit: r.totalDebit, totalCredit: r.totalCredit }); setErreur("");
      });
      return;
    }
    api.comptabilite.balanceOfficielle(session, dateDebut, dateFin).then((r) => {
      if (r.succes) {
        setLignes(r.resultat.lignes);
        setTotaux({ totalDebit: r.resultat.totalDebit, totalCredit: r.resultat.totalCredit });
        setErreur("");
      } else {
        setLignes([]); setErreur(r.message);
      }
    });
  }, [source, boutiqueId, dateDebut, dateFin, session]);

  return (
    <div className="fond-modale" onClick={onFermer}>
      <div className="modale-selection-produits" onClick={(e) => e.stopPropagation()}>
        <EnteteModale titre="Balance générale" onFermer={onFermer} />
        <div className="modale-corps">
          <BarreControles
            source={source} setSource={setSource}
            dateDebut={dateDebut} setDateDebut={setDateDebut}
            dateFin={dateFin} setDateFin={setDateFin}
          />
          <NoteSourceLocale source={source} />
          {erreur ? (
            <p className="message-erreur">{erreur}</p>
          ) : (
            <div className="zone-tableau-scroll">
              <table className="tableau-catalogue">
                <thead>
                  <tr><th>Compte</th><th>Libellé</th><th>Total débit</th><th>Total crédit</th><th>Solde débiteur</th><th>Solde créditeur</th></tr>
                </thead>
                <tbody>
                  {lignes.map((l) => (
                    <tr key={l.compte}>
                      <td>{l.compte}</td><td>{l.libelle}</td>
                      <td>{formaterMontant(l.totalDebit)}</td><td>{formaterMontant(l.totalCredit)}</td>
                      <td>{formaterMontant(l.soldeDebiteur)}</td><td>{formaterMontant(l.soldeCrediteur)}</td>
                    </tr>
                  ))}
                  {lignes.length === 0 && (
                    <tr><td colSpan={6} className="liste-vide">Aucun mouvement sur la période.</td></tr>
                  )}
                </tbody>
                {lignes.length > 0 && (
                  <tfoot>
                    <tr><td colSpan={2}>Total</td><td>{formaterMontant(totaux.totalDebit)}</td><td>{formaterMontant(totaux.totalCredit)}</td><td /><td /></tr>
                  </tfoot>
                )}
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// --- Modale Compte de résultat ---

function ModaleCompteDeResultat({
  session, boutiqueId, onFermer,
}: { session: Session; boutiqueId: string; onFermer: () => void }) {
  const [source, setSource] = useState<Source>("local");
  const [dateDebut, setDateDebut] = useState(debutAnnee());
  const [dateFin, setDateFin] = useState(dateAujourdhui());
  const [charges, setCharges] = useState<{ compte: string; libelle: string; montant: number }[]>([]);
  const [produits, setProduits] = useState<{ compte: string; libelle: string; montant: number }[]>([]);
  const [totaux, setTotaux] = useState({ totalCharges: 0, totalProduits: 0, resultatNet: 0 });
  const [erreur, setErreur] = useState("");

  useEffect(() => {
    if (source === "local") {
      api.comptabilite.compteDeResultat(boutiqueId, dateDebut, dateFin).then((r) => {
        setCharges(r.charges); setProduits(r.produits);
        setTotaux({ totalCharges: r.totalCharges, totalProduits: r.totalProduits, resultatNet: r.resultatNet });
        setErreur("");
      });
      return;
    }
    api.comptabilite.compteDeResultatOfficiel(session, dateDebut, dateFin).then((r) => {
      if (r.succes) {
        setCharges(r.resultat.charges); setProduits(r.resultat.produits);
        setTotaux({ totalCharges: r.resultat.totalCharges, totalProduits: r.resultat.totalProduits, resultatNet: r.resultat.resultatNet });
        setErreur("");
      } else {
        setCharges([]); setProduits([]); setErreur(r.message);
      }
    });
  }, [source, boutiqueId, dateDebut, dateFin, session]);

  return (
    <div className="fond-modale" onClick={onFermer}>
      <div className="modale-selection-produits" onClick={(e) => e.stopPropagation()}>
        <EnteteModale titre="Compte de résultat" onFermer={onFermer} />
        <div className="modale-corps">
          <BarreControles
            source={source} setSource={setSource}
            dateDebut={dateDebut} setDateDebut={setDateDebut}
            dateFin={dateFin} setDateFin={setDateFin}
          />
          <NoteSourceLocale source={source} />
          {erreur ? (
            <p className="message-erreur">{erreur}</p>
          ) : (
            <div className="disposition-deux-colonnes">
              <div className="zone-tableau-scroll">
                <table className="tableau-catalogue">
                  <thead><tr><th colSpan={2}>Charges</th></tr></thead>
                  <tbody>
                    {charges.map((c) => (
                      <tr key={c.compte}><td>{c.compte} · {c.libelle}</td><td>{formaterMontant(c.montant)}</td></tr>
                    ))}
                    {charges.length === 0 && <tr><td colSpan={2} className="liste-vide">Aucune charge.</td></tr>}
                  </tbody>
                  <tfoot><tr><td>Total charges</td><td>{formaterMontant(totaux.totalCharges)}</td></tr></tfoot>
                </table>
              </div>
              <div className="zone-tableau-scroll">
                <table className="tableau-catalogue">
                  <thead><tr><th colSpan={2}>Produits</th></tr></thead>
                  <tbody>
                    {produits.map((p) => (
                      <tr key={p.compte}><td>{p.compte} · {p.libelle}</td><td>{formaterMontant(p.montant)}</td></tr>
                    ))}
                    {produits.length === 0 && <tr><td colSpan={2} className="liste-vide">Aucun produit.</td></tr>}
                  </tbody>
                  <tfoot><tr><td>Total produits</td><td>{formaterMontant(totaux.totalProduits)}</td></tr></tfoot>
                </table>
              </div>
              <p className="note-aide" style={{ gridColumn: "1 / -1" }}>
                Résultat net : <strong>{formaterMontant(totaux.resultatNet)} FCFA</strong>{" "}
                {totaux.resultatNet >= 0 ? "(bénéfice)" : "(perte)"}
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// --- Modale Bilan ---

function ModaleBilan({
  session, boutiqueId, onFermer,
}: { session: Session; boutiqueId: string; onFermer: () => void }) {
  const [source, setSource] = useState<Source>("local");
  const [dateFin, setDateFin] = useState(dateAujourdhui());
  const [actif, setActif] = useState<{ compte: string; libelle: string; montant: number }[]>([]);
  const [passif, setPassif] = useState<{ compte: string; libelle: string; montant: number }[]>([]);
  const [totaux, setTotaux] = useState({ totalActif: 0, totalPassif: 0 });
  const [erreur, setErreur] = useState("");

  useEffect(() => {
    if (source === "local") {
      api.comptabilite.bilan(boutiqueId, dateFin).then((r) => {
        setActif(r.actif); setPassif(r.passif);
        setTotaux({ totalActif: r.totalActif, totalPassif: r.totalPassif });
        setErreur("");
      });
      return;
    }
    api.comptabilite.bilanOfficiel(session, dateFin).then((r) => {
      if (r.succes) {
        setActif(r.resultat.actif); setPassif(r.resultat.passif);
        setTotaux({ totalActif: r.resultat.totalActif, totalPassif: r.resultat.totalPassif });
        setErreur("");
      } else {
        setActif([]); setPassif([]); setErreur(r.message);
      }
    });
  }, [source, boutiqueId, dateFin, session]);

  return (
    <div className="fond-modale" onClick={onFermer}>
      <div className="modale-selection-produits" onClick={(e) => e.stopPropagation()}>
        <EnteteModale titre="Bilan" onFermer={onFermer} />
        <div className="modale-corps">
          <BarreControles source={source} setSource={setSource} dateFin={dateFin} setDateFin={setDateFin} masquerDateDebut />
          <NoteSourceLocale source={source} />
          {erreur ? (
            <p className="message-erreur">{erreur}</p>
          ) : (
            <div className="disposition-deux-colonnes">
              <div className="zone-tableau-scroll">
                <table className="tableau-catalogue">
                  <thead><tr><th colSpan={2}>Actif</th></tr></thead>
                  <tbody>
                    {actif.map((c) => (
                      <tr key={c.compte}><td>{c.compte} · {c.libelle}</td><td>{formaterMontant(c.montant)}</td></tr>
                    ))}
                    {actif.length === 0 && <tr><td colSpan={2} className="liste-vide">Aucun solde actif.</td></tr>}
                  </tbody>
                  <tfoot><tr><td>Total actif</td><td>{formaterMontant(totaux.totalActif)}</td></tr></tfoot>
                </table>
              </div>
              <div className="zone-tableau-scroll">
                <table className="tableau-catalogue">
                  <thead><tr><th colSpan={2}>Passif</th></tr></thead>
                  <tbody>
                    {passif.map((c) => (
                      <tr key={c.compte}><td>{c.compte} · {c.libelle}</td><td>{formaterMontant(c.montant)}</td></tr>
                    ))}
                    {passif.length === 0 && <tr><td colSpan={2} className="liste-vide">Aucun solde passif.</td></tr>}
                  </tbody>
                  <tfoot><tr><td>Total passif</td><td>{formaterMontant(totaux.totalPassif)}</td></tr></tfoot>
                </table>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// --- Page principale ---

const DOCUMENTS = [
  { cle: "journal", label: "Journal", icone: "📖" },
  { cle: "grandLivre", label: "Grand livre", icone: "📚" },
  { cle: "balance", label: "Balance générale", icone: "⚖️" },
  { cle: "resultat", label: "Compte de résultat", icone: "📈" },
  { cle: "bilan", label: "Bilan", icone: "🧾" },
] as const;

type DocumentCompta = (typeof DOCUMENTS)[number]["cle"];

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

export default function Comptabilite({ session }: { session: Session }) {
  const peutVoir = !!session.permissions.consulter_comptabilite;
  const [documentOuvert, setDocumentOuvert] = useState<DocumentCompta | null>(null);

  if (!peutVoir) {
    return (
      <div className="page-produits">
        <p className="note-aide">Vous n'avez pas accès à la comptabilité.</p>
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
      {documentOuvert === "journal" && (
        <ModaleJournal session={session} boutiqueId={session.boutiqueId} onFermer={() => setDocumentOuvert(null)} />
      )}
      {documentOuvert === "grandLivre" && (
        <ModaleGrandLivre session={session} boutiqueId={session.boutiqueId} onFermer={() => setDocumentOuvert(null)} />
      )}
      {documentOuvert === "balance" && (
        <ModaleBalance session={session} boutiqueId={session.boutiqueId} onFermer={() => setDocumentOuvert(null)} />
      )}
      {documentOuvert === "resultat" && (
        <ModaleCompteDeResultat session={session} boutiqueId={session.boutiqueId} onFermer={() => setDocumentOuvert(null)} />
      )}
      {documentOuvert === "bilan" && (
        <ModaleBilan session={session} boutiqueId={session.boutiqueId} onFermer={() => setDocumentOuvert(null)} />
      )}
    </div>
  );
}
