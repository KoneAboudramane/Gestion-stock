import { useEffect, useState } from "react";
import type { CSSProperties } from "react";

import { api } from "../api/client";
import type {
  CommandeDetail,
  CommandeResume,
  Depot,
  DetteResume,
  FournisseurResume,
  LigneAchatInitiale,
  Session,
  StatutCommande,
  StatutDette,
  VarianteRecherchee,
} from "../api/client";
import ChampMontant from "../components/ChampMontant";
import { useDevise } from "../contexts/DeviseContext";
import { formaterMontant } from "../lib/formatage";
import { MODES_REGLEMENT } from "../lib/libelles";

function libelleStatutCommande(statut: StatutCommande): string {
  if (statut === "brouillon") return "Brouillon";
  if (statut === "commandee") return "Commandée";
  if (statut === "recue") return "Reçue";
  return "Annulée";
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
  onAnnuler,
  onCree,
}: {
  session: Session;
  fournisseurs: FournisseurResume[];
  onAnnuler: () => void;
  onCree: () => void;
}) {
  const devise = useDevise();
  const [fournisseurId, setFournisseurId] = useState(fournisseurs[0]?.id ?? "");
  const [terme, setTerme] = useState("");
  const [resultats, setResultats] = useState<VarianteRecherchee[]>([]);
  const [dropdownOuvert, setDropdownOuvert] = useState(false);
  const [lignes, setLignes] = useState<LigneSaisie[]>([]);
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
      const resultat = await api.commandes.creer({
        boutiqueId: session.boutiqueId,
        fournisseurId,
        utilisateurId: session.utilisateurId,
        statut,
        lignes: lignes.map((l) => ({ varianteId: l.varianteId, quantite: l.quantite, prixAchat: l.prixAchat })),
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
        <h3>Nouvelle commande</h3>
        <div className="actions-formulaire">
          <button type="button" className="bouton-brouillon-commande" onClick={() => soumettre("brouillon")} disabled={enCours}>
            {enCours ? "Enregistrement…" : "Enregistrer en brouillon"}
          </button>
          <button type="button" className="bouton-creer-commande" onClick={() => soumettre("commandee")} disabled={enCours}>
            {enCours ? "Enregistrement…" : "Créer et commander"}
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

function DetailCommande({
  commandeId,
  session,
  fournisseurs,
  onRetour,
}: {
  commandeId: string;
  session: Session;
  fournisseurs: FournisseurResume[];
  onRetour: () => void;
}) {
  const peutGerer = !!session.permissions.gerer_produits_stock_achats;
  const devise = useDevise();
  const [commande, setCommande] = useState<CommandeDetail | null>(null);
  const [depots, setDepots] = useState<Depot[]>([]);
  const [depotId, setDepotId] = useState("");
  const [montantDejaPaye, setMontantDejaPaye] = useState("0");
  const [afficherReception, setAfficherReception] = useState(false);
  const [prixVentes, setPrixVentes] = useState<Record<string, string>>({});
  const [erreur, setErreur] = useState<string | null>(null);
  const [enCours, setEnCours] = useState(false);

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
    const resultat = await api.commandes.modifier(commandeId, { fournisseurId: nouveauFournisseurId });
    if (resultat.succes) rafraichir();
    else setErreur(resultat.message);
  }

  async function passerEnCommandee() {
    const resultat = await api.commandes.modifier(commandeId, { statut: "commandee" });
    if (resultat.succes) rafraichir();
    else setErreur(resultat.message);
  }

  function ouvrirReception() {
    if (commande) {
      const initial: Record<string, string> = {};
      for (const ligne of commande.lignes) {
        initial[ligne.varianteId] = String(ligne.prixVenteActuel || "");
      }
      setPrixVentes(initial);
    }
    setAfficherReception(true);
  }

  async function receptionner() {
    if (!depotId) return;
    setEnCours(true);
    setErreur(null);
    try {
      const resultat = await api.commandes.receptionner({
        commandeId,
        depotId,
        utilisateurId: session.utilisateurId,
        montantDejaPaye: Number(montantDejaPaye) || 0,
        lignesPrix: Object.entries(prixVentes).map(([varianteId, prixVente]) => ({
          varianteId,
          prixVente: Number(prixVente) || 0,
        })),
      });
      if (resultat.succes) {
        setAfficherReception(false);
        rafraichir();
      } else {
        setErreur(resultat.message);
      }
    } finally {
      setEnCours(false);
    }
  }

  if (!commande) return <p>Chargement…</p>;
  const fournisseurModifiable = commande.statut === "brouillon";

  return (
    <div className="detail-produit">
      <div className="entete-detail">
        <h3>
          Commande {commande.numero}{" "}
          <span className={`badge-${commande.statut}`}>{libelleStatutCommande(commande.statut)}</span>
        </h3>
        <button type="button" className="lien bouton-retour" onClick={onRetour}>
          ← Retour à la liste
        </button>
      </div>
      {erreur && <div className="message-erreur">{erreur}</div>}

      <p>
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
        )}
        <span className="sous-info"> {new Date(commande.dateCreation).toLocaleString("fr-FR")}</span>
      </p>

      <div className="zone-tableau-scroll">
      <table className="tableau-catalogue">
        <thead>
          <tr>
            <th>Désignation</th>
            <th>Référence</th>
            <th>Qté</th>
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
            </tr>
          ))}
        </tbody>
      </table>
      </div>

      <div className="totaux">
        <div className="total-net">Total : {formaterMontant(commande.total)} {devise}</div>
      </div>

      {peutGerer && commande.statut === "brouillon" && (
        <button type="button" className="bouton-primaire" onClick={passerEnCommandee}>
          Passer en commandée
        </button>
      )}

      {peutGerer && commande.statut === "commandee" && !afficherReception && (
        <button type="button" className="bouton-primaire" onClick={ouvrirReception}>
          Réceptionner
        </button>
      )}
      {peutGerer && commande.statut === "commandee" && afficherReception && (
        <div className="formulaire-catalogue">
          <h4>Réception de marchandise</h4>
          <div className="grille-champs">
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
              <ChampMontant value={montantDejaPaye} onChange={setMontantDejaPaye} />
            </label>
          </div>

          <h4>Prix de vente à la réception</h4>
          <div className="zone-tableau-scroll">
          <table className="tableau-catalogue">
            <thead>
              <tr>
                <th>Désignation</th>
                <th>Prix d'achat</th>
                <th>Prix de vente</th>
              </tr>
            </thead>
            <tbody>
              {commande.lignes.map((l) => {
                const invalide = Number(prixVentes[l.varianteId] || 0) < l.prixAchat;
                return (
                  <tr key={l.id}>
                    <td>{l.produitNom}</td>
                    <td>{formaterMontant(l.prixAchat)}</td>
                    <td>
                      <ChampMontant
                        className={invalide ? "champ-invalide" : ""}
                        value={prixVentes[l.varianteId] ?? ""}
                        onChange={(valeur) =>
                          setPrixVentes((prec) => ({ ...prec, [l.varianteId]: valeur }))
                        }
                      />
                      {invalide && (
                        <span className="badge-rupture" title="Prix de vente inférieur au prix d'achat">
                          ⚠
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
              {Array.from({ length: Math.max(0, 10 - commande.lignes.length) }).map((_, i) => (
                <tr key={`vide-${i}`} className="ligne-groupe-vide">
                  <td>&nbsp;</td>
                  <td>&nbsp;</td>
                  <td>&nbsp;</td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>

          <div className="actions-formulaire">
            <button type="button" onClick={() => setAfficherReception(false)}>
              Annuler
            </button>
            <button
              type="button"
              className="bouton-primaire"
              onClick={receptionner}
              disabled={
                enCours || commande.lignes.some((l) => Number(prixVentes[l.varianteId] || 0) < l.prixAchat)
              }
            >
              {enCours ? "Réception…" : "Confirmer la réception"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

const SECTIONS = [
  { cle: "commandes", label: "Commandes", icone: "📦" },
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

  if (commandeSelectionneeId) {
    return (
      <DetailCommande
        commandeId={commandeSelectionneeId}
        session={session}
        fournisseurs={fournisseurs}
        onRetour={() => {
          setCommandeSelectionneeId(null);
          rafraichir();
        }}
      />
    );
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
                <span className={`badge-${c.statut}`}>{libelleStatutCommande(c.statut)}</span>
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
          {commandes.length > 0 &&
            Array.from({ length: Math.max(0, 10 - commandes.length) }).map((_, i) => (
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
          {fournisseurs.length > 0 &&
            Array.from({ length: Math.max(0, 10 - fournisseurs.length) }).map((_, i) => (
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
          {dettes.length > 0 &&
            Array.from({ length: Math.max(0, 10 - dettes.length) }).map((_, i) => (
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
      {sectionOuverte === "fournisseurs" && (
        <ModaleFournisseurs session={session} onFermer={() => setSectionOuverte(null)} />
      )}
      {sectionOuverte === "dettes" && (
        <ModaleDettes session={session} onFermer={() => setSectionOuverte(null)} />
      )}
    </div>
  );
}
