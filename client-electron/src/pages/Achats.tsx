import { useEffect, useState } from "react";
import type { CSSProperties } from "react";

import { api } from "../api/client";
import type {
  CommandeDetail,
  CommandeResume,
  Depot,
  EtapeCommande,
  DetteResume,
  FournisseurResume,
  LigneAchatInitiale,
  PaiementDetteDetail,
  PaiementFournisseurHistorique,
  ReceptionDetail,
  HistoriqueAchats,
  ReceptionHistorique,
  Session,
  StatutCommande,
  StatutDette,
  VarianteRecherchee,
} from "../api/client";
import ChampMontant from "../components/ChampMontant";
import ModaleConfirmation from "../components/ModaleConfirmation";
import { useDevise } from "../contexts/DeviseContext";
import { formaterMontant } from "../lib/formatage";
import { libelleModeReglement, MODES_REGLEMENT } from "../lib/libelles";
import { useNomsUtilisateurs } from "../hooks/useNomsUtilisateurs";
import FiltrePeriodeHistorique from "../components/FiltrePeriodeHistorique";
import { bornesPeriode, dansPeriode, jourLocal, type PeriodeHistorique } from "../lib/periode";

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

// --- Onglet Commandes ---

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
  onAnnuler,
  onCree,
}: {
  session: Session;
  fournisseurs: FournisseurResume[];
  commandeAModifier?: { id: string; fournisseurId: string; lignes: LigneSaisie[] };
  onAnnuler: () => void;
  onCree: () => void;
}) {
  const devise = useDevise();
  const [fournisseurId, setFournisseurId] = useState(commandeAModifier?.fournisseurId ?? fournisseurs[0]?.id ?? "");
  const [terme, setTerme] = useState("");
  const [resultats, setResultats] = useState<VarianteRecherchee[]>([]);
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
      api.catalogue.rechercherVariantes(session.boutiqueId, terme.trim()).then(setResultats);
    }, 200);
    return () => clearTimeout(identifiant);
  }, [terme, session.boutiqueId]);

  function ajouterLigne(variante: VarianteRecherchee) {
    setLignes((actuel) => {
      if (actuel.some((l) => l.varianteId === variante.id)) return actuel;
      return [
        ...actuel,
        {
          varianteId: variante.id,
          produitNom: variante.produitNom,
          reference: variante.reference,
          quantite: 1,
          prixAchat: variante.prixAchat,
        },
      ];
    });
  }

  async function ajouterNouveauProduit() {
    const nom = terme.trim();
    if (!nom) return;
    const resultat = await api.produits.creer({ boutiqueId: session.boutiqueId, nom, prixAchat: 0, prixVente: 0 });
    if (resultat.succes) {
      const produit = await api.produits.obtenir(resultat.resultat.produitId);
      const reference = produit?.variantes[0]?.reference ?? "";
      setLignes((actuel) => [
        ...actuel,
        { varianteId: resultat.resultat.varianteId, produitNom: nom, reference, quantite: 1, prixAchat: 0 },
      ]);
      setTerme("");
      setResultats([]);
    } else {
      setErreur(resultat.message);
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
      const resultat = commandeAModifier
        ? await api.commandes.modifier(commandeAModifier.id, { fournisseurId, statut, lignes: lignesPayload , utilisateurId: session.utilisateurId })
        : await api.commandes.creer({
            boutiqueId: session.boutiqueId,
            fournisseurId,
            utilisateurId: session.utilisateurId,
            statut,
            lignes: lignesPayload,
          });
      if (resultat.succes) onCree();
      else setErreur(resultat.message);
    } finally {
      setEnCours(false);
    }
  }

  return (
    <form onSubmit={(e) => e.preventDefault()} className="formulaire-mouvement-groupe">
      <div className="modale-entete entete-fixe">
        <h3>{commandeAModifier ? "Modifier la commande" : "Nouvelle commande"}</h3>
        <div className="actions-formulaire">
          <button type="button" className="bouton-brouillon-commande" onClick={() => soumettre("brouillon")} disabled={enCours}>
            {enCours ? "Enregistrement…" : "Enregistrer en brouillon"}
          </button>
          <button type="button" className="bouton-creer-commande" onClick={() => soumettre("commandee")} disabled={enCours}>
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
                      <li key={v.id} onMouseDown={(e) => { e.preventDefault(); ajouterLigne(v); }}>
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
            <table className="tableau-catalogue">
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
                    <td>{index + 1}</td>
                    <td>{l.reference || ""}</td>
                    <td>{l.produitNom}</td>
                    <td>
                      <input
                        type="number"
                        min={0.01}
                        step="any"
                        value={l.quantite}
                        onChange={(e) => modifierLigne(l.varianteId, { quantite: Number(e.target.value) })}
                      />
                    </td>
                    <td>
                      <ChampMontant
                        value={String(l.prixAchat)}
                        onChange={(valeur) => modifierLigne(l.varianteId, { prixAchat: Number(valeur) || 0 })}
                      />
                    </td>
                    <td className="colonne-sous-total">{formaterMontant(Math.round(l.quantite * l.prixAchat))}</td>
                    <td className="colonne-actions-variante">
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
    </form>
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
    api.fournisseurs.derniers(session.boutiqueId, lignes.map((l) => l.varianteId)).then((derniers) => {
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
    setLignesEditees((actuel) =>
      (actuel ?? []).map((l) => (l.varianteId === varianteId ? { ...l, ...champs } : l)),
    );
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
        const resultat = await api.commandes.creer({
          boutiqueId: session.boutiqueId,
          fournisseurId: groupe.fournisseurId,
          utilisateurId: session.utilisateurId,
          statut: "brouillon",
          lignes: groupe.lignes.map((l) => ({ varianteId: l.varianteId, quantite: l.quantite, prixAchat: l.prixAchat })),
        });
        if (!resultat.succes) {
          setErreur(resultat.message);
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
            className="bouton-creer-commande"
            onClick={creerLesCommandes}
            disabled={enCours || lignesEditees.length === 0}
          >
            {enCours ? "Création…" : `Créer les commandes (${groupes.size})`}
          </button>
        </div>
      </div>
      {erreur && <div className="message-erreur">{erreur}</div>}

      <div className="zone-tableau-scroll">
      <table className="tableau-catalogue">
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
              <td>{l.produitNom}</td>
              <td>{l.depotNom}</td>
              <td>
                <input
                  type="number"
                  min={0.01}
                  step="any"
                  value={l.quantite}
                  onChange={(e) => modifierLigne(l.varianteId, { quantite: Number(e.target.value) })}
                />
              </td>
              <td>
                <ChampMontant
                  value={String(l.prixAchat)}
                  onChange={(valeur) => modifierLigne(l.varianteId, { prixAchat: Number(valeur) || 0 })}
                />
              </td>
              <td>
                <select
                  value={l.fournisseurId}
                  onChange={(e) => modifierLigne(l.varianteId, { fournisseurId: e.target.value })}
                >
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
  const [depots, setDepots] = useState<Depot[]>([]);
  const [depotId, setDepotId] = useState("");
  const [montantDejaPaye, setMontantDejaPaye] = useState("0");
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
    setCommande((await api.commandes.obtenir(commandeId)) ?? null);
  }
  useEffect(() => {
    rafraichir();
    api.catalogue.listerDepots(session.boutiqueId).then((liste) => {
      setDepots(liste);
      if (liste[0]) setDepotId(liste[0].id);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [commandeId]);

  async function changerFournisseur(nouveauFournisseurId: string) {
    const resultat = await api.commandes.modifier(commandeId, { fournisseurId: nouveauFournisseurId , utilisateurId: session.utilisateurId });
    if (resultat.succes) rafraichir();
    else setErreur(resultat.message);
  }

  async function passerEnCommandee() {
    const resultat = await api.commandes.modifier(commandeId, { statut: "commandee" , utilisateurId: session.utilisateurId });
    if (resultat.succes) rafraichir();
    else setErreur(resultat.message);
  }

  async function annulerCommande() {
    setEnCours(true);
    try {
      const resultat = await api.commandes.modifier(commandeId, { statut: "annulee" , utilisateurId: session.utilisateurId });
      if (resultat.succes) {
        setAfficherConfirmationAnnulation(false);
        rafraichir();
      } else {
        setErreur(resultat.message);
      }
    } finally {
      setEnCours(false);
    }
  }

  function ouvrirReception() {
    if (commande) {
      const initialPrix: Record<string, string> = {};
      const initialQuantites: Record<string, string> = {};
      for (const ligne of commande.lignes) {
        initialPrix[ligne.varianteId] = String(ligne.prixVenteActuel || "");
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
      api.commandes.listerReceptions(commandeId),
      api.dettes.lister(session.boutiqueId, commande.fournisseurId),
    ]);
    const dettesCommandeSeules = dettesResultat.filter((d) => d.commandeId === commandeId);
    const dettesAvecPaiements = await Promise.all(
      dettesCommandeSeules.map(async (d) => ({ ...d, paiements: await api.dettes.listerPaiements(d.id) })),
    );
    setReceptions(receptionsResultat);
    setReceptionSelectionnee(null);
    setDettesCommande(dettesAvecPaiements);
    setSuivi(await api.commandes.suivi(commandeId));
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
      const resultat = await api.commandes.receptionner({
        commandeId,
        depotId,
        utilisateurId: session.utilisateurId,
        montantDejaPaye: Number(montantDejaPaye) || 0,
        lignes: commande.lignes
          .map((l) => ({
            varianteId: l.varianteId,
            quantite: Number(quantitesRecevoir[l.varianteId]) || 0,
            prixVente: Number(prixVentes[l.varianteId]) || 0,
          }))
          .filter((l) => l.quantite > 0),
      });
      if (resultat.succes) {
        setReceptionReussie({ quantiteRecue, quantiteRestante });
      } else {
        setErreur(resultat.message);
      }
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
        <table className="tableau-catalogue">
          <thead>
            <tr>
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
            {commande.lignes.map((l) => (
              <tr key={l.id}>
                <td>{l.produitNom}</td>
                <td>{l.reference || ""}</td>
                <td>{l.quantite}</td>
                <td>{l.quantiteRecue}</td>
                <td>{l.quantite - l.quantiteRecue}</td>
                <td>{formaterMontant(l.prixAchat)}</td>
                <td>{formaterMontant(l.sousTotal)}</td>
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
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="totaux">
        <div className="total-net">Total : {formaterMontant(commande.total)} {devise}</div>
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
                      <table className="tableau-catalogue">
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
                              <td>{new Date(e.dateCreation).toLocaleString("fr-FR")}</td>
                              <td><span className="libelle-etape">{LIBELLES_ETAPE[e.type] ?? e.type}</span>{e.reconstitue && <span className="sous-info"> (reconstitué)</span>}</td>
                              <td>{e.detail || "—"}</td>
                              <td>{e.montant === null ? "—" : `${formaterMontant(e.montant)} ${devise}`}</td>
                              <td>{e.utilisateurId ? nomUtilisateur(e.utilisateurId) : "—"}</td>
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
                      <table className="tableau-catalogue">
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
                              <td>
                          {new Date(r.dateCreation).toLocaleString("fr-FR")}{" "}
                          {r.annulee && <span className="badge-brouillon">Annulée</span>}
                        </td>
                              <td>{r.depotNom}</td>
                              <td>
                                {formaterMontant(r.valeurRecue)} {devise}
                              </td>
                              <td>
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
                      <table className="tableau-catalogue">
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
                              <td>{new Date(p.dateCreation).toLocaleString("fr-FR")}</td>
                              <td>
                                {formaterMontant(p.montant)} {devise}
                              </td>
                              <td>{p.mode ? libelleModeReglement(p.mode) : "—"}</td>
                              <td>{p.origine}</td>
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
          <table className="tableau-catalogue">
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
                    <td>{index + 1}</td>
                    <td>{l.reference || ""}</td>
                    <td>{l.produitNom}</td>
                    <td className="colonne-sous-total">
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
                    <td className="colonne-sous-total">{formaterMontant(l.prixAchat)}</td>
                    <td className="colonne-sous-total">
                      <ChampMontant
                        className={`champ-prix-vente-reception ${prixInvalide ? "champ-invalide" : ""}`}
                        value={prixVentes[l.varianteId] ?? ""}
                        onChange={(valeur) =>
                          setPrixVentes((prec) => ({ ...prec, [l.varianteId]: valeur }))
                        }
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
                  <td className="colonne-sous-total">&nbsp;</td>
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

const SECTIONS = [
  { cle: "commandes", label: "Commandes", icone: "📦" },
  { cle: "reception", label: "Réceptionner", icone: "📥" },
  { cle: "historique", label: "Historique", icone: "🗂️" },
  { cle: "fournisseurs", label: "Fournisseurs", icone: "🚚" },
  { cle: "dettes", label: "Dettes", icone: "💰" },
] as const;

export type Onglet = (typeof SECTIONS)[number]["cle"];

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
  const [fournisseurs, setFournisseurs] = useState<FournisseurResume[]>([]);
  const [fournisseurId, setFournisseurId] = useState("");
  const [statut, setStatut] = useState<StatutCommande | "">("");
  const [terme, setTerme] = useState("");
  const [commandes, setCommandes] = useState<CommandeResume[]>([]);
  const [afficherForm, setAfficherForm] = useState(false);
  // Ne doit servir que pour l'ouverture qui vient du raccourci rupture — pas
  // être réutilisé si l'utilisateur annule puis ouvre une commande vierge à
  // la main pendant qu'il est encore sur cette page.
  const [apercuGroupeActif, setApercuGroupeActif] = useState(false);
  const [commandeSelectionneeId, setCommandeSelectionneeId] = useState<string | null>(null);

  useEffect(() => {
    api.fournisseurs.lister(session.boutiqueId).then(setFournisseurs);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.boutiqueId]);

  // Raccourci "Nouvel achat" du tableau de bord / bouton "Commander" d'une
  // rupture : ouvre directement l'aperçu de commandes groupées.
  useEffect(() => {
    if (ouvrirFormulaireInitial) {
      setApercuGroupeActif(true);
      onFormulaireInitialConsomme?.();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ouvrirFormulaireInitial]);

  async function rafraichir() {
    setCommandes(
      await api.commandes.lister(session.boutiqueId, fournisseurId || undefined, statut || undefined, terme),
    );
  }
  useEffect(() => {
    rafraichir();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fournisseurId, statut, terme]);

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

  return (
    <div>
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
      <div className="barre-actions barre-actions-avec-onglets">
        <select value={fournisseurId} onChange={(e) => setFournisseurId(e.target.value)}>
          <option value="">Tous les fournisseurs</option>
          {fournisseurs.map((f) => (
            <option key={f.id} value={f.id}>
              {f.nom}
            </option>
          ))}
        </select>
        <select value={statut} onChange={(e) => setStatut(e.target.value as StatutCommande | "")}>
          <option value="">Tous les statuts</option>
          <option value="brouillon">Brouillon</option>
          <option value="commandee">Commandée</option>
          <option value="recue">Reçue</option>
          <option value="annulee">Annulée</option>
        </select>
        <input
          className="champ-recherche"
          placeholder="Rechercher par numéro…"
          value={terme}
          onChange={(e) => setTerme(e.target.value)}
        />
        {peutGerer && (
          <span className="actions-ligne">
            <button
              type="button"
              className="bouton-ajouter-variante"
              onClick={() => setAfficherForm(true)}
              disabled={fournisseurs.length === 0}
            >
              + Nouvelle commande
            </button>
          </span>
        )}
      </div>
      {peutGerer && fournisseurs.length === 0 && (
        <p className="note-aide">Créez d'abord un fournisseur dans l'onglet « Fournisseurs ».</p>
      )}
      <div className="zone-tableau-scroll">
      <table className="tableau-catalogue">
        <thead>
          <tr>
            <th>Date</th>
            <th>Numéro</th>
            <th>Fournisseur</th>
            <th>Statut</th>
            <th>Total</th>
          </tr>
        </thead>
        <tbody>
          {commandes.map((c) => (
            <tr key={c.id} onClick={() => setCommandeSelectionneeId(c.id)}>
              <td>{new Date(c.dateCreation).toLocaleString("fr-FR")}</td>
              <td>{c.numero}</td>
              <td>{c.fournisseurNom}</td>
              <td>
                <BadgeStatutCommande statut={c.statut} partiellementRecue={c.partiellementRecue} />
              </td>
              <td>{formaterMontant(c.total)}</td>
            </tr>
          ))}
          {commandes.length === 0 && (
            <tr>
              <td colSpan={5} className="liste-vide">
                Aucune commande.
              </td>
            </tr>
          )}
          {Array.from({ length: Math.max(0, 10 - Math.max(1, commandes.length)) }).map((_, i) => (
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

function OngletReception({ session }: { session: Session }) {
  const [fournisseurs, setFournisseurs] = useState<FournisseurResume[]>([]);
  const [commandes, setCommandes] = useState<CommandeResume[]>([]);
  const [commandeSelectionneeId, setCommandeSelectionneeId] = useState<string | null>(null);

  async function rafraichir() {
    const liste = await api.commandes.lister(session.boutiqueId, undefined, "commandee");
    liste.sort((a, b) => new Date(a.dateCreation).getTime() - new Date(b.dateCreation).getTime());
    setCommandes(liste);
  }
  useEffect(() => {
    rafraichir();
    api.fournisseurs.lister(session.boutiqueId).then(setFournisseurs);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.boutiqueId]);

  return (
    <div>
      <div className="zone-tableau-scroll">
        <table className="tableau-catalogue">
          <thead>
            <tr>
              <th>Date</th>
              <th>Numéro</th>
              <th>Fournisseur</th>
              <th>Statut</th>
              <th>Reste à recevoir</th>
              <th>Total</th>
            </tr>
          </thead>
          <tbody>
            {commandes.map((c) => (
              <tr key={c.id} onClick={() => setCommandeSelectionneeId(c.id)}>
                <td>{new Date(c.dateCreation).toLocaleString("fr-FR")}</td>
                <td>{c.numero}</td>
                <td>{c.fournisseurNom}</td>
                <td>
                  <BadgeStatutCommande statut={c.statut} partiellementRecue={c.partiellementRecue} />
                </td>
                <td>
                  {c.quantiteCommandee - c.quantiteRecue} / {c.quantiteCommandee}
                </td>
                <td>{formaterMontant(c.total)}</td>
              </tr>
            ))}
            {commandes.length === 0 && (
              <tr>
                <td colSpan={6} className="liste-vide">
                  Aucune commande en attente de réception.
                </td>
              </tr>
            )}
            {Array.from({ length: Math.max(0, 10 - Math.max(1, commandes.length)) }).map((_, i) => (
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

// --- Onglet Fournisseurs ---

interface LigneFournisseurGroupe {
  id: string;
  nom: string;
  telephone: string;
  adresse: string;
  contact: string;
}

function FormulaireFournisseursGroupe({
  session,
  onAnnuler,
  onCree,
}: {
  session: Session;
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
    setLignes((actuel) => [
      ...actuel,
      { id: crypto.randomUUID(), nom: nom.trim(), telephone: telephone.trim(), adresse: adresse.trim(), contact: contact.trim() },
    ]);
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
        const resultat = await api.fournisseurs.creer(
          session.boutiqueId,
          ligne.nom,
          ligne.telephone,
          ligne.adresse,
          ligne.contact,
        );
        if (!resultat.succes) {
          setErreur(`"${ligne.nom}" : ${resultat.message}`);
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
        <table className="tableau-catalogue">
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
                <td className="colonne-numero-groupe">{index + 1}</td>
                <td className="col-designation-groupe">{l.nom}</td>
                <td>{l.telephone}</td>
                <td>{l.adresse}</td>
                <td>{l.contact}</td>
                <td className="colonne-numero-groupe">
                  <button
                    type="button"
                    className="bouton-retirer-ligne-groupe"
                    title="Retirer de la liste"
                    onClick={() => retirerLigne(l.id)}
                  >
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

function OngletFournisseurs({ session }: { session: Session }) {
  const peutGerer = !!session.permissions.gerer_produits_stock_achats;
  const [fournisseurs, setFournisseurs] = useState<FournisseurResume[]>([]);
  const [afficherModal, setAfficherModal] = useState(false);

  async function rafraichir() {
    setFournisseurs(await api.fournisseurs.lister(session.boutiqueId));
  }
  useEffect(() => {
    rafraichir();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div>
      <div className="barre-actions barre-actions-fixe barre-actions-avec-onglets">
        {peutGerer && (
          <button type="button" className="bouton-ajouter-variante" onClick={() => setAfficherModal(true)}>
            + Nouveau fournisseur
          </button>
        )}
      </div>
      {afficherModal && (
        <div className="fond-modale" onClick={() => setAfficherModal(false)}>
          <div className="modale-selection-produits" onClick={(e) => e.stopPropagation()}>
            <FormulaireFournisseursGroupe
              session={session}
              onAnnuler={() => setAfficherModal(false)}
              onCree={() => {
                setAfficherModal(false);
                rafraichir();
              }}
            />
          </div>
        </div>
      )}
      <div className="zone-tableau-scroll">
      <table className="tableau-catalogue">
        <thead>
          <tr>
            <th>Nom</th>
            <th>Téléphone</th>
            <th>Adresse</th>
            <th>Contact</th>
          </tr>
        </thead>
        <tbody>
          {fournisseurs.map((f) => (
            <tr key={f.id}>
              <td>{f.nom}</td>
              <td>{f.telephone || ""}</td>
              <td>{f.adresse || ""}</td>
              <td>{f.contact || ""}</td>
            </tr>
          ))}
          {fournisseurs.length === 0 && (
            <tr>
              <td colSpan={4} className="liste-vide">
                Aucun fournisseur.
              </td>
            </tr>
          )}
          {Array.from({ length: Math.max(0, 10 - Math.max(1, fournisseurs.length)) }).map((_, i) => (
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
    </div>
  );
}

// --- Onglet Dettes ---

function LignePayer({ dette, session, depots, onPaye }: { dette: DetteResume; session: Session; depots: Depot[]; onPaye: () => void }) {
  const [montant, setMontant] = useState("");
  const [mode, setMode] = useState(MODES_REGLEMENT[0].valeur);
  const [depotId, setDepotId] = useState(session.depotId ?? "");
  const [erreur, setErreur] = useState<string | null>(null);
  const [enCours, setEnCours] = useState(false);

  async function payer() {
    setEnCours(true);
    setErreur(null);
    try {
      const resultat = await api.dettes.payer(
        dette.id,
        Number(montant) || 0,
        mode,
        depotId || null,
        session.utilisateurId,
      );
      if (resultat.succes) {
        setMontant("");
        onPaye();
      } else {
        setErreur(resultat.message);
      }
    } finally {
      setEnCours(false);
    }
  }

  return (
    <div className="ligne-payer-dette">
      <ChampMontant placeholder="Montant" value={montant} onChange={setMontant} style={{ width: "100px" }} />
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
      <button type="button" className="bouton-primaire" onClick={payer} disabled={enCours}>
        {enCours ? "…" : "Payer"}
      </button>
      {erreur && <div className="message-erreur">{erreur}</div>}
    </div>
  );
}

function OngletDettes({ session }: { session: Session }) {
  const peutGerer = !!session.permissions.gerer_produits_stock_achats;
  const [statut, setStatut] = useState<StatutDette | "">("");
  const [dettes, setDettes] = useState<DetteResume[]>([]);
  const [depots, setDepots] = useState<Depot[]>([]);

  async function rafraichir() {
    setDettes(await api.dettes.lister(session.boutiqueId, undefined, statut || undefined));
  }
  useEffect(() => {
    rafraichir();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statut]);
  useEffect(() => {
    if (!session.depotId) api.catalogue.listerDepots(session.boutiqueId).then(setDepots);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div>
      <div className="barre-actions barre-actions-avec-onglets">
        <select value={statut} onChange={(e) => setStatut(e.target.value as StatutDette | "")}>
          <option value="">Tous les statuts</option>
          <option value="en_cours">En cours</option>
          <option value="solde">Soldée</option>
        </select>
      </div>
      <div className="zone-tableau-scroll">
      <table className="tableau-catalogue">
        <thead>
          <tr>
            <th>Date</th>
            <th>Fournisseur</th>
            <th>Commande</th>
            <th>Montant</th>
            <th>Payé</th>
            <th>Solde</th>
            <th>Statut</th>
            {peutGerer && <th></th>}
          </tr>
        </thead>
        <tbody>
          {dettes.map((d) => (
            <tr key={d.id}>
              <td>{new Date(d.dateCreation).toLocaleString("fr-FR")}</td>
              <td>{d.fournisseurNom}</td>
              <td>{d.commandeNumero ?? ""}</td>
              <td>{formaterMontant(d.montant)}</td>
              <td>{formaterMontant(d.montantPaye)}</td>
              <td>{formaterMontant(d.solde)}</td>
              <td>
                <span className={d.statut === "solde" ? "badge-payee" : "badge-commandee"}>
                  {d.statut === "solde" ? "Soldée" : "En cours"}
                </span>
              </td>
              {peutGerer && (
                <td>
                  {d.statut === "en_cours" && (
                    <LignePayer dette={d} session={session} depots={depots} onPaye={rafraichir} />
                  )}
                </td>
              )}
            </tr>
          ))}
          {dettes.length === 0 && (
            <tr>
              <td colSpan={peutGerer ? 8 : 7} className="liste-vide">
                Aucune dette fournisseur.
              </td>
            </tr>
          )}
          {Array.from({ length: Math.max(0, 10 - Math.max(1, dettes.length)) }).map((_, i) => (
            <tr key={`vide-${i}`} className="ligne-groupe-vide">
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
    </div>
  );
}

// --- Page principale ---
// Chaque section (Commandes / Fournisseurs / Dettes) est un bouton-carte qui
// ouvre sa propre modale, même patron que Comptabilite.tsx/Rapports.tsx.

function ModaleCommandes({
  session, ouvrirFormulaireInitial, lignesInitiales, onFormulaireInitialConsomme, onFermer,
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
      const resultat = await api.commandes.retournerAuFournisseur({
        receptionId: reception.id,
        lignes: aRetourner,
        motif,
        utilisateurId: session.utilisateurId,
      });
      if (!resultat.succes) {
        setErreur(resultat.message);
        return;
      }
      onTermine(resultat.resultat);
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
            <table className="tableau-catalogue">
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
                    <td>
                      {l.produitNom} {l.reference && <span className="sous-info">({l.reference})</span>}
                    </td>
                    <td>{l.quantite}</td>
                    <td>{l.quantiteRetournee}</td>
                    <td>
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
      const resultat = await api.commandes.annulerReception(reception.id, session.utilisateurId);
      if (!resultat.succes) {
        setErreur(resultat.message);
        return;
      }
      setMessage(
        resultat.resultat.montantARecuperer > 0
          ? `Réception annulée. Récupérez ${formaterMontant(resultat.resultat.montantARecuperer)} ${devise} payés sur place auprès du fournisseur.`
          : "Réception annulée : la marchandise est sortie du stock et la commande attend de nouveau ces articles.",
      );
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
            <table className="tableau-catalogue">
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
                    <td>{l.produitNom}</td>
                    <td>{l.reference}</td>
                    <td>{l.quantite}</td>
                    {aDesRetours && <td>{l.quantiteRetournee || ""}</td>}
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
                <table className="tableau-catalogue">
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
                        <td>{new Date(r.dateCreation).toLocaleDateString("fr-FR")}</td>
                        <td>{r.lignes.map((l) => `${l.quantite} × ${l.produitNom}`).join(", ")}</td>
                        <td>{r.motif || "—"}</td>
                        <td>
                          {formaterMontant(r.montant)} {devise}
                        </td>
                        <td>{r.avoir > 0 ? `${formaterMontant(r.avoir)} ${devise}` : "—"}</td>
                        <td>{nomUtilisateur(r.utilisateurId)}</td>
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
    api.dettes.lister(session.boutiqueId).then((liste) =>
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
            <table className="tableau-catalogue">
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
                    <td>{new Date(x.dateCreation).toLocaleString("fr-FR")}{" "}{x.annulee && <span className="badge-brouillon">Réception annulée</span>}</td>
                    <td>{x.commandeNumero ?? "—"}</td>
                    <td>{x.origine === "reception" ? "À la réception" : "Règlement de dette"}</td>
                    <td>{x.mode ? libelleModeReglement(x.mode) : "—"}</td>
                    <td>{formaterMontant(x.montant)} {devise}</td>
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
            <table className="tableau-catalogue">
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
                    <td>{new Date(d.dateCreation).toLocaleDateString("fr-FR")}</td>
                    <td>{d.commandeNumero ?? "—"}</td>
                    <td>{formaterMontant(d.montant)} {devise}</td>
                    <td>{formaterMontant(d.montantPaye)} {devise}</td>
                    <td>{new Date(d.dateModification).toLocaleDateString("fr-FR")}</td>
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

type SectionHistoriqueAchats = "commandes" | "receptions" | "paiements" | "dettes" | "retours";

/** Carte « Historique » : tout ce qui s'est passé côté achats, filtrable par
 * période, fournisseur et numéro de commande (sans limite de nombre). */
function ModaleHistoriqueAchats({ session, onFermer }: { session: Session; onFermer: () => void }) {
  const devise = useDevise();
  const nomUtilisateur = useNomsUtilisateurs(session);
  const [section, setSection] = useState<SectionHistoriqueAchats>("commandes");
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
    api.dettes.lister(session.boutiqueId).then(setDettes);
    api.commandes.historique(session.boutiqueId).then(setHistorique);
  }
  useEffect(() => {
    recharger();
    api.fournisseurs.lister(session.boutiqueId).then(setFournisseurs);
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
            </div>
            {section === "commandes" ? (
              <>
                <div className="zone-tableau-scroll">
                  <table className="tableau-catalogue">
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
                        <td>{new Date(x.dateCreation).toLocaleString("fr-FR")}</td>
                        <td>{x.numero}</td>
                        <td>{x.fournisseurNom}</td>
                        <td><BadgeStatutCommande statut={x.statut} partiellementRecue={x.partiellementRecue} /></td>
                        <td>{formaterMontant(x.total)} {devise}</td>
                        <td>{formaterMontant(x.valeurRecue)} {devise}</td>
                        <td>{nomUtilisateur(x.utilisateurId)}</td>
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
                  <table className="tableau-catalogue">
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
                        <td>{new Date(x.dateCreation).toLocaleString("fr-FR")} {x.annulee && <span className="badge-brouillon">Annulée</span>}</td>
                        <td>{x.commandeNumero}</td>
                        <td>{x.fournisseurNom}</td>
                        <td>{x.depotNom}</td>
                        <td>{x.lignes.length > 0 ? x.lignes.reduce((t, l) => t + Number(l.quantite), 0) : "—"}</td>
                        <td>{formaterMontant(x.valeurRecue)} {devise}</td>
                        <td>{formaterMontant(x.montantPaye)} {devise}</td>
                        <td>{nomUtilisateur(x.utilisateurId)}</td>
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
                  <table className="tableau-catalogue">
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
                          <td>{f.fournisseurNom}</td>
                          <td>{f.nombre}</td>
                          <td>{formaterMontant(f.aLaReception)} {devise}</td>
                          <td>{formaterMontant(f.reglements)} {devise}</td>
                          <td>{formaterMontant(f.totalPaye)} {devise}</td>
                          <td>{f.resteAPayer > 0 ? `${formaterMontant(f.resteAPayer)} ${devise}` : "—"}</td>
                          <td>{new Date(f.dernier).toLocaleDateString("fr-FR")}</td>
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
                  <table className="tableau-catalogue">
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
                          <td>{f.fournisseurNom}</td>
                          <td>{f.nombre}</td>
                          <td>{f.commandes}</td>
                          <td>{formaterMontant(f.montant)} {devise}</td>
                          <td>{new Date(f.premiere).toLocaleDateString("fr-FR")}</td>
                          <td>{new Date(f.derniere).toLocaleDateString("fr-FR")}</td>
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
                  <table className="tableau-catalogue">
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
                        <td>{new Date(x.dateCreation).toLocaleString("fr-FR")}</td>
                        <td>{x.commandeNumero}</td>
                        <td>{x.fournisseurNom}</td>
                        <td>{x.depotNom}</td>
                        <td>{x.quantite}</td>
                        <td>{x.motif || "—"}</td>
                        <td>{formaterMontant(x.montant)} {devise}</td>
                        <td>{x.avoir > 0 ? `${formaterMontant(x.avoir)} ${devise}` : "—"}</td>
                        <td>{nomUtilisateur(x.utilisateurId)}</td>
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
  const [sectionOuverte, setSectionOuverte] = useState<Onglet | null>(ouvrirNouvelleCommande ? "commandes" : null);
  const [compteReception, setCompteReception] = useState(0);

  useEffect(() => {
    api.commandes
      .lister(session.boutiqueId, undefined, "commandee")
      .then((liste) => setCompteReception(liste.length));
    // Se rafraîchit à la fermeture d'une section (ex. après une réception).
  }, [session.boutiqueId, sectionOuverte]);

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
