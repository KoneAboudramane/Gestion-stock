import { useEffect, useState } from "react";

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
import { useDevise } from "../contexts/DeviseContext";

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
      return [...actuel, { varianteId: variante.id, produitNom: variante.produitNom, quantite: 1, prixAchat: variante.prixAchat }];
    });
    setTerme("");
    setResultats([]);
  }

  async function ajouterNouveauProduit() {
    const nom = terme.trim();
    if (!nom) return;
    const resultat = await api.produits.creer({ boutiqueId: session.boutiqueId, nom, prixAchat: 0, prixVente: 0 });
    if (resultat.succes) {
      setLignes((actuel) => [
        ...actuel,
        { varianteId: resultat.resultat.varianteId, produitNom: nom, quantite: 1, prixAchat: 0 },
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
      <div className="entete-detail entete-fixe">
        <h3>Nouvelle commande</h3>
        <div className="actions-formulaire">
          <button type="button" onClick={onAnnuler}>
            Annuler
          </button>
          <button type="button" onClick={() => soumettre("brouillon")} disabled={enCours}>
            {enCours ? "Enregistrement…" : "Enregistrer en brouillon"}
          </button>
          <button type="button" onClick={() => soumettre("commandee")} disabled={enCours}>
            {enCours ? "Enregistrement…" : "Créer et commander"}
          </button>
        </div>
      </div>
      {erreur && <div className="message-erreur">{erreur}</div>}

      <div className="colonnes-mouvement-groupe">
        <div className="colonne-recherche-groupe">
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

          <input
            placeholder="Rechercher un produit à commander…"
            value={terme}
            onChange={(e) => setTerme(e.target.value)}
          />
          <ul className="resultats-recherche">
            {resultats.map((v) => (
              <li key={v.id} onClick={() => ajouterLigne(v)}>
                <span>{v.produitNom}</span>
              </li>
            ))}
            {terme.trim() && resultats.length === 0 && (
              <li className="client-suggestion-ajout" onClick={ajouterNouveauProduit}>
                + Ajouter « {terme.trim()} » comme nouveau produit
              </li>
            )}
          </ul>
        </div>

        <div className="colonne-lignes-groupe">
          <div className="lignes-groupe-scrollable">
            <table className="tableau-catalogue">
              <thead>
                <tr>
                  <th>Produit</th>
                  <th>Qté</th>
                  <th>Prix d'achat</th>
                  <th className="colonne-sous-total">Sous-total</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {lignes.map((l) => (
                  <tr key={l.varianteId}>
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
                      <input
                        type="number"
                        min={0}
                        step="any"
                        value={l.prixAchat}
                        onChange={(e) => modifierLigne(l.varianteId, { prixAchat: Number(e.target.value) })}
                      />
                    </td>
                    <td className="colonne-sous-total">{Math.round(l.quantite * l.prixAchat)}</td>
                    <td>
                      <button type="button" onClick={() => retirerLigne(l.varianteId)}>
                        ✕
                      </button>
                    </td>
                  </tr>
                ))}
                {lignes.length === 0 && (
                  <tr>
                    <td colSpan={5} className="liste-vide">
                      Aucune ligne.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="totaux">
            <div className="total-net">
              Total : {total} {devise}
            </div>
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
      setErreur("Aucun produit à commander.");
      return;
    }
    if (lignesEditees.some((l) => !l.fournisseurId)) {
      setErreur("Choisissez un fournisseur pour chaque produit avant de créer les commandes.");
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
          <button type="button" onClick={creerLesCommandes} disabled={enCours || lignesEditees.length === 0}>
            {enCours ? "Création…" : `Créer les commandes (${groupes.size})`}
          </button>
        </div>
      </div>
      {erreur && <div className="message-erreur">{erreur}</div>}

      <div className="zone-tableau-scroll">
      <table className="tableau-catalogue">
        <thead>
          <tr>
            <th>Produit</th>
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
                <input
                  type="number"
                  min={0}
                  step="any"
                  value={l.prixAchat}
                  onChange={(e) => modifierLigne(l.varianteId, { prixAchat: Number(e.target.value) })}
                />
              </td>
              <td>
                <select
                  value={l.fournisseurId}
                  onChange={(e) => modifierLigne(l.varianteId, { fournisseurId: e.target.value })}
                >
                  <option value="">— à choisir —</option>
                  {fournisseurs.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.nom}
                    </option>
                  ))}
                </select>
              </td>
              <td>
                <button type="button" onClick={() => retirerLigne(l.varianteId)}>
                  ✕
                </button>
              </td>
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
            <th>Produit</th>
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
              <td>{l.prixAchat}</td>
              <td>{l.sousTotal}</td>
            </tr>
          ))}
        </tbody>
      </table>
      </div>

      <div className="totaux">
        <div className="total-net">Total : {commande.total} {devise}</div>
      </div>

      {peutGerer && commande.statut === "brouillon" && (
        <button type="button" onClick={passerEnCommandee}>
          Passer en commandée
        </button>
      )}

      {peutGerer && commande.statut === "commandee" && !afficherReception && (
        <button type="button" onClick={ouvrirReception}>
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
              <input
                type="number"
                min={0}
                step="any"
                value={montantDejaPaye}
                onChange={(e) => setMontantDejaPaye(e.target.value)}
              />
            </label>
          </div>

          <h4>Prix de vente à la réception</h4>
          <div className="zone-tableau-scroll">
          <table className="tableau-catalogue">
            <thead>
              <tr>
                <th>Produit</th>
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
                    <td>{l.prixAchat}</td>
                    <td>
                      <input
                        type="number"
                        min={0}
                        step="any"
                        className={invalide ? "champ-invalide" : ""}
                        value={prixVentes[l.varianteId] ?? ""}
                        onChange={(e) =>
                          setPrixVentes((prec) => ({ ...prec, [l.varianteId]: e.target.value }))
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
            </tbody>
          </table>
          </div>

          <div className="actions-formulaire">
            <button type="button" onClick={() => setAfficherReception(false)}>
              Annuler
            </button>
            <button
              type="button"
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

  if (afficherForm) {
    return (
      <FormulaireCommande
        session={session}
        fournisseurs={fournisseurs}
        onAnnuler={() => setAfficherForm(false)}
        onCree={() => {
          setAfficherForm(false);
          rafraichir();
        }}
      />
    );
  }

  return (
    <div>
      <div className="barre-actions">
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
          <button type="button" onClick={() => setAfficherForm(true)} disabled={fournisseurs.length === 0}>
            + Nouvelle commande
          </button>
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
              <td>{c.total}</td>
            </tr>
          ))}
          {commandes.length === 0 && (
            <tr>
              <td colSpan={5} className="liste-vide">
                Aucune commande.
              </td>
            </tr>
          )}
        </tbody>
      </table>
      </div>
    </div>
  );
}

