import { useEffect, useState } from "react";
import { OPERATEURS_MOBILE_MONEY } from "../lib/libelles";
import type { CSSProperties } from "react";

import type { Session } from "../api";
import ChampMontant from "../components/ChampMontant";
import ModaleConfirmation from "../components/ModaleConfirmation";
import { useDevise } from "../contexts/DeviseContext";
import { formaterMontant } from "../lib/formatage";
import {
  creerCommande,
  creerFournisseur,
  ErreurAchat,
  listerCommandes,
  listerDettes,
  montantRembourseDettesDepuis,
  listerFournisseurs,
  modifierFournisseur,
  supprimerFournisseur,
  listerPaiementsDette,
  annulerPaiementDette,
  echeancierDette,
  planifierEcheancier,
  type EcheanceDetail,
  annulerReception,
  historiqueAchats,
  suiviCommande,
  type EtapeCommande,
  listerReceptionsCommande,
  modifierCommande,
  obtenirCommande,
  obtenirDerniersFournisseurs,
  payerDette,
  receptionnerCommande,
  rechercherVariantesAchat,
  retournerAuFournisseur,
  type CommandeDetail,
  type CommandeResume,
  type DetteResume,
  type FournisseurResume,
  type PaiementDetteDetail,
  type ReceptionDetail,
  type HistoriqueAchats,
  type PaiementFournisseurHistorique,
  type ReceptionHistorique,
  type StatutCommande,
  type StatutDette,
  type VarianteAchat,
} from "../services/achats";
import { libelleModeReglement, MODES_REGLEMENT } from "../lib/libelles";
import { creerProduit, ErreurProduit, obtenirProduit } from "../services/produits";
import { listerDepotsDetail, type DepotResume, type LigneAchatInitiale } from "../services/stock";
import { useNomsUtilisateurs } from "../hooks/useNomsUtilisateurs";
import BoutonsExport from "../components/BoutonsExport";
import { PanneauCompte } from "../components/CompteTiers";
import type { ColonneExport } from "../lib/export";
import ModaleEcheancier from "../components/ModaleEcheancier";
import FiltrePeriodeHistorique from "../components/FiltrePeriodeHistorique";
import { bornesPeriode, dansPeriode, jourLocal, type PeriodeHistorique } from "../lib/periode";

/**
 * Port de client-electron/src/pages/Achats.tsx, local d'abord (IndexedDB, voir
 * services/achats.ts), comme le reste de l'application. Accès réservé aux
 * comptes ayant la permission gerer_produits_stock_achats.
 *
 * Raccourci "Commander" groupé depuis une rupture de stock (2026-08-22,
 * parité Electron) : ApercuCommandesGroupees + lignesInitiales/
 * ouvrirFormulaireInitial, alimentés par Shell.tsx depuis Stock.tsx.
 */

function libelleStatutCommande(statut: StatutCommande): string {
  if (statut === "brouillon") return "Brouillon";
  if (statut === "commandee") return "Commandée";
  if (statut === "recue") return "Reçue";
  return "Annulée";
}

/** "Partiellement reçue" n'est pas un statut stocké : une commande encore
 * "commandee" dont une partie a déjà été livrée (voir receptionnerCommande). */
function BadgeStatutCommande({ statut, partiellementRecue }: { statut: StatutCommande; partiellementRecue: boolean }) {
  if (statut === "commandee" && partiellementRecue) {
    return <span className="badge-partielle">Partiellement reçue</span>;
  }
  return <span className={`badge-${statut}`}>{libelleStatutCommande(statut)}</span>;
}

interface LigneSaisie {
  varianteId: string;
  produitNom: string;
  reference: string;
  quantite: number;
  prixAchat: number;
}

