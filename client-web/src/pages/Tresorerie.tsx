import { useEffect, useState } from "react";
import type { CSSProperties } from "react";

import { api } from "../api";
import type { Session, UtilisateurResume } from "../api";
import ChampMontant from "../components/ChampMontant";
import { useDevise } from "../contexts/DeviseContext";
import { formaterMontant } from "../lib/formatage";
import {
  OPERATEURS_MOBILE_MONEY,
  libelleCategorieMouvementCaisse,
  libelleOperateurMobileMoney,
  libelleTypeMouvementCaisse,
  type OperateurMobileMoney,
} from "../lib/libelles";
import { listerDepotsDetail, type DepotResume } from "../services/stock";
import {
  ajusterCaisse,
  cloturerCaisse,
  effectuerRetrait,
  effectuerTransfert,
  enregistrerApport,
  ErreurTresorerie,
  listerClotures,
  listerMouvements,
  listerTransferts,
  soldeCaisse,
  soldeMobileMoneyDisponible,
  type ClotureCaisseResume,
  type MouvementCaisseResume,
  type TransfertCaisseResume,
} from "../services/tresorerie";

/**
 * Port de client-electron/src/pages/Tresorerie.tsx : suivi de la caisse
 * (solde, historique, transferts mobile money, clôtures), local d'abord
 * (IndexedDB, voir services/tresorerie.ts), séparé de l'écran de vente "Caisse".
 */

/**
 * Plusieurs utilisateurs (caissières) peuvent partager le même dépôt, et le
 * Patron/Gérant peut basculer sur leur caisse : on résout donc toujours
 * l'auteur réel de chaque mouvement, jamais seulement le dépôt affecté.
 */
function creerResolveurNom(utilisateurs: UtilisateurResume[], utilisateurIdSession: string) {
  const noms = new Map(
    utilisateurs.map((u) => [String(u.id), `${u.first_name} ${u.last_name}`.trim() || u.username]),
  );
  return (id: string | null): string => {
    if (!id) return "inconnu";
    if (id === utilisateurIdSession) return "Vous";
    return noms.get(id) ?? "Autre utilisateur";
  };
}

function SelecteurDepot({
  session,
  peutChangerDepot,
  depots,
  depotId,
  setDepotId,
}: {
  session: Session;
  peutChangerDepot: boolean;
  depots: DepotResume[];
  depotId: string;
  setDepotId: (id: string) => void;
}) {
  // Un compte verrouillé sur un dépôt (caissier) n'a pas le choix. Patron et
  // Gérant (gerer_tresorerie) gardent leur dépôt assigné par défaut, mais
  // peuvent basculer sur un autre — les traces gardent leur utilisateurId
  // propre, donc on sait toujours qui a agi sur le dépôt de qui.
  if (session.depotId && !peutChangerDepot) return null;
  return (
    <select value={depotId} onChange={(e) => setDepotId(e.target.value)}>
      <option value="">Choisir un dépôt…</option>
      {depots.map((d) => (
        <option key={d.id} value={d.id}>
          {d.nom}
        </option>
      ))}
    </select>
  );
}

// Même dimension fixe que les autres modales à tableau de l'appli
// (.modale-selection-produits, voir index.css) : leur historique respectif
// vit désormais dans la modale elle-même, juste sous le formulaire.

type CategorieActionCaisse = "retrait" | "apport" | "ajustement";

const SECTIONS_ACTION_CAISSE: Record<
  CategorieActionCaisse,
  { bouton: string; icone: string; modaleTitre: string; historiqueTitre: string; vide: string }
> = {
  retrait: {
    bouton: "Retrait",
    icone: "➖",
    modaleTitre: "Retrait de caisse",
    historiqueTitre: "Historique des retraits",
    vide: "Aucun retrait.",
  },
  apport: {
    bouton: "Mise de fonds",
    icone: "➕",
    modaleTitre: "Mise de fonds en caisse",
    historiqueTitre: "Historique des mises de fonds",
    vide: "Aucune mise de fonds.",
  },
  ajustement: {
    bouton: "Ajustement",
    icone: "⚖️",
    modaleTitre: "Ajustement de caisse",
    historiqueTitre: "Historique des ajustements",
    vide: "Aucun ajustement.",
  },
};

