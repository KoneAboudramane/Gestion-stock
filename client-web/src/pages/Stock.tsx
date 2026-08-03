import { useEffect, useState } from "react";

import { api } from "../api";
import type { DepotResume, LigneStock, Session } from "../api";

/**
 * Adapté de client-electron/src/pages/Stock.tsx (uniquement OngletStockNiveau —
 * Mouvements/Transferts/Inventaire ne sont pas dans le périmètre du portail web).
 * La recherche par texte se fait côté client (filtrage local) : contrairement au
 * SQLite local d'Electron, l'API Django /api/stocks/ ne supporte qu'un filtre par
 * dépôt, pas par terme de recherche.
 */
export default function Stock({ session }: { session: Session }) {
  const peutGerer = !!session.permissions.gerer_produits_stock_achats;
  const [depots, setDepots] = useState<DepotResume[]>([]);
  const [depotId, setDepotId] = useState(peutGerer ? "" : (session.depotId ?? ""));
  const [terme, setTerme] = useState("");
  const [lignes, setLignes] = useState<LigneStock[]>([]);
  const [seulementRuptures, setSeulementRuptures] = useState(false);

  useEffect(() => {
    if (peutGerer) api.depots.lister().then((r) => r.succes && setDepots(r.resultat));
  }, [peutGerer]);

  useEffect(() => {
    api.stock.lister(depotId || undefined).then((r) => r.succes && setLignes(r.resultat));
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
          placeholder="Rechercher un produit…"
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
              <th>Produit</th>
              <th>Référence</th>
              <th>Dépôt</th>
              <th>Quantité</th>
              <th>Seuil</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {lignesAffichees.map((l) => (
              <tr key={l.id}>
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
                <td colSpan={6} className="liste-vide">
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
