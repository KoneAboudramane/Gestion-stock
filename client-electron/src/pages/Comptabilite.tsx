import { Fragment, useEffect, useMemo, useState } from "react";
import type { CSSProperties, ReactNode } from "react";

import { api } from "../api/client";
import type { ColonneExport, CompteSyscohada, MasseBilan, Session } from "../api/client";
import { formaterMontant } from "../lib/formatage";
import BoutonsExport from "../components/BoutonsExport";
import { useDevise } from "../contexts/DeviseContext";

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

type Resultat<T> = { ok: true; valeur: T } | { ok: false; message: string };

interface LigneJournalAffichage {
  date: string;
  journal: string;
  libelleEcriture: string;
  compte: string;
  libelleCompte: string;
  debit: number;
  credit: number;
}

interface LigneGrandLivre {
  date: string;
  journal: string;
  libelle: string;
  debit: number;
  credit: number;
  soldeCumule: number;
}

interface LigneBalance {
  compte: string;
  libelle: string;
  totalDebit: number;
  totalCredit: number;
  soldeDebiteur: number;
  soldeCrediteur: number;
}

interface LigneMontant {
  compte: string;
  libelle: string;
  montant: number;
}

/** Accès aux documents comptables : aperçu local ou livre officiel (voir useDonneesCompta). */
interface DonneesCompta {
  plan: { numero: string; libelle: string }[];
  journal(source: Source, debut: string, fin: string): Promise<Resultat<LigneJournalAffichage[]>>;
  grandLivre(
    source: Source,
    compte: string,
    debut: string,
    fin: string,
  ): Promise<Resultat<{ libelle: string; lignes: LigneGrandLivre[]; soldeFinal: number }>>;
  balance(source: Source, debut: string, fin: string): Promise<Resultat<{ lignes: LigneBalance[]; totalDebit: number; totalCredit: number }>>;
  resultat(
    source: Source,
    debut: string,
    fin: string,
  ): Promise<
    Resultat<{ charges: LigneMontant[]; produits: LigneMontant[]; totalCharges: number; totalProduits: number; resultatNet: number }>
  >;
  bilan(source: Source, fin: string): Promise<Resultat<{ actif: MasseBilan[]; passif: MasseBilan[]; totalActif: number; totalPassif: number }>>;
}

function succes<T>(valeur: T): Resultat<T> {
  return { ok: true, valeur };
}

function depuisApi<T>(r: { succes: true; resultat: T } | { succes: false; message: string }): Resultat<T> {
  return r.succes ? { ok: true, valeur: r.resultat } : { ok: false, message: r.message };
}

