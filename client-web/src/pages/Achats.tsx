import { useEffect, useState } from "react";

import type { Session } from "../api";
import ChampMontant from "../components/ChampMontant";
import { useDevise } from "../contexts/DeviseContext";
import { formaterMontant } from "../lib/formatage";
import {
  creerCommande,
  creerFournisseur,
  ErreurAchat,
  listerCommandes,
  listerDettes,
  listerFournisseurs,
  modifierCommande,
  obtenirCommande,
  payerDette,
  receptionnerCommande,
  rechercherVariantesAchat,
  type CommandeDetail,
  type CommandeResume,
  type DetteResume,
  type FournisseurResume,
  type StatutCommande,
  type StatutDette,
  type VarianteAchat,
} from "../services/achats";
import { listerDepotsDetail, type DepotResume } from "../services/stock";

/**
 * Port de client-electron/src/pages/Achats.tsx, local d'abord (IndexedDB, voir
 * services/achats.ts), comme le reste de l'application. Accès réservé aux
 * comptes ayant la permission gerer_produits_stock_achats.
 *
 * Non repris ici par rapport à l'Electron : le raccourci "Commander" groupé
 * depuis une rupture de stock du tableau de bord (n'existe pas côté web).
 */

function libelleStatutCommande(statut: StatutCommande): string {
  if (statut === "brouillon") return "Brouillon";
  if (statut === "commandee") return "Commandée";
  if (statut === "recue") return "Reçue";
  return "Annulée";
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
  const [resultats, setResultats] = useState<VarianteAchat[]>([]);
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
      await creerCommande({
        boutiqueId: session.boutiqueId,
        fournisseurId,
        utilisateurId: session.utilisateurId,
        statut,
        lignes: lignes.map((l) => ({ varianteId: l.varianteId, quantite: l.quantite, prixAchat: l.prixAchat })),
      });
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
        <h3>Nouvelle commande</h3>
        <div className="actions-formulaire">
          <button type="button" onClick={() => soumettre("brouillon")} disabled={enCours}>
            {enCours ? "Enregistrement…" : "Enregistrer en brouillon"}
          </button>
          <button type="button" className="bouton-primaire" onClick={() => soumettre("commandee")} disabled={enCours}>
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
                  {resultats.length === 0 && <li className="liste-vide">Aucun article trouvé.</li>}
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
                      <ChampMontant value={String(l.prixAchat)} onChange={(valeur) => modifierLigne(l.varianteId, { prixAchat: Number(valeur) || 0 })} />
                    </td>
                    <td className="colonne-sous-total">{formaterMontant(Math.round(l.quantite * l.prixAchat))}</td>
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
  const [depots, setDepots] = useState<DepotResume[]>([]);
  const [depotId, setDepotId] = useState("");
  const [montantDejaPaye, setMontantDejaPaye] = useState("0");
  const [afficherReception, setAfficherReception] = useState(false);
  const [prixVentes, setPrixVentes] = useState<Record<string, string>>({});
  const [erreur, setErreur] = useState<string | null>(null);
  const [enCours, setEnCours] = useState(false);

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
      await modifierCommande(commandeId, { fournisseurId: nouveauFournisseurId });
      rafraichir();
    } catch (e) {
      setErreur(e instanceof ErreurAchat ? e.message : "Erreur inattendue.");
    }
  }

  async function passerEnCommandee() {
    try {
      await modifierCommande(commandeId, { statut: "commandee" });
      rafraichir();
    } catch (e) {
      setErreur(e instanceof ErreurAchat ? e.message : "Erreur inattendue.");
    }
  }

  function ouvrirReception() {
    if (commande) {
      const initial: Record<string, string> = {};
      for (const ligne of commande.lignes) {
        initial[ligne.varianteId] = String(ligne.prixAchat || "");
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
      await receptionnerCommande({
        commandeId,
        depotId,
        utilisateurId: session.utilisateurId,
        montantDejaPaye: Number(montantDejaPaye) || 0,
        lignesPrix: Object.entries(prixVentes).map(([varianteId, prixVente]) => ({ varianteId, prixVente: Number(prixVente) || 0 })),
      });
      setAfficherReception(false);
      rafraichir();
    } catch (e) {
      setErreur(e instanceof ErreurAchat ? e.message : "Erreur inattendue.");
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
          Commande {commande.numero} <span className={`badge-${commande.statut}`}>{libelleStatutCommande(commande.statut)}</span>
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
              <th>N°</th>
              <th>Désignation</th>
              <th>Référence</th>
              <th>Qté</th>
              <th>Prix d'achat</th>
              <th>Sous-total</th>
            </tr>
          </thead>
          <tbody>
            {commande.lignes.map((l, index) => (
              <tr key={l.id}>
                <td>{index + 1}</td>
                <td>{l.produitNom}</td>
                <td>{l.reference || ""}</td>
                <td>{l.quantite}</td>
                <td>{formaterMontant(l.prixAchat)}</td>
                <td>{formaterMontant(l.sousTotal)}</td>
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
                  <th>N°</th>
                  <th>Désignation</th>
                  <th>Prix d'achat</th>
                  <th>Prix de vente</th>
                </tr>
              </thead>
              <tbody>
                {commande.lignes.map((l, index) => {
                  const invalide = Number(prixVentes[l.varianteId] || 0) < l.prixAchat;
                  return (
                    <tr key={l.id}>
                      <td>{index + 1}</td>
                      <td>{l.produitNom}</td>
                      <td>{formaterMontant(l.prixAchat)}</td>
                      <td>
                        <ChampMontant
                          className={invalide ? "champ-invalide" : ""}
                          value={prixVentes[l.varianteId] ?? ""}
                          onChange={(valeur) => setPrixVentes((prec) => ({ ...prec, [l.varianteId]: valeur }))}
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
              className="bouton-primaire"
              onClick={receptionner}
              disabled={enCours || commande.lignes.some((l) => Number(prixVentes[l.varianteId] || 0) < l.prixAchat)}
            >
              {enCours ? "Réception…" : "Confirmer la réception"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

const ONGLETS = [
  { cle: "commandes", label: "Commandes" },
  { cle: "fournisseurs", label: "Fournisseurs" },
  { cle: "dettes", label: "Dettes" },
] as const;

type Onglet = (typeof ONGLETS)[number]["cle"];

function SelecteurOnglet({ onglet, setOnglet }: { onglet: Onglet; setOnglet: (o: Onglet) => void }) {
  return (
    <div className="barre-onglets">
      {ONGLETS.map((o) => (
        <button key={o.cle} type="button" className={`onglet ${onglet === o.cle ? "actif" : ""}`} onClick={() => setOnglet(o.cle)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

function OngletCommandes({ session, onglet, setOnglet }: { session: Session; onglet: Onglet; setOnglet: (o: Onglet) => void }) {
  const peutGerer = !!session.permissions.gerer_produits_stock_achats;
  const [fournisseurs, setFournisseurs] = useState<FournisseurResume[]>([]);
  const [fournisseurId, setFournisseurId] = useState("");
  const [statut, setStatut] = useState<StatutCommande | "">("");
  const [terme, setTerme] = useState("");
  const [commandes, setCommandes] = useState<CommandeResume[]>([]);
  const [afficherForm, setAfficherForm] = useState(false);
  const [commandeSelectionneeId, setCommandeSelectionneeId] = useState<string | null>(null);

  useEffect(() => {
    listerFournisseurs(session.boutiqueId).then(setFournisseurs);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function rafraichir() {
    setCommandes(await listerCommandes(session.boutiqueId, fournisseurId || undefined, statut || undefined, terme));
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
        <SelecteurOnglet onglet={onglet} setOnglet={setOnglet} />
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
        <input className="champ-recherche" placeholder="Rechercher par numéro…" value={terme} onChange={(e) => setTerme(e.target.value)} />
        {peutGerer && (
          <span className="actions-ligne">
            <button type="button" className="bouton-ajouter-variante" onClick={() => setAfficherForm(true)} disabled={fournisseurs.length === 0}>
              + Nouvelle commande
            </button>
          </span>
        )}
      </div>
      {peutGerer && fournisseurs.length === 0 && <p className="note-aide">Créez d'abord un fournisseur dans l'onglet « Fournisseurs ».</p>}
      <div className="zone-tableau-scroll">
        <table className="tableau-catalogue">
          <thead>
            <tr>
              <th>N°</th>
              <th>Date</th>
              <th>Numéro</th>
              <th>Fournisseur</th>
              <th>Statut</th>
              <th>Total</th>
            </tr>
          </thead>
          <tbody>
            {commandes.map((c, index) => (
              <tr key={c.id} onClick={() => setCommandeSelectionneeId(c.id)}>
                <td>{index + 1}</td>
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
                <td colSpan={6} className="liste-vide">
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

function OngletFournisseurs({ session, onglet, setOnglet }: { session: Session; onglet: Onglet; setOnglet: (o: Onglet) => void }) {
  const peutGerer = !!session.permissions.gerer_produits_stock_achats;
  const [fournisseurs, setFournisseurs] = useState<FournisseurResume[]>([]);
  const [afficherModal, setAfficherModal] = useState(false);

  async function rafraichir() {
    setFournisseurs(await listerFournisseurs(session.boutiqueId));
  }
  useEffect(() => {
    rafraichir();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div>
      <div className="barre-actions barre-actions-fixe barre-actions-avec-onglets">
        <SelecteurOnglet onglet={onglet} setOnglet={setOnglet} />
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
      <div className="zone-tableau-scroll">
        <table className="tableau-catalogue">
          <thead>
            <tr>
              <th>N°</th>
              <th>Nom</th>
              <th>Téléphone</th>
              <th>Adresse</th>
              <th>Contact</th>
            </tr>
          </thead>
          <tbody>
            {fournisseurs.map((f, index) => (
              <tr key={f.id}>
                <td>{index + 1}</td>
                <td>{f.nom}</td>
                <td>{f.telephone || ""}</td>
                <td>{f.adresse || ""}</td>
                <td>{f.contact || ""}</td>
              </tr>
            ))}
            {fournisseurs.length === 0 && (
              <tr>
                <td colSpan={5} className="liste-vide">
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

function LignePayer({ dette, onPaye }: { dette: DetteResume; onPaye: () => void }) {
  const [montant, setMontant] = useState("");
  const [erreur, setErreur] = useState<string | null>(null);
  const [enCours, setEnCours] = useState(false);

  async function payer() {
    setEnCours(true);
    setErreur(null);
    try {
      await payerDette(dette.id, Number(montant) || 0);
      setMontant("");
      onPaye();
    } catch (e) {
      setErreur(e instanceof ErreurAchat ? e.message : "Erreur inattendue.");
    } finally {
      setEnCours(false);
    }
  }

  return (
    <div>
      <ChampMontant placeholder="Montant" value={montant} onChange={setMontant} style={{ width: "100px" }} />
      <button type="button" className="bouton-primaire" onClick={payer} disabled={enCours}>
        {enCours ? "…" : "Payer"}
      </button>
      {erreur && <div className="message-erreur">{erreur}</div>}
    </div>
  );
}

function OngletDettes({ session, onglet, setOnglet }: { session: Session; onglet: Onglet; setOnglet: (o: Onglet) => void }) {
  const peutGerer = !!session.permissions.gerer_produits_stock_achats;
  const [statut, setStatut] = useState<StatutDette | "">("");
  const [dettes, setDettes] = useState<DetteResume[]>([]);

  async function rafraichir() {
    setDettes(await listerDettes(session.boutiqueId, undefined, statut || undefined));
  }
  useEffect(() => {
    rafraichir();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statut]);

  return (
    <div>
      <div className="barre-actions barre-actions-avec-onglets">
        <SelecteurOnglet onglet={onglet} setOnglet={setOnglet} />
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
              <th>N°</th>
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
            {dettes.map((d, index) => (
              <tr key={d.id}>
                <td>{index + 1}</td>
                <td>{new Date(d.dateCreation).toLocaleString("fr-FR")}</td>
                <td>{d.fournisseurNom}</td>
                <td>{d.commandeNumero ?? ""}</td>
                <td>{formaterMontant(d.montant)}</td>
                <td>{formaterMontant(d.montantPaye)}</td>
                <td>{formaterMontant(d.solde)}</td>
                <td>
                  <span className={d.statut === "solde" ? "badge-payee" : "badge-commandee"}>{d.statut === "solde" ? "Soldée" : "En cours"}</span>
                </td>
                {peutGerer && <td>{d.statut === "en_cours" && <LignePayer dette={d} onPaye={rafraichir} />}</td>}
              </tr>
            ))}
            {dettes.length === 0 && (
              <tr>
                <td colSpan={peutGerer ? 9 : 8} className="liste-vide">
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

export default function Achats({ session }: { session: Session }) {
  const [onglet, setOnglet] = useState<Onglet>("commandes");
  const peutAcceder = !!session.permissions.gerer_produits_stock_achats;

  if (!peutAcceder) {
    return (
      <div className="page-produits">
        <p className="note-aide">Accès réservé à la gestion produits/stock/achats.</p>
      </div>
    );
  }

  return (
    <div className="page-produits">
      <div className="contenu-onglet">
        {onglet === "commandes" && <OngletCommandes session={session} onglet={onglet} setOnglet={setOnglet} />}
        {onglet === "fournisseurs" && <OngletFournisseurs session={session} onglet={onglet} setOnglet={setOnglet} />}
        {onglet === "dettes" && <OngletDettes session={session} onglet={onglet} setOnglet={setOnglet} />}
      </div>
    </div>
  );
}
