import { useEffect, useState } from "react";

import type { Session } from "../api";
import { listerDepotsDetail, listerStock, type DepotResume, type LigneStock } from "../services/stock";

/**
 * Adapté de client-electron/src/pages/Stock.tsx (uniquement OngletStockNiveau —
 * Mouvements/Transferts/Inventaire ne sont pas dans le périmètre du portail web).
 * Local d'abord (IndexedDB, voir services/stock.ts), comme le reste de l'application.
 */
export default function Stock({ session }: { session: Session }) {
  const peutGerer = !!session.permissions.gerer_produits_stock_achats;
  const [depots, setDepots] = useState<DepotResume[]>([]);
  const [depotId, setDepotId] = useState(peutGerer ? "" : (session.depotId ?? ""));
  const [terme, setTerme] = useState("");
  const [lignes, setLignes] = useState<LigneStock[]>([]);
  const [seulementRuptures, setSeulementRuptures] = useState(false);

  useEffect(() => {
    if (peutGerer) listerDepotsDetail(session.boutiqueId).then(setDepots);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [peutGerer]);

  useEffect(() => {
    listerStock(session.boutiqueId, depotId || undefined).then(setLignes);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [depotId]);

  const termeNormalise = terme.trim().toLowerCase();
  const lignesFiltrees = termeNormalise
    ? lignes.filter(
        (l) => l.produitNom.toLowerCase().includes(termeNormalise) || l.reference.toLowerCase().includes(termeNormalise),
      )
    : lignes;
  const lignesAffichees = seulementRuptures ? lignesFiltrees.filter((l) => l.enRupture) : lignesFiltrees;

  return (
    <div className="page-produits">
      <h2>Stock</h2>
      <div className="barre-actions">
        {peutGerer ? (
          <select value={depotId} onChange={(e) => setDepotId(e.target.value)}>
            <option value="">Tous les dépôts</option>
            {depots.map((d) => (
              <option key={d.id} value={d.id}>
                {d.nom}
              </option>
            ))}
          </select>
        ) : (
          session.depotNom && <span className="depot-fixe">{session.depotNom}</span>
        )}
        <input
          className="champ-recherche"
          placeholder="Rechercher un article…"
          value={terme}
          onChange={(e) => setTerme(e.target.value)}
        />
        <label className="case-a-cocher">
          <input
            type="checkbox"
            checked={seulementRuptures}
            onChange={(e) => setSeulementRuptures(e.target.checked)}
          />
          Seulement les ruptures
        </label>
      </div>
      <div className="zone-tableau-scroll">
        <table className="tableau-catalogue">
          <thead>
            <tr>
              <th>N°</th>
              <th>Désignation</th>
              <th>Référence</th>
              <th>Dépôt</th>
              <th>Quantité</th>
              <th>Seuil</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {lignesAffichees.map((l, index) => (
              <tr key={l.id}>
                <td>{index + 1}</td>
                <td>{l.produitNom}</td>
                <td>{l.reference || ""}</td>
                <td>{l.depotNom}</td>
                <td>{l.quantite}</td>
                <td>{l.seuilAlerte}</td>
                <td>{l.enRupture ? <span className="badge-rupture">Rupture</span> : null}</td>
              </tr>
            ))}
            {lignesAffichees.length === 0 && (
              <tr>
                <td colSpan={7} className="liste-vide">
                  {seulementRuptures ? "Aucune rupture de stock." : "Aucune ligne de stock."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