function jourLocalIso(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function dateAujourdhui(): string {
  return jourLocalIso(new Date());
}

function debutAnnee(): string {
  return `${new Date().getFullYear()}-01-01`;
}

/** « 2026-08-06 » → « 06/08/2026 » (les dates comptables restent des jours, sans heure). */
function dateFr(iso: string): string {
  const [a, m, j] = iso.slice(0, 10).split("-");
  return j && m && a ? `${j}/${m}/${a}` : iso;
}

/** Classes du plan SYSCOHADA (premier chiffre du compte). */
const CLASSES_SYSCOHADA: Record<string, string> = {
  "1": "Classe 1 · Ressources durables",
  "2": "Classe 2 · Actif immobilisé",
  "3": "Classe 3 · Stocks",
  "4": "Classe 4 · Tiers",
  "5": "Classe 5 · Trésorerie",
  "6": "Classe 6 · Charges",
  "7": "Classe 7 · Produits",
  "8": "Classe 8 · Autres charges et produits",
};

type PeriodeRapide = "annee" | "mois" | "mois_dernier" | "perso";

function bornesRapides(p: PeriodeRapide): [string, string] | null {
  const d = new Date();
  if (p === "mois") return [jourLocalIso(new Date(d.getFullYear(), d.getMonth(), 1)), dateAujourdhui()];
  if (p === "mois_dernier") {
    return [jourLocalIso(new Date(d.getFullYear(), d.getMonth() - 1, 1)), jourLocalIso(new Date(d.getFullYear(), d.getMonth(), 0))];
  }
  if (p === "annee") return [debutAnnee(), dateAujourdhui()];
  return null;
}

// --- Sélecteur de source + période, à l'intérieur de chaque modale ---

function BarreControles({
  source, setSource, dateDebut, setDateDebut, dateFin, setDateFin, masquerDateDebut, children,
}: {
  source: Source;
  setSource: (s: Source) => void;
  dateDebut?: string;
  setDateDebut?: (v: string) => void;
  dateFin: string;
  setDateFin: (v: string) => void;
  masquerDateDebut?: boolean;
  children?: ReactNode;
}) {
  const [rapide, setRapide] = useState<PeriodeRapide>("annee");
  function choisir(p: PeriodeRapide) {
    setRapide(p);
    const bornes = bornesRapides(p);
    if (!bornes) return;
    setDateDebut?.(bornes[0]);
    setDateFin(bornes[1]);
  }
  return (
    <div className="barre-actions barre-filtres-historique barre-compta">
      <select value={source} onChange={(e) => setSource(e.target.value as Source)}>
        <option value="local">Aperçu local</option>
        <option value="officiel">Livre officiel (en ligne)</option>
      </select>
      {source === "local" && (
        <span
          className="badge-apercu"
          title="Recalculé depuis les données de cet appareil, sans numérotation légale. Passez sur « Livre officiel » (connexion requise) pour le document réel, numéroté."
        >
          Non officiel ⓘ
        </span>
      )}
      {!masquerDateDebut && dateDebut !== undefined && setDateDebut && (
        <>
          <select value={rapide} onChange={(e) => choisir(e.target.value as PeriodeRapide)}>
            <option value="annee">Cette année</option>
            <option value="mois">Ce mois</option>
            <option value="mois_dernier">Mois dernier</option>
            <option value="perso">Personnalisée</option>
          </select>
          <input
            type="date"
            value={dateDebut}
            onChange={(e) => {
              setRapide("perso");
              setDateDebut(e.target.value);
            }}
          />
        </>
      )}
      <input
        type="date"
        value={dateFin}
        onChange={(e) => {
          setRapide("perso");
          setDateFin(e.target.value);
        }}
      />
      {children}
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

function BadgeEquilibre({ ecart, devise, libelle }: { ecart: number; devise: string; libelle: string }) {
  return Math.abs(ecart) < 0.5 ? (
    <span className="badge-payee">{libelle} équilibré ✓</span>
  ) : (
    <span className="badge-annulee">
      Écart de {formaterMontant(Math.abs(ecart))} {devise}
    </span>
  );
}

function montantOuVide(v: number) {
  return v ? formaterMontant(v) : "";
}

/** Electron : aperçu local via IPC, livre officiel via l'API Django. */
function useDonneesCompta(session: Session): DonneesCompta {
  const [plan, setPlan] = useState<CompteSyscohada[]>([]);
  useEffect(() => {
    api.comptabilite.planComptable().then(setPlan);
  }, []);
  const b = session.boutiqueId;
  return useMemo<DonneesCompta>(
    () => ({
      plan,
      journal: async (source, d, f) =>
        source === "local" ? succes(await api.comptabilite.journal(b, d, f)) : depuisApi(await api.comptabilite.journalOfficiel(session, d, f)),
      grandLivre: async (source, compte, d, f) =>
        source === "local"
          ? succes(await api.comptabilite.grandLivre(b, compte, d, f))
          : depuisApi(await api.comptabilite.grandLivreOfficiel(session, compte, d, f)),
      balance: async (source, d, f) =>
        source === "local" ? succes(await api.comptabilite.balance(b, d, f)) : depuisApi(await api.comptabilite.balanceOfficielle(session, d, f)),
      resultat: async (source, d, f) =>
        source === "local"
          ? succes(await api.comptabilite.compteDeResultat(b, d, f))
          : depuisApi(await api.comptabilite.compteDeResultatOfficiel(session, d, f)),
      bilan: async (source, f) =>
        source === "local" ? succes(await api.comptabilite.bilan(b, f)) : depuisApi(await api.comptabilite.bilanOfficiel(session, f)),
    }),
    [plan, b, session],
  );
}

// --- Modale Journal : écritures regroupées ---

function ModaleJournal({ donnees, onFermer }: { donnees: DonneesCompta; onFermer: () => void }) {
  const devise = useDevise();
  const [source, setSource] = useState<Source>("local");
  const [dateDebut, setDateDebut] = useState(debutAnnee());
  const [dateFin, setDateFin] = useState(dateAujourdhui());
  const [lignes, setLignes] = useState<LigneJournalAffichage[]>([]);
  const [erreur, setErreur] = useState("");
  const [journal, setJournal] = useState("");
  const [terme, setTerme] = useState("");

  useEffect(() => {
    donnees.journal(source, dateDebut, dateFin).then((r) => {
      if (r.ok) {
        setLignes(r.valeur);
        setErreur("");
      } else {
        setLignes([]);
        setErreur(r.message);
      }
    });
  }, [donnees, source, dateDebut, dateFin]);

  const journaux = [...new Set(lignes.map((l) => l.journal))].sort();
  const cle = terme.trim().toLowerCase();
  const filtrees = lignes.filter(
    (l) =>
      (!journal || l.journal === journal) &&
      (!cle || l.libelleEcriture.toLowerCase().includes(cle) || l.libelleCompte.toLowerCase().includes(cle) || l.compte.startsWith(cle)),
  );
  // Écritures = lignes consécutives de même date, journal et libellé.
  const ecritures = filtrees.reduce<{ cle: string; date: string; journal: string; libelle: string; lignes: LigneJournalAffichage[] }[]>(
    (acc, l) => {
      const derniere = acc[acc.length - 1];
      if (derniere && derniere.date === l.date && derniere.journal === l.journal && derniere.libelle === l.libelleEcriture) {
        derniere.lignes.push(l);
      } else {
        acc.push({ cle: `${acc.length}`, date: l.date, journal: l.journal, libelle: l.libelleEcriture, lignes: [l] });
      }
      return acc;
    },
    [],
  );
  const totalDebit = filtrees.reduce((t, l) => t + l.debit, 0);
  const totalCredit = filtrees.reduce((t, l) => t + l.credit, 0);
  const colonnesExport: ColonneExport[] = [
    { cle: "date", libelle: "Date" },
    { cle: "journal", libelle: "Journal" },
    { cle: "ecriture", libelle: "Écriture" },
    { cle: "compte", libelle: "Compte" },
    { cle: "libelle", libelle: "Libellé" },
    { cle: "debit", libelle: "Débit" },
    { cle: "credit", libelle: "Crédit" },
  ];
  const lignesExport = filtrees.map((l) => ({
    date: dateFr(l.date),
    journal: l.journal,
    ecriture: l.libelleEcriture,
    compte: l.compte,
    libelle: l.libelleCompte,
    debit: l.debit,
    credit: l.credit,
  }));

  return (
    <div className="fond-modale" onClick={onFermer}>
      <div className="modale-selection-produits" onClick={(e) => e.stopPropagation()}>
        <EnteteModale titre="Journal" onFermer={onFermer} />
        <div className="modale-corps">
          <BarreControles
            source={source} setSource={setSource}
            dateDebut={dateDebut} setDateDebut={setDateDebut}
            dateFin={dateFin} setDateFin={setDateFin}
          >
            <select value={journal} onChange={(e) => setJournal(e.target.value)}>
              <option value="">Tous les journaux</option>
              {journaux.map((j) => (
                <option key={j} value={j}>
                  {j}
                </option>
              ))}
            </select>
            <input type="search" placeholder="Libellé, compte…" value={terme} onChange={(e) => setTerme(e.target.value)} />
            <BoutonsExport titre="Journal" colonnes={colonnesExport} lignes={lignesExport} compact />
          </BarreControles>
          {erreur ? (
            <p className="message-erreur">{erreur}</p>
          ) : (
            <>
              <div className="tuiles-fiche">
                <div className="tuile-fiche">
                  <span className="sous-info">📖 Écritures</span>
                  <strong>{ecritures.length}</strong>
                </div>
                <div className="tuile-fiche">
                  <span className="sous-info">⬅️ Total débit</span>
                  <strong className="nowrap">
                    {formaterMontant(totalDebit)} {devise}
                  </strong>
                </div>
                <div className="tuile-fiche">
                  <span className="sous-info">➡️ Total crédit</span>
                  <strong className="nowrap">
                    {formaterMontant(totalCredit)} {devise}
                  </strong>
                </div>
                <div className="tuile-fiche">
                  <span className="sous-info">⚖️ Contrôle</span>
                  <strong>
                    <BadgeEquilibre ecart={totalDebit - totalCredit} devise={devise} libelle="Journal" />
                  </strong>
                </div>
              </div>
              <div className="zone-tableau-scroll zone-commandes-fiche">
                <table className="tableau-catalogue tableau-journal">
                  <thead>
                    <tr>
                      <th>Compte</th>
                      <th>Libellé</th>
                      <th>Débit</th>
                      <th>Crédit</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ecritures.map((e) => (
                      <Fragment key={e.cle}>
                        <tr className="ligne-ecriture">
                          <td colSpan={4}>
                            <span className="nowrap">{dateFr(e.date)}</span> <span className="badge-brouillon">{e.journal}</span>{" "}
                            <strong>{e.libelle}</strong>
                          </td>
                        </tr>
                        {e.lignes.map((l, i) => (
                          <tr key={i}>
                            <td className={l.credit ? "compte-credit" : undefined}>{l.compte}</td>
                            <td>{l.libelleCompte}</td>
                            <td className="nowrap">{montantOuVide(l.debit)}</td>
                            <td className="nowrap">{montantOuVide(l.credit)}</td>
                          </tr>
                        ))}
                      </Fragment>
                    ))}
                    {ecritures.length === 0 && (
                      <tr>
                        <td colSpan={4} className="liste-vide">
                          Aucune écriture sur la période.
                        </td>
                      </tr>
                    )}
                  </tbody>
                  {filtrees.length > 0 && (
                    <tfoot>
                      <tr>
                        <td colSpan={2}>Total</td>
                        <td className="nowrap">{formaterMontant(totalDebit)}</td>
                        <td className="nowrap">{formaterMontant(totalCredit)}</td>
                      </tr>
                    </tfoot>
                  )}
                </table>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// --- Modale Grand livre ---

function ModaleGrandLivre({
  donnees, compteInitial, onFermer,
}: { donnees: DonneesCompta; compteInitial?: string; onFermer: () => void }) {
  const devise = useDevise();
  const [source, setSource] = useState<Source>("local");
  const [dateDebut, setDateDebut] = useState(debutAnnee());
  const [dateFin, setDateFin] = useState(dateAujourdhui());
  const [compte, setCompte] = useState(compteInitial ?? "571");
  const [libelleCompte, setLibelleCompte] = useState("");
  const [lignes, setLignes] = useState<LigneGrandLivre[]>([]);
  const [soldeFinal, setSoldeFinal] = useState(0);
  const [erreur, setErreur] = useState("");
  const [mouvementes, setMouvementes] = useState<Set<string>>(new Set());
  const [tousLesComptes, setTousLesComptes] = useState(false);
  const [recherche, setRecherche] = useState("");

  useEffect(() => {
    donnees.grandLivre(source, compte, dateDebut, dateFin).then((r) => {
      if (r.ok) {
        setLibelleCompte(r.valeur.libelle);
        setLignes(r.valeur.lignes);
        setSoldeFinal(r.valeur.soldeFinal);
        setErreur("");
      } else {
        setLignes([]);
        setErreur(r.message);
      }
    });
  }, [donnees, source, compte, dateDebut, dateFin]);

  // Comptes ayant des mouvements sur la période (via la balance).
  useEffect(() => {
    donnees.balance(source, dateDebut, dateFin).then((r) => {
      if (r.ok) setMouvementes(new Set(r.valeur.lignes.map((l) => l.compte)));
    });
  }, [donnees, source, dateDebut, dateFin]);

  const cle = recherche.trim().toLowerCase();
  const comptesProposes = donnees.plan.filter(
    (c) =>
      (tousLesComptes || mouvementes.has(c.numero) || c.numero === compte) &&
      (!cle || c.numero.startsWith(cle) || c.libelle.toLowerCase().includes(cle)),
  );
  const totalDebit = lignes.reduce((t, l) => t + l.debit, 0);
  const totalCredit = lignes.reduce((t, l) => t + l.credit, 0);
  const colonnesExport: ColonneExport[] = [
    { cle: "date", libelle: "Date" },
    { cle: "journal", libelle: "Journal" },
    { cle: "libelle", libelle: "Libellé" },
    { cle: "debit", libelle: "Débit" },
    { cle: "credit", libelle: "Crédit" },
    { cle: "solde", libelle: "Solde cumulé" },
  ];
  const lignesExport = lignes.map((l) => ({
    date: dateFr(l.date),
    journal: l.journal,
    libelle: l.libelle,
    debit: l.debit,
    credit: l.credit,
    solde: l.soldeCumule,
  }));

  return (
    <div className="fond-modale" onClick={onFermer}>
      <div className="modale-selection-produits" onClick={(e) => e.stopPropagation()}>
        <EnteteModale titre="Grand livre" onFermer={onFermer} />
        <div className="modale-corps">
          <BarreControles
            source={source} setSource={setSource}
            dateDebut={dateDebut} setDateDebut={setDateDebut}
            dateFin={dateFin} setDateFin={setDateFin}
          >
            <BoutonsExport titre={`Grand livre ${compte}`} colonnes={colonnesExport} lignes={lignesExport} compact />
          </BarreControles>
          <div className="barre-actions barre-filtres-historique">
            <input type="search" placeholder="N° ou libellé de compte…" value={recherche} onChange={(e) => setRecherche(e.target.value)} />
            <select value={compte} onChange={(e) => setCompte(e.target.value)} className="select-compte">
              {comptesProposes.map((c) => (
                <option key={c.numero} value={c.numero}>
                  {c.numero} · {c.libelle}
                </option>
              ))}
            </select>
            <label className="case-a-cocher">
              <input type="checkbox" checked={tousLesComptes} onChange={(e) => setTousLesComptes(e.target.checked)} />
              Tous les comptes
            </label>
          </div>
          {erreur ? (
            <p className="message-erreur">{erreur}</p>
          ) : (
            <>
              <div className="tuiles-fiche">
                <div className="tuile-fiche">
                  <span className="sous-info">📚 Compte</span>
                  <strong>
                    {compte} · {libelleCompte}
                  </strong>
                </div>
                <div className="tuile-fiche">
                  <span className="sous-info">⬅️ Total débit</span>
                  <strong className="nowrap">
                    {formaterMontant(totalDebit)} {devise}
                  </strong>
                </div>
                <div className="tuile-fiche">
                  <span className="sous-info">➡️ Total crédit</span>
                  <strong className="nowrap">
                    {formaterMontant(totalCredit)} {devise}
                  </strong>
                </div>
                <div className="tuile-fiche">
                  <span className="sous-info">⚖️ Solde final</span>
                  <strong className="nowrap">
                    {formaterMontant(Math.abs(soldeFinal))} {devise}{" "}
                    <span className="sous-info">{soldeFinal > 0 ? "débiteur" : soldeFinal < 0 ? "créditeur" : "soldé"}</span>
                  </strong>
                </div>
              </div>
              <div className="zone-tableau-scroll zone-commandes-fiche">
                <table className="tableau-catalogue">
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Journal</th>
                      <th>Libellé</th>
                      <th>Débit</th>
                      <th>Crédit</th>
                      <th>Solde cumulé</th>
                    </tr>
                  </thead>
                  <tbody>
                    {lignes.map((l, i) => (
                      <tr key={i}>
                        <td className="nowrap">{dateFr(l.date)}</td>
                        <td>{l.journal}</td>
                        <td>{l.libelle}</td>
                        <td className="nowrap">{montantOuVide(l.debit)}</td>
                        <td className="nowrap">{montantOuVide(l.credit)}</td>
                        <td className="nowrap">{formaterMontant(l.soldeCumule)}</td>
                      </tr>
                    ))}
                    {lignes.length === 0 && (
                      <tr>
                        <td colSpan={6} className="liste-vide">
                          Aucun mouvement sur ce compte.
                        </td>
                      </tr>
                    )}
                    {Array.from({ length: Math.max(0, 10 - Math.max(1, lignes.length)) }).map((_, i) => (
                      <tr key={`vide-${i}`} className="ligne-groupe-vide">
                        <td>&nbsp;</td>
                        <td>&nbsp;</td>
                        <td>&nbsp;</td>
                        <td>&nbsp;</td>
                        <td>&nbsp;</td>
                        <td>&nbsp;</td>
                      </tr>
                    ))}
                  </tbody>
                  {lignes.length > 0 && (
                    <tfoot>
                      <tr>
                        <td colSpan={3}>Solde final</td>
                        <td className="nowrap">{formaterMontant(totalDebit)}</td>
                        <td className="nowrap">{formaterMontant(totalCredit)}</td>
                        <td className="nowrap">{formaterMontant(soldeFinal)}</td>
                      </tr>
                    </tfoot>
                  )}
                </table>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// --- Modale Balance générale : par classe, contrôle d'équilibre ---

function ModaleBalance({
  donnees, onOuvrirCompte, onFermer,
}: { donnees: DonneesCompta; onOuvrirCompte: (compte: string) => void; onFermer: () => void }) {
  const devise = useDevise();
  const [source, setSource] = useState<Source>("local");
  const [dateDebut, setDateDebut] = useState(debutAnnee());
  const [dateFin, setDateFin] = useState(dateAujourdhui());
  const [lignes, setLignes] = useState<LigneBalance[]>([]);
  const [totaux, setTotaux] = useState({ totalDebit: 0, totalCredit: 0 });
  const [erreur, setErreur] = useState("");

  useEffect(() => {
    donnees.balance(source, dateDebut, dateFin).then((r) => {
      if (r.ok) {
        setLignes(r.valeur.lignes);
        setTotaux({ totalDebit: r.valeur.totalDebit, totalCredit: r.valeur.totalCredit });
        setErreur("");
      } else {
        setLignes([]);
        setErreur(r.message);
      }
    });
  }, [donnees, source, dateDebut, dateFin]);

  const classes = [...new Set(lignes.map((l) => l.compte.charAt(0)))].sort();
  const somme = (liste: LigneBalance[], cle: keyof Omit<LigneBalance, "compte" | "libelle">) => liste.reduce((t, l) => t + l[cle], 0);
  const colonnesExport: ColonneExport[] = [
    { cle: "compte", libelle: "Compte" },
    { cle: "libelle", libelle: "Libellé" },
    { cle: "totalDebit", libelle: "Total débit" },
    { cle: "totalCredit", libelle: "Total crédit" },
    { cle: "soldeDebiteur", libelle: "Solde débiteur" },
    { cle: "soldeCrediteur", libelle: "Solde créditeur" },
  ];

  return (
    <div className="fond-modale" onClick={onFermer}>
      <div className="modale-selection-produits" onClick={(e) => e.stopPropagation()}>
        <EnteteModale titre="Balance générale" onFermer={onFermer} />
        <div className="modale-corps">
          <BarreControles
            source={source} setSource={setSource}
            dateDebut={dateDebut} setDateDebut={setDateDebut}
            dateFin={dateFin} setDateFin={setDateFin}
          >
            <BoutonsExport titre="Balance generale" colonnes={colonnesExport} lignes={lignes as unknown as Record<string, unknown>[]} compact />
          </BarreControles>
          {erreur ? (
            <p className="message-erreur">{erreur}</p>
          ) : (
            <>
              <div className="tuiles-fiche">
                <div className="tuile-fiche">
                  <span className="sous-info">📒 Comptes mouvementés</span>
                  <strong>{lignes.length}</strong>
                </div>
                <div className="tuile-fiche">
                  <span className="sous-info">⬅️ Total débit</span>
                  <strong className="nowrap">
                    {formaterMontant(totaux.totalDebit)} {devise}
                  </strong>
                </div>
                <div className="tuile-fiche">
                  <span className="sous-info">➡️ Total crédit</span>
                  <strong className="nowrap">
                    {formaterMontant(totaux.totalCredit)} {devise}
                  </strong>
                </div>
                <div className="tuile-fiche">
                  <span className="sous-info">⚖️ Contrôle</span>
                  <strong>
                    <BadgeEquilibre ecart={totaux.totalDebit - totaux.totalCredit} devise={devise} libelle="Balance" />
                  </strong>
                </div>
              </div>
              <div className="zone-tableau-scroll zone-commandes-fiche">
                <table className="tableau-catalogue">
                  <thead>
                    <tr>
                      <th>Compte</th>
                      <th>Libellé</th>
                      <th>Total débit</th>
                      <th>Total crédit</th>
                      <th>Solde débiteur</th>
                      <th>Solde créditeur</th>
                    </tr>
                  </thead>
                  <tbody>
                    {classes.map((classe) => {
                      const duGroupe = lignes.filter((l) => l.compte.charAt(0) === classe);
                      return (
                        <Fragment key={classe}>
                          <tr className="ligne-ecriture">
                            <td colSpan={6}>
                              <strong>{CLASSES_SYSCOHADA[classe] ?? `Classe ${classe}`}</strong>
                            </td>
                          </tr>
                          {duGroupe.map((l) => (
                            <tr key={l.compte} onClick={() => onOuvrirCompte(l.compte)} title="Voir le grand livre de ce compte">
                              <td>{l.compte}</td>
                              <td>{l.libelle}</td>
                              <td className="nowrap">{formaterMontant(l.totalDebit)}</td>
                              <td className="nowrap">{formaterMontant(l.totalCredit)}</td>
                              <td className="nowrap">{montantOuVide(l.soldeDebiteur)}</td>
                              <td className="nowrap">{montantOuVide(l.soldeCrediteur)}</td>
                            </tr>
                          ))}
                          <tr className="ligne-sous-total">
                            <td colSpan={2}>Sous-total classe {classe}</td>
                            <td className="nowrap">{formaterMontant(somme(duGroupe, "totalDebit"))}</td>
                            <td className="nowrap">{formaterMontant(somme(duGroupe, "totalCredit"))}</td>
                            <td className="nowrap">{montantOuVide(somme(duGroupe, "soldeDebiteur"))}</td>
                            <td className="nowrap">{montantOuVide(somme(duGroupe, "soldeCrediteur"))}</td>
                          </tr>
                        </Fragment>
                      );
                    })}
                    {lignes.length === 0 && (
                      <tr>
                        <td colSpan={6} className="liste-vide">
                          Aucun mouvement sur la période.
                        </td>
                      </tr>
                    )}
                  </tbody>
                  {lignes.length > 0 && (
                    <tfoot>
                      <tr>
                        <td colSpan={2}>Total</td>
                        <td className="nowrap">{formaterMontant(totaux.totalDebit)}</td>
                        <td className="nowrap">{formaterMontant(totaux.totalCredit)}</td>
                        <td className="nowrap">{formaterMontant(somme(lignes, "soldeDebiteur"))}</td>
                        <td className="nowrap">{formaterMontant(somme(lignes, "soldeCrediteur"))}</td>
                      </tr>
                    </tfoot>
                  )}
                </table>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// --- Modale Compte de résultat ---

function ModaleCompteDeResultat({ donnees, onFermer }: { donnees: DonneesCompta; onFermer: () => void }) {
  const devise = useDevise();
  const [source, setSource] = useState<Source>("local");
  const [dateDebut, setDateDebut] = useState(debutAnnee());
  const [dateFin, setDateFin] = useState(dateAujourdhui());
  const [charges, setCharges] = useState<LigneMontant[]>([]);
  const [produits, setProduits] = useState<LigneMontant[]>([]);
  const [totaux, setTotaux] = useState({ totalCharges: 0, totalProduits: 0, resultatNet: 0 });
  const [erreur, setErreur] = useState("");

  useEffect(() => {
    donnees.resultat(source, dateDebut, dateFin).then((r) => {
      if (r.ok) {
        setCharges(r.valeur.charges);
        setProduits(r.valeur.produits);
        setTotaux({ totalCharges: r.valeur.totalCharges, totalProduits: r.valeur.totalProduits, resultatNet: r.valeur.resultatNet });
        setErreur("");
      } else {
        setCharges([]);
        setProduits([]);
        setErreur(r.message);
      }
    });
  }, [donnees, source, dateDebut, dateFin]);

  const benefice = totaux.resultatNet >= 0;
  const colonnesExport: ColonneExport[] = [
    { cle: "nature", libelle: "Nature" },
    { cle: "compte", libelle: "Compte" },
    { cle: "libelle", libelle: "Libellé" },
    { cle: "montant", libelle: "Montant" },
  ];
  const lignesExport = [
    ...charges.map((c) => ({ nature: "Charge", ...c })),
    ...produits.map((p) => ({ nature: "Produit", ...p })),
    { nature: "Résultat net", compte: "", libelle: benefice ? "Bénéfice" : "Perte", montant: totaux.resultatNet },
  ];
  const tableau = (titre: string, liste: LigneMontant[], total: number, vide: string) => (
    <div className="zone-tableau-scroll">
      <table className="tableau-catalogue">
        <thead>
          <tr>
            <th>{titre}</th>
            <th>Montant</th>
            <th>Part</th>
          </tr>
        </thead>
        <tbody>
          {liste.map((l) => (
            <tr key={l.compte}>
              <td>
                {l.compte} · {l.libelle}
              </td>
              <td className="nowrap">{formaterMontant(l.montant)}</td>
              <td className="nowrap sous-info">{total > 0 ? Math.round((l.montant / total) * 100) : 0} %</td>
            </tr>
          ))}
          {liste.length === 0 && (
            <tr>
              <td colSpan={3} className="liste-vide">
                {vide}
              </td>
            </tr>
          )}
        </tbody>
        <tfoot>
          <tr>
            <td>Total {titre.toLowerCase()}</td>
            <td className="nowrap">{formaterMontant(total)}</td>
            <td />
          </tr>
        </tfoot>
      </table>
    </div>
  );

  return (
    <div className="fond-modale" onClick={onFermer}>
      <div className="modale-selection-produits" onClick={(e) => e.stopPropagation()}>
        <EnteteModale titre="Compte de résultat" onFermer={onFermer} />
        <div className="modale-corps">
          <BarreControles
            source={source} setSource={setSource}
            dateDebut={dateDebut} setDateDebut={setDateDebut}
            dateFin={dateFin} setDateFin={setDateFin}
          >
            <BoutonsExport titre="Compte de resultat" colonnes={colonnesExport} lignes={lignesExport} compact />
          </BarreControles>
          {erreur ? (
            <p className="message-erreur">{erreur}</p>
          ) : (
            <>
              <div className="tuiles-fiche">
                <div className="tuile-fiche">
                  <span className="sous-info">📥 Produits</span>
                  <strong className="nowrap">
                    {formaterMontant(totaux.totalProduits)} {devise}
                  </strong>
                </div>
                <div className="tuile-fiche">
                  <span className="sous-info">📤 Charges</span>
                  <strong className="nowrap">
                    {formaterMontant(totaux.totalCharges)} {devise}
                  </strong>
                </div>
                <div className={`tuile-fiche${benefice ? "" : " tuile-fiche--alerte"}`}>
                  <span className="sous-info">{benefice ? "📈 Bénéfice" : "📉 Perte"}</span>
                  <strong className={`nowrap ${benefice ? "montant-entree" : "texte-erreur"}`}>
                    {formaterMontant(totaux.resultatNet)} {devise}
                  </strong>
                </div>
                <div className="tuile-fiche">
                  <span className="sous-info">🧮 Marge nette</span>
                  <strong>
                    {totaux.totalProduits > 0 ? Math.round((totaux.resultatNet / totaux.totalProduits) * 100) : 0} %
                  </strong>
                </div>
              </div>
              <div className="disposition-deux-colonnes">
                {tableau("Charges", charges, totaux.totalCharges, "Aucune charge.")}
                {tableau("Produits", produits, totaux.totalProduits, "Aucun produit.")}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// --- Modale Bilan ---

type LigneAplatieBilan =
  | { type: "entete"; texte: string }
  | { type: "ligne" | "sousTotal"; libelle: string; montant: number };

/** Bilan Actif/Passif dans un même tableau : chaque masse est aplatie en
 * [en-tête, comptes…, sous-total], puis les deux côtés sont juxtaposés ligne à
 * ligne — simple mise en page en deux colonnes, pas une correspondance. */
function aplatirMasses(masses: MasseBilan[]): LigneAplatieBilan[] {
  const lignes: LigneAplatieBilan[] = [];
  for (const groupe of masses) {
    lignes.push({ type: "entete", texte: groupe.masse });
    for (const l of groupe.lignes) {
      lignes.push({ type: "ligne", libelle: `${l.compte} · ${l.libelle}`, montant: l.montant });
    }
    lignes.push({ type: "sousTotal", libelle: `Sous-total ${groupe.masse.toLowerCase()}`, montant: groupe.sousTotal });
  }
  return lignes;
}

function celluleCoteBilan(ligne: LigneAplatieBilan | undefined, cle: string) {
  if (!ligne) return [<td key={cle} colSpan={2} />];
  if (ligne.type === "entete") {
    return [<td key={cle} colSpan={2} className="ligne-masse-bilan">{ligne.texte}</td>];
  }
  const classe = ligne.type === "sousTotal" ? "cellule-sous-total-bilan" : undefined;
  return [
    <td key={`${cle}-libelle`} className={classe}>{ligne.libelle}</td>,
    <td key={`${cle}-montant`} className={`nowrap${classe ? ` ${classe}` : ""}`}>{formaterMontant(ligne.montant)}</td>,
  ];
}

function ModaleBilan({ donnees, onFermer }: { donnees: DonneesCompta; onFermer: () => void }) {
  const devise = useDevise();
  const [source, setSource] = useState<Source>("local");
  const [dateFin, setDateFin] = useState(dateAujourdhui());
  const [actif, setActif] = useState<MasseBilan[]>([]);
  const [passif, setPassif] = useState<MasseBilan[]>([]);
  const [totaux, setTotaux] = useState({ totalActif: 0, totalPassif: 0 });
  const [erreur, setErreur] = useState("");

  useEffect(() => {
    donnees.bilan(source, dateFin).then((r) => {
      if (r.ok) {
        setActif(r.valeur.actif);
        setPassif(r.valeur.passif);
        setTotaux({ totalActif: r.valeur.totalActif, totalPassif: r.valeur.totalPassif });
        setErreur("");
      } else {
        setActif([]);
        setPassif([]);
        setErreur(r.message);
      }
    });
  }, [donnees, source, dateFin]);

  const resultat = passif
    .flatMap((m) => m.lignes)
    .filter((l) => l.compte.startsWith("12") || l.compte.startsWith("13"))
    .reduce((t, l) => t + l.montant, 0);
  const lignesExport = [
    ...actif.flatMap((m) => m.lignes.map((l) => ({ cote: "Actif", masse: m.masse, compte: l.compte, libelle: l.libelle, montant: l.montant }))),
    ...passif.flatMap((m) => m.lignes.map((l) => ({ cote: "Passif", masse: m.masse, compte: l.compte, libelle: l.libelle, montant: l.montant }))),
  ];
  const colonnesExport: ColonneExport[] = [
    { cle: "cote", libelle: "Côté" },
    { cle: "masse", libelle: "Masse" },
    { cle: "compte", libelle: "Compte" },
    { cle: "libelle", libelle: "Libellé" },
    { cle: "montant", libelle: "Montant" },
  ];

  return (
    <div className="fond-modale" onClick={onFermer}>
      <div className="modale-selection-produits" onClick={(e) => e.stopPropagation()}>
        <EnteteModale titre="Bilan" onFermer={onFermer} />
        <div className="modale-corps">
          <BarreControles source={source} setSource={setSource} dateFin={dateFin} setDateFin={setDateFin} masquerDateDebut>
            <BoutonsExport titre="Bilan" colonnes={colonnesExport} lignes={lignesExport} compact />
          </BarreControles>
          {erreur ? (
            <p className="message-erreur">{erreur}</p>
          ) : (
            <>
              <div className="tuiles-fiche">
                <div className="tuile-fiche">
                  <span className="sous-info">🏦 Total actif</span>
                  <strong className="nowrap">
                    {formaterMontant(totaux.totalActif)} {devise}
                  </strong>
                </div>
                <div className="tuile-fiche">
                  <span className="sous-info">📑 Total passif</span>
                  <strong className="nowrap">
                    {formaterMontant(totaux.totalPassif)} {devise}
                  </strong>
                </div>
                <div className={`tuile-fiche${resultat < 0 ? " tuile-fiche--alerte" : ""}`}>
                  <span className="sous-info">{resultat >= 0 ? "📈 Résultat (bénéfice)" : "📉 Résultat (perte)"}</span>
                  <strong className={`nowrap ${resultat >= 0 ? "montant-entree" : "texte-erreur"}`}>
                    {formaterMontant(resultat)} {devise}
                  </strong>
                </div>
                <div className="tuile-fiche">
                  <span className="sous-info">⚖️ Contrôle</span>
                  <strong>
                    <BadgeEquilibre ecart={totaux.totalActif - totaux.totalPassif} devise={devise} libelle="Bilan" />
                  </strong>
                </div>
              </div>
              <div className="zone-tableau-scroll zone-commandes-fiche">
                <table className="tableau-catalogue tableau-bilan">
                  <thead>
                    <tr>
                      <th colSpan={2}>Actif</th>
                      <th colSpan={2}>Passif</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(() => {
                      const lignesActif = aplatirMasses(actif);
                      const lignesPassif = aplatirMasses(passif);
                      const nb = Math.max(lignesActif.length, lignesPassif.length);
                      if (nb === 0) {
                        return (
                          <tr>
                            <td colSpan={4} className="liste-vide">
                              Aucun solde.
                            </td>
                          </tr>
                        );
                      }
                      return Array.from({ length: nb }, (_, i) => (
                        <tr key={i}>
                          {celluleCoteBilan(lignesActif[i], `a${i}`)}
                          {celluleCoteBilan(lignesPassif[i], `p${i}`)}
                        </tr>
                      ));
                    })()}
                  </tbody>
                  <tfoot>
                    <tr>
                      <td>Total actif</td>
                      <td className="nowrap">{formaterMontant(totaux.totalActif)}</td>
                      <td>Total passif</td>
                      <td className="nowrap">{formaterMontant(totaux.totalPassif)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </>
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
  const [compteGrandLivre, setCompteGrandLivre] = useState<string | undefined>(undefined);
  const donnees = useDonneesCompta(session);

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
      {documentOuvert === "journal" && <ModaleJournal donnees={donnees} onFermer={() => setDocumentOuvert(null)} />}
      {documentOuvert === "grandLivre" && (
        <ModaleGrandLivre donnees={donnees} compteInitial={compteGrandLivre} onFermer={() => setDocumentOuvert(null)} />
      )}
      {documentOuvert === "balance" && (
        <ModaleBalance
          donnees={donnees}
          onOuvrirCompte={(compte) => {
            setCompteGrandLivre(compte);
            setDocumentOuvert("grandLivre");
          }}
          onFermer={() => setDocumentOuvert(null)}
        />
      )}
      {documentOuvert === "resultat" && <ModaleCompteDeResultat donnees={donnees} onFermer={() => setDocumentOuvert(null)} />}
      {documentOuvert === "bilan" && <ModaleBilan donnees={donnees} onFermer={() => setDocumentOuvert(null)} />}
    </div>
  );
}