// --- Onglet Fournisseurs ---

function OngletFournisseurs({ session }: { session: Session }) {
  const peutGerer = !!session.permissions.gerer_produits_stock_achats;
  const [fournisseurs, setFournisseurs] = useState<FournisseurResume[]>([]);
  const [nom, setNom] = useState("");
  const [telephone, setTelephone] = useState("");
  const [adresse, setAdresse] = useState("");
  const [contact, setContact] = useState("");
  const [erreur, setErreur] = useState<string | null>(null);

  async function rafraichir() {
    setFournisseurs(await api.fournisseurs.lister(session.boutiqueId));
  }
  useEffect(() => {
    rafraichir();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function ajouter(evenement: React.FormEvent) {
    evenement.preventDefault();
    if (!nom.trim()) return;
    const resultat = await api.fournisseurs.creer(
      session.boutiqueId,
      nom.trim(),
      telephone.trim(),
      adresse.trim(),
      contact.trim(),
    );
    if (resultat.succes) {
      setNom("");
      setTelephone("");
      setAdresse("");
      setContact("");
      setErreur(null);
      rafraichir();
    } else {
      setErreur(resultat.message);
    }
  }

  return (
    <div>
      {peutGerer && (
        <form onSubmit={ajouter} className="formulaire-inline barre-actions-fixe">
          <input placeholder="Nouveau fournisseur" value={nom} onChange={(e) => setNom(e.target.value)} />
          <input placeholder="Téléphone" value={telephone} onChange={(e) => setTelephone(e.target.value)} />
          <input placeholder="Adresse" value={adresse} onChange={(e) => setAdresse(e.target.value)} />
          <input placeholder="Contact" value={contact} onChange={(e) => setContact(e.target.value)} />
          <button type="submit">Ajouter</button>
        </form>
      )}
      {erreur && <div className="message-erreur">{erreur}</div>}
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
        </tbody>
      </table>
      </div>
    </div>
  );
}

// --- Onglet Dettes ---

function LignePayer({ dette, onPaye }: { dette: DetteResume; onPaye: () => void }) {
  const [montant, setMontant] = useState("");
  const [erreur, setErreur] = useState<string | null>(null);
  const [enCours, setEnCours] = useState(false);

  async function payer() {
    setEnCours(true);
    setErreur(null);
    try {
      const resultat = await api.dettes.payer(dette.id, Number(montant) || 0);
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
    <div>
      <input
        type="number"
        min={0.01}
        step="any"
        placeholder="Montant"
        value={montant}
        onChange={(e) => setMontant(e.target.value)}
        style={{ width: "100px" }}
      />
      <button type="button" onClick={payer} disabled={enCours}>
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

  async function rafraichir() {
    setDettes(await api.dettes.lister(session.boutiqueId, undefined, statut || undefined));
  }
  useEffect(() => {
    rafraichir();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statut]);

  return (
    <div>
      <div className="barre-actions">
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
              <td>{d.montant}</td>
              <td>{d.montantPaye}</td>
              <td>{d.solde}</td>
              <td>
                <span className={d.statut === "solde" ? "badge-payee" : "badge-commandee"}>
                  {d.statut === "solde" ? "Soldée" : "En cours"}
                </span>
              </td>
              {peutGerer && <td>{d.statut === "en_cours" && <LignePayer dette={d} onPaye={rafraichir} />}</td>}
            </tr>
          ))}
          {dettes.length === 0 && (
            <tr>
              <td colSpan={peutGerer ? 8 : 7} className="liste-vide">
                Aucune dette fournisseur.
              </td>
            </tr>
          )}
        </tbody>
      </table>
      </div>
    </div>
  );
}

// --- Page principale ---

const ONGLETS = [
  { cle: "commandes", label: "Commandes" },
  { cle: "fournisseurs", label: "Fournisseurs" },
  { cle: "dettes", label: "Dettes" },
] as const;

type Onglet = (typeof ONGLETS)[number]["cle"];

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
  const [onglet, setOnglet] = useState<Onglet>("commandes");

  return (
    <div className="page-produits">
      <div className="entete-page-onglets">
        <h2>Achats & fournisseurs</h2>
        <div className="barre-onglets">
          {ONGLETS.map((o) => (
            <button key={o.cle} className={`onglet ${onglet === o.cle ? "actif" : ""}`} onClick={() => setOnglet(o.cle)}>
              {o.label}
            </button>
          ))}
        </div>
      </div>
      <div className="contenu-onglet">
        {onglet === "commandes" && (
          <OngletCommandes
            session={session}
            ouvrirFormulaireInitial={ouvrirNouvelleCommande}
            lignesInitiales={lignesAchatInitiales}
            onFormulaireInitialConsomme={onOuvertureConsommee}
          />
        )}
        {onglet === "fournisseurs" && <OngletFournisseurs session={session} />}
        {onglet === "dettes" && <OngletDettes session={session} />}
      </div>
    </div>
  );
}
