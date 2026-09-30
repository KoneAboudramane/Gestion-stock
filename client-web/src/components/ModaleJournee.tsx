import { useEffect, useState } from "react";

import type { Session } from "../api";
import type { ColonneExport } from "../lib/export";
import { listerDepotsDetail } from "../services/stock";
import { journeeCaisse, type JourneeCaisse } from "../services/tresorerie";

const donnees = {
  journee: (boutiqueId: string, depotId: string | null, debut: string, fin: string): Promise<JourneeCaisse> =>
    journeeCaisse(boutiqueId, depotId, debut, fin),
  depots: async (boutiqueId: string): Promise<{ id: string; nom: string }[]> => listerDepotsDetail(boutiqueId),
};

import BoutonsExport from "./BoutonsExport";
import { useDevise } from "../contexts/DeviseContext";
import { DetailVente } from "../pages/Ventes";
import { useNomsUtilisateurs } from "../hooks/useNomsUtilisateurs";
import { formaterMontant } from "../lib/formatage";
import { libelleCategorieMouvementCaisse, libelleOperateurMobileMoney } from "../lib/libelles";

function debutDuJour(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

function decalerJours(date: Date, jours: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + jours);
  return d;
}

function valeurChampDate(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

async function chargerJournee(boutiqueId: string, depotId: string, jour: Date): Promise<JourneeCaisse> {
  const debut = debutDuJour(jour);
  return donnees.journee(boutiqueId, depotId || null, debut.toISOString(), decalerJours(debut, 1).toISOString());
}

/** « +12 % » par rapport à hier (vert), « −5 % » (rouge), rien si hier était à zéro. */
function Evolution({ actuel, precedent }: { actuel: number; precedent: number }) {
  if (!precedent) return <span className="sous-info">hier : 0</span>;
  const taux = Math.round(((actuel - precedent) / Math.abs(precedent)) * 100);
  return (
    <span className={taux > 0 ? "montant-entree" : taux < 0 ? "texte-erreur" : "sous-info"}>
      {taux > 0 ? "+" : ""}
      {taux} % vs hier
    </span>
  );
}

function heure(iso: string | null): string {
  return iso ? new Date(iso).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" }) : "—";
}

const LIBELLES_MODE: Record<string, string> = {
  especes: "Espèces",
  mobile_money: "Mobile Money",
  credit: "Crédit",
  carte: "Carte",
};

/** Fenêtre « Par caissier » de la Journée : qui a vendu quoi, et ce que chacun doit avoir remis. */
function FenetreParCaissier({
  session,
  journee,
  titreJour,
  onFermer,
}: {
  session: Session;
  journee: JourneeCaisse;
  titreJour: string;
  onFermer: () => void;
}) {
  const devise = useDevise();
  const nomUtilisateur = useNomsUtilisateurs(session);
  const [caissierOuvert, setCaissierOuvert] = useState<string | null | undefined>(undefined);
  const [venteOuverte, setVenteOuverte] = useState<string | null>(null);
  const caissiers = journee.parCaissier;
  const total = caissiers.reduce((t, c) => t + c.total, 0);
  const meilleur = caissiers[0];
  const somme = (cle: "nombreVentes" | "especes" | "mobileMoney" | "credit" | "total" | "aRemettre") =>
    caissiers.reduce((t, c) => t + c[cle], 0);

  const colonnesExport: ColonneExport[] = [
    { cle: "caissier", libelle: "Caissier" },
    { cle: "ventes", libelle: "Ventes" },
    { cle: "part", libelle: "Part du jour (%)" },
    { cle: "especes", libelle: `Espèces (${devise})` },
    { cle: "mobileMoney", libelle: `Mobile Money (${devise})` },
    { cle: "credit", libelle: `Crédit (${devise})` },
    { cle: "total", libelle: `Total vendu (${devise})` },
    { cle: "aRemettre", libelle: `À remettre (${devise})` },
    { cle: "horaires", libelle: "Horaires" },
  ];
  const lignesExport = caissiers.map((c) => ({
    caissier: nomUtilisateur(c.utilisateurId),
    ventes: c.nombreVentes,
    part: total ? Math.round((c.total / total) * 100) : 0,
    especes: c.especes,
    mobileMoney: c.mobileMoney,
    credit: c.credit,
    total: c.total,
    aRemettre: c.aRemettre,
    horaires: `${heure(c.premiereVente)} → ${heure(c.derniereVente)}`,
  }));

  const ventesCaissier =
    caissierOuvert === undefined ? [] : journee.ventes.filter((v) => (v.utilisateurId ?? null) === caissierOuvert);

  return (
    <div
      className="fond-modale"
      onClick={(e) => {
        e.stopPropagation();
        onFermer();
      }}
    >
      <div className="modale-selection-produits" onClick={(e) => e.stopPropagation()}>
        {venteOuverte ? (
          <DetailVente venteId={venteOuverte} session={session} onRetour={() => setVenteOuverte(null)} />
        ) : caissierOuvert !== undefined ? (
          <>
            <div className="modale-entete">
              <h3>
                🧾 Ventes de {nomUtilisateur(caissierOuvert)} — {titreJour}
              </h3>
              <button type="button" className="lien bouton-retour" onClick={() => setCaissierOuvert(undefined)}>
                ← Retour
              </button>
            </div>
            <div className="modale-corps">
              <div className="zone-tableau-scroll zone-commandes-fiche tableau-grille-journee">
                <table className="tableau-catalogue carte-mobile">
                  <thead>
                    <tr>
                      <th>Heure</th>
                      <th>Numéro</th>
                      <th>Client</th>
                      <th>Paiement</th>
                      <th>Montant</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ventesCaissier.map((v) => (
                      <tr key={v.id} className="ligne-cliquable" onClick={() => setVenteOuverte(v.id)} title="Voir la vente">
                        <td data-label="Heure">{heure(v.dateCreation)}</td>
                        <td data-label="Numéro">{v.numero}</td>
                        <td data-label="Client">{v.clientNom ?? ""}</td>
                        <td data-label="Paiement">{v.modes.map((m) => LIBELLES_MODE[m] ?? m).join(" + ")}</td>
                        <td data-label="Montant" className="nowrap">
                          <strong>
                            {formaterMontant(v.totalNet)} {devise}
                          </strong>
                        </td>
                      </tr>
                    ))}
                    {ventesCaissier.length === 0 && (
                      <tr>
                        <td colSpan={5} className="liste-vide">
                          Aucune vente.
                        </td>
                      </tr>
                    )}
                    {Array.from({ length: Math.max(0, 12 - Math.max(1, ventesCaissier.length)) }).map((_, i) => (
                      <tr key={`vide-${i}`} className="ligne-groupe-vide">
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
            </div>
          </>
        ) : (
          <>
            <div className="modale-entete">
              <h3>👥 Par caissier — {titreJour}</h3>
              <button type="button" className="lien bouton-retour" onClick={onFermer}>
                ← Retour
              </button>
            </div>
            <div className="modale-corps">
              <div className="tuiles-fiche">
                <div className="tuile-fiche">
                  <span className="sous-info">👥 Caissiers actifs</span>
                  <strong>{caissiers.length}</strong>
                </div>
                <div className="tuile-fiche">
                  <span className="sous-info">🏆 Meilleur vendeur</span>
                  <strong>{meilleur ? nomUtilisateur(meilleur.utilisateurId) : "—"}</strong>
                  {meilleur && (
                    <span className="sous-info">
                      {formaterMontant(meilleur.total)} {devise}
                    </span>
                  )}
                </div>
                <div className="tuile-fiche">
                  <span className="sous-info">💰 Total vendu</span>
                  <strong className="nowrap">
                    {formaterMontant(total)} {devise}
                  </strong>
                </div>
                <div className="tuile-fiche">
                  <span className="sous-info">🧺 Panier moyen</span>
                  <strong className="nowrap">
                    {formaterMontant(somme("nombreVentes") ? Math.round(total / somme("nombreVentes")) : 0)} {devise}
                  </strong>
                </div>
              </div>
              <div className="barre-actions barre-filtres-historique">
                <span className="sous-info">Cliquez sur un caissier pour voir ses ventes.</span>
                <BoutonsExport titre={`Par caissier — ${titreJour}`} colonnes={colonnesExport} lignes={lignesExport} compact />
              </div>
              <div className="zone-tableau-scroll zone-commandes-fiche tableau-grille-journee">
                <table className="tableau-catalogue carte-mobile">
                  <thead>
                    <tr>
                      <th>Caissier</th>
                      <th>Ventes</th>
                      <th>Part du jour</th>
                      <th>Espèces</th>
                      <th>Mobile Money</th>
                      <th>Crédit</th>
                      <th>Total vendu</th>
                      <th title="Espèces encaissées (ventes et crédits remboursés) : ce que le caissier doit avoir remis à la caisse">
                        À remettre
                      </th>
                      <th>Horaires</th>
                    </tr>
                  </thead>
                  <tbody>
                    {caissiers.map((c) => {
                      const part = total ? Math.round((c.total / total) * 100) : 0;
                      return (
                        <tr
                          key={c.utilisateurId ?? "inconnu"}
                          className="ligne-cliquable"
                          onClick={() => setCaissierOuvert(c.utilisateurId ?? null)}
                          title="Voir ses ventes"
                        >
                          <td data-label="Caissier">
                            <strong>{nomUtilisateur(c.utilisateurId)}</strong>
                          </td>
                          <td data-label="Ventes">{c.nombreVentes}</td>
                          <td data-label="Part du jour">
                            <span className="barre-part">
                              <span className="barre-part-remplie" style={{ width: `${part}%` }} />
                            </span>{" "}
                            {part} %
                          </td>
                          <td data-label="Espèces" className="nowrap">
                            {formaterMontant(c.especes)}
                          </td>
                          <td data-label="Mobile Money" className="nowrap">
                            {formaterMontant(c.mobileMoney)}
                          </td>
                          <td data-label="Crédit" className="nowrap">
                            {formaterMontant(c.credit)}
                          </td>
                          <td data-label="Total vendu" className="nowrap">
                            <strong>
                              {formaterMontant(c.total)} {devise}
                            </strong>
                          </td>
                          <td data-label="À remettre" className="nowrap">
                            <strong className="montant-a-remettre">{formaterMontant(c.aRemettre)}</strong>
                            {c.remboursements > 0 && (
                              <span className="sous-info ligne-detail-article">dont {formaterMontant(c.remboursements)} de crédits</span>
                            )}
                          </td>
                          <td data-label="Horaires" className="nowrap">
                            {heure(c.premiereVente)} → {heure(c.derniereVente)}
                          </td>
                        </tr>
                      );
                    })}
                    {caissiers.length === 0 && (
                      <tr>
                        <td colSpan={9} className="liste-vide">
                          Aucune vente ce jour-là.
                        </td>
                      </tr>
                    )}
                    {Array.from({ length: Math.max(0, 12 - Math.max(1, caissiers.length)) }).map((_, i) => (
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
                  {caissiers.length > 1 && (
                    <tfoot>
                      <tr className="ligne-total-tableau">
                        <td>Total</td>
                        <td>{somme("nombreVentes")}</td>
                        <td>100 %</td>
                        <td className="nowrap">{formaterMontant(somme("especes"))}</td>
                        <td className="nowrap">{formaterMontant(somme("mobileMoney"))}</td>
                        <td className="nowrap">{formaterMontant(somme("credit"))}</td>
                        <td className="nowrap">
                          {formaterMontant(somme("total"))} {devise}
                        </td>
                        <td className="nowrap">{formaterMontant(somme("aRemettre"))}</td>
                        <td />
                      </tr>
                    </tfoot>
                  )}
                </table>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export default function ModaleJournee({
  session,
  depotIdInitial,
  depotCourantId,
  onCloturer,
  onFermer,
}: {
  session: Session;
  /** Dépôt affiché au départ ("" = tous les dépôts). */
  depotIdInitial: string;
  /** Dépôt de la page Trésorerie : seul lui peut être clôturé depuis ici. */
  depotCourantId: string;
  onCloturer?: () => void;
  onFermer: () => void;
}) {
  const devise = useDevise();
  const nomUtilisateur = useNomsUtilisateurs(session);
  const peutGerer = !!session.permissions.gerer_tresorerie;
  const [depots, setDepots] = useState<{ id: string; nom: string }[]>([]);
  const [depotId, setDepotId] = useState(depotIdInitial);
  const [jour, setJour] = useState(debutDuJour(new Date()));
  const [journee, setJournee] = useState<JourneeCaisse | null>(null);
  const [veille, setVeille] = useState<JourneeCaisse | null>(null);
  const [parCaissierOuvert, setParCaissierOuvert] = useState(false);

  useEffect(() => {
    if (peutGerer || !session.depotId) donnees.depots(session.boutiqueId).then(setDepots);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.boutiqueId]);

  useEffect(() => {
    setJournee(null);
    chargerJournee(session.boutiqueId, depotId, jour).then(setJournee);
    chargerJournee(session.boutiqueId, depotId, decalerJours(jour, -1)).then(setVeille);
  }, [session.boutiqueId, depotId, jour]);

  const aujourdhui = debutDuJour(new Date()).getTime() === jour.getTime();
  const titreJour = jour.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  const totalEntrees = journee?.entrees.reduce((t, l) => t + l.montant, 0) ?? 0;
  const totalSorties = journee?.sorties.reduce((t, l) => t + l.montant, 0) ?? 0;
  const mobileMoney = journee?.mobileMoney.reduce((t, m) => t + m.montant, 0) ?? 0;
  const encaisseEspeces = journee?.entrees.filter((l) => l.categorie === "vente_especes" || l.categorie === "remboursement_credit").reduce((t, l) => t + l.montant, 0) ?? 0;
  const encaisseEspecesVeille = veille?.entrees.filter((l) => l.categorie === "vente_especes" || l.categorie === "remboursement_credit").reduce((t, l) => t + l.montant, 0) ?? 0;
  const peutCloturer = !!onCloturer && peutGerer && aujourdhui && !!depotId && depotId === depotCourantId;
  const nomDepot = (id: string) => depots.find((d) => d.id === id)?.nom ?? "";

  return (
    <div className="fond-modale" onClick={onFermer}>
      <div className="modale-selection-produits" onClick={(e) => e.stopPropagation()}>
        <div className="modale-entete">
          <h3>📅 Journée — {titreJour}</h3>
          <button type="button" className="lien bouton-retour" onClick={onFermer}>
            ← Retour
          </button>
        </div>
        <div className="modale-corps">
          <div className="barre-actions barre-filtres-historique">
            <button type="button" onClick={() => setJour(decalerJours(jour, -1))}>
              ◀ Veille
            </button>
            <input
              type="date"
              value={valeurChampDate(jour)}
              max={valeurChampDate(new Date())}
              onChange={(e) => {
                if (!e.target.value) return;
                const [a, m, j] = e.target.value.split("-").map(Number);
                setJour(new Date(a, m - 1, j));
              }}
            />
            <button type="button" disabled={aujourdhui} onClick={() => setJour(decalerJours(jour, 1))}>
              Lendemain ▶
            </button>
            {!aujourdhui && (
              <button type="button" className="lien" onClick={() => setJour(debutDuJour(new Date()))}>
                Aujourd'hui
              </button>
            )}
            {depots.length > 1 && (
              <select value={depotId} onChange={(e) => setDepotId(e.target.value)}>
                {peutGerer && <option value="">Tous les dépôts</option>}
                {depots.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.nom}
                  </option>
                ))}
              </select>
            )}
          </div>

          {!journee ? (
            <p className="note-aide">Chargement…</p>
          ) : (
            <>
              <div className="tuiles-fiche">
                <div className="tuile-fiche">
                  <span className="sous-info">💰 Chiffre d'affaires</span>
                  <strong className="nowrap">
                    {formaterMontant(journee.chiffreAffaires)} {devise}
                  </strong>
                  <Evolution actuel={journee.chiffreAffaires} precedent={veille?.chiffreAffaires ?? 0} />
                </div>
                <div className="tuile-fiche">
                  <span className="sous-info">🧾 Ventes</span>
                  <strong>{journee.nombreVentes}</strong>
                  <Evolution actuel={journee.nombreVentes} precedent={veille?.nombreVentes ?? 0} />
                </div>
                <div className="tuile-fiche">
                  <span className="sous-info">💵 Encaissé en espèces</span>
                  <strong className="nowrap">
                    {formaterMontant(encaisseEspeces)} {devise}
                  </strong>
                  <Evolution actuel={encaisseEspeces} precedent={encaisseEspecesVeille} />
                </div>
                <div className={`tuile-fiche${journee.soldeAttendu < 0 ? " tuile-fiche--alerte" : ""}`}>
                  <span className="sous-info">🗄️ Doit être en caisse</span>
                  <strong className="nowrap">
                    {formaterMontant(journee.soldeAttendu)} {devise}
                  </strong>
                  <span className="sous-info">{aujourdhui ? "à cet instant" : "en fin de journée"}</span>
                </div>
              </div>

              <div className="colonnes-journee">
                <div className="bloc-journee">
                  <h4>🗄️ Caisse (espèces)</h4>
                  <div className="ligne-journee">
                    <span>Fond de caisse {aujourdhui ? "ce matin" : "le matin"}</span>
                    <strong>{formaterMontant(journee.fondOuverture)}</strong>
                  </div>
                  <div className="ligne-journee ligne-journee--total montant-entree">
                    <span>+ Entrées</span>
                    <strong>+{formaterMontant(totalEntrees)}</strong>
                  </div>
                  {journee.entrees.map((l) => (
                    <div key={`e-${l.categorie}`} className="ligne-journee ligne-journee--detail">
                      <span>
                        {libelleCategorieMouvementCaisse(l.categorie)} <span className="sous-info">({l.nombre})</span>
                      </span>
                      <span>{formaterMontant(l.montant)}</span>
                    </div>
                  ))}
                  <div className="ligne-journee ligne-journee--total texte-erreur">
                    <span>− Sorties</span>
                    <strong>−{formaterMontant(totalSorties)}</strong>
                  </div>
                  {journee.sorties.map((l) => (
                    <div key={`s-${l.categorie}`} className="ligne-journee ligne-journee--detail">
                      <span>
                        {/* Une sortie « vente en espèces » est l'annulation d'une vente : l'argent ressort. */}
                        {l.categorie === "vente_especes" ? "Annulation de vente" : libelleCategorieMouvementCaisse(l.categorie)}{" "}
                        <span className="sous-info">({l.nombre})</span>
                      </span>
                      <span>{formaterMontant(l.montant)}</span>
                    </div>
                  ))}
                  {journee.ajustements !== 0 && (
                    <div className="ligne-journee ligne-journee--total">
                      <span>± Ajustements</span>
                      <strong>
                        {journee.ajustements > 0 ? "+" : ""}
                        {formaterMontant(journee.ajustements)}
                      </strong>
                    </div>
                  )}
                  <div className="ligne-journee ligne-journee--resultat">
                    <span>= Doit être en caisse</span>
                    <strong>
                      {formaterMontant(journee.soldeAttendu)} {devise}
                    </strong>
                  </div>
                  {journee.clotures.map((c) => (
                    <div key={c.id} className={`ligne-cloture-journee${c.ecart !== 0 ? " texte-erreur" : ""}`}>
                      🔒 Clôturée à {new Date(c.dateCreation).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}
                      {!depotId && nomDepot(c.depotId) && ` (${nomDepot(c.depotId)})`} par {nomUtilisateur(c.utilisateurId)} : compté{" "}
                      {formaterMontant(c.soldeCompte)}, écart {c.ecart > 0 ? "+" : ""}
                      {formaterMontant(c.ecart)}
                    </div>
                  ))}
                  {peutCloturer && (
                    <button type="button" className="bouton-valider bouton-cloturer-journee" onClick={onCloturer}>
                      🔒 Clôturer la journée
                    </button>
                  )}
                </div>

                <div className="bloc-journee">
                  <h4>📱 Hors caisse (pour info)</h4>
                  <p className="note-aide">Cet argent n'est pas dans le tiroir : ne le comptez pas à la clôture.</p>
                  <div className="ligne-journee ligne-journee--total">
                    <span>Mobile Money</span>
                    <strong>{formaterMontant(mobileMoney)}</strong>
                  </div>
                  {journee.mobileMoney.map((m) => (
                    <div key={m.operateur} className="ligne-journee ligne-journee--detail">
                      <span>{libelleOperateurMobileMoney(m.operateur) || "Autre"}</span>
                      <span>{formaterMontant(m.montant)}</span>
                    </div>
                  ))}
                  <div className="ligne-journee ligne-journee--total">
                    <span>Vendu à crédit</span>
                    <strong>{formaterMontant(journee.credit)}</strong>
                  </div>
                  {journee.autres > 0 && (
                    <div className="ligne-journee ligne-journee--total">
                      <span>Carte / autres</span>
                      <strong>{formaterMontant(journee.autres)}</strong>
                    </div>
                  )}
                  <div className="ligne-journee ligne-journee--resultat">
                    <span>Chiffre d'affaires du jour</span>
                    <strong>
                      {formaterMontant(journee.chiffreAffaires)} {devise}
                    </strong>
                  </div>
                  <div className="ligne-journee ligne-journee--detail">
                    <span>Panier moyen</span>
                    <span>
                      {formaterMontant(journee.nombreVentes ? Math.round(journee.chiffreAffaires / journee.nombreVentes) : 0)}
                    </span>
                  </div>
                </div>
              </div>

              <button type="button" className="bouton-par-caissier" onClick={() => setParCaissierOuvert(true)}>
                👥 Voir par caissier ({journee.parCaissier.length})
              </button>
            </>
          )}
        </div>
      </div>
      {parCaissierOuvert && journee && (
        <FenetreParCaissier session={session} journee={journee} titreJour={titreJour} onFermer={() => setParCaissierOuvert(false)} />
      )}
    </div>
  );
}