function FormulaireCommande({
  session,
  fournisseurs,
  commandeAModifier,
  fournisseurInitialId,
  onAnnuler,
  onCree,
}: {
  session: Session;
  fournisseurs: FournisseurResume[];
  commandeAModifier?: { id: string; fournisseurId: string; lignes: LigneSaisie[] };
  /** Fournisseur déjà choisi (nouvelle commande depuis la fiche d'un fournisseur). */
  fournisseurInitialId?: string;
  onAnnuler: () => void;
  onCree: () => void;
}) {
  const devise = useDevise();
  const [fournisseurId, setFournisseurId] = useState(
    commandeAModifier?.fournisseurId ?? fournisseurInitialId ?? fournisseurs[0]?.id ?? "",
  );
  const [terme, setTerme] = useState("");
  const [resultats, setResultats] = useState<VarianteAchat[]>([]);
  const [dropdownOuvert, setDropdownOuvert] = useState(false);
  const [lignes, setLignes] = useState<LigneSaisie[]>(commandeAModifier?.lignes ?? []);
  const [erreur, setErreur] = useState<string | null>(null);
  const [enCours, setEnCours] = useState(false);

  useEffect(() => {
    if (!terme.trim()) {
      setResultats([]);
      return;
    }
    const identifiant = setTimeout(() => {
      rechercherVariantesAchat(session.boutiqueId, terme.trim()).then(setResultats);
    }, 200);
    return () => clearTimeout(identifiant);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [terme]);

  function ajouterLigne(variante: VarianteAchat) {
    setLignes((actuel) => {
      if (actuel.some((l) => l.varianteId === variante.id)) return actuel;
      return [
        ...actuel,
        { varianteId: variante.id, produitNom: variante.produitNom, reference: variante.reference, quantite: 1, prixAchat: variante.prixAchat },
      ];
    });
    setTerme("");
    setResultats([]);
  }

  async function ajouterNouveauProduit() {
    const nom = terme.trim();
    if (!nom) return;
    try {
      const cree = await creerProduit({ boutiqueId: session.boutiqueId, nom, prixAchat: 0, prixVente: 0 });
      const produit = await obtenirProduit(cree.id);
      const reference = produit?.variantes[0]?.reference ?? "";
      setLignes((actuel) => [...actuel, { varianteId: cree.varianteId, produitNom: nom, reference, quantite: 1, prixAchat: 0 }]);
      setTerme("");
      setResultats([]);
    } catch (e) {
      setErreur(e instanceof ErreurProduit ? e.message : "Erreur inattendue.");
    }
  }

  function modifierLigne(varianteId: string, champs: Partial<LigneSaisie>) {
    setLignes((actuel) => actuel.map((l) => (l.varianteId === varianteId ? { ...l, ...champs } : l)));
  }

  function retirerLigne(varianteId: string) {
    setLignes((actuel) => actuel.filter((l) => l.varianteId !== varianteId));
  }

  const total = lignes.reduce((somme, l) => somme + Math.round(l.quantite * l.prixAchat), 0);

  async function soumettre(statut: StatutCommande) {
    setErreur(null);
    if (!fournisseurId) {
      setErreur("Choisissez un fournisseur.");
      return;
    }
    if (lignes.length === 0) {
      setErreur("Ajoutez au moins une ligne.");
      return;
    }
    setEnCours(true);
    try {
      const lignesPayload = lignes.map((l) => ({ varianteId: l.varianteId, quantite: l.quantite, prixAchat: l.prixAchat }));
      if (commandeAModifier) {
        await modifierCommande(commandeAModifier.id, { fournisseurId, statut, lignes: lignesPayload , utilisateurId: session.utilisateurId });
      } else {
        await creerCommande({
          boutiqueId: session.boutiqueId,
          fournisseurId,
          utilisateurId: session.utilisateurId,
          statut,
          lignes: lignesPayload,
        });
      }
      onCree();
    } catch (e) {
      setErreur(e instanceof ErreurAchat ? e.message : "Erreur inattendue.");
    } finally {
      setEnCours(false);
    }
  }

  return (
    <div className="formulaire-mouvement-groupe">
      <div className="modale-entete entete-fixe">
        <h3>{commandeAModifier ? "Modifier la commande" : "Nouvelle commande"}</h3>
        <div className="actions-formulaire">
          <button type="button" onClick={() => soumettre("brouillon")} disabled={enCours}>
            {enCours ? "Enregistrement…" : "Enregistrer en brouillon"}
          </button>
          <button type="button" className="bouton-primaire" onClick={() => soumettre("commandee")} disabled={enCours}>
            {enCours ? "Enregistrement…" : commandeAModifier ? "Enregistrer et commander" : "Créer et commander"}
          </button>
          <button type="button" className="lien bouton-retour" onClick={onAnnuler}>
            ← Retour
          </button>
        </div>
      </div>
      {erreur && <div className="message-erreur">{erreur}</div>}

      <div className="colonnes-mouvement-groupe">
        <div className="colonne-recherche-groupe">
          <div className="ligne-champs-recherche-commande">
            <label>
              Fournisseur
              <select value={fournisseurId} onChange={(e) => setFournisseurId(e.target.value)}>
                {fournisseurs.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.nom}
                  </option>
                ))}
              </select>
            </label>

            <div className="recherche-commande-combobox">
              <input
                placeholder="Rechercher un article à commander…"
                value={terme}
                onChange={(e) => setTerme(e.target.value)}
                onFocus={() => setDropdownOuvert(true)}
                onBlur={() => setDropdownOuvert(false)}
              />
              {terme.trim() && dropdownOuvert && (
                <ul className="resultats-recherche">
                  {resultats
                    .filter((v) => !lignes.some((l) => l.varianteId === v.id))
                    .map((v) => (
                      <li
                        key={v.id}
                        onMouseDown={(e) => {
                          e.preventDefault();
                          ajouterLigne(v);
                        }}
                      >
                        <span>{v.produitNom}</span>
                      </li>
                    ))}
                  {resultats.length === 0 && (
                    <li
                      className="client-suggestion-ajout"
                      onMouseDown={(e) => {
                        e.preventDefault();
                        ajouterNouveauProduit();
                      }}
                    >
                      + Ajouter « {terme.trim()} » comme nouvel article
                    </li>
                  )}
                </ul>
              )}
            </div>
            <div className="total-net total-net-commande">
              Total : <span className="montant-total-commande">{formaterMontant(total)} {devise}</span>
            </div>
          </div>
        </div>

        <div className="colonne-lignes-groupe">
          <div className="lignes-groupe-scrollable">
            <table className="tableau-catalogue carte-mobile">
              <thead>
                <tr>
                  <th>N°</th>
                  <th>Référence</th>
                  <th>Désignation</th>
                  <th>Qté</th>
                  <th>Prix d'achat</th>
                  <th className="colonne-sous-total">Sous-total</th>
                  <th className="colonne-actions-variante" />
                </tr>
              </thead>
              <tbody>
                {lignes.map((l, index) => (
                  <tr key={l.varianteId}>
                    <td data-label="N°">{index + 1}</td>
                    <td data-label="Référence">{l.reference || ""}</td>
                    <td data-label="Désignation">{l.produitNom}</td>
                    <td data-label="Qté">
                      <input
                        type="number"
                        min={0.01}
                        step="any"
                        value={l.quantite}
                        onChange={(e) => modifierLigne(l.varianteId, { quantite: Number(e.target.value) })}
                      />
                    </td>
                    <td data-label="Prix d'achat">
                      <ChampMontant value={String(l.prixAchat)} onChange={(valeur) => modifierLigne(l.varianteId, { prixAchat: Number(valeur) || 0 })} />
                    </td>
                    <td data-label="Sous-total" className="colonne-sous-total">{formaterMontant(Math.round(l.quantite * l.prixAchat))}</td>
                    <td className="colonne-actions-variante">
                      <button type="button" className="bouton-retirer-ligne-groupe" title="Retirer de la liste" onClick={() => retirerLigne(l.varianteId)}>
                        ✕
                      </button>
                    </td>
                  </tr>
                ))}
                {/* Lignes vides pour que le tableau soit déjà tracé (grille visible,
                    au moins 10 lignes) avant même la première ligne ajoutée. */}
                {Array.from({ length: Math.max(0, 10 - lignes.length) }).map((_, i) => (
                  <tr key={`vide-${i}`} className="ligne-groupe-vide">
                    <td>&nbsp;</td>
                    <td>&nbsp;</td>
                    <td>&nbsp;</td>
                    <td>&nbsp;</td>
                    <td>&nbsp;</td>
                    <td className="colonne-sous-total">&nbsp;</td>
                    <td className="colonne-actions-variante">&nbsp;</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}

// --- Aperçu de commandes groupées (raccourci "Commander" depuis une/des rupture(s)) ---

interface LigneApercu {
  varianteId: string;
  produitNom: string;
  depotId: string;
  depotNom: string;
  quantite: number;
  prixAchat: number;
  fournisseurId: string;
}

function ApercuCommandesGroupees({
  session,
  lignes,
  fournisseurs,
  onAnnuler,
  onCreees,
}: {
  session: Session;
  lignes: LigneAchatInitiale[];
  fournisseurs: FournisseurResume[];
  onAnnuler: () => void;
  onCreees: () => void;
}) {
  const [lignesEditees, setLignesEditees] = useState<LigneApercu[] | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [enCours, setEnCours] = useState(false);

  useEffect(() => {
    obtenirDerniersFournisseurs(
      session.boutiqueId,
      lignes.map((l) => l.varianteId),
    ).then((derniers) => {
      setLignesEditees(
        lignes.map((l) => ({
          varianteId: l.varianteId,
          produitNom: l.produitNom,
          depotId: l.depotId,
          depotNom: l.depotNom,
          quantite: 1,
          prixAchat: l.prixAchat,
          fournisseurId: derniers[l.varianteId]?.id ?? "",
        })),
      );
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.boutiqueId]);

  function modifierLigne(varianteId: string, champs: Partial<LigneApercu>) {
    setLignesEditees((actuel) => (actuel ?? []).map((l) => (l.varianteId === varianteId ? { ...l, ...champs } : l)));
  }

  function retirerLigne(varianteId: string) {
    setLignesEditees((actuel) => (actuel ?? []).filter((l) => l.varianteId !== varianteId));
  }

  if (lignesEditees === null) return <p>Chargement…</p>;

  // Regroupement (dépôt, fournisseur) : une commande par groupe, recalculé à
  // chaque modification (ex. changement de fournisseur sur une ligne).
  const groupes = new Map<string, { depotNom: string; fournisseurId: string; lignes: LigneApercu[] }>();
  for (const ligne of lignesEditees) {
    const cle = `${ligne.depotId}::${ligne.fournisseurId}`;
    const groupe = groupes.get(cle);
    if (groupe) groupe.lignes.push(ligne);
    else groupes.set(cle, { depotNom: ligne.depotNom, fournisseurId: ligne.fournisseurId, lignes: [ligne] });
  }

  async function creerLesCommandes() {
    setErreur(null);
    if (lignesEditees === null || lignesEditees.length === 0) {
      setErreur("Aucun article à commander.");
      return;
    }
    if (lignesEditees.some((l) => !l.fournisseurId)) {
      setErreur("Choisissez un fournisseur pour chaque article avant de créer les commandes.");
      return;
    }
    setEnCours(true);
    try {
      for (const groupe of groupes.values()) {
        try {
          await creerCommande({
            boutiqueId: session.boutiqueId,
            fournisseurId: groupe.fournisseurId,
            utilisateurId: session.utilisateurId,
            statut: "brouillon",
            lignes: groupe.lignes.map((l) => ({ varianteId: l.varianteId, quantite: l.quantite, prixAchat: l.prixAchat })),
          });
        } catch (e) {
          setErreur(e instanceof ErreurAchat ? e.message : "Erreur inattendue.");
          return;
        }
      }
      onCreees();
    } finally {
      setEnCours(false);
    }
  }

  return (
    <div className="detail-produit">
      <div className="entete-detail entete-fixe">
        <h3>Commander les produits en rupture ({lignesEditees.length})</h3>
        <div className="actions-formulaire">
          <button type="button" onClick={onAnnuler}>
            Annuler
          </button>
          <button
            type="button"
            className="bouton-primaire"
            onClick={creerLesCommandes}
            disabled={enCours || lignesEditees.length === 0}
          >
            {enCours ? "Création…" : `Créer les commandes (${groupes.size})`}
          </button>
        </div>
      </div>
      {erreur && <div className="message-erreur">{erreur}</div>}

      <div className="zone-tableau-scroll">
        <table className="tableau-catalogue carte-mobile">
          <thead>
            <tr>
              <th>Désignation</th>
              <th>Dépôt</th>
              <th>Qté</th>
              <th>Prix d'achat</th>
              <th>Fournisseur</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {lignesEditees.map((l) => (
              <tr key={l.varianteId}>
                <td data-label="Désignation">{l.produitNom}</td>
                <td data-label="Dépôt">{l.depotNom}</td>
                <td data-label="Qté">
                  <input
                    type="number"
                    min={0.01}
                    step="any"
                    value={l.quantite}
                    onChange={(e) => modifierLigne(l.varianteId, { quantite: Number(e.target.value) })}
                  />
                </td>
                <td data-label="Prix d'achat">
                  <ChampMontant
                    value={String(l.prixAchat)}
                    onChange={(valeur) => modifierLigne(l.varianteId, { prixAchat: Number(valeur) || 0 })}
                  />
                </td>
                <td data-label="Fournisseur">
                  <select value={l.fournisseurId} onChange={(e) => modifierLigne(l.varianteId, { fournisseurId: e.target.value })}>
                    <option value="">À choisir…</option>
                    {fournisseurs.map((f) => (
                      <option key={f.id} value={f.id}>
                        {f.nom}
                      </option>
                    ))}
                  </select>
                </td>
                <td>
                  <button
                    type="button"
                    className="bouton-retirer-ligne-groupe"
                    title="Retirer de la liste"
                    onClick={() => retirerLigne(l.varianteId)}
                  >
                    ✕
                  </button>
                </td>
              </tr>
            ))}
            {Array.from({ length: Math.max(0, 10 - lignesEditees.length) }).map((_, i) => (
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
        </table>
      </div>
    </div>
  );
}

/** Animation de confirmation après une réception : coche qui se dessine puis
 * fermeture automatique (un clic ferme tout de suite). */
function ConfirmationReception({
  quantiteRecue,
  quantiteRestante,
  onTerminee,
}: {
  quantiteRecue: number;
  quantiteRestante: number;
  onTerminee: () => void;
}) {
  useEffect(() => {
    const minuterie = setTimeout(onTerminee, 1800);
    return () => clearTimeout(minuterie);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="fond-confirmation-reception" onClick={onTerminee}>
      <div className="carte-confirmation-reception" role="status">
        <svg className="coche-reception" viewBox="0 0 52 52" aria-hidden="true">
          <circle className="coche-reception-cercle" cx="26" cy="26" r="24" />
          <path className="coche-reception-trait" d="M15 27 l7 7 l15 -16" />
        </svg>
        <h3>Réception enregistrée</h3>
        <p>
          {quantiteRecue} article{quantiteRecue > 1 ? "s" : ""} entré{quantiteRecue > 1 ? "s" : ""} en stock
        </p>
        <p className="sous-info">
          {quantiteRestante > 0
            ? `Reste ${quantiteRestante} à réceptionner`
            : "Commande entièrement reçue"}
        </p>
      </div>
    </div>
  );
}

const LIBELLES_ETAPE: Record<string, string> = {
  creee: "📝 Créée",
  modifiee: "✏️ Modifiée",
  commandee: "📨 Passée en commandée",
  reception: "📥 Réception",
  reception_annulee: "⛔ Réception annulée",
  retour: "↩️ Retour fournisseur",
  paiement: "💰 Paiement",
  paiement_annule: "🚫 Paiement annulé",
  annulee: "❌ Commande annulée",
};

function DetailCommande({
  commandeId,
  session,
  fournisseurs,
  ouvrirReceptionInitial,
  onRetour,
}: {
  commandeId: string;
  session: Session;
  fournisseurs: FournisseurResume[];
  ouvrirReceptionInitial?: boolean;
  onRetour: () => void;
}) {
  const peutGerer = !!session.permissions.gerer_produits_stock_achats;
  const nomUtilisateur = useNomsUtilisateurs(session);
  const devise = useDevise();
  const [commande, setCommande] = useState<CommandeDetail | null>(null);
  const [depots, setDepots] = useState<DepotResume[]>([]);
  const [depotId, setDepotId] = useState("");
  const [montantDejaPaye, setMontantDejaPaye] = useState("0");
  const [modePaiementReception, setModePaiementReception] = useState<"especes" | "mobile_money" | "banque">("especes");
  const [operateurReception, setOperateurReception] = useState("orange_money");
  const [afficherReception, setAfficherReception] = useState(false);
  const [receptionReussie, setReceptionReussie] = useState<{ quantiteRecue: number; quantiteRestante: number } | null>(
    null,
  );
  const [afficherDetailCommande, setAfficherDetailCommande] = useState(false);
  const [prixVentes, setPrixVentes] = useState<Record<string, string>>({});
  const [quantitesRecevoir, setQuantitesRecevoir] = useState<Record<string, string>>({});
  const [erreur, setErreur] = useState<string | null>(null);
  const [enCours, setEnCours] = useState(false);
  const [afficherHistorique, setAfficherHistorique] = useState(false);
  const [sectionHistorique, setSectionHistorique] = useState<"suivi" | "receptions" | "paiements">("suivi");
  const [suivi, setSuivi] = useState<EtapeCommande[]>([]);
  const [receptions, setReceptions] = useState<ReceptionDetail[]>([]);
  const [receptionSelectionnee, setReceptionSelectionnee] = useState<ReceptionDetail | null>(null);
  const [dettesCommande, setDettesCommande] = useState<(DetteResume & { paiements: PaiementDetteDetail[] })[]>([]);
  const [afficherModification, setAfficherModification] = useState(false);
  const [afficherConfirmationAnnulation, setAfficherConfirmationAnnulation] = useState(false);

  async function rafraichir() {
    const resultat = await obtenirCommande(commandeId);
    if (resultat) setCommande(resultat);
  }
  useEffect(() => {
    rafraichir();
    listerDepotsDetail(session.boutiqueId).then((liste) => {
      setDepots(liste);
      if (liste[0]) setDepotId(liste[0].id);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [commandeId]);

  async function changerFournisseur(nouveauFournisseurId: string) {
    try {
      await modifierCommande(commandeId, { fournisseurId: nouveauFournisseurId , utilisateurId: session.utilisateurId });
      rafraichir();
    } catch (e) {
      setErreur(e instanceof ErreurAchat ? e.message : "Erreur inattendue.");
    }
  }

  async function passerEnCommandee() {
    try {
      await modifierCommande(commandeId, { statut: "commandee" , utilisateurId: session.utilisateurId });
      rafraichir();
    } catch (e) {
      setErreur(e instanceof ErreurAchat ? e.message : "Erreur inattendue.");
    }
  }

  async function annulerCommande() {
    setEnCours(true);
    try {
      await modifierCommande(commandeId, { statut: "annulee" , utilisateurId: session.utilisateurId });
      setAfficherConfirmationAnnulation(false);
      rafraichir();
    } catch (e) {
      setErreur(e instanceof ErreurAchat ? e.message : "Erreur inattendue.");
    } finally {
      setEnCours(false);
    }
  }

  function ouvrirReception() {
    if (commande) {
      const initialPrix: Record<string, string> = {};
      const initialQuantites: Record<string, string> = {};
      for (const ligne of commande.lignes) {
        initialPrix[ligne.varianteId] = String(ligne.prixAchat || "");
        initialQuantites[ligne.varianteId] = String(ligne.quantite - ligne.quantiteRecue);
      }
      setPrixVentes(initialPrix);
      setQuantitesRecevoir(initialQuantites);
    }
    setAfficherDetailCommande(false);
    setAfficherReception(true);
  }

  async function ouvrirHistorique() {
    if (!commande) return;
    const [receptionsResultat, dettesResultat] = await Promise.all([
      listerReceptionsCommande(commandeId),
      listerDettes(session.boutiqueId, commande.fournisseurId),
    ]);
    const dettesCommandeSeules = dettesResultat.filter((d) => d.commandeId === commandeId);
    const dettesAvecPaiements = await Promise.all(
      dettesCommandeSeules.map(async (d) => ({ ...d, paiements: await listerPaiementsDette(d.id) })),
    );
    setReceptions(receptionsResultat);
    setReceptionSelectionnee(null);
    setDettesCommande(dettesAvecPaiements);
    setSuivi(await suiviCommande(commandeId));
    setSectionHistorique("suivi");
    setAfficherHistorique(true);
  }

  // Arrivée depuis la file d'attente « Réceptionner » : la commande est déjà
  // au statut commandée, on ouvre directement le formulaire sans repasser par
  // le bouton (ne se redéclenche pas après une réception réussie, puisque le
  // statut passe alors à "recue").
  useEffect(() => {
    if (ouvrirReceptionInitial && commande?.statut === "commandee" && !afficherReception) {
      ouvrirReception();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ouvrirReceptionInitial, commande]);

  async function receptionner() {
    if (!depotId || !commande) return;
    setEnCours(true);
    setErreur(null);
    const quantiteRecue = commande.lignes.reduce(
      (somme, l) => somme + Math.max(0, Number(quantitesRecevoir[l.varianteId]) || 0),
      0,
    );
    const quantiteRestante =
      commande.lignes.reduce((somme, l) => somme + (l.quantite - l.quantiteRecue), 0) - quantiteRecue;
    try {
      await receptionnerCommande({
        commandeId,
        depotId,
        utilisateurId: session.utilisateurId,
        montantDejaPaye: Number(montantDejaPaye) || 0,
        modePaiement: (Number(montantDejaPaye) || 0) > 0 ? modePaiementReception : "",
        operateurPaiement: modePaiementReception === "mobile_money" ? operateurReception : "",
        lignes: commande.lignes
          .map((l) => ({
            varianteId: l.varianteId,
            quantite: Number(quantitesRecevoir[l.varianteId]) || 0,
            prixVente: Number(prixVentes[l.varianteId]) || 0,
          }))
          .filter((l) => l.quantite > 0),
      });
      setReceptionReussie({ quantiteRecue, quantiteRestante });
    } catch (e) {
      setErreur(e instanceof ErreurAchat ? e.message : "Erreur inattendue.");
    } finally {
      setEnCours(false);
    }
  }

  if (!commande) return <p>Chargement…</p>;
  const fournisseurModifiable = commande.statut === "brouillon";
  const peutAnnuler =
    peutGerer &&
    !afficherReception &&
    (commande.statut === "brouillon" || commande.statut === "commandee") &&
    commande.lignes.every((l) => l.quantiteRecue === 0);
  const lignesAReceptionner = commande.lignes.filter((l) => l.quantite - l.quantiteRecue > 0);
  const quantiteTotaleARecevoir = lignesAReceptionner.reduce(
    (somme, l) => somme + Math.max(0, Number(quantitesRecevoir[l.varianteId] || 0)),
    0,
  );
  const valeurARecevoir = lignesAReceptionner.reduce((somme, l) => {
    const quantiteSaisie = Number(quantitesRecevoir[l.varianteId] || 0);
    return somme + (quantiteSaisie > 0 ? quantiteSaisie * l.prixAchat : 0);
  }, 0);
  const resteAPayer = valeurARecevoir - (Number(montantDejaPaye) || 0);

  // Paiements fournisseur de la commande : ce qui a été payé sur place à
  // chaque réception (pas de dette créée si c'est tout payé) + les règlements
  // de dette faits ensuite. Le reste à payer vient des dettes (seule source
  // de vérité du solde).
  const totalRecu = receptions.reduce((somme, r) => somme + r.valeurRecue, 0);
  const paiementsCommande = [
    ...receptions
      .filter((r) => r.montantPaye > 0)
      .map((r) => ({
        id: `reception-${r.id}`,
        dateCreation: r.dateCreation,
        montant: r.montantPaye,
        mode: "",
        origine: "À la réception",
      })),
    ...dettesCommande
      .flatMap((d) => d.paiements)
      .map((p) => ({ ...p, origine: "Règlement de dette" })),
  ].sort((a, b) => a.dateCreation.localeCompare(b.dateCreation));
  const totalPaye = paiementsCommande.reduce((somme, p) => somme + p.montant, 0);
  const resteAPayerCommande = dettesCommande.reduce((somme, d) => somme + d.solde, 0);
  const receptionInvalide =
    lignesAReceptionner.every((l) => !Number(quantitesRecevoir[l.varianteId])) ||
    (Number(montantDejaPaye) || 0) > valeurARecevoir ||
    lignesAReceptionner.some((l) => {
      const restant = l.quantite - l.quantiteRecue;
      const quantiteSaisie = Number(quantitesRecevoir[l.varianteId] || 0);
      if (quantiteSaisie < 0 || quantiteSaisie > restant) return true;
      return quantiteSaisie > 0 && Number(prixVentes[l.varianteId] || 0) < l.prixAchat;
    });

  const tableauLignesCommande = (
    <>
      <div className="zone-tableau-scroll">
        <table className="tableau-catalogue carte-mobile">
          <thead>
            <tr>
              <th>N°</th>
              <th>Désignation</th>
              <th>Référence</th>
              <th>Qté</th>
              <th>Reçu</th>
              <th>Non reçu</th>
              <th>Prix d'achat</th>
              <th>Sous-total</th>
            </tr>
          </thead>
          <tbody>
            {commande.lignes.map((l, index) => (
              <tr key={l.id}>
                <td data-label="N°">{index + 1}</td>
                <td data-label="Désignation">{l.produitNom}</td>
                <td data-label="Référence">{l.reference || ""}</td>
                <td data-label="Qté">{l.quantite}</td>
                <td data-label="Reçu">{l.quantiteRecue}</td>
                <td data-label="Non reçu">{l.quantite - l.quantiteRecue}</td>
                <td data-label="Prix d'achat">{formaterMontant(l.prixAchat)}</td>
                <td data-label="Sous-total">{formaterMontant(l.sousTotal)}</td>
              </tr>
            ))}
            {Array.from({ length: Math.max(0, 10 - commande.lignes.length) }).map((_, i) => (
              <tr key={`vide-${i}`} className="ligne-groupe-vide">
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
        </table>
      </div>

      <div className="totaux">
        <div className="total-net">
          Total : {formaterMontant(commande.total)} {devise}
        </div>
      </div>
    </>
  );

  return (
    <div className="detail-produit">
      {receptionReussie && (
        <ConfirmationReception
          quantiteRecue={receptionReussie.quantiteRecue}
          quantiteRestante={receptionReussie.quantiteRestante}
          onTerminee={onRetour}
        />
      )}
      <div className="entete-detail">
        <div className="entete-detail-titre">
          <h3>Commande {commande.numero}</h3>
          <BadgeStatutCommande
            statut={commande.statut}
            partiellementRecue={commande.lignes.some((l) => l.quantiteRecue > 0)}
          />
          <span className="sous-info">
            Fournisseur :{" "}
            {peutGerer && fournisseurModifiable ? (
              <select value={commande.fournisseurId} onChange={(e) => changerFournisseur(e.target.value)}>
                {fournisseurs.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.nom}
                  </option>
                ))}
              </select>
            ) : (
              commande.fournisseurNom
            )}{" "}
            {new Date(commande.dateCreation).toLocaleString("fr-FR")}
          </span>
        </div>
        <div className="entete-detail-actions">
          {peutGerer && commande.statut === "brouillon" && !afficherReception && (
            <button type="button" onClick={() => setAfficherModification(true)}>
              Modifier
            </button>
          )}
          {peutGerer && commande.statut === "brouillon" && !afficherReception && (
            <button type="button" onClick={passerEnCommandee} disabled={enCours}>
              Passer en commandée
            </button>
          )}
          {peutGerer && commande.statut === "commandee" && !afficherReception && (
            <button type="button" className="bouton-primaire" onClick={ouvrirReception} disabled={enCours}>
              Réceptionner
            </button>
          )}
          {peutAnnuler && (
            <button
              type="button"
              className="bouton-danger"
              onClick={() => setAfficherConfirmationAnnulation(true)}
              disabled={enCours}
            >
              Annuler la commande
            </button>
          )}
          {commande.statut !== "brouillon" && (
            <button type="button" onClick={ouvrirHistorique}>
              Historique
            </button>
          )}
          <button type="button" className="lien bouton-retour" onClick={onRetour}>
            ← Retour à la liste
          </button>
        </div>
      </div>
      {erreur && <div className="message-erreur">{erreur}</div>}

      {!afficherReception && tableauLignesCommande}

      {afficherReception && afficherDetailCommande && (
        <div className="fond-modale" onClick={() => setAfficherDetailCommande(false)}>
          <div className="modale-selection-produits" onClick={(e) => e.stopPropagation()}>
            <EnteteModale titre="Détails de la commande" onFermer={() => setAfficherDetailCommande(false)} />
            <div className="modale-corps">{tableauLignesCommande}</div>
          </div>
        </div>
      )}

      {afficherModification && (
        <div className="fond-modale" onClick={() => setAfficherModification(false)}>
          <div className="modale-selection-produits" onClick={(e) => e.stopPropagation()}>
            <FormulaireCommande
              session={session}
              fournisseurs={fournisseurs}
              commandeAModifier={{
                id: commande.id,
                fournisseurId: commande.fournisseurId,
                lignes: commande.lignes.map((l) => ({
                  varianteId: l.varianteId,
                  produitNom: l.produitNom,
                  reference: l.reference,
                  quantite: l.quantite,
                  prixAchat: l.prixAchat,
                })),
              }}
              onAnnuler={() => setAfficherModification(false)}
              onCree={() => {
                setAfficherModification(false);
                rafraichir();
              }}
            />
          </div>
        </div>
      )}

      {afficherConfirmationAnnulation && (
        <ModaleConfirmation
          titre="Annuler cette commande ?"
          description="Cette action est définitive : la commande passera au statut « Annulée »."
          labelConfirmer="Annuler la commande"
          dangereux
          enCours={enCours}
          onAnnuler={() => setAfficherConfirmationAnnulation(false)}
          onConfirmer={annulerCommande}
        />
      )}

      {afficherHistorique && (
        <div className="fond-modale" onClick={() => setAfficherHistorique(false)}>
          <div className="modale-selection-produits" onClick={(e) => e.stopPropagation()}>
            <EnteteModale titre="Historique de la commande" onFermer={() => setAfficherHistorique(false)} />
            <div className="modale-avec-menu">
              <nav className="menu-modale">
                <button
                  type="button"
                  className={sectionHistorique === "suivi" ? "actif" : ""}
                  onClick={() => setSectionHistorique("suivi")}
                >
                  <span className="icone-menu-modale">🧭</span>
                  Suivi
                  <span className="compteur-menu-modale">{suivi.length}</span>
                </button>
                <button
                  type="button"
                  className={sectionHistorique === "receptions" ? "actif" : ""}
                  onClick={() => setSectionHistorique("receptions")}
                >
                  <span className="icone-menu-modale">📥</span>
                  Réceptions
                  <span className="compteur-menu-modale">{receptions.length}</span>
                </button>
                <button
                  type="button"
                  className={sectionHistorique === "paiements" ? "actif" : ""}
                  onClick={() => setSectionHistorique("paiements")}
                >
                  <span className="icone-menu-modale">💰</span>
                  Paiements fournisseur
                  <span className="compteur-menu-modale">{paiementsCommande.length}</span>
                </button>
              </nav>
              <div className="modale-corps">
                {sectionHistorique === "suivi" && (
                  <>
                    <div className="zone-tableau-scroll">
                      <table className="tableau-catalogue carte-mobile">
                        <thead>
                          <tr>
                            <th>Date</th>
                            <th>Étape</th>
                            <th>Détail</th>
                            <th>Montant</th>
                            <th>Par</th>
                          </tr>
                        </thead>
                        <tbody>
                          {suivi.map((e) => (
                            <tr key={e.id} className={`etape-${e.type}`}>
                              <td data-label="Date">{new Date(e.dateCreation).toLocaleString("fr-FR")}</td>
                              <td data-label="Étape"><span className="libelle-etape">{LIBELLES_ETAPE[e.type] ?? e.type}</span>{e.reconstitue && <span className="sous-info"> (reconstitué)</span>}</td>
                              <td data-label="Détail">{e.detail || "—"}</td>
                              <td data-label="Montant">{e.montant === null ? "—" : `${formaterMontant(e.montant)} ${devise}`}</td>
                              <td data-label="Par">{e.utilisateurId ? nomUtilisateur(e.utilisateurId) : "—"}</td>
                            </tr>
                          ))}
                          {Array.from({ length: Math.max(0, 10 - suivi.length) }).map((_, i) => (
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
                    {suivi.some((e) => e.reconstitue) && (
                      <p className="note-aide">
                        « Reconstitué » : étape retrouvée dans les réceptions, paiements et retours de cette commande,
                        passée avant la mise en place du suivi. Les changements de statut de cette période ne sont pas
                        connus.
                      </p>
                    )}
                  </>
                )}
                {sectionHistorique === "receptions" && (
                  <>
                    <h4>Réceptions</h4>
                    <div className="zone-tableau-scroll">
                      <table className="tableau-catalogue carte-mobile">
                        <thead>
                          <tr>
                            <th>Date</th>
                            <th>Dépôt</th>
                            <th>Valeur reçue</th>
                            <th>Montant payé</th>
                          </tr>
                        </thead>
                        <tbody>
                          {receptions.map((r) => (
                            <tr key={r.id} className="ligne-reception-cliquable" onClick={() => setReceptionSelectionnee(r)}>
                              <td data-label="Date">
                          {new Date(r.dateCreation).toLocaleString("fr-FR")}{" "}
                          {r.annulee && <span className="badge-brouillon">Annulée</span>}
                        </td>
                              <td data-label="Dépôt">{r.depotNom}</td>
                              <td data-label="Valeur reçue">
                                {formaterMontant(r.valeurRecue)} {devise}
                              </td>
                              <td data-label="Montant payé">
                                {formaterMontant(r.montantPaye)} {devise}
                              </td>
                            </tr>
                          ))}
                          {receptions.length === 0 && (
                            <tr>
                              <td colSpan={4} className="liste-vide">Aucune réception enregistrée.</td>
                            </tr>
                          )}
                          {Array.from({ length: Math.max(0, 10 - Math.max(1, receptions.length)) }).map((_, i) => (
                            <tr key={`vide-${i}`} className="ligne-groupe-vide">
                              <td>&nbsp;</td>
                              <td>&nbsp;</td>
                              <td>&nbsp;</td>
                              <td>&nbsp;</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </>
                )}
                {sectionHistorique === "paiements" && (
                  <>
                    <h4>Paiements fournisseur</h4>
                    <div className="totaux">
                      <div>
                        Total reçu : {formaterMontant(totalRecu)} {devise}
                      </div>
                      <div>
                        Total payé : {formaterMontant(totalPaye)} {devise}
                      </div>
                      <div className="total-net">
                        Reste à payer : {formaterMontant(resteAPayerCommande)} {devise}
                      </div>
                    </div>
                    <div className="zone-tableau-scroll">
                      <table className="tableau-catalogue carte-mobile">
                        <thead>
                          <tr>
                            <th>Date</th>
                            <th>Montant</th>
                            <th>Mode</th>
                            <th>Origine</th>
                          </tr>
                        </thead>
                        <tbody>
                          {paiementsCommande.map((p) => (
                            <tr key={p.id}>
                              <td data-label="Date">{new Date(p.dateCreation).toLocaleString("fr-FR")}</td>
                              <td data-label="Montant">
                                {formaterMontant(p.montant)} {devise}
                              </td>
                              <td data-label="Mode">{p.mode ? libelleModeReglement(p.mode) : "—"}</td>
                              <td data-label="Origine">{p.origine}</td>
                            </tr>
                          ))}
                          {paiementsCommande.length === 0 && (
                            <tr>
                              <td colSpan={4} className="liste-vide">
                                Aucun paiement enregistré.
                              </td>
                            </tr>
                          )}
                          {Array.from({ length: Math.max(0, 10 - Math.max(1, paiementsCommande.length)) }).map((_, i) => (
                            <tr key={`vide-${i}`} className="ligne-groupe-vide">
                              <td>&nbsp;</td>
                              <td>&nbsp;</td>
                              <td>&nbsp;</td>
                              <td>&nbsp;</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </>
                )}
              </div>
            </div>
              {receptionSelectionnee && (
                <ModaleDetailReception
                  session={session}
                  reception={receptionSelectionnee}
                  commandeNumero={commande.numero}
                  fournisseurNom={commande.fournisseurNom}
                  onFermer={() => setReceptionSelectionnee(null)}
                  onModifie={() => {
                    setReceptionSelectionnee(null);
                    rafraichir();
                    ouvrirHistorique();
                  }}
                />
              )}
          </div>
        </div>
      )}

      {peutGerer && afficherReception && (
        <div className="formulaire-catalogue formulaire-reception">
          <div className="entete-detail entete-fixe">
            <h4>Réception de marchandise</h4>
            <div className="entete-detail-actions">
              <label>
                Dépôt
                <select value={depotId} onChange={(e) => setDepotId(e.target.value)}>
                  {depots.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.nom}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Montant déjà payé
                <ChampMontant className="champ-montant-deja-paye" value={montantDejaPaye} onChange={setMontantDejaPaye} />
              </label>
              {Number(montantDejaPaye) > 0 && (
                <label>
                  Payé par
                  <select
                    value={modePaiementReception}
                    onChange={(e) => setModePaiementReception(e.target.value as "especes" | "mobile_money" | "banque")}
                    title="Espèces : l'argent sort de la caisse du dépôt"
                  >
                    <option value="especes">💵 Espèces (caisse)</option>
                    <option value="mobile_money">📱 Mobile Money</option>
                    <option value="banque">🏦 Banque</option>
                  </select>
                </label>
              )}
              {Number(montantDejaPaye) > 0 && modePaiementReception === "mobile_money" && (
                <label>
                  Opérateur
                  <select value={operateurReception} onChange={(e) => setOperateurReception(e.target.value)}>
                    {OPERATEURS_MOBILE_MONEY.map((o) => (
                      <option key={o.valeur} value={o.valeur}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <button type="button" onClick={() => setAfficherReception(false)}>
                Annuler
              </button>
              <button
                type="button"
                className="bouton-primaire"
                onClick={receptionner}
                disabled={enCours || receptionInvalide}
              >
                {enCours ? "Réception…" : "Confirmer la réception"}
              </button>
            </div>
          </div>

          <div className="totaux">
            <div>Quantité à recevoir : {quantiteTotaleARecevoir}</div>
            <div>Total à recevoir : {formaterMontant(valeurARecevoir)} {devise}</div>
            <div className="total-net" style={{ visibility: Number(montantDejaPaye) > 0 ? "visible" : "hidden" }}>
              Reste à payer : {formaterMontant(Math.max(0, resteAPayer))} {devise}
            </div>
          </div>

          <div className="zone-tableau-scroll">
            <table className="tableau-catalogue carte-mobile">
              <thead>
                <tr>
                  <th>N°</th>
                  <th>Référence</th>
                  <th>Désignation</th>
                  <th className="colonne-sous-total">Qté à recevoir</th>
                  <th className="colonne-sous-total">Prix d'achat</th>
                  <th className="colonne-sous-total">Prix de vente</th>
                </tr>
              </thead>
              <tbody>
                {lignesAReceptionner.map((l, index) => {
                  const restant = l.quantite - l.quantiteRecue;
                  const quantiteSaisie = Number(quantitesRecevoir[l.varianteId] || 0);
                  const quantiteInvalide = quantiteSaisie < 0 || quantiteSaisie > restant;
                  const prixInvalide = quantiteSaisie > 0 && Number(prixVentes[l.varianteId] || 0) < l.prixAchat;
                  return (
                    <tr key={l.id}>
                      <td data-label="N°">{index + 1}</td>
                      <td data-label="Référence">{l.reference || ""}</td>
                      <td data-label="Désignation">{l.produitNom}</td>
                      <td data-label="Qté à recevoir" className="colonne-sous-total">
                        <input
                          type="number"
                          min={0}
                          max={restant}
                          step="any"
                          className={quantiteInvalide ? "champ-invalide" : ""}
                          value={quantitesRecevoir[l.varianteId] ?? ""}
                          onChange={(e) =>
                            setQuantitesRecevoir((prec) => ({ ...prec, [l.varianteId]: e.target.value }))
                          }
                        />
                        <span className="sous-info"> / {restant} restant</span>
                      </td>
                      <td data-label="Prix d'achat" className="colonne-sous-total">{formaterMontant(l.prixAchat)}</td>
                      <td data-label="Prix de vente" className="colonne-sous-total">
                        <ChampMontant
                          className={`champ-prix-vente-reception ${prixInvalide ? "champ-invalide" : ""}`}
                          value={prixVentes[l.varianteId] ?? ""}
                          onChange={(valeur) => setPrixVentes((prec) => ({ ...prec, [l.varianteId]: valeur }))}
                        />
                        {prixInvalide && (
                          <span className="badge-rupture" title="Prix de vente inférieur au prix d'achat">
                            ⚠
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
                {Array.from({ length: Math.max(0, 10 - lignesAReceptionner.length) }).map((_, i) => (
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
            </table>
          </div>
        </div>
      )}

      {afficherReception && (
        <div className="lien-details-reception">
          <button type="button" className="lien" onClick={() => setAfficherDetailCommande(true)}>
            ▸ Détails de la commande
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * Ronds défilants du fond (même patron que Accueil.tsx) : tailles/vitesses/
 * délais variés, trajectoire propre à chacun (départ → arrivée en vw/vh),
 * couleur --cercle-N (index.css — cycle des teintes sémantiques par défaut,
 * réassorti à l'identité propre de certains thèmes comme Orange).
 */
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

const SECTIONS = [
  { cle: "commandes", label: "Commandes", icone: "📦" },
  { cle: "reception", label: "Réceptionner", icone: "📥" },
  { cle: "historique", label: "Historique", icone: "🗂️" },
  { cle: "fournisseurs", label: "Fournisseurs", icone: "🚚" },
  { cle: "dettes", label: "Dettes", icone: "💰" },
] as const;

type Section = (typeof SECTIONS)[number]["cle"];

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

function OngletCommandes({
  session,
  ouvrirFormulaireInitial,
  lignesInitiales,
  onFormulaireInitialConsomme,
}: {
  session: Session;
  ouvrirFormulaireInitial?: boolean;
  lignesInitiales?: LigneAchatInitiale[];
  onFormulaireInitialConsomme?: () => void;
}) {
  const peutGerer = !!session.permissions.gerer_produits_stock_achats;
  const devise = useDevise();
  const nomUtilisateur = useNomsUtilisateurs(session);
  const [fournisseurs, setFournisseurs] = useState<FournisseurResume[]>([]);
  const [fournisseurNom, setFournisseurNom] = useState("");
  const [statut, setStatut] = useState<"a_traiter" | StatutCommande | "">("a_traiter");
  const [terme, setTerme] = useState("");
  const [commandes, setCommandes] = useState<CommandeResume[]>([]);
  const [receptions, setReceptions] = useState<ReceptionHistorique[]>([]);
  const [afficherForm, setAfficherForm] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  // Ne doit servir que pour l'ouverture qui vient du raccourci rupture — pas
  // être réutilisé si l'utilisateur annule puis ouvre une commande vierge à
  // la main pendant qu'il est encore sur cette page.
  const [apercuGroupeActif, setApercuGroupeActif] = useState(false);
  const [commandeSelectionneeId, setCommandeSelectionneeId] = useState<string | null>(null);
  // « Réceptionner » depuis la ligne : ouvre directement le formulaire de réception.
  const [receptionDirecte, setReceptionDirecte] = useState(false);

  // Raccourci "Commander" d'une rupture : ouvre directement l'aperçu de commandes groupées.
  useEffect(() => {
    if (ouvrirFormulaireInitial) {
      setApercuGroupeActif(true);
      onFormulaireInitialConsomme?.();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ouvrirFormulaireInitial]);

  async function rafraichir() {
    const [liste, h] = await Promise.all([listerFournisseurs(session.boutiqueId), historiqueAchats(session.boutiqueId)]);
    setFournisseurs(liste);
    setCommandes(h.commandes);
    setReceptions(h.receptions);
  }
  useEffect(() => {
    rafraichir();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function passerEnCommandee(c: CommandeResume) {
    try {
      await modifierCommande(c.id, { statut: "commandee", utilisateurId: session.utilisateurId });
      setErreur(null);
      rafraichir();
    } catch (e) {
      setErreur(e instanceof ErreurAchat ? e.message : "Erreur inattendue.");
    }
  }

  if (apercuGroupeActif) {
    return (
      <ApercuCommandesGroupees
        session={session}
        lignes={lignesInitiales ?? []}
        fournisseurs={fournisseurs}
        onAnnuler={() => setApercuGroupeActif(false)}
        onCreees={() => {
          setApercuGroupeActif(false);
          rafraichir();
        }}
      />
    );
  }

  const somme = (valeurs: number[]) => valeurs.reduce((t, v) => t + v, 0);
  const pourcentageRecu = (c: CommandeResume) =>
    c.quantiteCommandee > 0 ? Math.min(100, Math.round((c.quantiteRecue / c.quantiteCommandee) * 100)) : 0;
  const brouillons = commandes.filter((c) => c.statut === "brouillon");
  const aRecevoir = commandes.filter((c) => c.statut === "commandee");
  const debutMois = new Date();
  debutMois.setDate(1);
  debutMois.setHours(0, 0, 0, 0);
  const recuMois = somme(
    receptions.filter((r) => !r.annulee && r.dateCreation >= debutMois.toISOString()).map((r) => r.valeurRecue),
  );
  const nomsFournisseurs = [...new Set(commandes.map((c) => c.fournisseurNom))].sort((a, b) => a.localeCompare(b, "fr"));
  const cle = terme.trim().toLowerCase();
  const rang = (c: CommandeResume) => (c.statut === "commandee" ? 0 : c.statut === "brouillon" ? 1 : 2);
  const commandesFiltrees = commandes
    .filter(
      (c) =>
        (statut === "a_traiter" ? c.statut === "brouillon" || c.statut === "commandee" : !statut || c.statut === statut) &&
        (!fournisseurNom || c.fournisseurNom === fournisseurNom) &&
        (!cle || c.numero.toLowerCase().includes(cle)),
    )
    .sort((a, b) => rang(a) - rang(b) || b.dateCreation.localeCompare(a.dateCreation));

  return (
    <div className="liste-dettes-credits">
      {afficherForm && (
        <div className="fond-modale" onClick={() => setAfficherForm(false)}>
          <div className="modale-selection-produits" onClick={(e) => e.stopPropagation()}>
            <FormulaireCommande
              session={session}
              fournisseurs={fournisseurs}
              onAnnuler={() => setAfficherForm(false)}
              onCree={() => {
                setAfficherForm(false);
                rafraichir();
              }}
            />
          </div>
        </div>
      )}
      <div className="tuiles-fiche">
        <div className="tuile-fiche">
          <span className="sous-info">📝 Brouillons</span>
          <strong>{brouillons.length}</strong>
        </div>
        <div className="tuile-fiche">
          <span className="sous-info">📨 À recevoir</span>
          <strong>
            {aRecevoir.length} · {somme(aRecevoir.map((c) => c.quantiteCommandee - c.quantiteRecue))} article(s)
          </strong>
        </div>
        <div className="tuile-fiche">
          <span className="sous-info">📥 Reçu ce mois</span>
          <strong>
            {formaterMontant(recuMois)} {devise}
          </strong>
        </div>
        <div className="tuile-fiche">
          <span className="sous-info">💰 Engagé (pas encore reçu)</span>
          <strong>
            {formaterMontant(somme(aRecevoir.map((c) => Math.max(0, c.total - c.valeurRecue))))} {devise}
          </strong>
        </div>
      </div>
      <div className="barre-actions barre-filtres-historique">
        <select value={statut} onChange={(e) => setStatut(e.target.value as typeof statut)}>
          <option value="a_traiter">À traiter</option>
          <option value="brouillon">Brouillons</option>
          <option value="commandee">Commandées</option>
          <option value="recue">Reçues</option>
          <option value="annulee">Annulées</option>
          <option value="">Toutes</option>
        </select>
        <select value={fournisseurNom} onChange={(e) => setFournisseurNom(e.target.value)}>
          <option value="">Tous les fournisseurs</option>
          {nomsFournisseurs.map((nom) => (
            <option key={nom} value={nom}>
              {nom}
            </option>
          ))}
        </select>
        <input type="search" placeholder="N° de commande…" value={terme} onChange={(e) => setTerme(e.target.value)} />
        {peutGerer && (
          <button
            type="button"
            className="bouton-ajouter-variante"
            onClick={() => setAfficherForm(true)}
            disabled={fournisseurs.length === 0}
          >
            + Nouvelle commande
          </button>
        )}
      </div>
      {peutGerer && fournisseurs.length === 0 && (
        <p className="note-aide">Créez d'abord un fournisseur dans l'onglet « Fournisseurs ».</p>
      )}
      {erreur && <div className="message-erreur">{erreur}</div>}
      <div className="zone-tableau-scroll">
        <table className="tableau-catalogue carte-mobile">
          <thead>
            <tr>
              <th>N°</th>
              <th>Date</th>
              <th>Numéro</th>
              <th>Fournisseur</th>
              <th>Articles</th>
              <th>Total</th>
              <th>Reçu</th>
              <th>Statut</th>
              <th>Fait par</th>
              <th className="colonne-actions-categorie" />
            </tr>
          </thead>
          <tbody>
            {commandesFiltrees.map((c, index) => (
              <tr
                key={c.id}
                onClick={() => {
                  setReceptionDirecte(false);
                  setCommandeSelectionneeId(c.id);
                }}
                title="Voir la commande"
              >
                <td data-label="N°">{index + 1}</td>
                <td data-label="Date">{new Date(c.dateCreation).toLocaleDateString("fr-FR")}</td>
                <td data-label="Numéro">{c.numero}</td>
                <td data-label="Fournisseur">{c.fournisseurNom}</td>
                <td data-label="Articles">{c.quantiteCommandee}</td>
                <td data-label="Total"><span className="nowrap">{formaterMontant(c.total)} {devise}</span></td>
                <td data-label="Reçu"><span className="mini-progression" title={`${c.quantiteRecue} / ${c.quantiteCommandee} articles reçus`}>
                    <span className="barre-progression">
                      <span style={{ width: `${pourcentageRecu(c)}%` }} />
                    </span>
                    <span className="sous-info">{pourcentageRecu(c)} %</span>
                  </span></td>
                <td data-label="Statut"><span className="nowrap"><BadgeStatutCommande statut={c.statut} partiellementRecue={c.partiellementRecue} /></span></td>
                <td data-label="Fait par">{nomUtilisateur(c.utilisateurId)}</td>
                <td data-label="Action" className="colonne-actions-categorie">{peutGerer && c.statut === "brouillon" && (
                    <button
                      type="button"
                      className="nowrap"
                      title="Passer en commandée (envoyée au fournisseur)"
                      onClick={(e) => {
                        e.stopPropagation();
                        passerEnCommandee(c);
                      }}
                    >
                      📨 Commander
                    </button>
                  )}
                  {peutGerer && c.statut === "commandee" && (
                    <button
                      type="button"
                      className="bouton-primaire nowrap"
                      title="Réceptionner la marchandise"
                      onClick={(e) => {
                        e.stopPropagation();
                        setReceptionDirecte(true);
                        setCommandeSelectionneeId(c.id);
                      }}
                    >
                      📥 Recevoir
                    </button>
                  )}</td>
              </tr>
            ))}
            {commandesFiltrees.length === 0 && (
              <tr>
                <td colSpan={10} className="liste-vide">
                  Aucune commande pour ces filtres.
                </td>
              </tr>
            )}
            {Array.from({ length: Math.max(0, 10 - Math.max(1, commandesFiltrees.length)) }).map((_, i) => (
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
              <td>&nbsp;</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {commandesFiltrees.length > 0 && (
        <div className="totaux">
          <div>
            {commandesFiltrees.length} commande{commandesFiltrees.length > 1 ? "s" : ""} · Reçu :{" "}
            {formaterMontant(somme(commandesFiltrees.filter((c) => c.statut !== "annulee").map((c) => c.valeurRecue)))}{" "}
            {devise}
          </div>
          <div className="total-net">
            Total : {formaterMontant(somme(commandesFiltrees.filter((c) => c.statut !== "annulee").map((c) => c.total)))}{" "}
            {devise}
          </div>
        </div>
      )}

      {commandeSelectionneeId && (
        <div
          className="fond-modale"
          onClick={() => {
            setCommandeSelectionneeId(null);
            rafraichir();
          }}
        >
          <div className="modale-selection-produits" onClick={(e) => e.stopPropagation()}>
            <DetailCommande
              commandeId={commandeSelectionneeId}
              session={session}
              fournisseurs={fournisseurs}
              ouvrirReceptionInitial={receptionDirecte}
              onRetour={() => {
                setCommandeSelectionneeId(null);
                rafraichir();
              }}
            />
          </div>
        </div>
      )}
    </div>
  );
}

// --- Onglet Réceptionner : file d'attente des commandes commandées, triées de
// la plus ancienne à la plus récente (les plus urgentes à réceptionner). ---

/** Au-delà, l'attente d'une livraison s'affiche en rouge. */
const SEUIL_ATTENTE_JOURS = 7;

function OngletReception({ session }: { session: Session }) {
  const devise = useDevise();
  const [fournisseurs, setFournisseurs] = useState<FournisseurResume[]>([]);
  const [commandes, setCommandes] = useState<CommandeResume[]>([]);
  const [fournisseurNom, setFournisseurNom] = useState("");
  const [terme, setTerme] = useState("");
  const [commandeSelectionneeId, setCommandeSelectionneeId] = useState<string | null>(null);

  async function rafraichir() {
    setCommandes(await listerCommandes(session.boutiqueId, undefined, "commandee"));
  }
  useEffect(() => {
    rafraichir();
    listerFournisseurs(session.boutiqueId).then(setFournisseurs);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.boutiqueId]);

  const somme = (valeurs: number[]) => valeurs.reduce((t, v) => t + v, 0);
  const attente = (c: CommandeResume) =>
    Math.max(0, Math.floor((Date.now() - new Date(c.dateCreation).getTime()) / 86_400_000));
  const pourcentageRecu = (c: CommandeResume) =>
    c.quantiteCommandee > 0 ? Math.min(100, Math.round((c.quantiteRecue / c.quantiteCommandee) * 100)) : 0;
  const resteValeur = (c: CommandeResume) => Math.max(0, c.total - c.valeurRecue);
  const nomsFournisseurs = [...new Set(commandes.map((c) => c.fournisseurNom))].sort((a, b) => a.localeCompare(b, "fr"));
  const cle = terme.trim().toLowerCase();
  // La plus ancienne attente d'abord.
  const commandesFiltrees = commandes
    .filter((c) => (!fournisseurNom || c.fournisseurNom === fournisseurNom) && (!cle || c.numero.toLowerCase().includes(cle)))
    .sort((a, b) => a.dateCreation.localeCompare(b.dateCreation));
  const plusAncienne = commandes.length > 0 ? Math.max(...commandes.map(attente)) : 0;

  return (
    <div className="liste-dettes-credits">
      <div className="tuiles-fiche">
        <div className="tuile-fiche">
          <span className="sous-info">📨 Commandes à recevoir</span>
          <strong>{commandes.length}</strong>
        </div>
        <div className="tuile-fiche">
          <span className="sous-info">📦 Articles restants</span>
          <strong>{somme(commandes.map((c) => c.quantiteCommandee - c.quantiteRecue))}</strong>
        </div>
        <div className="tuile-fiche">
          <span className="sous-info">💰 Valeur restante</span>
          <strong>
            {formaterMontant(somme(commandes.map(resteValeur)))} {devise}
          </strong>
        </div>
        <div className={`tuile-fiche${plusAncienne > SEUIL_ATTENTE_JOURS ? " tuile-fiche--alerte" : ""}`}>
          <span className="sous-info">⏳ Plus ancienne attente</span>
          <strong>
            {commandes.length === 0 ? "—" : `${plusAncienne} jour${plusAncienne > 1 ? "s" : ""}`}
          </strong>
        </div>
      </div>
      <div className="barre-actions barre-filtres-historique">
        <select value={fournisseurNom} onChange={(e) => setFournisseurNom(e.target.value)}>
          <option value="">Tous les fournisseurs</option>
          {nomsFournisseurs.map((nom) => (
            <option key={nom} value={nom}>
              {nom}
            </option>
          ))}
        </select>
        <input type="search" placeholder="N° de commande…" value={terme} onChange={(e) => setTerme(e.target.value)} />
      </div>
      <div className="zone-tableau-scroll">
        <table className="tableau-catalogue carte-mobile">
          <thead>
            <tr>
              <th>N°</th>
              <th>Date</th>
              <th>Numéro</th>
              <th>Fournisseur</th>
              <th>Attente</th>
              <th>Reçu</th>
              <th>Reste à recevoir</th>
              <th>Statut</th>
              <th className="colonne-actions-categorie" />
            </tr>
          </thead>
          <tbody>
            {commandesFiltrees.map((c, index) => (
              <tr key={c.id} onClick={() => setCommandeSelectionneeId(c.id)} title="Réceptionner cette commande">
                <td data-label="N°">{index + 1}</td>
                <td data-label="Date">{new Date(c.dateCreation).toLocaleDateString("fr-FR")}</td>
                <td data-label="Numéro">{c.numero}</td>
                <td data-label="Fournisseur">{c.fournisseurNom}</td>
                <td data-label="Attente"><span className={attente(c) > SEUIL_ATTENTE_JOURS ? "texte-erreur nowrap" : "nowrap"}>
                    {attente(c)} jour{attente(c) > 1 ? "s" : ""}
                  </span></td>
                <td data-label="Reçu"><span className="mini-progression" title={`${c.quantiteRecue} / ${c.quantiteCommandee} articles reçus`}>
                    <span className="barre-progression">
                      <span style={{ width: `${pourcentageRecu(c)}%` }} />
                    </span>
                    <span className="sous-info">{pourcentageRecu(c)} %</span>
                  </span></td>
                <td data-label="Reste à recevoir"><strong className="nowrap">{c.quantiteCommandee - c.quantiteRecue} art.</strong>
                  <span className="sous-info nowrap"> · {formaterMontant(resteValeur(c))} {devise}</span></td>
                <td data-label="Statut"><span className="nowrap"><BadgeStatutCommande statut={c.statut} partiellementRecue={c.partiellementRecue} /></span></td>
                <td data-label="Action" className="colonne-actions-categorie"><button
                    type="button"
                    className="bouton-primaire nowrap"
                    onClick={(e) => {
                      e.stopPropagation();
                      setCommandeSelectionneeId(c.id);
                    }}
                  >
                    📥 Recevoir
                  </button></td>
              </tr>
            ))}
            {commandesFiltrees.length === 0 && (
              <tr>
                <td colSpan={9} className="liste-vide">
                  {commandes.length === 0 ? "Aucune commande en attente de réception." : "Aucune commande pour ces filtres."}
                </td>
              </tr>
            )}
            {Array.from({ length: Math.max(0, 10 - Math.max(1, commandesFiltrees.length)) }).map((_, i) => (
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
        </table>
      </div>
      {commandesFiltrees.length > 0 && (
        <div className="totaux">
          <div>
            {commandesFiltrees.length} commande{commandesFiltrees.length > 1 ? "s" : ""} ·{" "}
            {somme(commandesFiltrees.map((c) => c.quantiteCommandee - c.quantiteRecue))} article(s) restant(s)
          </div>
          <div className="total-net">
            Valeur restante : {formaterMontant(somme(commandesFiltrees.map(resteValeur)))} {devise}
          </div>
        </div>
      )}

      {commandeSelectionneeId && (
        <div
          className="fond-modale"
          onClick={() => {
            setCommandeSelectionneeId(null);
            rafraichir();
          }}
        >
          <div className="modale-selection-produits" onClick={(e) => e.stopPropagation()}>
            <DetailCommande
              commandeId={commandeSelectionneeId}
              session={session}
              fournisseurs={fournisseurs}
              ouvrirReceptionInitial
              onRetour={() => {
                setCommandeSelectionneeId(null);
                rafraichir();
              }}
            />
          </div>
        </div>
      )}
    </div>
  );
}

interface LigneFournisseurGroupe {
  id: string;
  nom: string;
  telephone: string;
  adresse: string;
  contact: string;
}

function FormulaireFournisseursGroupe({
  boutiqueId,
  onAnnuler,
  onCree,
}: {
  boutiqueId: string;
  onAnnuler: () => void;
  onCree: () => void;
}) {
  const [nom, setNom] = useState("");
  const [telephone, setTelephone] = useState("");
  const [adresse, setAdresse] = useState("");
  const [contact, setContact] = useState("");
  const [lignes, setLignes] = useState<LigneFournisseurGroupe[]>([]);
  const [erreur, setErreur] = useState<string | null>(null);
  const [enCours, setEnCours] = useState(false);

  function ajouterFournisseur() {
    if (!nom.trim()) return;
    setLignes((actuel) => [...actuel, { id: crypto.randomUUID(), nom: nom.trim(), telephone: telephone.trim(), adresse: adresse.trim(), contact: contact.trim() }]);
    setNom("");
    setTelephone("");
    setAdresse("");
    setContact("");
  }

  function surEntree(evenement: React.KeyboardEvent) {
    if (evenement.key === "Enter") {
      evenement.preventDefault();
      ajouterFournisseur();
    }
  }

  function retirerLigne(id: string) {
    setLignes((actuel) => actuel.filter((l) => l.id !== id));
  }

  async function soumettre(evenement: React.FormEvent) {
    evenement.preventDefault();
    setErreur(null);
    if (lignes.length === 0) {
      setErreur("Ajoutez au moins un fournisseur à la liste.");
      return;
    }
    setEnCours(true);
    try {
      for (const ligne of lignes) {
        try {
          await creerFournisseur(boutiqueId, ligne.nom, ligne.telephone, ligne.adresse, ligne.contact);
        } catch (e) {
          setErreur(`"${ligne.nom}" : ${e instanceof ErreurAchat ? e.message : "Erreur inattendue."}`);
          return;
        }
      }
      onCree();
    } finally {
      setEnCours(false);
    }
  }

  return (
    <form onSubmit={soumettre} className="formulaire-produits-groupe">
      <div className="modale-entete entete-fixe">
        <h3>Nouveau fournisseur</h3>
        <div className="actions-formulaire">
          <button type="button" onClick={onAnnuler}>
            Annuler
          </button>
          <button type="submit" disabled={enCours}>
            {enCours ? "Enregistrement…" : `Enregistrer la liste (${lignes.length})`}
          </button>
          <button type="button" className="lien bouton-retour" onClick={onAnnuler}>
            ← Retour
          </button>
        </div>
      </div>
      {erreur && <div className="message-erreur">{erreur}</div>}

      <div className="grille-champs ajout-produit-groupe">
        <label>
          Nom
          <input value={nom} onChange={(e) => setNom(e.target.value)} onKeyDown={surEntree} autoFocus />
        </label>
        <label>
          Téléphone
          <input value={telephone} onChange={(e) => setTelephone(e.target.value)} onKeyDown={surEntree} />
        </label>
        <label>
          Adresse
          <input value={adresse} onChange={(e) => setAdresse(e.target.value)} onKeyDown={surEntree} />
        </label>
        <label>
          Contact
          <input value={contact} onChange={(e) => setContact(e.target.value)} onKeyDown={surEntree} />
        </label>
        <button type="button" className="bouton-ajouter-produit-groupe" onClick={ajouterFournisseur}>
          + Ajouter à la liste
        </button>
      </div>

      <div className="zone-tableau-scroll tableau-produits-groupe-scroll">
        <table className="tableau-catalogue carte-mobile">
          <thead>
            <tr>
              <th className="colonne-numero-groupe">N°</th>
              <th className="col-designation-groupe">Nom</th>
              <th>Téléphone</th>
              <th>Adresse</th>
              <th>Contact</th>
              <th className="colonne-numero-groupe" />
            </tr>
          </thead>
          <tbody>
            {lignes.map((l, index) => (
              <tr key={l.id}>
                <td data-label="N°" className="colonne-numero-groupe">{index + 1}</td>
                <td data-label="Nom" className="col-designation-groupe">{l.nom}</td>
                <td data-label="Téléphone">{l.telephone}</td>
                <td data-label="Adresse">{l.adresse}</td>
                <td data-label="Contact">{l.contact}</td>
                <td className="colonne-numero-groupe">
                  <button type="button" className="bouton-retirer-ligne-groupe" title="Retirer de la liste" onClick={() => retirerLigne(l.id)}>
                    ✕
                  </button>
                </td>
              </tr>
            ))}
            {Array.from({ length: Math.max(0, 10 - lignes.length) }).map((_, i) => (
              <tr key={`vide-${i}`} className="ligne-groupe-vide">
                <td className="colonne-numero-groupe">&nbsp;</td>
                <td className="col-designation-groupe">&nbsp;</td>
                <td>&nbsp;</td>
                <td>&nbsp;</td>
                <td>&nbsp;</td>
                <td className="colonne-numero-groupe">&nbsp;</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </form>
  );
}

interface StatsFournisseur {
  commandes: number;
  derniere: string;
  achete: number;
  du: number;
  retard: boolean;
}

function OngletFournisseurs({ session }: { session: Session }) {
  const peutGerer = !!session.permissions.gerer_produits_stock_achats;
  const devise = useDevise();
  const [fournisseurs, setFournisseurs] = useState<FournisseurResume[]>([]);
  const [commandes, setCommandes] = useState<CommandeResume[]>([]);
  const [receptions, setReceptions] = useState<ReceptionHistorique[]>([]);
  const [dettes, setDettes] = useState<DetteResume[]>([]);
  const [depots, setDepots] = useState<DepotResume[]>([]);
  const [recherche, setRecherche] = useState("");
  const [tri, setTri] = useState<"nom" | "du" | "derniere">("nom");
  const [afficherModal, setAfficherModal] = useState(false);
  const [enEdition, setEnEdition] = useState<FournisseurResume | null>(null);
  const [brouillon, setBrouillon] = useState({ nom: "", telephone: "", adresse: "", contact: "" });
  const [aSupprimer, setASupprimer] = useState<FournisseurResume | null>(null);
  const [ficheOuverte, setFicheOuverte] = useState<FournisseurResume | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);

  async function rafraichir() {
    const [liste, historique, toutesDettes] = await Promise.all([
      listerFournisseurs(session.boutiqueId),
      historiqueAchats(session.boutiqueId),
      listerDettes(session.boutiqueId),
    ]);
    setFournisseurs(liste);
    setCommandes(historique.commandes);
    setReceptions(historique.receptions);
    setDettes(toutesDettes);
  }
  useEffect(() => {
    rafraichir();
    if (!session.depotId) listerDepotsDetail(session.boutiqueId).then(setDepots);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function commencerEdition(f: FournisseurResume) {
    setErreur(null);
    setEnEdition(f);
    setBrouillon({ nom: f.nom, telephone: f.telephone ?? "", adresse: f.adresse ?? "", contact: f.contact ?? "" });
  }

  async function enregistrerEdition() {
    if (!enEdition || !brouillon.nom.trim()) return;
    try {
      await modifierFournisseur(enEdition.id, brouillon);
      setEnEdition(null);
      setErreur(null);
      rafraichir();
    } catch (e) {
      setErreur(e instanceof ErreurAchat ? e.message : "Erreur inattendue.");
    }
  }

  async function supprimer() {
    if (!aSupprimer) return;
    try {
      await supprimerFournisseur(aSupprimer.id);
      setErreur(null);
      rafraichir();
    } catch (e) {
      setErreur(e instanceof ErreurAchat ? e.message : "Erreur inattendue.");
    }
    setASupprimer(null);
  }

  function ecrire(f: FournisseurResume) {
    const numero = (f.telephone ?? "").replace(/\D/g, "");
    if (!numero) return;
    const texte = `Bonjour ${f.contact || f.nom}, `;
    window.open(`https://wa.me/${numero}?text=${encodeURIComponent(texte)}`, "_blank", "noopener");
  }

  // Chiffres par fournisseur (commandes non annulées, dettes en cours).
  const stats = new Map<string, StatsFournisseur>();
  const statsDe = (nom: string) => {
    if (!stats.has(nom)) stats.set(nom, { commandes: 0, derniere: "", achete: 0, du: 0, retard: false });
    return stats.get(nom)!;
  };
  for (const c of commandes) {
    if (c.statut === "annulee") continue;
    const s = statsDe(c.fournisseurNom);
    s.commandes += 1;
    s.achete += c.valeurRecue;
    if (c.dateCreation > s.derniere) s.derniere = c.dateCreation;
  }
  for (const d of dettes) {
    if (d.statut !== "en_cours") continue;
    const s = statsDe(d.fournisseurNom);
    s.du += d.solde;
    if (d.prochaineEcheance?.enRetard) s.retard = true;
  }
  const debutMois = new Date();
  debutMois.setDate(1);
  debutMois.setHours(0, 0, 0, 0);
  const acheteMois = receptions
    .filter((r) => !r.annulee && r.dateCreation >= debutMois.toISOString())
    .reduce((t, r) => t + r.valeurRecue, 0);
  const somme = (valeurs: number[]) => valeurs.reduce((t, v) => t + v, 0);

  const cle = recherche.trim().toLowerCase();
  const fournisseursFiltres = fournisseurs
    .filter(
      (f) =>
        !cle ||
        f.nom.toLowerCase().includes(cle) ||
        (f.telephone ?? "").toLowerCase().includes(cle) ||
        (f.contact ?? "").toLowerCase().includes(cle),
    )
    .sort((a, b) =>
      tri === "du"
        ? statsDe(b.nom).du - statsDe(a.nom).du
        : tri === "derniere"
          ? statsDe(b.nom).derniere.localeCompare(statsDe(a.nom).derniere)
          : a.nom.localeCompare(b.nom, "fr"),
    );
  const avecRetard = fournisseurs.filter((f) => statsDe(f.nom).retard).length;

  return (
    <div className="liste-dettes-credits">
      <div className="tuiles-fiche">
        <div className="tuile-fiche">
          <span className="sous-info">🚚 Fournisseurs</span>
          <strong>{fournisseurs.length}</strong>
        </div>
        <div className="tuile-fiche">
          <span className="sous-info">💰 Total dû</span>
          <strong>
            {formaterMontant(somme(fournisseurs.map((f) => statsDe(f.nom).du)))} {devise}
          </strong>
        </div>
        <div className={`tuile-fiche${avecRetard > 0 ? " tuile-fiche--alerte" : ""}`}>
          <span className="sous-info">🔴 Avec un retard</span>
          <strong>{avecRetard}</strong>
        </div>
        <div className="tuile-fiche">
          <span className="sous-info">📦 Acheté ce mois</span>
          <strong>
            {formaterMontant(acheteMois)} {devise}
          </strong>
        </div>
      </div>
      <div className="barre-actions barre-filtres-historique">
        <input
          type="search"
          placeholder="Nom, téléphone ou contact…"
          value={recherche}
          onChange={(e) => setRecherche(e.target.value)}
        />
        <select value={tri} onChange={(e) => setTri(e.target.value as typeof tri)}>
          <option value="nom">Trier par nom</option>
          <option value="du">Plus gros dû d'abord</option>
          <option value="derniere">Dernière commande d'abord</option>
        </select>
        {peutGerer && (
          <button type="button" className="bouton-ajouter-variante" onClick={() => setAfficherModal(true)}>
            + Nouveau fournisseur
          </button>
        )}
      </div>
      {erreur && <div className="message-erreur">{erreur}</div>}
      {afficherModal && (
        <div className="fond-modale" onClick={() => setAfficherModal(false)}>
          <div className="modale-selection-produits" onClick={(e) => e.stopPropagation()}>
            <FormulaireFournisseursGroupe
              boutiqueId={session.boutiqueId}
              onAnnuler={() => setAfficherModal(false)}
              onCree={() => {
                setAfficherModal(false);
                rafraichir();
              }}
            />
          </div>
        </div>
      )}
      {aSupprimer && (
        <ModaleConfirmation
          titre={`Supprimer le fournisseur « ${aSupprimer.nom} » ?`}
          description="Il disparaîtra des listes et des choix de fournisseur. Ses commandes, paiements et historiques restent consultables."
          labelConfirmer="Supprimer"
          dangereux
          onAnnuler={() => setASupprimer(null)}
          onConfirmer={supprimer}
        />
      )}
      {ficheOuverte && (
        <ModaleFicheFournisseur
          session={session}
          fournisseur={ficheOuverte}
          fournisseurs={fournisseurs}
          commandes={commandes.filter((c) => c.fournisseurNom === ficheOuverte.nom)}
          dettes={dettes.filter((d) => d.fournisseurNom === ficheOuverte.nom)}
          depots={depots}
          onEcrire={() => ecrire(ficheOuverte)}
          onModifie={rafraichir}
          onFermer={() => setFicheOuverte(null)}
        />
      )}
      <div className="zone-tableau-scroll">
        <table className="tableau-catalogue carte-mobile">
          <thead>
            <tr>
              <th>N°</th>
              <th>Fournisseur</th>
              <th>Téléphone</th>
              <th>Commandes</th>
              <th>Dernière commande</th>
              <th>Total acheté</th>
              <th>Reste dû</th>
              <th className="colonne-actions-categorie" />
            </tr>
          </thead>
          <tbody>
            {fournisseursFiltres.map((f, index) => {
              const s = statsDe(f.nom);
              return enEdition?.id === f.id ? (
                <tr key={f.id} className="ligne-edition-fournisseur">
                  <td data-label="N°">{index + 1}</td>
                  <td data-label="Nom">
                    <input
                      autoFocus
                      value={brouillon.nom}
                      onChange={(e) => setBrouillon({ ...brouillon, nom: e.target.value })}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") enregistrerEdition();
                        if (e.key === "Escape") setEnEdition(null);
                      }}
                      placeholder="Nom"
                    />
                  </td>
                  <td data-label="Téléphone">
                    <input
                      value={brouillon.telephone}
                      onChange={(e) => setBrouillon({ ...brouillon, telephone: e.target.value })}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") enregistrerEdition();
                        if (e.key === "Escape") setEnEdition(null);
                      }}
                      placeholder="Téléphone"
                    />
                  </td>
                  <td data-label="Contact" colSpan={2}>
                    <input
                      value={brouillon.contact}
                      onChange={(e) => setBrouillon({ ...brouillon, contact: e.target.value })}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") enregistrerEdition();
                        if (e.key === "Escape") setEnEdition(null);
                      }}
                      placeholder="Contact"
                    />
                  </td>
                  <td data-label="Adresse" colSpan={2}>
                    <input
                      value={brouillon.adresse}
                      onChange={(e) => setBrouillon({ ...brouillon, adresse: e.target.value })}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") enregistrerEdition();
                        if (e.key === "Escape") setEnEdition(null);
                      }}
                      placeholder="Adresse"
                    />
                  </td>
                  <td data-label="Actions" className="colonne-actions-categorie">
                    <span className="actions-ligne">
                      <button type="button" onClick={() => setEnEdition(null)}>
                        Annuler
                      </button>
                      <button
                        type="button"
                        className="bouton-primaire"
                        disabled={!brouillon.nom.trim()}
                        onClick={enregistrerEdition}
                      >
                        Enregistrer
                      </button>
                    </span>
                  </td>
                </tr>
              ) : (
                <tr key={f.id} onClick={() => setFicheOuverte(f)} title="Voir la fiche du fournisseur">
                  <td data-label="N°">{index + 1}</td>
                  <td data-label="Fournisseur">
                    <strong>{f.nom}</strong>
                    {f.contact && <span className="sous-info"> · {f.contact}</span>}
                  </td>
                  <td data-label="Téléphone"><span className="nowrap">{f.telephone || "—"}</span></td>
                  <td data-label="Commandes">{s.commandes}</td>
                  <td data-label="Dernière commande">{s.derniere ? new Date(s.derniere).toLocaleDateString("fr-FR") : "—"}</td>
                  <td data-label="Total acheté"><span className="nowrap">{formaterMontant(s.achete)} {devise}</span></td>
                  <td data-label="Reste dû">{s.du > 0 ? (
                      <strong className={`nowrap${s.retard ? " texte-erreur" : ""}`}>
                        {formaterMontant(s.du)} {devise}
                        {s.retard && " (retard)"}
                      </strong>
                    ) : (
                      "—"
                    )}</td>
                  <td data-label="Actions" className="colonne-actions-categorie">
                    <span className="actions-ligne" onClick={(e) => e.stopPropagation()}>
                      {f.telephone && (
                        <button type="button" className="lien-icone" title="Écrire sur WhatsApp" onClick={() => ecrire(f)}>
                          📲
                        </button>
                      )}
                      {peutGerer && (
                        <>
                          <button type="button" className="lien-icone" title="Modifier" onClick={() => commencerEdition(f)}>
                            ✎
                          </button>
                          <button
                            type="button"
                            className="lien-icone lien-icone-danger"
                            title="Supprimer"
                            onClick={() => {
                              setErreur(null);
                              setASupprimer(f);
                            }}
                          >
                            ×
                          </button>
                        </>
                      )}
                    </span>
                  </td>
                </tr>
              );
            })}
            {fournisseursFiltres.length === 0 && (
              <tr>
                <td colSpan={8} className="liste-vide">
                  {fournisseurs.length === 0 ? "Aucun fournisseur." : "Aucun fournisseur ne correspond à la recherche."}
                </td>
              </tr>
            )}
            {Array.from({ length: Math.max(0, 10 - Math.max(1, fournisseursFiltres.length)) }).map((_, i) => (
              <tr key={`vide-${i}`} className="ligne-groupe-vide">
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
        </table>
      </div>
      {fournisseursFiltres.length > 0 && (
        <div className="totaux">
          <div>
            {fournisseursFiltres.length} fournisseur{fournisseursFiltres.length > 1 ? "s" : ""} · Total acheté :{" "}
            {formaterMontant(somme(fournisseursFiltres.map((f) => statsDe(f.nom).achete)))} {devise}
          </div>
          <div className="total-net">
            Total dû : {formaterMontant(somme(fournisseursFiltres.map((f) => statsDe(f.nom).du)))} {devise}
          </div>
        </div>
      )}
    </div>
  );
}

/** Fiche d'un fournisseur : coordonnées, chiffres, commandes et dettes, nouvelle commande. */
function ModaleFicheFournisseur({
  session,
  fournisseur,
  fournisseurs,
  commandes,
  dettes,
  depots,
  onEcrire,
  onModifie,
  onFermer,
}: {
  session: Session;
  fournisseur: FournisseurResume;
  fournisseurs: FournisseurResume[];
  commandes: CommandeResume[];
  dettes: DetteResume[];
  depots: DepotResume[];
  onEcrire: () => void;
  onModifie: () => void;
  onFermer: () => void;
}) {
  const peutGerer = !!session.permissions.gerer_produits_stock_achats;
  const devise = useDevise();
  const [commandeOuverteId, setCommandeOuverteId] = useState<string | null>(null);
  const [detteOuverte, setDetteOuverte] = useState<DetteResume | null>(null);
  const [nouvelleCommande, setNouvelleCommande] = useState(false);
  const [ongletFiche, setOngletFiche] = useState<"commandes" | "dettes" | "compte">("commandes");

  const valides = commandes.filter((c) => c.statut !== "annulee");
  const achete = valides.reduce((t, c) => t + c.valeurRecue, 0);
  const dettesEnCours = dettes.filter((d) => d.statut === "en_cours");
  const du = dettesEnCours.reduce((t, d) => t + d.solde, 0);
  const triees = [...commandes].sort((a, b) => b.dateCreation.localeCompare(a.dateCreation));

  return (
    <div className="fond-modale" onClick={onFermer}>
      <div className="modale-selection-produits" onClick={(e) => e.stopPropagation()}>
        <EnteteModale titre={`Fournisseur — ${fournisseur.nom}`} onFermer={onFermer} />
        {commandeOuverteId && (
          <div className="fond-modale" onClick={() => setCommandeOuverteId(null)}>
            <div className="modale-selection-produits" onClick={(e) => e.stopPropagation()}>
              <DetailCommande
                commandeId={commandeOuverteId}
                session={session}
                fournisseurs={fournisseurs}
                onRetour={() => {
                  setCommandeOuverteId(null);
                  onModifie();
                }}
              />
            </div>
          </div>
        )}
        {detteOuverte && (
          <ModaleDette
            dette={detteOuverte}
            session={session}
            depots={depots}
            onFermer={() => setDetteOuverte(null)}
            onPaye={onModifie}
          />
        )}
        {nouvelleCommande && (
          <div className="fond-modale" onClick={() => setNouvelleCommande(false)}>
            <div className="modale-selection-produits" onClick={(e) => e.stopPropagation()}>
              <FormulaireCommande
                session={session}
                fournisseurs={fournisseurs}
                fournisseurInitialId={fournisseur.id}
                onAnnuler={() => setNouvelleCommande(false)}
                onCree={() => {
                  setNouvelleCommande(false);
                  onModifie();
                }}
              />
            </div>
          </div>
        )}
        <div className="modale-avec-menu">
          <nav className="menu-modale">
            <button
              type="button"
              className={ongletFiche === "commandes" ? "actif" : ""}
              onClick={() => setOngletFiche("commandes")}
            >
              <span className="icone-menu-modale">🧾</span>
              Commandes
              <span className="compteur-menu-modale">{triees.length}</span>
            </button>
            <button
              type="button"
              className={ongletFiche === "dettes" ? "actif" : ""}
              onClick={() => setOngletFiche("dettes")}
            >
              <span className="icone-menu-modale">💰</span>
              Dettes en cours
              <span className="compteur-menu-modale">{dettesEnCours.length}</span>
            </button>
            <button
              type="button"
              className={ongletFiche === "compte" ? "actif" : ""}
              onClick={() => setOngletFiche("compte")}
            >
              <span className="icone-menu-modale">📄</span>
              Compte
            </button>
          </nav>
        <div className="modale-corps">
          <div className="cartes-fiche">
            <section className="carte-fiche">
              <h4>🚚 Coordonnées</h4>
              <strong>{fournisseur.nom}</strong>
              <span>📞 {fournisseur.telephone || "Téléphone non renseigné"}</span>
              <span>👤 {fournisseur.contact || "Contact non renseigné"}</span>
              <span>📍 {fournisseur.adresse || "Adresse non renseignée"}</span>
              <span className="actions-ligne">
                {fournisseur.telephone && (
                  <button type="button" onClick={onEcrire}>
                    📲 WhatsApp
                  </button>
                )}
                {peutGerer && (
                  <button type="button" className="bouton-primaire" onClick={() => setNouvelleCommande(true)}>
                    + Nouvelle commande
                  </button>
                )}
              </span>
            </section>
            <div className="tuiles-fiche tuiles-fiche--carte">
              <div className="tuile-fiche">
                <span className="sous-info">📦 Total acheté</span>
                <strong>
                  {formaterMontant(achete)} {devise}
                </strong>
              </div>
              <div className="tuile-fiche">
                <span className="sous-info">🧾 Commandes</span>
                <strong>{valides.length}</strong>
              </div>
              <div className="tuile-fiche">
                <span className="sous-info">✅ Payé</span>
                <strong>
                  {formaterMontant(Math.max(0, achete - du))} {devise}
                </strong>
              </div>
              <div className={`tuile-fiche${dettesEnCours.some((d) => d.prochaineEcheance?.enRetard) ? " tuile-fiche--alerte" : ""}`}>
                <span className="sous-info">💰 Reste dû</span>
                <strong>
                  {formaterMontant(du)} {devise}
                </strong>
              </div>
            </div>
          </div>

          {ongletFiche === "compte" ? (
            <PanneauCompte
              genre="fournisseur"
              tiersId={fournisseur.id}
              tiersNom={fournisseur.nom}
              telephone={fournisseur.telephone ?? ""}
              session={session}
              classeZone="zone-commandes-fiche zone-compte-tiers"
              onModifie={onModifie}
            />
          ) : ongletFiche === "dettes" ? (
            <div className="zone-tableau-scroll zone-commandes-fiche">
              <table className="tableau-catalogue carte-mobile">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Commande</th>
                    <th>Montant</th>
                    <th>Reste</th>
                    <th>Prochaine échéance</th>
                  </tr>
                </thead>
                <tbody>
                  {dettesEnCours.map((d) => (
                    <tr key={d.id} onClick={() => setDetteOuverte(d)} title="Voir la dette">
                      <td data-label="Date">{new Date(d.dateCreation).toLocaleDateString("fr-FR")}</td>
                      <td data-label="Commande">{d.commandeNumero ?? "—"}</td>
                      <td data-label="Montant"><span className="nowrap">{formaterMontant(d.montant)} {devise}</span></td>
                      <td data-label="Reste"><strong className="nowrap">{formaterMontant(d.solde)} {devise}</strong></td>
                      <td data-label="Prochaine échéance">{d.prochaineEcheance ? (
                          <span className={d.prochaineEcheance.enRetard ? "texte-erreur nowrap" : "nowrap"}>
                            {new Date(`${d.prochaineEcheance.date}T00:00:00`).toLocaleDateString("fr-FR")}
                            {d.prochaineEcheance.enRetard && " (en retard)"}
                          </span>
                        ) : (
                          "—"
                        )}</td>
                    </tr>
                  ))}
                  {dettesEnCours.length === 0 && (
                    <tr>
                      <td colSpan={5} className="liste-vide">
                        Aucune dette en cours chez ce fournisseur.
                      </td>
                    </tr>
                  )}
                  {Array.from({ length: Math.max(0, 10 - Math.max(1, dettesEnCours.length)) }).map((_, i) => (
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
          ) : (
            <div className="zone-tableau-scroll zone-commandes-fiche">
              <table className="tableau-catalogue carte-mobile">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Numéro</th>
                    <th>Statut</th>
                    <th>Total</th>
                    <th>Reçu</th>
                  </tr>
                </thead>
                <tbody>
                  {triees.map((c) => (
                    <tr key={c.id} onClick={() => setCommandeOuverteId(c.id)} title="Voir la commande">
                      <td data-label="Date">{new Date(c.dateCreation).toLocaleDateString("fr-FR")}</td>
                      <td data-label="Numéro">{c.numero}</td>
                      <td data-label="Statut"><BadgeStatutCommande statut={c.statut} partiellementRecue={c.partiellementRecue} /></td>
                      <td data-label="Total"><span className="nowrap">{formaterMontant(c.total)} {devise}</span></td>
                      <td data-label="Reçu"><span className="nowrap">{formaterMontant(c.valeurRecue)} {devise}</span></td>
                    </tr>
                  ))}
                  {triees.length === 0 && (
                    <tr>
                      <td colSpan={5} className="liste-vide">
                        Aucune commande chez ce fournisseur.
                      </td>
                    </tr>
                  )}
                  {Array.from({ length: Math.max(0, 10 - Math.max(1, triees.length)) }).map((_, i) => (
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
          )}
        </div>
        </div>
      </div>
    </div>
  );
}

function ModaleDette({
  dette: detteInitiale,
  session,
  depots,
  onFermer,
  onPaye,
}: {
  dette: DetteResume;
  session: Session;
  depots: DepotResume[];
  onFermer: () => void;
  onPaye: () => void;
}) {
  const devise = useDevise();
  const peutGerer = !!session.permissions.gerer_produits_stock_achats;
  const [dette, setDette] = useState(detteInitiale);
  const [paiements, setPaiements] = useState<PaiementDetteDetail[]>([]);
  const [montant, setMontant] = useState("");
  const [mode, setMode] = useState(MODES_REGLEMENT[0].valeur);
  const [depotId, setDepotId] = useState(session.depotId ?? "");
  const [erreur, setErreur] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [enCours, setEnCours] = useState(false);
  const [aAnnuler, setAAnnuler] = useState<PaiementDetteDetail | null>(null);
  const [tracesOuvertes, setTracesOuvertes] = useState(false);
  const [fournisseur, setFournisseur] = useState<FournisseurResume | null>(null);
  useEffect(() => {
    listerFournisseurs(session.boutiqueId).then((liste) => setFournisseur(liste.find((f) => f.nom === dette.fournisseurNom) ?? null));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dette.fournisseurNom]);
  const [echeances, setEcheances] = useState<EcheanceDetail[]>([]);
  const [planification, setPlanification] = useState(false);
  const [motifAnnulation, setMotifAnnulation] = useState("");
  const nomUtilisateur = useNomsUtilisateurs(session);

  function chargerPaiements() {
    listerPaiementsDette(dette.id).then(setPaiements);
    echeancierDette(dette.id).then(setEcheances);
  }
  useEffect(() => {
    chargerPaiements();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dette.id]);

  async function rembourser() {
    const valeur = Number(montant) || 0;
    setEnCours(true);
    setErreur(null);
    setMessage(null);
    let succes = false;
    try {
      try {
        await payerDette(dette.id, valeur, mode, depotId || null, session.utilisateurId);
        succes = true;
      } catch (e) {
        setErreur(e instanceof ErreurAchat ? e.message : "Erreur inattendue.");
      }
    } finally {
      setEnCours(false);
    }
    if (!succes) return;
    const solde = dette.solde - valeur;
    setDette({ ...dette, montantPaye: dette.montantPaye + valeur, solde, statut: solde <= 0 ? "solde" : "en_cours" });
    setMontant("");
    setMessage(solde <= 0 ? "Remboursement enregistré : la dette est soldée." : "Remboursement enregistré.");
    chargerPaiements();
    onPaye();
  }

  async function planifier(tranches: { dateEcheance: string; montant: number }[]): Promise<string | null> {
    try {
      await planifierEcheancier(dette.id, tranches);
    } catch (e) {
      return e instanceof Error ? e.message : "Erreur inattendue.";
    }
    chargerPaiements();
    onPaye();
    return null;
  }

  async function annulerRemboursement() {
    if (!aAnnuler) return;
    setEnCours(true);
    setErreur(null);
    setMessage(null);
    let succes = false;
    try {
      try {
        await annulerPaiementDette(aAnnuler.id, session.utilisateurId, motifAnnulation);
        succes = true;
      } catch (e) {
        setErreur(e instanceof ErreurAchat ? e.message : "Erreur inattendue.");
      }
    } finally {
      setEnCours(false);
    }
    const montantAnnule = Number(aAnnuler.montant);
    setAAnnuler(null);
    if (!succes) return;
    setDette({
      ...dette,
      montantPaye: dette.montantPaye - montantAnnule,
      solde: dette.solde + montantAnnule,
      statut: "en_cours",
    });
    setMessage("Remboursement annulé : son montant est revenu dans le reste à payer.");
    chargerPaiements();
    onPaye();
  }


  const pourcentagePaye = dette.montant > 0 ? Math.min(100, Math.round((dette.montantPaye / dette.montant) * 100)) : 100;
  const resumeEcheancier = (() => {
    if (echeances.length === 0) {
      return { texte: peutGerer && dette.statut === "en_cours"
          ? "Pas d'échéancier : cliquez pour en planifier un."
          : "Pas d'échéancier.", retard: false };
    }
    const prochaine = echeances.find((e) => e.statut !== "payee");
    const payees = echeances.filter((e) => e.statut === "payee").length;
    return {
      texte:
        `${echeances.length} tranche${echeances.length > 1 ? "s" : ""} · ${payees} payée${payees > 1 ? "s" : ""}` +
        (prochaine
          ? ` · prochaine le ${new Date(`${prochaine.dateEcheance}T00:00:00`).toLocaleDateString("fr-FR")} ` +
            `(${formaterMontant(prochaine.montant - prochaine.couvert)} ${devise})` +
            (prochaine.statut === "en_retard" ? " — en retard" : "")
          : " · tout est payé"),
      retard: prochaine?.statut === "en_retard",
    };
  })();

  // Traces : ce qui a été payé à la réception (s'il y en a), puis chaque règlement.
  const regle = paiements.filter((x) => !x.annulee).reduce((t, x) => t + Number(x.montant), 0);
  const payeALaReception = Math.max(0, dette.montantPaye - regle);
  const traces = [
    ...(payeALaReception > 0
      ? [{ id: "reception", dateCreation: dette.dateCreation, origine: "Payé à la réception", mode: "", montant: payeALaReception }]
      : []),
    ...[...paiements]
      .sort((a, b) => a.dateCreation.localeCompare(b.dateCreation))
      .map((x) => ({
        id: x.id,
        dateCreation: x.dateCreation,
        origine: x.annulee ? "Remboursement annulé" : "Remboursement",
        mode: x.mode,
        montant: Number(x.montant),
        paiement: x as PaiementDetteDetail | null,
      })),
  ];
  let cumul = 0;
  const lignesTraces = traces.map((t) => {
    const annule = !!("paiement" in t && t.paiement?.annulee);
    if (!annule) cumul += t.montant;
    return { ...t, paiement: "paiement" in t ? t.paiement : null, annule, reste: Math.max(0, dette.montant - cumul) };
  });

  return (
    <div className="fond-modale" onClick={onFermer}>
      <div className="modale-selection-produits" onClick={(e) => e.stopPropagation()}>
        <EnteteModale titre={`Dette — ${dette.fournisseurNom}`} onFermer={onFermer} />
        <div className="modale-corps">
          <div className="fiche-entete">
            <div className="fiche-entete-haut">
              <div>
                <span className="sous-info">Reste à payer</span>
                <strong className={`fiche-reste${dette.solde > 0 ? " reste-dette" : ""}`}>
                  {formaterMontant(dette.solde)} {devise}
                </strong>
              </div>
              <span className={dette.statut === "solde" ? "badge-payee" : "badge-commandee"}>
                {dette.statut === "solde" ? "Soldée" : "En cours"}
              </span>
            </div>
            <div className="barre-progression" title={`${pourcentagePaye} % remboursé`}>
              <span style={{ width: `${pourcentagePaye}%` }} />
            </div>
            <span className="sous-info">
              {formaterMontant(dette.montantPaye)} / {formaterMontant(dette.montant)} {devise} remboursés ({pourcentagePaye} %)
            </span>
          </div>
          <div className="tuiles-fiche">
            <div className="tuile-fiche">
              <span className="sous-info">Commande</span>
              <strong>{dette.commandeNumero ?? "—"}</strong>
            </div>
            <div className="tuile-fiche">
              <span className="sous-info">Née le</span>
              <strong>{new Date(dette.dateCreation).toLocaleDateString("fr-FR")}</strong>
            </div>
            <div className="tuile-fiche">
              <span className="sous-info">Montant</span>
              <strong>{formaterMontant(dette.montant)} {devise}</strong>
            </div>
            <div className="tuile-fiche">
              <span className="sous-info">Déjà payé</span>
              <strong>{formaterMontant(dette.montantPaye)} {devise}</strong>
            </div>
          </div>
          <div className="cartes-fiche">
            <section className="carte-fiche">
              <h4>🚚 Fournisseur</h4>
              <strong>{dette.fournisseurNom}</strong>
              <span>📞 {fournisseur?.telephone || "Téléphone non renseigné"}</span>
              <span>👤 {fournisseur?.contact || "Contact non renseigné"}</span>
              {fournisseur?.adresse && <span>📍 {fournisseur.adresse}</span>}
            </section>
            {peutGerer && dette.statut === "en_cours" ? (
              <section className="carte-fiche carte-fiche--action">
                <h4>💸 Rembourser</h4>
                <div className="ligne-champs-fiche">
                  <ChampMontant placeholder="Montant" value={montant} onChange={setMontant} />
                  <button type="button" onClick={() => setMontant(String(dette.solde))}>
                    Tout le reste
                  </button>
                </div>
                <div className="ligne-champs-fiche">
                  <select value={mode} onChange={(e) => setMode(e.target.value)}>
                    {MODES_REGLEMENT.map((m) => (
                      <option key={m.valeur} value={m.valeur}>
                        {m.label}
                      </option>
                    ))}
                  </select>
                  {!session.depotId && (
                    <select value={depotId} onChange={(e) => setDepotId(e.target.value)}>
                      <option value="">Dépôt…</option>
                      {depots.map((d) => (
                        <option key={d.id} value={d.id}>
                          {d.nom}
                        </option>
                      ))}
                    </select>
                  )}
                </div>
                <button
                  type="button"
                  className="bouton-primaire"
                  onClick={rembourser}
                  disabled={enCours || !(Number(montant) > 0)}
                >
                  {enCours ? "…" : "Enregistrer le remboursement"}
                </button>
                {erreur && <div className="message-erreur">{erreur}</div>}
                {message && <div className="message-succes">{message}</div>}
              </section>
            ) : (
              <section className="carte-fiche">
                <h4>{dette.statut === "solde" ? "✅ Dette soldée" : "💸 Remboursement"}</h4>
                <span className="sous-info">
                  {dette.statut === "solde"
                    ? `Tout a été payé (dernière mise à jour le ${new Date(dette.dateModification).toLocaleDateString("fr-FR")}).`
                    : "Seuls les comptes qui gèrent les achats peuvent enregistrer un remboursement."}
                </span>
                {message && <div className="message-succes">{message}</div>}
              </section>
            )}
          </div>
          <div className="cartes-liens-fiche">
            <button type="button" className="carte-lien-fiche" onClick={() => setPlanification(true)} disabled={!(echeances.length > 0 || (peutGerer && dette.statut === "en_cours"))}>
              <span className="carte-lien-fiche-icone" aria-hidden="true">
                📅
              </span>
              <span className="carte-lien-fiche-corps">
                <strong>Échéancier</strong>
                <span className={resumeEcheancier.retard ? "texte-erreur" : "sous-info"}>{resumeEcheancier.texte}</span>
              </span>
              <span className="carte-lien-fiche-fleche" aria-hidden="true">
                →
              </span>
            </button>
            <button type="button" className="carte-lien-fiche" onClick={() => setTracesOuvertes(true)} disabled={false}>
              <span className="carte-lien-fiche-icone" aria-hidden="true">
                🧾
              </span>
              <span className="carte-lien-fiche-corps">
                <strong>Traces des paiements</strong>
                <span className="sous-info">{lignesTraces.length === 0
                    ? "Aucun paiement pour l'instant."
                    : `${lignesTraces.filter((x) => !x.annule).length} paiement(s)` +
                      (lignesTraces.some((x) => x.annule) ? ` · ${lignesTraces.filter((x) => x.annule).length} annulé(s)` : "") +
                      ` · dernier le ${new Date(lignesTraces[lignesTraces.length - 1].dateCreation).toLocaleDateString("fr-FR")}`}</span>
              </span>
              <span className="carte-lien-fiche-fleche" aria-hidden="true">
                →
              </span>
            </button>
          </div>

          {planification && (
            <ModaleEcheancier
              titre={`Échéancier — ${dette.fournisseurNom}`}
              reste={dette.solde}
              enCours={dette.statut === "en_cours"}
              peutGerer={peutGerer}
              echeances={echeances}
              onPlanifier={planifier}
              onFermer={() => setPlanification(false)}
            />
          )}
          {tracesOuvertes && (
            <div className="fond-modale" onClick={() => setTracesOuvertes(false)}>
              <div className="modale-selection-produits" onClick={(e) => e.stopPropagation()}>
                <EnteteModale titre={`Traces des paiements — ${dette.fournisseurNom}`} onFermer={() => setTracesOuvertes(false)} />
                <div className="modale-corps">
                  {erreur && <div className="message-erreur">{erreur}</div>}
                  {message && <div className="message-succes">{message}</div>}
                <div className="zone-tableau-scroll zone-traces-dette">
                  <table className="tableau-catalogue carte-mobile">
                    <thead>
                      <tr>
                        <th>Date</th>
                        <th>Origine</th>
                        <th>Mode</th>
                        <th>Montant</th>
                        <th>Reste après</th>
                        {peutGerer && <th className="colonne-actions-categorie" />}
                      </tr>
                    </thead>
                    <tbody>
                      {lignesTraces.map((t) => (
                        <tr key={t.id} className={t.annule ? "ligne-annulee" : undefined}>
                          <td data-label="Date">{new Date(t.dateCreation).toLocaleString("fr-FR")}</td>
                          <td data-label="Origine">
                            {t.origine}
                            {t.annule && t.paiement && (
                              <span className="sous-info">
                                {" "}
                                · le {new Date(t.paiement.dateAnnulation ?? t.dateCreation).toLocaleDateString("fr-FR")}
                                {t.paiement.annuleParId ? ` par ${nomUtilisateur(t.paiement.annuleParId)}` : ""}
                                {t.paiement.motifAnnulation ? ` · ${t.paiement.motifAnnulation}` : ""}
                              </span>
                            )}
                          </td>
                          <td data-label="Mode">{t.mode ? libelleModeReglement(t.mode) : "—"}</td>
                          <td data-label="Montant">{formaterMontant(t.montant)} {devise}</td>
                          <td data-label="Reste après">{t.annule ? "—" : `${formaterMontant(t.reste)} ${devise}`}</td>
                          {peutGerer && (
                            <td className="colonne-actions-categorie">
                              {t.paiement && !t.annule && (
                                <button
                                  type="button"
                                  className="lien-icone lien-icone-danger"
                                  title="Annuler ce remboursement"
                                  onClick={() => {
                                    setMotifAnnulation("");
                                    setAAnnuler(t.paiement);
                                  }}
                                >
                                  ×
                                </button>
                              )}
                            </td>
                          )}
                        </tr>
                      ))}
                      {lignesTraces.length === 0 && (
                        <tr>
                          <td colSpan={peutGerer ? 6 : 5} className="liste-vide">
                            Aucun paiement pour l'instant.
                          </td>
                        </tr>
                      )}
                      {Array.from({ length: Math.max(0, 10 - Math.max(1, lignesTraces.length)) }).map((_, i) => (
                        <tr key={`vide-${i}`} className="ligne-groupe-vide">
                          <td>&nbsp;</td>
                          <td>&nbsp;</td>
                          <td>&nbsp;</td>
                          <td>&nbsp;</td>
                          <td>&nbsp;</td>
                          {peutGerer && <td>&nbsp;</td>}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                  <div className="totaux">
                    <div>
                      Montant : {formaterMontant(dette.montant)} {devise} · Déjà payé : {formaterMontant(dette.montantPaye)} {devise}
                    </div>
                    <div className="total-net">
                      Reste à payer : {formaterMontant(dette.solde)} {devise}
                    </div>
                  </div>
                {aAnnuler && (
                  <ModaleConfirmation
                    titre={`Annuler le remboursement de ${formaterMontant(aAnnuler.montant)} ${devise} ?`}
                    description="Il restera visible dans les traces, marqué annulé. Son montant revient dans le reste à payer ; s'il a été payé en espèces, l'argent revient dans la caisse."
                    labelConfirmer="Annuler le remboursement"
                    dangereux
                    enCours={enCours}
                    onAnnuler={() => setAAnnuler(null)}
                    onConfirmer={annulerRemboursement}
                  >
                    <label className="champ-formulaire">
                      Motif (facultatif)
                      <input value={motifAnnulation} onChange={(e) => setMotifAnnulation(e.target.value)} autoFocus />
                    </label>
                  </ModaleConfirmation>
                )}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function OngletDettes({ session }: { session: Session }) {
  const peutGerer = !!session.permissions.gerer_produits_stock_achats;
  const devise = useDevise();
  const [statut, setStatut] = useState<StatutDette | "">("en_cours");
  const [fournisseur, setFournisseur] = useState("");
  const [recherche, setRecherche] = useState("");
  const [dettes, setDettes] = useState<DetteResume[]>([]);
  const [rembourseMois, setRembourseMois] = useState(0);
  const [detteOuverte, setDetteOuverte] = useState<DetteResume | null>(null);
  const [depots, setDepots] = useState<DepotResume[]>([]);

  async function rafraichir() {
    setDettes(await listerDettes(session.boutiqueId));
    const debutMois = new Date();
    debutMois.setDate(1);
    debutMois.setHours(0, 0, 0, 0);
    setRembourseMois(await montantRembourseDettesDepuis(session.boutiqueId, debutMois.toISOString()));
  }
  useEffect(() => {
    rafraichir();
    if (!session.depotId) listerDepotsDetail(session.boutiqueId).then(setDepots);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const enCours = dettes.filter((d) => d.statut === "en_cours");
  const enRetard = enCours.filter((d) => d.prochaineEcheance?.enRetard).length;
  const fournisseurs = [...new Set(dettes.map((d) => d.fournisseurNom))].sort((a, b) => a.localeCompare(b, "fr"));
  const cle = recherche.trim().toLowerCase();
  // Les dettes en retard d'abord, puis les plus anciennes.
  const dettesFiltrees = dettes
    .filter(
      (d) =>
        (!statut || d.statut === statut) &&
        (!fournisseur || d.fournisseurNom === fournisseur) &&
        (!cle || (d.commandeNumero ?? "").toLowerCase().includes(cle)),
    )
    .sort(
      (a, b) =>
        Number(!!b.prochaineEcheance?.enRetard) - Number(!!a.prochaineEcheance?.enRetard) ||
        a.dateCreation.localeCompare(b.dateCreation),
    );
  const pourcentage = (d: DetteResume) =>
    d.montant > 0 ? Math.min(100, Math.round((d.montantPaye / d.montant) * 100)) : 100;
  const somme = (valeurs: number[]) => valeurs.reduce((t, v) => t + v, 0);

  return (
    <div className="liste-dettes-credits">
      {detteOuverte && (
        <ModaleDette
          dette={detteOuverte}
          session={session}
          depots={depots}
          onFermer={() => setDetteOuverte(null)}
          onPaye={rafraichir}
        />
      )}
      <div className="tuiles-fiche">
        <div className="tuile-fiche">
          <span className="sous-info">💰 Total dû</span>
          <strong>
            {formaterMontant(somme(enCours.map((d) => d.solde)))} {devise}
          </strong>
        </div>
        <div className="tuile-fiche">
          <span className="sous-info">📄 Dettes en cours</span>
          <strong>{enCours.length}</strong>
        </div>
        <div className={`tuile-fiche${enRetard > 0 ? " tuile-fiche--alerte" : ""}`}>
          <span className="sous-info">🔴 En retard</span>
          <strong>{enRetard}</strong>
        </div>
        <div className="tuile-fiche">
          <span className="sous-info">✅ Remboursé ce mois</span>
          <strong>
            {formaterMontant(rembourseMois)} {devise}
          </strong>
        </div>
      </div>
      <div className="barre-actions barre-filtres-historique">
        <select value={statut} onChange={(e) => setStatut(e.target.value as StatutDette | "")}>
          <option value="en_cours">En cours</option>
          <option value="solde">Soldées</option>
          <option value="">Toutes</option>
        </select>
        <select value={fournisseur} onChange={(e) => setFournisseur(e.target.value)}>
          <option value="">Tous les fournisseurs</option>
          {fournisseurs.map((nom) => (
            <option key={nom} value={nom}>
              {nom}
            </option>
          ))}
        </select>
        <input
          type="search"
          placeholder="N° de commande…"
          value={recherche}
          onChange={(e) => setRecherche(e.target.value)}
        />
      </div>
      <div className="zone-tableau-scroll">
        <table className="tableau-catalogue carte-mobile">
          <thead>
            <tr>
              <th>N°</th>
              <th>Date</th>
              <th>Fournisseur</th>
              <th>Commande</th>
              <th>Montant</th>
              <th>Remboursé</th>
              <th>Reste</th>
              <th>Prochaine échéance</th>
              <th>Statut</th>
              {peutGerer && <th />}
            </tr>
          </thead>
          <tbody>
            {dettesFiltrees.map((d, index) => (
              <tr
                key={d.id}
                className="ligne-reception-cliquable"
                onClick={() => setDetteOuverte(d)}
                title="Voir la dette"
              >
                  <td data-label="N°">{index + 1}</td>
                  <td data-label="Date">{new Date(d.dateCreation).toLocaleDateString("fr-FR")}</td>
                  <td data-label="Fournisseur">{d.fournisseurNom}</td>
                  <td data-label="Commande">{d.commandeNumero ?? "—"}</td>
                  <td data-label="Montant"><span className="nowrap">{formaterMontant(d.montant)} {devise}</span></td>
                  <td data-label="Remboursé"><span className="mini-progression">
                    <span className="barre-progression">
                      <span style={{ width: `${pourcentage(d)}%` }} />
                    </span>
                    <span className="sous-info">{pourcentage(d)} %</span>
                  </span></td>
                  <td data-label="Reste"><strong className="nowrap">{formaterMontant(d.solde)} {devise}</strong></td>
                  <td data-label="Prochaine échéance">{d.prochaineEcheance ? (
                    <span className={d.prochaineEcheance.enRetard ? "texte-erreur nowrap" : "nowrap"}>
                      {new Date(`${d.prochaineEcheance.date}T00:00:00`).toLocaleDateString("fr-FR")} ·{" "}
                      {formaterMontant(d.prochaineEcheance.reste)}
                      {d.prochaineEcheance.enRetard && " (en retard)"}
                    </span>
                  ) : (
                    "—"
                  )}</td>
                  <td data-label="Statut"><span className={`nowrap ${d.statut === "solde" ? "badge-payee" : "badge-commandee"}`}>
                    {d.statut === "solde" ? "Soldée" : "En cours"}
                  </span></td>
                {peutGerer && (
                  <td data-label="Action">{d.statut === "en_cours" && (
                      <button
                        type="button"
                        className="bouton-primaire nowrap"
                        onClick={(e) => {
                          e.stopPropagation();
                          setDetteOuverte(d);
                        }}
                      >
                        Rembourser
                      </button>
                    )}</td>
                )}
              </tr>
            ))}
            {dettesFiltrees.length === 0 && (
              <tr>
                <td colSpan={peutGerer ? 10 : 9} className="liste-vide">
                  Aucune dette pour ces filtres.
                </td>
              </tr>
            )}
            {Array.from({ length: Math.max(0, 10 - Math.max(1, dettesFiltrees.length)) }).map((_, i) => (
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
                {peutGerer && <td>&nbsp;</td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {dettesFiltrees.length > 0 && (
        <div className="totaux">
          <div>
            {dettesFiltrees.length} dette{dettesFiltrees.length > 1 ? "s" : ""} · Montant :{" "}
            {formaterMontant(somme(dettesFiltrees.map((d) => d.montant)))} {devise} · Remboursé :{" "}
            {formaterMontant(somme(dettesFiltrees.map((d) => d.montantPaye)))} {devise}
          </div>
          <div className="total-net">
            Reste : {formaterMontant(somme(dettesFiltrees.map((d) => d.solde)))} {devise}
          </div>
        </div>
      )}
    </div>
  );
}

function ModaleCommandes({
  session,
  ouvrirFormulaireInitial,
  lignesInitiales,
  onFormulaireInitialConsomme,
  onFermer,
}: {
  session: Session;
  ouvrirFormulaireInitial?: boolean;
  lignesInitiales?: LigneAchatInitiale[];
  onFormulaireInitialConsomme?: () => void;
  onFermer: () => void;
}) {
  return (
    <div className="fond-modale" onClick={onFermer}>
      <div className="modale-selection-produits" onClick={(e) => e.stopPropagation()}>
        <EnteteModale titre="Commandes" onFermer={onFermer} />
        <div className="modale-corps">
          <OngletCommandes
            session={session}
            ouvrirFormulaireInitial={ouvrirFormulaireInitial}
            lignesInitiales={lignesInitiales}
            onFormulaireInitialConsomme={onFormulaireInitialConsomme}
          />
        </div>
      </div>
    </div>
  );
}

function ModaleReception({ session, onFermer }: { session: Session; onFermer: () => void }) {
  return (
    <div className="fond-modale" onClick={onFermer}>
      <div className="modale-selection-produits" onClick={(e) => e.stopPropagation()}>
        <EnteteModale titre="Réceptionner" onFermer={onFermer} />
        <div className="modale-corps">
          <OngletReception session={session} />
        </div>
      </div>
    </div>
  );
}

function ModaleFournisseurs({ session, onFermer }: { session: Session; onFermer: () => void }) {
  return (
    <div className="fond-modale" onClick={onFermer}>
      <div className="modale-selection-produits" onClick={(e) => e.stopPropagation()}>
        <EnteteModale titre="Fournisseurs" onFermer={onFermer} />
        <div className="modale-corps">
          <OngletFournisseurs session={session} />
        </div>
      </div>
    </div>
  );
}

function ModaleDettes({ session, onFermer }: { session: Session; onFermer: () => void }) {
  return (
    <div className="fond-modale" onClick={onFermer}>
      <div className="modale-selection-produits" onClick={(e) => e.stopPropagation()}>
        <EnteteModale titre="Dettes" onFermer={onFermer} />
        <div className="modale-corps">
          <OngletDettes session={session} />
        </div>
      </div>
    </div>
  );
}

/** Détail d'une réception (articles, paiement, retours), avec annulation et
 * retour fournisseur. Ouvert depuis l'historique d'une commande ou de toutes
 * les réceptions. */
function ModaleRetourFournisseur({
  session,
  reception,
  onAnnuler,
  onTermine,
}: {
  session: Session;
  reception: ReceptionDetail;
  onAnnuler: () => void;
  onTermine: (resultat: { montant: number; avoir: number }) => void;
}) {
  const [quantites, setQuantites] = useState<Record<string, string>>({});
  const [motif, setMotif] = useState("");
  const [erreur, setErreur] = useState<string | null>(null);
  const [enCours, setEnCours] = useState(false);
  const lignes = reception.lignes.map((l) => ({ ...l, disponible: l.quantite - l.quantiteRetournee }));
  const aRetourner = lignes
    .map((l) => ({ varianteId: l.varianteId, quantite: Number(quantites[l.varianteId]) || 0 }))
    .filter((l) => l.quantite > 0);
  const invalide = lignes.some((l) => (Number(quantites[l.varianteId]) || 0) > l.disponible);

  async function valider(evenement: React.FormEvent) {
    evenement.preventDefault();
    setErreur(null);
    if (aRetourner.length === 0 || invalide) {
      setErreur("Indiquez des quantités à retourner, sans dépasser ce qui a été reçu.");
      return;
    }
    setEnCours(true);
    try {
      const resultat = await retournerAuFournisseur({
        receptionId: reception.id,
        lignes: aRetourner,
        motif,
        utilisateurId: session.utilisateurId,
      });
      onTermine(resultat);
    } catch (e) {
      setErreur(e instanceof ErreurAchat ? e.message : "Erreur inattendue.");
    } finally {
      setEnCours(false);
    }
  }

  return (
    <div className="fond-modale" onClick={onAnnuler}>
      <div className="modale-selection-produits" onClick={(e) => e.stopPropagation()}>
        <form onSubmit={valider} className="formulaire-destockage">
          <div className="modale-entete entete-fixe">
            <h3>Retour fournisseur</h3>
            <div className="actions-formulaire">
              <button type="submit" className="bouton-primaire" disabled={enCours || aRetourner.length === 0 || invalide}>
                {enCours ? "Enregistrement…" : "Valider le retour"}
              </button>
              <button type="button" className="lien bouton-retour" onClick={onAnnuler}>
                ← Retour
              </button>
            </div>
          </div>
          {erreur && <div className="message-erreur">{erreur}</div>}
          <p className="note-aide">
            Les articles retournés sortent du stock du dépôt {reception.depotNom}. La dette de cette réception baisse
            du montant retourné (au prix d'achat) ; si elle est déjà réglée, l'appli note un avoir à récupérer.
          </p>
          <div className="zone-tableau-scroll">
            <table className="tableau-catalogue carte-mobile">
              <thead>
                <tr>
                  <th>Article</th>
                  <th>Reçu</th>
                  <th>Déjà retourné</th>
                  <th>Quantité à retourner</th>
                </tr>
              </thead>
              <tbody>
                {lignes.map((l) => (
                  <tr key={l.varianteId}>
                    <td data-label="Article">
                      {l.produitNom} {l.reference && <span className="sous-info">({l.reference})</span>}
                    </td>
                    <td data-label="Reçu">{l.quantite}</td>
                    <td data-label="Déjà retourné">{l.quantiteRetournee}</td>
                    <td data-label="Quantité à retourner">
                      <input
                        type="number"
                        min={0}
                        max={l.disponible}
                        step="any"
                        disabled={l.disponible <= 0}
                        className={(Number(quantites[l.varianteId]) || 0) > l.disponible ? "champ-invalide" : undefined}
                        value={quantites[l.varianteId] ?? ""}
                        onChange={(e) => setQuantites((q) => ({ ...q, [l.varianteId]: e.target.value }))}
                      />
                      <span className="sous-info"> / {l.disponible}</span>
                    </td>
                  </tr>
                ))}
                {Array.from({ length: Math.max(0, 10 - lignes.length) }).map((_, i) => (
                  <tr key={`vide-${i}`} className="ligne-groupe-vide">
                    <td>&nbsp;</td>
                    <td>&nbsp;</td>
                    <td>&nbsp;</td>
                    <td>&nbsp;</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <label className="champ-nom-operation">
            Motif du retour
            <input
              value={motif}
              onChange={(e) => setMotif(e.target.value)}
              placeholder="ex. Sacs percés, erreur de livraison…"
            />
          </label>
        </form>
      </div>
    </div>
  );
}

function ModaleDetailReception({
  session,
  reception,
  commandeNumero,
  fournisseurNom,
  onFermer,
  onModifie,
}: {
  session: Session;
  reception: ReceptionDetail;
  commandeNumero?: string;
  fournisseurNom?: string;
  onFermer: () => void;
  /** Après une annulation ou un retour : le parent recharge ses données. */
  onModifie: () => void;
}) {
  const devise = useDevise();
  const nomUtilisateur = useNomsUtilisateurs(session);
  const peutGerer = !!session.permissions.gerer_produits_stock_achats;
  const [confirmerAnnulation, setConfirmerAnnulation] = useState(false);
  const [afficherRetour, setAfficherRetour] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [enCours, setEnCours] = useState(false);
  const quantiteArticles = reception.lignes.reduce((somme, l) => somme + Number(l.quantite), 0);
  const aDesRetours = reception.retours.length > 0;
  const resteARetourner = reception.lignes.some((l) => l.quantite - l.quantiteRetournee > 0);

  async function annuler() {
    setEnCours(true);
    setErreur(null);
    try {
      const resultat = await annulerReception(reception.id, session.utilisateurId);
      setMessage(
        resultat.montantARecuperer > 0
          ? `Réception annulée. Récupérez ${formaterMontant(resultat.montantARecuperer)} ${devise} payés sur place auprès du fournisseur.`
          : "Réception annulée : la marchandise est sortie du stock et la commande attend de nouveau ces articles.",
      );
    } catch (e) {
      setErreur(e instanceof ErreurAchat ? e.message : "Erreur inattendue.");
    } finally {
      setEnCours(false);
      setConfirmerAnnulation(false);
    }
  }

  const fermer = message ? onModifie : onFermer;

  return (
    <div className="fond-modale" onClick={fermer}>
      <div className="modale-selection-produits" onClick={(e) => e.stopPropagation()}>
        <div className="modale-entete">
          <h3>
            Réception du {new Date(reception.dateCreation).toLocaleString("fr-FR")}{" "}
            {reception.annulee && <span className="badge-brouillon">Annulée</span>}
          </h3>
          <div className="actions-formulaire">
            {peutGerer && !reception.annulee && !message && (
              <>
                {resteARetourner && (
                  <button type="button" onClick={() => setAfficherRetour(true)}>
                    ↩ Retour fournisseur
                  </button>
                )}
                {!aDesRetours && (
                  <button type="button" className="bouton-danger" onClick={() => setConfirmerAnnulation(true)}>
                    Annuler la réception
                  </button>
                )}
              </>
            )}
            <button type="button" className="lien bouton-retour" onClick={fermer}>
              ← Retour
            </button>
          </div>
        </div>
        <div className="modale-corps">
          {erreur && <div className="message-erreur">{erreur}</div>}
          {message && <div className="message-succes">{message}</div>}
          <div className="infos-reception">
            {commandeNumero && (
              <div>
                <span className="sous-info">Commande</span>
                <strong>{commandeNumero}</strong>
              </div>
            )}
            {fournisseurNom && (
              <div>
                <span className="sous-info">Fournisseur</span>
                <strong>{fournisseurNom}</strong>
              </div>
            )}
            <div>
              <span className="sous-info">Dépôt</span>
              <strong>{reception.depotNom}</strong>
            </div>
            <div>
              <span className="sous-info">Réceptionné par</span>
              <strong>{nomUtilisateur(reception.utilisateurId)}</strong>
            </div>
          </div>
          <div className="zone-tableau-scroll">
            <table className="tableau-catalogue carte-mobile">
              <thead>
                <tr>
                  <th>Désignation</th>
                  <th>Référence</th>
                  <th>Quantité reçue</th>
                  {aDesRetours && <th>Retourné</th>}
                </tr>
              </thead>
              <tbody>
                {reception.lignes.map((l, i) => (
                  <tr key={i}>
                    <td data-label="Désignation">{l.produitNom}</td>
                    <td data-label="Référence">{l.reference}</td>
                    <td data-label="Quantité reçue">{l.quantite}</td>
                    {aDesRetours && <td data-label="Retourné">{l.quantiteRetournee || ""}</td>}
                  </tr>
                ))}
                {reception.lignes.length === 0 && (
                  <tr>
                    <td colSpan={3} className="liste-vide">
                      Détail des articles non disponible pour cette réception.
                    </td>
                  </tr>
                )}
                {Array.from({ length: Math.max(0, 10 - Math.max(1, reception.lignes.length)) }).map((_, i) => (
                  <tr key={`vide-${i}`} className="ligne-groupe-vide">
                    <td>&nbsp;</td>
                    <td>&nbsp;</td>
                    <td>&nbsp;</td>
                    {aDesRetours && <td>&nbsp;</td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {aDesRetours && (
            <>
              <h4>Retours fournisseur</h4>
              <div className="zone-tableau-scroll">
                <table className="tableau-catalogue carte-mobile">
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Articles</th>
                      <th>Motif</th>
                      <th>Montant</th>
                      <th>Avoir à récupérer</th>
                      <th>Fait par</th>
                    </tr>
                  </thead>
                  <tbody>
                    {reception.retours.map((r) => (
                      <tr key={r.id}>
                        <td data-label="Date">{new Date(r.dateCreation).toLocaleDateString("fr-FR")}</td>
                        <td data-label="Articles">{r.lignes.map((l) => `${l.quantite} × ${l.produitNom}`).join(", ")}</td>
                        <td data-label="Motif">{r.motif || "—"}</td>
                        <td data-label="Montant">
                          {formaterMontant(r.montant)} {devise}
                        </td>
                        <td data-label="Avoir à récupérer">{r.avoir > 0 ? `${formaterMontant(r.avoir)} ${devise}` : "—"}</td>
                        <td data-label="Fait par">{nomUtilisateur(r.utilisateurId)}</td>
                      </tr>
                    ))}
                    {Array.from({ length: Math.max(0, 10 - reception.retours.length) }).map((_, i) => (
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
                </table>
              </div>
            </>
          )}
          <div className="totaux">
            <div>Articles reçus : {reception.lignes.length > 0 ? quantiteArticles : "—"}</div>
            <div>
              Valeur reçue : {formaterMontant(reception.valeurRecue)} {devise}
            </div>
            <div>
              Payé à la réception : {formaterMontant(reception.montantPaye)} {devise}
            </div>
            <div className="total-net">
              Reste dû : {formaterMontant(Math.max(0, reception.valeurRecue - reception.montantPaye))} {devise}
            </div>
          </div>
        </div>
      </div>
      {confirmerAnnulation && (
        <ModaleConfirmation
          titre="Annuler cette réception ?"
          description="La marchandise ressort du stock, la commande attend de nouveau ces articles et la dette de cette réception est annulée. La réception reste visible, marquée « Annulée »."
          labelConfirmer="Annuler la réception"
          dangereux
          enCours={enCours}
          onAnnuler={() => setConfirmerAnnulation(false)}
          onConfirmer={annuler}
        />
      )}
      {afficherRetour && (
        <ModaleRetourFournisseur
          session={session}
          reception={reception}
          onAnnuler={() => setAfficherRetour(false)}
          onTermine={(resultat) => {
            setAfficherRetour(false);
            setMessage(
              resultat.avoir > 0
                ? `Retour enregistré : ${formaterMontant(resultat.montant)} ${devise}, dont ${formaterMontant(resultat.avoir)} ${devise} à récupérer auprès du fournisseur (avoir).`
                : `Retour enregistré : ${formaterMontant(resultat.montant)} ${devise} déduits de la dette.`,
            );
          }}
        />
      )}
    </div>
  );
}


/** Historique de toutes les réceptions, toutes commandes confondues. Chaque
 * ligne se déplie pour montrer les articles livrés à cette réception. */
/** Tous les paiements faits à un fournisseur (sans les filtres de l'historique),
 * avec ce qui lui reste dû. */
function ModalePaiementsFournisseur({
  session,
  fournisseurNom,
  paiements,
  onFermer,
}: {
  session: Session;
  fournisseurNom: string;
  paiements: PaiementFournisseurHistorique[];
  onFermer: () => void;
}) {
  const devise = useDevise();
  const [resteAPayer, setResteAPayer] = useState<number | null>(null);
  useEffect(() => {
    listerDettes(session.boutiqueId).then((liste) =>
      setResteAPayer(
        liste
          .filter((d) => d.fournisseurNom === fournisseurNom && d.statut === "en_cours")
          .reduce((t, d) => t + Number(d.solde), 0),
      ),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fournisseurNom]);

  const valides = paiements.filter((x) => !x.annulee);
  const somme = (liste: PaiementFournisseurHistorique[]) => liste.reduce((t, x) => t + x.montant, 0);

  return (
    <div className="fond-modale" onClick={onFermer}>
      <div className="modale-selection-produits" onClick={(e) => e.stopPropagation()}>
        <EnteteModale titre={`Paiements à ${fournisseurNom}`} onFermer={onFermer} />
        <div className="modale-corps">
          <div className="zone-tableau-scroll">
            <table className="tableau-catalogue carte-mobile">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Commande</th>
                  <th>Origine</th>
                  <th>Mode</th>
                  <th>Montant</th>
                </tr>
              </thead>
              <tbody>
                {paiements.map((x) => (
                  <tr key={x.id} className={x.annulee ? "ligne-annulee" : undefined}>
                    <td data-label="Date">{new Date(x.dateCreation).toLocaleString("fr-FR")}{" "}{x.annulee && (
                      <span className="badge-brouillon">{x.origine === "reception" ? "Réception annulée" : "Annulé"}</span>
                    )}</td>
                    <td data-label="Commande">{x.commandeNumero ?? "—"}</td>
                    <td data-label="Origine">{x.origine === "reception" ? "À la réception" : "Règlement de dette"}</td>
                    <td data-label="Mode">{x.mode ? libelleModeReglement(x.mode) : "—"}</td>
                    <td data-label="Montant">{formaterMontant(x.montant)} {devise}</td>
                  </tr>
                ))}
                {paiements.length === 0 && (
                  <tr>
                    <td colSpan={5} className="liste-vide">
                      Aucun paiement à ce fournisseur.
                    </td>
                  </tr>
                )}
                {Array.from({ length: Math.max(0, 10 - Math.max(1, paiements.length)) }).map((_, i) => (
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
          <div className="totaux">
            <div>
              {valides.length} paiement{valides.length > 1 ? "s" : ""} · À la réception :{" "}
              {formaterMontant(somme(valides.filter((x) => x.origine === "reception")))} {devise} · Règlements de dette :{" "}
              {formaterMontant(somme(valides.filter((x) => x.origine === "dette")))} {devise}
            </div>
            {resteAPayer !== null && (
              <div>
                Reste à payer : {formaterMontant(resteAPayer)} {devise}
              </div>
            )}
            <div className="total-net">
              Total payé : {formaterMontant(somme(valides))} {devise}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Dettes soldées d'un fournisseur (historique), avec la date où chacune l'a été. */
function ModaleDettesFournisseur({
  fournisseurNom,
  dettes,
  onFermer,
}: {
  fournisseurNom: string;
  dettes: DetteResume[];
  onFermer: () => void;
}) {
  const devise = useDevise();
  const triees = [...dettes].sort((a, b) => b.dateModification.localeCompare(a.dateModification));
  return (
    <div className="fond-modale" onClick={onFermer}>
      <div className="modale-selection-produits" onClick={(e) => e.stopPropagation()}>
        <EnteteModale titre={`Dettes soldées — ${fournisseurNom}`} onFermer={onFermer} />
        <div className="modale-corps">
          <div className="zone-tableau-scroll">
            <table className="tableau-catalogue carte-mobile">
              <thead>
                <tr>
                  <th>Née le</th>
                  <th>Commande</th>
                  <th>Montant</th>
                  <th>Réglé</th>
                  <th>Soldée le</th>
                </tr>
              </thead>
              <tbody>
                {triees.map((d) => (
                  <tr key={d.id}>
                    <td data-label="Née le">{new Date(d.dateCreation).toLocaleDateString("fr-FR")}</td>
                    <td data-label="Commande">{d.commandeNumero ?? "—"}</td>
                    <td data-label="Montant">{formaterMontant(d.montant)} {devise}</td>
                    <td data-label="Réglé">{formaterMontant(d.montantPaye)} {devise}</td>
                    <td data-label="Soldée le">{new Date(d.dateModification).toLocaleDateString("fr-FR")}</td>
                  </tr>
                ))}
                {Array.from({ length: Math.max(0, 10 - triees.length) }).map((_, i) => (
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
          <div className="totaux">
            <div>
              {triees.length} dette{triees.length > 1 ? "s" : ""} soldée{triees.length > 1 ? "s" : ""}
            </div>
            <div className="total-net">
              Montant réglé : {formaterMontant(triees.reduce((t, d) => t + Number(d.montant), 0))} {devise}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Nom de fournisseur cliquable dans l'historique : filtre sur ce fournisseur. */
function LienFournisseur({ nom, onFiltrer }: { nom: string; onFiltrer: (nom: string) => void }) {
  return (
    <button
      type="button"
      className="lien-fournisseur"
      title="Filtrer sur ce fournisseur"
      onClick={(e) => {
        e.stopPropagation();
        onFiltrer(nom);
      }}
    >
      {nom}
    </button>
  );
}

type SectionHistoriqueAchats = "commandes" | "receptions" | "paiements" | "dettes" | "retours";

/** Carte « Historique » : tout ce qui s'est passé côté achats, filtrable par
 * période, fournisseur et numéro de commande (sans limite de nombre). */
export function ModaleHistoriqueAchats({
  session,
  sectionInitiale = "commandes",
  onFermer,
}: {
  session: Session;
  sectionInitiale?: SectionHistoriqueAchats;
  onFermer: () => void;
}) {
  const devise = useDevise();
  const nomUtilisateur = useNomsUtilisateurs(session);
  const [section, setSection] = useState<SectionHistoriqueAchats>(sectionInitiale);
  const [historique, setHistorique] = useState<HistoriqueAchats>({
    commandes: [],
    receptions: [],
    paiements: [],
    retours: [],
  });
  const [fournisseurs, setFournisseurs] = useState<FournisseurResume[]>([]);
  const [dettes, setDettes] = useState<DetteResume[]>([]);
  const [periode, setPeriode] = useState<PeriodeHistorique>("tout");
  const [debutPerso, setDebutPerso] = useState(jourLocal(new Date()));
  const [finPerso, setFinPerso] = useState(jourLocal(new Date()));
  const [fournisseur, setFournisseur] = useState("");
  const [recherche, setRecherche] = useState("");
  const [statut, setStatut] = useState<StatutCommande | "">("");
  const [commandeOuverteId, setCommandeOuverteId] = useState<string | null>(null);
  const [receptionOuverte, setReceptionOuverte] = useState<ReceptionHistorique | null>(null);
  const [fournisseurPaiements, setFournisseurPaiements] = useState<string | null>(null);
  const [fournisseurDettes, setFournisseurDettes] = useState<string | null>(null);

  function recharger() {
    listerDettes(session.boutiqueId).then(setDettes);
    historiqueAchats(session.boutiqueId).then(setHistorique);
  }
  useEffect(() => {
    recharger();
    listerFournisseurs(session.boutiqueId).then(setFournisseurs);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.boutiqueId]);

  const bornes = bornesPeriode(periode, debutPerso, finPerso);
  const cle = recherche.trim().toLowerCase();
  const garder = (x: { dateCreation: string; fournisseurNom: string; commandeNumero?: string | null; numero?: string }) =>
    dansPeriode(x.dateCreation, bornes) &&
    (!fournisseur || x.fournisseurNom === fournisseur) &&
    (!cle || (x.numero ?? x.commandeNumero ?? "").toLowerCase().includes(cle));
  // Historique = commandes terminées ; brouillons et commandes en cours restent dans la carte « Commandes ».
  const commandesFiltrees = historique.commandes.filter(
    (c) => (c.statut === "recue" || c.statut === "annulee") && garder(c) && (!statut || c.statut === statut),
  );
  const receptionsFiltrees = historique.receptions.filter(garder);
  const paiementsFiltres = historique.paiements.filter(garder);
  const retoursFiltres = historique.retours.filter(garder);

  // Dettes : historique des dettes soldées, une ligne par fournisseur (période = date où elle a été soldée).
  const dettesSoldees = dettes.filter(
    (d) =>
      d.statut === "solde" &&
      garder({ dateCreation: d.dateModification, fournisseurNom: d.fournisseurNom, commandeNumero: d.commandeNumero }),
  );
  const dettesParFournisseur = [
    ...dettesSoldees
      .reduce((groupes, d) => groupes.set(d.fournisseurNom, [...(groupes.get(d.fournisseurNom) ?? []), d]), new Map<
        string,
        DetteResume[]
      >())
      .entries(),
  ]
    .map(([fournisseurNom, liste]) => ({
      fournisseurNom,
      nombre: liste.length,
      commandes: new Set(liste.map((d) => d.commandeId).filter(Boolean)).size,
      montant: liste.reduce((t, d) => t + Number(d.montant), 0),
      premiere: liste.reduce((p, d) => (!p || d.dateCreation < p ? d.dateCreation : p), ""),
      derniere: liste.reduce((p, d) => (d.dateModification > p ? d.dateModification : p), ""),
    }))
    .sort((a, b) => b.derniere.localeCompare(a.derniere));

  // Paiements fournisseur : une ligne par fournisseur (le détail daté s'ouvre au clic).
  const resteParFournisseur = new Map<string, number>();
  for (const d of dettes) {
    if (d.statut === "en_cours") {
      resteParFournisseur.set(d.fournisseurNom, (resteParFournisseur.get(d.fournisseurNom) ?? 0) + Number(d.solde));
    }
  }
  const paiementsParFournisseur = [
    ...paiementsFiltres
      .reduce((groupes, x) => groupes.set(x.fournisseurNom, [...(groupes.get(x.fournisseurNom) ?? []), x]), new Map<
        string,
        PaiementFournisseurHistorique[]
      >())
      .entries(),
  ]
    .map(([fournisseurNom, liste]) => {
      const valides = liste.filter((x) => !x.annulee);
      const total = (origine?: string) =>
        valides.filter((x) => !origine || x.origine === origine).reduce((t, x) => t + x.montant, 0);
      return {
        fournisseurNom,
        nombre: valides.length,
        aLaReception: total("reception"),
        reglements: total("dette"),
        totalPaye: total(),
        resteAPayer: resteParFournisseur.get(fournisseurNom) ?? 0,
        dernier: liste.reduce((d, x) => (x.dateCreation > d ? x.dateCreation : d), ""),
      };
    })
    .sort((a, b) => b.dernier.localeCompare(a.dernier));

  const commandesValides = commandesFiltrees.filter((c) => c.statut !== "annulee");
  const somme = (valeurs: number[]) => valeurs.reduce((t, v) => t + v, 0);

  const montant = (v: number) => `${formaterMontant(v)} ${devise}`;
  const receptionsValides = receptionsFiltrees.filter((r) => !r.annulee);
  const paiementsValides = paiementsFiltres.filter((x) => !x.annulee);
  const tuilesSection: [string, string][] =
    section === "commandes"
      ? [
          ["🧾 Commandes", String(commandesFiltrees.length)],
          ["💰 Commandé", montant(somme(commandesValides.map((c) => c.total)))],
          ["📥 Reçu", montant(somme(commandesValides.map((c) => c.valeurRecue)))],
          ["❌ Annulées", String(commandesFiltrees.length - commandesValides.length)],
        ]
      : section === "receptions"
        ? [
            ["📥 Réceptions", String(receptionsFiltrees.length)],
            ["📦 Valeur reçue", montant(somme(receptionsValides.map((r) => r.valeurRecue)))],
            ["💵 Payé à la réception", montant(somme(receptionsValides.map((r) => r.montantPaye)))],
            ["❌ Annulées", String(receptionsFiltrees.length - receptionsValides.length)],
          ]
        : section === "paiements"
          ? [
              ["💰 Total payé", montant(somme(paiementsValides.map((x) => x.montant)))],
              ["🚚 Fournisseurs payés", String(paiementsParFournisseur.length)],
              ["🧾 Paiements", String(paiementsValides.length)],
              ["⬆️ Plus gros paiement", montant(paiementsValides.length ? Math.max(...paiementsValides.map((x) => x.montant)) : 0)],
            ]
          : section === "dettes"
            ? [
                ["🧾 Dettes soldées", String(dettesSoldees.length)],
                ["🚚 Fournisseurs", String(dettesParFournisseur.length)],
                ["✅ Montant réglé", montant(somme(dettesSoldees.map((d) => Number(d.montant))))],
              ]
            : [
                ["↩️ Retours", String(retoursFiltres.length)],
                ["💸 Montant retourné", montant(somme(retoursFiltres.map((r) => r.montant)))],
                ["🎁 Avoirs à récupérer", montant(somme(retoursFiltres.map((r) => r.avoir)))],
              ];

  const jour = (iso: string) => (iso ? new Date(iso).toLocaleDateString("fr-FR") : "");
  const exportSection: { titre: string; colonnes: ColonneExport[]; lignes: Record<string, unknown>[] } =
    section === "commandes"
      ? {
          titre: "Historique des commandes",
          colonnes: [
            { cle: "date", libelle: "Date" },
            { cle: "numero", libelle: "Numéro" },
            { cle: "fournisseur", libelle: "Fournisseur" },
            { cle: "statut", libelle: "Statut" },
            { cle: "total", libelle: "Total" },
            { cle: "recu", libelle: "Reçu" },
            { cle: "faitPar", libelle: "Fait par" },
          ],
          lignes: commandesFiltrees.map((c) => ({
            date: jour(c.dateCreation),
            numero: c.numero,
            fournisseur: c.fournisseurNom,
            statut: libelleStatutCommande(c.statut),
            total: c.total,
            recu: c.valeurRecue,
            faitPar: nomUtilisateur(c.utilisateurId),
          })),
        }
      : section === "receptions"
        ? {
            titre: "Historique des réceptions",
            colonnes: [
              { cle: "date", libelle: "Date" },
              { cle: "commande", libelle: "Commande" },
              { cle: "fournisseur", libelle: "Fournisseur" },
              { cle: "depot", libelle: "Dépôt" },
              { cle: "articles", libelle: "Articles" },
              { cle: "valeur", libelle: "Valeur reçue" },
              { cle: "paye", libelle: "Montant payé" },
              { cle: "annulee", libelle: "Annulée" },
              { cle: "faitPar", libelle: "Fait par" },
            ],
            lignes: receptionsFiltrees.map((r) => ({
              date: jour(r.dateCreation),
              commande: r.commandeNumero,
              fournisseur: r.fournisseurNom,
              depot: r.depotNom,
              articles: r.lignes.reduce((t, l) => t + Number(l.quantite), 0),
              valeur: r.valeurRecue,
              paye: r.montantPaye,
              annulee: r.annulee ? "Oui" : "",
              faitPar: nomUtilisateur(r.utilisateurId),
            })),
          }
        : section === "paiements"
          ? {
              titre: "Paiements fournisseur",
              colonnes: [
                { cle: "fournisseur", libelle: "Fournisseur" },
                { cle: "nombre", libelle: "Paiements" },
                { cle: "aLaReception", libelle: "Payé à la réception" },
                { cle: "reglements", libelle: "Règlements de dette" },
                { cle: "totalPaye", libelle: "Total payé" },
                { cle: "resteAPayer", libelle: "Reste à payer" },
                { cle: "dernier", libelle: "Dernier paiement" },
              ],
              lignes: paiementsParFournisseur.map((f) => ({
                fournisseur: f.fournisseurNom,
                nombre: f.nombre,
                aLaReception: f.aLaReception,
                reglements: f.reglements,
                totalPaye: f.totalPaye,
                resteAPayer: f.resteAPayer,
                dernier: jour(f.dernier),
              })),
            }
          : section === "dettes"
            ? {
                titre: "Dettes soldées",
                colonnes: [
                  { cle: "fournisseur", libelle: "Fournisseur" },
                  { cle: "nombre", libelle: "Dettes soldées" },
                  { cle: "commandes", libelle: "Commandes" },
                  { cle: "montant", libelle: "Montant réglé" },
                  { cle: "premiere", libelle: "Première dette" },
                  { cle: "derniere", libelle: "Dernière soldée le" },
                ],
                lignes: dettesParFournisseur.map((f) => ({
                  fournisseur: f.fournisseurNom,
                  nombre: f.nombre,
                  commandes: f.commandes,
                  montant: f.montant,
                  premiere: jour(f.premiere),
                  derniere: jour(f.derniere),
                })),
              }
            : {
                titre: "Retours fournisseur",
                colonnes: [
                  { cle: "date", libelle: "Date" },
                  { cle: "commande", libelle: "Commande" },
                  { cle: "fournisseur", libelle: "Fournisseur" },
                  { cle: "depot", libelle: "Dépôt" },
                  { cle: "articles", libelle: "Articles" },
                  { cle: "motif", libelle: "Motif" },
                  { cle: "montant", libelle: "Montant" },
                  { cle: "avoir", libelle: "Avoir" },
                  { cle: "faitPar", libelle: "Fait par" },
                ],
                lignes: retoursFiltres.map((r) => ({
                  date: jour(r.dateCreation),
                  commande: r.commandeNumero,
                  fournisseur: r.fournisseurNom,
                  depot: r.depotNom,
                  articles: r.quantite,
                  motif: r.motif,
                  montant: r.montant,
                  avoir: r.avoir,
                  faitPar: nomUtilisateur(r.utilisateurId),
                })),
              };

  const menu: [SectionHistoriqueAchats, string, string, number][] = [
    ["commandes", "📦", "Commandes", commandesFiltrees.length],
    ["receptions", "📥", "Réceptions", receptionsFiltrees.length],
    ["paiements", "💰", "Paiements fournisseur", paiementsParFournisseur.length],
    ["dettes", "🧾", "Dettes soldées", dettesParFournisseur.length],
    ["retours", "↩️", "Retours fournisseur", retoursFiltres.length],
  ];

  return (
    <div className="fond-modale" onClick={onFermer}>
      <div className="modale-selection-produits" onClick={(e) => e.stopPropagation()}>
        <EnteteModale titre="Historique des achats" onFermer={onFermer} />
        {commandeOuverteId && (
          <div className="fond-modale" onClick={() => setCommandeOuverteId(null)}>
            <div className="modale-selection-produits" onClick={(e) => e.stopPropagation()}>
              <DetailCommande
                commandeId={commandeOuverteId}
                session={session}
                fournisseurs={fournisseurs}
                onRetour={() => {
                  setCommandeOuverteId(null);
                  recharger();
                }}
              />
            </div>
          </div>
        )}
        {fournisseurDettes && (
          <ModaleDettesFournisseur
            fournisseurNom={fournisseurDettes}
            dettes={dettes.filter((d) => d.statut === "solde" && d.fournisseurNom === fournisseurDettes)}
            onFermer={() => setFournisseurDettes(null)}
          />
        )}
        {fournisseurPaiements && (
          <ModalePaiementsFournisseur
            session={session}
            fournisseurNom={fournisseurPaiements}
            paiements={historique.paiements.filter((x) => x.fournisseurNom === fournisseurPaiements)}
            onFermer={() => setFournisseurPaiements(null)}
          />
        )}
        {receptionOuverte && (
          <ModaleDetailReception
            session={session}
            reception={receptionOuverte}
            commandeNumero={receptionOuverte.commandeNumero}
            fournisseurNom={receptionOuverte.fournisseurNom}
            onFermer={() => setReceptionOuverte(null)}
            onModifie={() => {
              setReceptionOuverte(null);
              recharger();
            }}
          />
        )}
        <div className="modale-avec-menu">
          <nav className="menu-modale">
            {menu.map(([valeur, icone, libelle, nombre]) => (
              <button
                key={valeur}
                type="button"
                className={section === valeur ? "actif" : ""}
                onClick={() => setSection(valeur)}
              >
                <span className="icone-menu-modale">{icone}</span>
                {libelle}
                <span className="compteur-menu-modale">{nombre}</span>
              </button>
            ))}
          </nav>
          <div className="modale-corps">
            <div className="barre-actions barre-filtres-historique">
              <FiltrePeriodeHistorique
                periode={periode}
                setPeriode={setPeriode}
                debutPerso={debutPerso}
                setDebutPerso={setDebutPerso}
                finPerso={finPerso}
                setFinPerso={setFinPerso}
              />
              <select value={fournisseur} onChange={(e) => setFournisseur(e.target.value)}>
                <option value="">Tous les fournisseurs</option>
                {fournisseurs.map((f) => (
                  <option key={f.id} value={f.nom}>
                    {f.nom}
                  </option>
                ))}
              </select>
              {section === "commandes" && (
                <select value={statut} onChange={(e) => setStatut(e.target.value as StatutCommande | "")}>
                  <option value="">Reçues et annulées</option>
                  <option value="recue">Reçues</option>
                  <option value="annulee">Annulées</option>
                </select>
              )}
              <input
                type="search"
                placeholder="N° de commande…"
                value={recherche}
                onChange={(e) => setRecherche(e.target.value)}
              />
              <BoutonsExport titre={exportSection.titre} colonnes={exportSection.colonnes} lignes={exportSection.lignes} compact />
            </div>
            <div className="tuiles-fiche">
              {tuilesSection.map(([libelle, valeur]) => (
                <div key={libelle} className="tuile-fiche">
                  <span className="sous-info">{libelle}</span>
                  <strong>{valeur}</strong>
                </div>
              ))}
            </div>
            {section === "commandes" ? (
              <>
                <div className="zone-tableau-scroll">
                  <table className="tableau-catalogue carte-mobile">
                    <thead>
                      <tr>
                      <th>Date</th>
                      <th>Numéro</th>
                      <th>Fournisseur</th>
                      <th>Statut</th>
                      <th>Total</th>
                      <th>Reçu</th>
                      <th>Fait par</th>
                      </tr>
                    </thead>
                    <tbody>
                      {commandesFiltrees.map((x) => (
                      <tr key={x.id} onClick={() => setCommandeOuverteId(x.id)}>
                        <td data-label="Date"><span title={new Date(x.dateCreation).toLocaleString("fr-FR")}>{new Date(x.dateCreation).toLocaleDateString("fr-FR")}</span></td>
                        <td data-label="Numéro">{x.numero}</td>
                        <td data-label="Fournisseur"><LienFournisseur nom={x.fournisseurNom} onFiltrer={setFournisseur} /></td>
                        <td data-label="Statut"><BadgeStatutCommande statut={x.statut} partiellementRecue={x.partiellementRecue} /></td>
                        <td data-label="Total"><span className="nowrap">{formaterMontant(x.total)} {devise}</span></td>
                        <td data-label="Reçu"><span className="nowrap">{formaterMontant(x.valeurRecue)} {devise}</span></td>
                        <td data-label="Fait par">{nomUtilisateur(x.utilisateurId)}</td>
                      </tr>
                      ))}
                      {commandesFiltrees.length === 0 && (
                        <tr>
                          <td colSpan={7} className="liste-vide">
                            Aucune commande pour ces filtres.
                          </td>
                        </tr>
                      )}
                      {Array.from({ length: Math.max(0, 10 - Math.max(1, commandesFiltrees.length)) }).map((_, i) => (
                        <tr key={`vide-${i}`} className="ligne-groupe-vide">
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
                  </table>
                </div>
                {commandesFiltrees.length > 0 && (
                  <div className="totaux">
                    <div>
                      {commandesFiltrees.length} commande{commandesFiltrees.length > 1 ? "s" : ""}
                    </div>
                    <div>
                      Reçu : {formaterMontant(somme(commandesValides.map((c) => c.valeurRecue)))} {devise}
                    </div>
                    <div className="total-net">
                      Commandé : {formaterMontant(somme(commandesValides.map((c) => c.total)))} {devise}
                    </div>
                  </div>
                )}
              </>
            ) : section === "receptions" ? (
              <>
                <div className="zone-tableau-scroll">
                  <table className="tableau-catalogue carte-mobile">
                    <thead>
                      <tr>
                      <th>Date</th>
                      <th>Commande</th>
                      <th>Fournisseur</th>
                      <th>Dépôt</th>
                      <th>Articles</th>
                      <th>Valeur reçue</th>
                      <th>Montant payé</th>
                      <th>Fait par</th>
                      </tr>
                    </thead>
                    <tbody>
                      {receptionsFiltrees.map((x) => (
                      <tr key={x.id} className={x.annulee ? "ligne-annulee" : "ligne-reception-cliquable"} onClick={() => setReceptionOuverte(x)}>
                        <td data-label="Date"><span title={new Date(x.dateCreation).toLocaleString("fr-FR")}>{new Date(x.dateCreation).toLocaleDateString("fr-FR")}</span> {x.annulee && <span className="badge-brouillon">Annulée</span>}</td>
                        <td data-label="Commande">{x.commandeNumero}</td>
                        <td data-label="Fournisseur"><LienFournisseur nom={x.fournisseurNom} onFiltrer={setFournisseur} /></td>
                        <td data-label="Dépôt">{x.depotNom}</td>
                        <td data-label="Articles">{x.lignes.length > 0 ? x.lignes.reduce((t, l) => t + Number(l.quantite), 0) : "—"}</td>
                        <td data-label="Valeur reçue"><span className="nowrap">{formaterMontant(x.valeurRecue)} {devise}</span></td>
                        <td data-label="Montant payé"><span className="nowrap">{formaterMontant(x.montantPaye)} {devise}</span></td>
                        <td data-label="Fait par">{nomUtilisateur(x.utilisateurId)}</td>
                      </tr>
                      ))}
                      {receptionsFiltrees.length === 0 && (
                        <tr>
                          <td colSpan={8} className="liste-vide">
                            Aucune réception pour ces filtres.
                          </td>
                        </tr>
                      )}
                      {Array.from({ length: Math.max(0, 10 - Math.max(1, receptionsFiltrees.length)) }).map((_, i) => (
                        <tr key={`vide-${i}`} className="ligne-groupe-vide">
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
                  </table>
                </div>
                {receptionsFiltrees.length > 0 && (
                  <div className="totaux">
                    <div>
                      {receptionsFiltrees.length} réception{receptionsFiltrees.length > 1 ? "s" : ""}
                    </div>
                    <div>
                      Payé à la réception :{" "}
                      {formaterMontant(somme(receptionsFiltrees.filter((r) => !r.annulee).map((r) => r.montantPaye)))}{" "}
                      {devise}
                    </div>
                    <div className="total-net">
                      Valeur reçue :{" "}
                      {formaterMontant(somme(receptionsFiltrees.filter((r) => !r.annulee).map((r) => r.valeurRecue)))}{" "}
                      {devise}
                    </div>
                  </div>
                )}
              </>
            ) : section === "paiements" ? (
              <>
                <div className="zone-tableau-scroll">
                  <table className="tableau-catalogue carte-mobile">
                    <thead>
                      <tr>
                        <th>Fournisseur</th>
                        <th>Paiements</th>
                        <th>Payé à la réception</th>
                        <th>Règlements de dette</th>
                        <th>Total payé</th>
                        <th>Reste à payer</th>
                        <th>Dernier paiement</th>
                      </tr>
                    </thead>
                    <tbody>
                      {paiementsParFournisseur.map((f) => (
                        <tr
                          key={f.fournisseurNom}
                          className="ligne-reception-cliquable"
                          onClick={() => setFournisseurPaiements(f.fournisseurNom)}
                          title="Voir tous les paiements à ce fournisseur"
                        >
                          <td data-label="Fournisseur"><LienFournisseur nom={f.fournisseurNom} onFiltrer={setFournisseur} /></td>
                          <td data-label="Paiements">{f.nombre}</td>
                          <td data-label="Payé à la réception"><span className="nowrap">{formaterMontant(f.aLaReception)} {devise}</span></td>
                          <td data-label="Règlements de dette"><span className="nowrap">{formaterMontant(f.reglements)} {devise}</span></td>
                          <td data-label="Total payé"><span className="nowrap">{formaterMontant(f.totalPaye)} {devise}</span></td>
                          <td data-label="Reste à payer">{f.resteAPayer > 0 ? `${formaterMontant(f.resteAPayer)} ${devise}` : "—"}</td>
                          <td data-label="Dernier paiement">{new Date(f.dernier).toLocaleDateString("fr-FR")}</td>
                        </tr>
                      ))}
                      {paiementsParFournisseur.length === 0 && (
                        <tr>
                          <td colSpan={7} className="liste-vide">
                            Aucun paiement fournisseur pour ces filtres.
                          </td>
                        </tr>
                      )}
                      {Array.from({ length: Math.max(0, 10 - Math.max(1, paiementsParFournisseur.length)) }).map((_, i) => (
                        <tr key={`vide-${i}`} className="ligne-groupe-vide">
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
                  </table>
                </div>
                {paiementsParFournisseur.length > 0 && (
                  <div className="totaux">
                    <div>
                      {paiementsParFournisseur.length} fournisseur{paiementsParFournisseur.length > 1 ? "s" : ""} ·{" "}
                      {somme(paiementsParFournisseur.map((f) => f.nombre))} paiement(s)
                    </div>
                    <div>
                      Reste à payer : {formaterMontant(somme(paiementsParFournisseur.map((f) => f.resteAPayer)))} {devise}
                    </div>
                    <div className="total-net">
                      Total payé : {formaterMontant(somme(paiementsParFournisseur.map((f) => f.totalPaye)))} {devise}
                    </div>
                  </div>
                )}
              </>
            ) : section === "dettes" ? (
              <>
                <div className="zone-tableau-scroll">
                  <table className="tableau-catalogue carte-mobile">
                    <thead>
                      <tr>
                        <th>Fournisseur</th>
                        <th>Dettes soldées</th>
                        <th>Commandes</th>
                        <th>Montant réglé</th>
                        <th>Première dette</th>
                        <th>Dernière soldée le</th>
                      </tr>
                    </thead>
                    <tbody>
                      {dettesParFournisseur.map((f) => (
                        <tr
                          key={f.fournisseurNom}
                          className="ligne-reception-cliquable"
                          onClick={() => setFournisseurDettes(f.fournisseurNom)}
                          title="Voir les dettes soldées de ce fournisseur"
                        >
                          <td data-label="Fournisseur"><LienFournisseur nom={f.fournisseurNom} onFiltrer={setFournisseur} /></td>
                          <td data-label="Dettes soldées">{f.nombre}</td>
                          <td data-label="Commandes">{f.commandes}</td>
                          <td data-label="Montant réglé"><span className="nowrap">{formaterMontant(f.montant)} {devise}</span></td>
                          <td data-label="Première dette">{new Date(f.premiere).toLocaleDateString("fr-FR")}</td>
                          <td data-label="Dernière soldée le">{new Date(f.derniere).toLocaleDateString("fr-FR")}</td>
                        </tr>
                      ))}
                      {dettesParFournisseur.length === 0 && (
                        <tr>
                          <td colSpan={6} className="liste-vide">
                            Aucune dette soldée pour ces filtres.
                          </td>
                        </tr>
                      )}
                      {Array.from({ length: Math.max(0, 10 - Math.max(1, dettesParFournisseur.length)) }).map((_, i) => (
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
                  </table>
                </div>
                {dettesParFournisseur.length > 0 && (
                  <div className="totaux">
                    <div>
                      {dettesParFournisseur.length} fournisseur{dettesParFournisseur.length > 1 ? "s" : ""} ·{" "}
                      {somme(dettesParFournisseur.map((f) => f.nombre))} dette(s) soldée(s)
                    </div>
                    <div className="total-net">
                      Montant réglé : {formaterMontant(somme(dettesParFournisseur.map((f) => f.montant)))} {devise}
                    </div>
                  </div>
                )}
              </>
            ) : (
              <>
                <div className="zone-tableau-scroll">
                  <table className="tableau-catalogue carte-mobile">
                    <thead>
                      <tr>
                      <th>Date</th>
                      <th>Commande</th>
                      <th>Fournisseur</th>
                      <th>Dépôt</th>
                      <th>Articles</th>
                      <th>Motif</th>
                      <th>Montant</th>
                      <th>Avoir</th>
                      <th>Fait par</th>
                      </tr>
                    </thead>
                    <tbody>
                      {retoursFiltres.map((x) => (
                      <tr key={x.id}>
                        <td data-label="Date"><span title={new Date(x.dateCreation).toLocaleString("fr-FR")}>{new Date(x.dateCreation).toLocaleDateString("fr-FR")}</span></td>
                        <td data-label="Commande">{x.commandeNumero}</td>
                        <td data-label="Fournisseur"><LienFournisseur nom={x.fournisseurNom} onFiltrer={setFournisseur} /></td>
                        <td data-label="Dépôt">{x.depotNom}</td>
                        <td data-label="Articles">{x.quantite}</td>
                        <td data-label="Motif">{x.motif || "—"}</td>
                        <td data-label="Montant"><span className="nowrap">{formaterMontant(x.montant)} {devise}</span></td>
                        <td data-label="Avoir">{x.avoir > 0 ? `${formaterMontant(x.avoir)} ${devise}` : "—"}</td>
                        <td data-label="Fait par">{nomUtilisateur(x.utilisateurId)}</td>
                      </tr>
                      ))}
                      {retoursFiltres.length === 0 && (
                        <tr>
                          <td colSpan={9} className="liste-vide">
                            Aucun retour fournisseur pour ces filtres.
                          </td>
                        </tr>
                      )}
                      {Array.from({ length: Math.max(0, 10 - Math.max(1, retoursFiltres.length)) }).map((_, i) => (
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
                  </table>
                </div>
                {retoursFiltres.length > 0 && (
                  <div className="totaux">
                    <div>
                      {retoursFiltres.length} retour{retoursFiltres.length > 1 ? "s" : ""} ·{" "}
                      {somme(retoursFiltres.map((r) => r.quantite))} article(s)
                    </div>
                    <div>
                      Avoirs : {formaterMontant(somme(retoursFiltres.map((r) => r.avoir)))} {devise}
                    </div>
                    <div className="total-net">
                      Montant retourné : {formaterMontant(somme(retoursFiltres.map((r) => r.montant)))} {devise}
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function Achats({
  session,
  ouvrirNouvelleCommande,
  lignesAchatInitiales,
  onOuvertureConsommee,
}: {
  session: Session;
  ouvrirNouvelleCommande?: boolean;
  lignesAchatInitiales?: LigneAchatInitiale[];
  onOuvertureConsommee?: () => void;
}) {
  const [sectionOuverte, setSectionOuverte] = useState<Section | null>(ouvrirNouvelleCommande ? "commandes" : null);
  const peutAcceder = !!session.permissions.gerer_produits_stock_achats;
  const [compteReception, setCompteReception] = useState(0);

  useEffect(() => {
    if (!peutAcceder) return;
    listerCommandes(session.boutiqueId, undefined, "commandee").then((liste) => setCompteReception(liste.length));
    // Se rafraîchit à la fermeture d'une section (ex. après une réception).
  }, [peutAcceder, session.boutiqueId, sectionOuverte]);

  if (!peutAcceder) {
    return (
      <div className="page-produits">
        <p className="note-aide">Accès réservé à la gestion produits/stock/achats.</p>
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
        {SECTIONS.map((s) => (
          <button
            key={s.cle}
            type="button"
            className="carte-document-comptable"
            onClick={() => setSectionOuverte(s.cle)}
          >
            {s.cle === "reception" && compteReception > 0 && (
              <span className="badge-compte-carte">{compteReception > 99 ? "99+" : compteReception}</span>
            )}
            <span className="icone-document-comptable">{s.icone}</span>
            {s.label}
          </button>
        ))}
      </div>
      {sectionOuverte === "commandes" && (
        <ModaleCommandes
          session={session}
          ouvrirFormulaireInitial={ouvrirNouvelleCommande}
          lignesInitiales={lignesAchatInitiales}
          onFormulaireInitialConsomme={onOuvertureConsommee}
          onFermer={() => setSectionOuverte(null)}
        />
      )}
      {sectionOuverte === "reception" && (
        <ModaleReception session={session} onFermer={() => setSectionOuverte(null)} />
      )}
      {sectionOuverte === "fournisseurs" && (
        <ModaleFournisseurs session={session} onFermer={() => setSectionOuverte(null)} />
      )}
      {sectionOuverte === "historique" && (
        <ModaleHistoriqueAchats session={session} onFermer={() => setSectionOuverte(null)} />
      )}
      {sectionOuverte === "dettes" && (
        <ModaleDettes session={session} onFermer={() => setSectionOuverte(null)} />
      )}
    </div>
  );
}