function ModaleMouvementCategorie({
  titre,
  historiqueTitre,
  libelleVide,
  mouvements,
  devise,
  nomUtilisateur,
  motifRequis = false,
  montantSigne = false,
  onAnnuler,
  onValider,
}: {
  titre: string;
  historiqueTitre: string;
  libelleVide: string;
  mouvements: MouvementCaisseResume[];
  devise: string;
  nomUtilisateur: (id: string | null) => string;
  motifRequis?: boolean;
  montantSigne?: boolean;
  onAnnuler: () => void;
  onValider: (montant: number, motif: string) => Promise<void>;
}) {
  const [montant, setMontant] = useState("");
  const [negatif, setNegatif] = useState(false);
  const [motif, setMotif] = useState("");
  const [erreur, setErreur] = useState<string | null>(null);
  const [enCours, setEnCours] = useState(false);

  async function valider(evenement: React.FormEvent) {
    evenement.preventDefault();
    setErreur(null);
    if (motifRequis && !motif.trim()) {
      setErreur("Le motif est obligatoire.");
      return;
    }
    setEnCours(true);
    try {
      const valeur = (Number(montant) || 0) * (montantSigne && negatif ? -1 : 1);
      await onValider(valeur, motif.trim());
    } catch (e) {
      setErreur(e instanceof ErreurTresorerie ? e.message : "Erreur inattendue.");
    } finally {
      setEnCours(false);
    }
  }

  return (
    <div className="fond-modale" onClick={onAnnuler}>
      <div className="modale-selection-produits" onClick={(e) => e.stopPropagation()}>
        <form onSubmit={valider} className="formulaire-mouvement-caisse-modale">
          <div className="modale-entete">
            <h3>{titre}</h3>
            <button type="button" className="lien bouton-retour" onClick={onAnnuler} disabled={enCours}>
              ← Retour
            </button>
          </div>
          <div className="modale-corps">
            {erreur && <div className="message-erreur">{erreur}</div>}
            <div className="ligne-champs-tresorerie">
              <label>
                Montant
                <ChampMontant value={montant} onChange={setMontant} autoFocus />
              </label>
              {montantSigne && (
                <label>
                  Sens
                  <select value={negatif ? "1" : "0"} onChange={(e) => setNegatif(e.target.value === "1")}>
                    <option value="0">Correction vers le haut (+)</option>
                    <option value="1">Correction vers le bas (−)</option>
                  </select>
                </label>
              )}
              <label>
                Motif {motifRequis ? "" : "(optionnel)"}
                <input value={motif} onChange={(e) => setMotif(e.target.value)} />
              </label>
              <button type="submit" className="bouton-primaire" disabled={enCours}>
                {enCours ? "…" : "Valider"}
              </button>
            </div>

            <h4>{historiqueTitre}</h4>
            <div className="zone-tableau-scroll">
              <table className="tableau-catalogue carte-mobile">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Motif</th>
                    <th>Montant</th>
                    <th>Effectué par</th>
                  </tr>
                </thead>
                <tbody>
                  {mouvements.map((m) => (
                    <tr key={m.id}>
                      <td data-label="Date">{new Date(m.dateCreation).toLocaleString("fr-FR")}</td>
                      <td data-label="Motif">{m.motif}</td>
                      <td data-label="Montant">
                        {m.type === "sortie" ? "−" : "+"}
                        {formaterMontant(Math.abs(m.montant))} {devise}
                      </td>
                      <td data-label="Effectué par">{nomUtilisateur(m.utilisateurId)}</td>
                    </tr>
                  ))}
                  {mouvements.length === 0 && (
                    <tr>
                      <td colSpan={4} className="liste-vide-compacte">
                        {libelleVide}
                      </td>
                    </tr>
                  )}
                  {Array.from({ length: Math.max(0, 12 - mouvements.length - (mouvements.length === 0 ? 1 : 0)) }).map(
                    (_, i) => (
                      <tr key={`vide-${i}`} className="ligne-groupe-vide">
                        <td>&nbsp;</td>
                        <td>&nbsp;</td>
                        <td>&nbsp;</td>
                        <td>&nbsp;</td>
                      </tr>
                    ),
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}

// --- Historique complet du solde (tous les mouvements, toutes catégories) ---

function ModaleHistoriqueSolde({
  mouvements,
  devise,
  nomUtilisateur,
  onFermer,
}: {
  mouvements: MouvementCaisseResume[];
  devise: string;
  nomUtilisateur: (id: string | null) => string;
  onFermer: () => void;
}) {
  return (
    <div className="fond-modale" onClick={onFermer}>
      <div className="modale-selection-produits" onClick={(e) => e.stopPropagation()}>
        <div className="modale-entete">
          <h3>Historique du solde</h3>
          <button type="button" className="lien bouton-retour" onClick={onFermer}>
            ← Retour
          </button>
        </div>
        <div className="modale-corps">
          <div className="zone-tableau-scroll">
            <table className="tableau-catalogue carte-mobile">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Type</th>
                  <th>Catégorie</th>
                  <th>Motif</th>
                  <th>Montant</th>
                  <th>Effectué par</th>
                </tr>
              </thead>
              <tbody>
                {mouvements.map((m) => (
                  <tr key={m.id}>
                    <td data-label="Date">{new Date(m.dateCreation).toLocaleString("fr-FR")}</td>
                    <td data-label="Type">
                      <span className={m.type === "sortie" ? "badge-annulee" : "badge-payee"}>
                        {libelleTypeMouvementCaisse(m.type)}
                      </span>
                    </td>
                    <td data-label="Catégorie">{libelleCategorieMouvementCaisse(m.categorie)}</td>
                    <td data-label="Motif">{m.motif}</td>
                    <td data-label="Montant">
                      {m.type === "sortie" ? "−" : "+"}
                      {formaterMontant(Math.abs(m.montant))} {devise}
                    </td>
                    <td data-label="Effectué par">{nomUtilisateur(m.utilisateurId)}</td>
                  </tr>
                ))}
                {mouvements.length === 0 && (
                  <tr>
                    <td colSpan={6} className="liste-vide-compacte">
                      Aucun mouvement de caisse.
                    </td>
                  </tr>
                )}
                {Array.from({ length: Math.max(0, 15 - mouvements.length - (mouvements.length === 0 ? 1 : 0)) }).map(
                  (_, i) => (
                    <tr key={`vide-${i}`} className="ligne-groupe-vide">
                      <td>&nbsp;</td>
                      <td>&nbsp;</td>
                      <td>&nbsp;</td>
                      <td>&nbsp;</td>
                      <td>&nbsp;</td>
                      <td>&nbsp;</td>
                    </tr>
                  ),
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}

// --- Transfert mobile money -> caisse, depuis l'onglet Solde ---
// Modale compacte, dédiée au geste de transfert seul (comme les applis
// mobile money elles-mêmes) — l'historique est un bouton séparé, pas mêlé au
// formulaire (voir ModaleHistoriqueTransferts ci-dessous).

function ModaleTransfertMobileMoney({
  operateur,
  disponible,
  devise,
  onAnnuler,
  onValider,
}: {
  operateur: OperateurMobileMoney;
  disponible: number;
  devise: string;
  onAnnuler: () => void;
  onValider: (montant: number) => Promise<void>;
}) {
  const [montant, setMontant] = useState("");
  const [erreur, setErreur] = useState<string | null>(null);
  const [enCours, setEnCours] = useState(false);
  const montantDepasseDisponible = Number(montant) > disponible;

  function definirPourcentage(fraction: number) {
    setMontant(disponible > 0 ? String(Math.floor(disponible * fraction)) : "");
  }

  async function valider(evenement: React.FormEvent) {
    evenement.preventDefault();
    if (montantDepasseDisponible) return;
    setErreur(null);
    setEnCours(true);
    try {
      await onValider(Number(montant) || 0);
    } catch (e) {
      setErreur(e instanceof ErreurTresorerie ? e.message : "Erreur inattendue.");
    } finally {
      setEnCours(false);
    }
  }

  return (
    <div className="fond-modale" onClick={onAnnuler}>
      <div
        className={`modale-transfert-mobile-money bandeau-transfert--${operateur}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="bandeau-transfert">
          <span className="badge-operateur-transfert">{libelleOperateurMobileMoney(operateur).charAt(0)}</span>
          <div className="bandeau-transfert-titres">
            <span className="bandeau-transfert-titre">{libelleOperateurMobileMoney(operateur)}</span>
            <span className="bandeau-transfert-sous-titre">Vers la caisse</span>
          </div>
          <span className="pastille-disponible">
            {formaterMontant(disponible)} {devise}
          </span>
        </div>
        <form onSubmit={valider} className="corps-transfert">
          {erreur && <div className="message-erreur">{erreur}</div>}
          <label className="champ-montant-transfert">
            Montant à transférer
            <div className={`saisie-montant-transfert ${montantDepasseDisponible ? "saisie-montant-transfert--erreur" : ""}`}>
              <ChampMontant value={montant} onChange={setMontant} autoFocus />
              <span className="devise-inline">{devise}</span>
            </div>
            {montantDepasseDisponible && (
              <span className="aide-montant-erreur">Montant supérieur au disponible.</span>
            )}
          </label>
          <div className="raccourcis-montant-transfert">
            <button type="button" onClick={() => definirPourcentage(0.25)} disabled={disponible <= 0}>
              25%
            </button>
            <button type="button" onClick={() => definirPourcentage(0.5)} disabled={disponible <= 0}>
              50%
            </button>
            <button type="button" onClick={() => definirPourcentage(1)} disabled={disponible <= 0}>
              Tout
            </button>
          </div>
          <div className="actions-formulaire">
            <button type="button" onClick={onAnnuler} disabled={enCours}>
              Annuler
            </button>
            <button
              type="submit"
              className="bouton-primaire bouton-transferer"
              disabled={enCours || disponible <= 0 || montantDepasseDisponible}
            >
              {enCours ? "Transfert…" : "Transférer"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function ModaleHistoriqueTransferts({
  operateur,
  transferts,
  devise,
  nomUtilisateur,
  onFermer,
}: {
  operateur: OperateurMobileMoney;
  transferts: TransfertCaisseResume[];
  devise: string;
  nomUtilisateur: (id: string | null) => string;
  onFermer: () => void;
}) {
  return (
    <div className="fond-modale" onClick={onFermer}>
      <div className="modale-selection-produits" onClick={(e) => e.stopPropagation()}>
        <div className="modale-entete">
          <h3>Historique des transferts {libelleOperateurMobileMoney(operateur)}</h3>
          <button type="button" className="lien bouton-retour" onClick={onFermer}>
            ← Retour
          </button>
        </div>
        <div className="modale-corps">
          <div className="zone-tableau-scroll">
            <table className="tableau-catalogue carte-mobile">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Montant</th>
                  <th>Effectué par</th>
                </tr>
              </thead>
              <tbody>
                {transferts.map((t) => (
                  <tr key={t.id}>
                    <td data-label="Date">{new Date(t.dateCreation).toLocaleString("fr-FR")}</td>
                    <td data-label="Montant">
                      {formaterMontant(t.montant)} {devise}
                    </td>
                    <td data-label="Effectué par">{nomUtilisateur(t.utilisateurId)}</td>
                  </tr>
                ))}
                {transferts.length === 0 && (
                  <tr>
                    <td colSpan={3} className="liste-vide-compacte">
                      Aucun transfert.
                    </td>
                  </tr>
                )}
                {Array.from({ length: Math.max(0, 15 - transferts.length - (transferts.length === 0 ? 1 : 0)) }).map(
                  (_, i) => (
                    <tr key={`vide-${i}`} className="ligne-groupe-vide">
                      <td>&nbsp;</td>
                      <td>&nbsp;</td>
                      <td>&nbsp;</td>
                    </tr>
                  ),
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}

function OngletHistorique({
  session,
  depotId,
  peutGererTresorerie,
  nomUtilisateur,
}: {
  session: Session;
  depotId: string;
  peutGererTresorerie: boolean;
  nomUtilisateur: (id: string | null) => string;
}) {
  const devise = useDevise();
  const [solde, setSolde] = useState<number | null>(null);
  const [mouvements, setMouvements] = useState<MouvementCaisseResume[]>([]);
  const [transferts, setTransferts] = useState<TransfertCaisseResume[]>([]);
  const [clotures, setClotures] = useState<ClotureCaisseResume[]>([]);
  const [modaleOuverte, setModaleOuverte] = useState<
    CategorieActionCaisse | "historique" | "transfert" | "historiqueTransfert" | "cloture" | null
  >(null);
  const [soldesMobileMoney, setSoldesMobileMoney] = useState<Record<OperateurMobileMoney, number> | null>(null);
  const [selection, setSelection] = useState<"caisse" | OperateurMobileMoney>("caisse");

  async function rafraichirSoldesMobileMoney() {
    const paires = await Promise.all(
      OPERATEURS_MOBILE_MONEY.map((o) =>
        soldeMobileMoneyDisponible(session.boutiqueId, session.utilisateurId, o.valeur).then(
          (montant) => [o.valeur, montant] as const,
        ),
      ),
    );
    setSoldesMobileMoney(Object.fromEntries(paires) as Record<OperateurMobileMoney, number>);
  }

  async function rafraichir() {
    if (!depotId) return;
    setSolde(await soldeCaisse(depotId));
    setMouvements(await listerMouvements(depotId, 200));
    setTransferts(await listerTransferts(depotId, 200));
    setClotures(await listerClotures(depotId, 60));
  }
  useEffect(() => {
    rafraichir();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [depotId]);

  // Toujours crédité à celui qui vend (jamais une ligne partagée, voir
  // tresorerie/services.py) : ce solde dépend de l'utilisateur connecté, pas
  // du dépôt affiché — indépendant de depotId.
  useEffect(() => {
    rafraichirSoldesMobileMoney();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.boutiqueId, session.utilisateurId]);

  const mouvementsParCategorie: Record<CategorieActionCaisse, MouvementCaisseResume[]> = {
    retrait: mouvements.filter((m) => m.categorie === "retrait"),
    apport: mouvements.filter((m) => m.categorie === "apport"),
    ajustement: mouvements.filter((m) => m.categorie === "ajustement"),
  };

  const itemsSolde: { cle: "caisse" | OperateurMobileMoney; label: string; valeur: number | null; alerte: boolean }[] =
    [
      { cle: "caisse", label: "Solde de caisse", valeur: solde, alerte: (solde ?? 0) < 0 },
      ...OPERATEURS_MOBILE_MONEY.map((o) => ({
        cle: o.valeur as "caisse" | OperateurMobileMoney,
        label: o.label,
        valeur: soldesMobileMoney ? soldesMobileMoney[o.valeur] : null,
        alerte: false,
      })),
    ];
  const itemSelectionne = itemsSolde.find((i) => i.cle === selection)!;
  const autresItems = itemsSolde.filter((i) => i.cle !== selection);

  return (
    <div className="onglet-solde">
      <div className="disposition-solde">
        <div className="detail-solde">
          <div className="carte-stat carte-stat-solde-principal">
            {selection === "caisse" && peutGererTresorerie && depotId && (
              <button type="button" className="bouton-cloture-coin" onClick={() => setModaleOuverte("cloture")}>
                Clôturer la caisse
              </button>
            )}
            <span className="carte-stat-label">{itemSelectionne.label}</span>
            <span className={`carte-stat-valeur ${itemSelectionne.alerte ? "carte-stat-alerte" : ""}`}>
              {itemSelectionne.valeur !== null ? `${formaterMontant(itemSelectionne.valeur)} ${devise}` : "…"}
            </span>
          </div>

          {selection !== "caisse" && depotId && (
            <div className="grille-documents-comptables">
              <button type="button" className="carte-document-comptable" onClick={() => setModaleOuverte("transfert")}>
                <span className="icone-document-comptable">🔁</span>
                Transfert
              </button>
              <button
                type="button"
                className="carte-document-comptable"
                onClick={() => setModaleOuverte("historiqueTransfert")}
              >
                <span className="icone-document-comptable">🕘</span>
                Historique
              </button>
            </div>
          )}

          {selection === "caisse" && depotId && (
            <div className="grille-documents-comptables">
              {peutGererTresorerie &&
                (Object.keys(SECTIONS_ACTION_CAISSE) as CategorieActionCaisse[]).map((categorie) => (
                  <button
                    key={categorie}
                    type="button"
                    className="carte-document-comptable"
                    onClick={() => setModaleOuverte(categorie)}
                  >
                    <span className="icone-document-comptable">{SECTIONS_ACTION_CAISSE[categorie].icone}</span>
                    {SECTIONS_ACTION_CAISSE[categorie].bouton}
                  </button>
                ))}
              <button
                type="button"
                className="carte-document-comptable"
                onClick={() => setModaleOuverte("historique")}
              >
                <span className="icone-document-comptable">🕘</span>
                Historique
              </button>
            </div>
          )}
        </div>

        <div className="menu-solde">
          {autresItems.map((item) => (
            <button
              key={item.cle}
              type="button"
              className="carte-stat menu-solde-item"
              onClick={() => setSelection(item.cle)}
            >
              <span className="carte-stat-label">{item.label}</span>
              <span className="carte-stat-valeur">
                {item.valeur !== null ? `${formaterMontant(item.valeur)} ${devise}` : "…"}
              </span>
            </button>
          ))}
        </div>
      </div>

      {modaleOuverte === "historique" && (
        <ModaleHistoriqueSolde
          mouvements={mouvements}
          devise={devise}
          nomUtilisateur={nomUtilisateur}
          onFermer={() => setModaleOuverte(null)}
        />
      )}

      {modaleOuverte === "transfert" && selection !== "caisse" && (
        <ModaleTransfertMobileMoney
          operateur={selection}
          disponible={soldesMobileMoney ? soldesMobileMoney[selection] : 0}
          devise={devise}
          onAnnuler={() => setModaleOuverte(null)}
          onValider={async (montant) => {
            await effectuerTransfert({
              boutiqueId: session.boutiqueId,
              depotId,
              utilisateurSourceId: session.utilisateurId,
              operateur: selection,
              montant,
              utilisateurId: session.utilisateurId,
            });
            setModaleOuverte(null);
            await rafraichir();
            await rafraichirSoldesMobileMoney();
          }}
        />
      )}

      {modaleOuverte === "historiqueTransfert" && selection !== "caisse" && (
        <ModaleHistoriqueTransferts
          operateur={selection}
          transferts={transferts.filter((t) => t.operateur === selection)}
          devise={devise}
          nomUtilisateur={nomUtilisateur}
          onFermer={() => setModaleOuverte(null)}
        />
      )}

      {modaleOuverte === "cloture" && (
        <ModaleClotureCaisse
          soldeActuel={solde}
          clotures={clotures}
          devise={devise}
          nomUtilisateur={nomUtilisateur}
          onAnnuler={() => setModaleOuverte(null)}
          onValider={async (soldeCompte) => {
            await cloturerCaisse(depotId, soldeCompte, session.utilisateurId);
            setModaleOuverte(null);
            await rafraichir();
          }}
        />
      )}

      {modaleOuverte === "retrait" && (
        <ModaleMouvementCategorie
          titre={SECTIONS_ACTION_CAISSE.retrait.modaleTitre}
          historiqueTitre={SECTIONS_ACTION_CAISSE.retrait.historiqueTitre}
          libelleVide={SECTIONS_ACTION_CAISSE.retrait.vide}
          mouvements={mouvementsParCategorie.retrait}
          devise={devise}
          nomUtilisateur={nomUtilisateur}
          onAnnuler={() => setModaleOuverte(null)}
          onValider={async (montant, motif) => {
            await effectuerRetrait(depotId, montant, motif, session.utilisateurId);
            setModaleOuverte(null);
            await rafraichir();
          }}
        />
      )}
      {modaleOuverte === "apport" && (
        <ModaleMouvementCategorie
          titre={SECTIONS_ACTION_CAISSE.apport.modaleTitre}
          historiqueTitre={SECTIONS_ACTION_CAISSE.apport.historiqueTitre}
          libelleVide={SECTIONS_ACTION_CAISSE.apport.vide}
          mouvements={mouvementsParCategorie.apport}
          devise={devise}
          nomUtilisateur={nomUtilisateur}
          onAnnuler={() => setModaleOuverte(null)}
          onValider={async (montant, motif) => {
            await enregistrerApport(depotId, montant, motif, session.utilisateurId);
            setModaleOuverte(null);
            await rafraichir();
          }}
        />
      )}
      {modaleOuverte === "ajustement" && (
        <ModaleMouvementCategorie
          titre={SECTIONS_ACTION_CAISSE.ajustement.modaleTitre}
          historiqueTitre={SECTIONS_ACTION_CAISSE.ajustement.historiqueTitre}
          libelleVide={SECTIONS_ACTION_CAISSE.ajustement.vide}
          mouvements={mouvementsParCategorie.ajustement}
          devise={devise}
          nomUtilisateur={nomUtilisateur}
          motifRequis
          montantSigne
          onAnnuler={() => setModaleOuverte(null)}
          onValider={async (montant, motif) => {
            await ajusterCaisse(depotId, montant, motif, session.utilisateurId);
            setModaleOuverte(null);
            await rafraichir();
          }}
        />
      )}
    </div>
  );
}

// --- Clôture de caisse, depuis l'onglet Solde ---

function ModaleClotureCaisse({
  soldeActuel,
  clotures,
  devise,
  nomUtilisateur,
  onAnnuler,
  onValider,
}: {
  soldeActuel: number | null;
  clotures: ClotureCaisseResume[];
  devise: string;
  nomUtilisateur: (id: string | null) => string;
  onAnnuler: () => void;
  onValider: (soldeCompte: number) => Promise<void>;
}) {
  const [soldeCompte, setSoldeCompte] = useState("");
  const [erreur, setErreur] = useState<string | null>(null);
  const [enCours, setEnCours] = useState(false);

  async function valider(evenement: React.FormEvent) {
    evenement.preventDefault();
    setErreur(null);
    setEnCours(true);
    try {
      await onValider(Number(soldeCompte) || 0);
    } catch (e) {
      setErreur(e instanceof ErreurTresorerie ? e.message : "Erreur inattendue.");
    } finally {
      setEnCours(false);
    }
  }

  return (
    <div className="fond-modale" onClick={onAnnuler}>
      <div className="modale-selection-produits" onClick={(e) => e.stopPropagation()}>
        <form onSubmit={valider} className="formulaire-mouvement-caisse-modale">
          <div className="modale-entete">
            <h3>Clôture de caisse</h3>
            <button type="button" className="lien bouton-retour" onClick={onAnnuler} disabled={enCours}>
              ← Retour
            </button>
          </div>
          <div className="modale-corps">
            {erreur && <div className="message-erreur">{erreur}</div>}
            <p className="note-aide">
              Solde théorique actuel : {soldeActuel !== null ? `${formaterMontant(soldeActuel)} ${devise}` : "…"}
            </p>
            <div className="ligne-champs-tresorerie">
              <label>
                Montant réellement compté
                <ChampMontant value={soldeCompte} onChange={setSoldeCompte} autoFocus />
              </label>
              <button type="submit" className="bouton-primaire" disabled={enCours}>
                {enCours ? "…" : "Clôturer"}
              </button>
            </div>

            <h4>Historique des clôtures</h4>
            <div className="zone-tableau-scroll">
              <table className="tableau-catalogue carte-mobile">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Solde théorique</th>
                    <th>Solde compté</th>
                    <th>Écart</th>
                    <th>Effectué par</th>
                  </tr>
                </thead>
                <tbody>
                  {clotures.map((c) => (
                    <tr key={c.id}>
                      <td data-label="Date">{new Date(c.dateCreation).toLocaleString("fr-FR")}</td>
                      <td data-label="Solde théorique">
                        {formaterMontant(c.soldeTheorique)} {devise}
                      </td>
                      <td data-label="Solde compté">
                        {formaterMontant(c.soldeCompte)} {devise}
                      </td>
                      <td data-label="Écart" className={c.ecart !== 0 ? "carte-stat-alerte" : undefined}>
                        {c.ecart > 0 ? "+" : ""}
                        {formaterMontant(c.ecart)} {devise}
                      </td>
                      <td data-label="Effectué par">{nomUtilisateur(c.utilisateurId)}</td>
                    </tr>
                  ))}
                  {clotures.length === 0 && (
                    <tr>
                      <td colSpan={5} className="liste-vide-compacte">
                        Aucune clôture enregistrée.
                      </td>
                    </tr>
                  )}
                  {Array.from({ length: Math.max(0, 12 - clotures.length - (clotures.length === 0 ? 1 : 0)) }).map(
                    (_, i) => (
                      <tr key={`vide-${i}`} className="ligne-groupe-vide">
                        <td>&nbsp;</td>
                        <td>&nbsp;</td>
                        <td>&nbsp;</td>
                        <td>&nbsp;</td>
                        <td>&nbsp;</td>
                      </tr>
                    ),
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}

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

export default function Tresorerie({ session }: { session: Session }) {
  const peutGererTresorerie = !!session.permissions.gerer_tresorerie;
  const [depots, setDepots] = useState<DepotResume[]>([]);
  const [depotId, setDepotId] = useState(session.depotId ?? "");
  const [utilisateurs, setUtilisateurs] = useState<UtilisateurResume[]>([]);

  // session.depotId peut se rafraîchir après le montage (retour de
  // rafraichirPermissions lancé en tâche de fond au démarrage, ou dépôt de
  // vente modifié dans Informations boutique) : l'état local doit le suivre,
  // pas seulement s'initialiser une fois au montage.
  useEffect(() => {
    if (session.depotId) setDepotId(session.depotId);
  }, [session.depotId]);

  useEffect(() => {
    if (!session.depotId || peutGererTresorerie) {
      listerDepotsDetail(session.boutiqueId).then((liste) => {
        setDepots(liste);
        // Sans dépôt assigné (Patron/Gérant, voir Réglages), le sélecteur
        // partait vide par défaut — même repli silencieux que Caisse.tsx :
        // premier dépôt de la boutique, modifiable ensuite via le sélecteur.
        if (!session.depotId && liste[0]) setDepotId(liste[0].id);
      });
      // Plusieurs caissières peuvent partager le même dépôt : on résout leur
      // nom pour tracer qui a réellement agi sur la caisse (voir creerResolveurNom).
      api.comptes.listerUtilisateurs().then((resultat) => {
        if (resultat.succes) setUtilisateurs(resultat.resultat);
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const nomUtilisateur = creerResolveurNom(utilisateurs, session.utilisateurId);

  return (
    <div className="page-produits page-tresorerie page-accueil">
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
      <div className="barre-actions barre-actions-avec-onglets">
        <SelecteurDepot
          session={session}
          peutChangerDepot={peutGererTresorerie}
          depots={depots}
          depotId={depotId}
          setDepotId={setDepotId}
        />
      </div>
      <div className="contenu-onglet">
        <OngletHistorique
          session={session}
          depotId={depotId}
          peutGererTresorerie={peutGererTresorerie}
          nomUtilisateur={nomUtilisateur}
        />
      </div>
    </div>
  );
}
