import { useEffect, useState } from "react";

import { api } from "../api/client";
import type { JourneeCaisse, Session } from "../api/client";

const donnees = {
  journee: (boutiqueId: string, depotId: string | null, debut: string, fin: string): Promise<JourneeCaisse> =>
    api.tresorerie.journee(boutiqueId, depotId, debut, fin),
  depots: async (boutiqueId: string): Promise<{ id: string; nom: string }[]> => api.depots.lister(boutiqueId),
};

import { useDevise } from "../contexts/DeviseContext";
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

              <h4 className="titre-section-journee">👥 Par caissier</h4>
              <div className="zone-tableau-scroll">
                <table className="tableau-catalogue carte-mobile">
                  <thead>
                    <tr>
                      <th>Caissier</th>
                      <th>Ventes</th>
                      <th>Espèces</th>
                      <th>Mobile Money</th>
                      <th>Crédit</th>
                      <th>Total vendu</th>
                      <th>Crédits encaissés</th>
                    </tr>
                  </thead>
                  <tbody>
                    {journee.parCaissier.map((c) => (
                      <tr key={c.utilisateurId ?? "inconnu"}>
                        <td data-label="Caissier">
                          <strong>{nomUtilisateur(c.utilisateurId)}</strong>
                        </td>
                        <td data-label="Ventes">{c.nombreVentes}</td>
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
                        <td data-label="Crédits encaissés" className="nowrap">
                          {formaterMontant(c.remboursements)}
                        </td>
                      </tr>
                    ))}
                    {journee.parCaissier.length === 0 && (
                      <tr>
                        <td colSpan={7} className="liste-vide">
                          Aucune vente ce jour-là.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
