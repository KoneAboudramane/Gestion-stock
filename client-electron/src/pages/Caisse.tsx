import { useEffect, useMemo, useState } from "react";

import { api } from "../api/client";
import type { ClientBoutique, Depot, ModePaiement, Session, VarianteCatalogue, VenteCreee } from "../api/client";
import { useDevise } from "../contexts/DeviseContext";
import { MODES_PAIEMENT } from "../lib/libelles";

const SANS_CATEGORIE = "Sans catégorie";

interface LignePanier {
  varianteId: string;
  produitNom: string;
  quantite: number;
  prixUnitaire: number;
  remise: number;
  prixAchat: number;
}

interface LignePaiement {
  mode: ModePaiement;
  montant: string;
  montantRecu?: string;
}

export default function Caisse({ session }: { session: Session }) {
  const peutModifierPrix = !!session.permissions.modifier_prix;
  const devise = useDevise();

  const [terme, setTerme] = useState("");
  const [categorieFiltre, setCategorieFiltre] = useState("");
  const [catalogue, setCatalogue] = useState<VarianteCatalogue[]>([]);
  const [panier, setPanier] = useState<LignePanier[]>([]);
  const [depots, setDepots] = useState<Depot[]>([]);
  const [depotId, setDepotId] = useState(session.depotId ?? "");
  const [clients, setClients] = useState<ClientBoutique[]>([]);
  const [clientId, setClientId] = useState("");
  const [clientTerme, setClientTerme] = useState("");
  const [listeClientOuverte, setListeClientOuverte] = useState(false);
  const [creationClientOuverte, setCreationClientOuverte] = useState(false);
  const [nouveauClientTelephone, setNouveauClientTelephone] = useState("");
  const [remiseGlobale, setRemiseGlobale] = useState("0");
  const [typeRemiseGlobale, setTypeRemiseGlobale] = useState<"montant" | "pourcentage">("montant");
  const [remiseGlobaleOuverte, setRemiseGlobaleOuverte] = useState(false);
  const [colonneRemiseOuverte, setColonneRemiseOuverte] = useState(false);
  const [paiements, setPaiements] = useState<LignePaiement[]>([{ mode: "especes", montant: "" }]);
  const [erreur, setErreur] = useState<string | null>(null);
  const [ticket, setTicket] = useState<VenteCreee | null>(null);
  const [enCours, setEnCours] = useState(false);

  useEffect(() => {
    // Si l'utilisateur a un dépôt assigné (Réglages), pas besoin de la liste :
    // la Caisse est verrouillée dessus, sans sélecteur.
    if (!session.depotId) {
      api.catalogue.listerDepots(session.boutiqueId).then((liste) => {
        setDepots(liste);
        if (liste[0]) setDepotId(liste[0].id);
      });
    }
    api.catalogue.listerClients(session.boutiqueId).then(setClients);
  }, [session.boutiqueId, session.depotId]);

  // Recharge la quantité disponible affichée dès que le dépôt change.
  useEffect(() => {
    api.catalogue.listerVariantesCatalogue(session.boutiqueId, depotId || undefined).then(setCatalogue);
  }, [session.boutiqueId, depotId]);

  // Catégories distinctes présentes dans le catalogue, pour le filtre —
  // dérivées du catalogue déjà chargé, pas d'appel supplémentaire.
  const categoriesDisponibles = useMemo(() => {
    const noms = new Set<string>();
    for (const v of catalogue) {
      noms.add(v.categorieNom ?? SANS_CATEGORIE);
    }
    return Array.from(noms).sort((a, b) => {
      if (a === SANS_CATEGORIE) return 1;
      if (b === SANS_CATEGORIE) return -1;
      return a.localeCompare(b);
    });
  }, [catalogue]);

  // Quantité disponible affichée = quantité en dépôt moins ce qui est déjà
  // dans le panier — recalculée à chaque ajout/retrait/modif de quantité,
  // sans nouvelle requête (le stock réel ne bouge qu'à la validation de la vente).
  const quantitesDisponiblesAjustees = useMemo(() => {
    const disponibles = new Map(catalogue.map((v) => [v.id, v.quantiteDisponible]));
    for (const ligne of panier) {
      const actuel = disponibles.get(ligne.varianteId);
      if (actuel !== undefined) {
        disponibles.set(ligne.varianteId, actuel - ligne.quantite);
      }
    }
    return disponibles;
  }, [catalogue, panier]);

  // Le catalogue (listerVariantesCatalogue) ne renvoie déjà que les variantes
  // ayant une ligne de stock dans ce dépôt — un produit jamais stocké ici n'y
  // figure pas. Ici on ne fait plus que filtrer par catégorie/recherche ;
  // une quantité à 0 (rupture) reste affichée mais grisée (voir plus bas).
  const catalogueFiltre = useMemo(() => {
    const q = terme.trim().toLowerCase();
    return catalogue.filter((v) => {
      const categorie = v.categorieNom ?? SANS_CATEGORIE;
      if (categorieFiltre && categorie !== categorieFiltre) return false;
      if (!q) return true;
      return (
        v.produitNom.toLowerCase().includes(q) ||
        v.reference.toLowerCase().includes(q) ||
        v.codeBarres.toLowerCase().includes(q)
      );
    });
  }, [catalogue, terme, categorieFiltre]);

  // Suggestions du combobox client : les clients connus qui correspondent au
  // texte tapé — sert aussi à savoir si on doit proposer de créer un nouveau
  // client (aucune correspondance exacte).
  const clientsFiltres = useMemo(() => {
    const q = clientTerme.trim().toLowerCase();
    if (!q) return clients;
    return clients.filter((c) => c.nom.toLowerCase().includes(q));
  }, [clients, clientTerme]);

  const clientCorrespondExactement = useMemo(
    () => clients.some((c) => c.nom.trim().toLowerCase() === clientTerme.trim().toLowerCase()),
    [clients, clientTerme],
  );

  function choisirClient(client: ClientBoutique) {
    setClientId(client.id);
    setClientTerme(client.telephone ? `${client.nom} (${client.telephone})` : client.nom);
    setListeClientOuverte(false);
    setCreationClientOuverte(false);
    setNouveauClientTelephone("");
  }

  function demarrerCreationClient() {
    setCreationClientOuverte(true);
    setListeClientOuverte(false);
  }

  async function confirmerCreationClient() {
    const nom = clientTerme.trim();
    if (!nom) return;
    const telephone = nouveauClientTelephone.trim();
    const resultat = await api.clients.creer(session.boutiqueId, nom, telephone);
    if (resultat.succes) {
      const nouveau: ClientBoutique = { id: resultat.resultat, nom, telephone };
      setClients((actuel) => [...actuel, nouveau]);
      choisirClient(nouveau);
    } else {
      setErreur(resultat.message);
    }
  }

  function ajouterAuPanier(variante: VarianteCatalogue) {
    const quantiteAjustee = quantitesDisponiblesAjustees.get(variante.id) ?? variante.quantiteDisponible;
    if (quantiteAjustee <= 0) {
      setErreur(`"${variante.produitNom}" est en rupture de stock dans ce dépôt.`);
      return;
    }
    setErreur(null);
    setPanier((actuel) => {
      const existant = actuel.find((l) => l.varianteId === variante.id);
      if (existant) {
        return actuel.map((l) =>
          l.varianteId === variante.id ? { ...l, quantite: l.quantite + 1 } : l,
        );
      }
      return [
        ...actuel,
        {
          varianteId: variante.id,
          produitNom: variante.produitNom,
          quantite: 1,
          prixUnitaire: variante.prixVente,
          remise: 0,
          prixAchat: variante.prixAchat,
        },
      ];
    });
    setTerme("");
  }

  function modifierLigne(varianteId: string, champs: Partial<LignePanier>) {
    setPanier((actuel) => actuel.map((l) => (l.varianteId === varianteId ? { ...l, ...champs } : l)));
  }

  function retirerLigne(varianteId: string) {
    setPanier((actuel) => actuel.filter((l) => l.varianteId !== varianteId));
  }

  const lignesCalculees = useMemo(
    () =>
      panier.map((l) => {
        const sousTotal = Math.round(l.quantite * l.prixUnitaire - l.remise);
        const sousPrixAchat = sousTotal < Math.round(l.quantite * l.prixAchat);
        return { ...l, sousTotal, sousPrixAchat };
      }),
    [panier],
  );
  const totalBrut = lignesCalculees.reduce((somme, l) => somme + l.sousTotal, 0);
  const remiseGlobaleNombre =
    typeRemiseGlobale === "pourcentage"
      ? Math.round((totalBrut * (Number(remiseGlobale) || 0)) / 100)
      : Number(remiseGlobale) || 0;
  const totalNet = Math.round(totalBrut - remiseGlobaleNombre);
  const totalPaiements = paiements.reduce((somme, p) => somme + (Number(p.montant) || 0), 0);

  // Cas le plus fréquent : un seul mode de paiement pour la totalité — pas besoin de retaper
  // un montant déjà connu (Total net). Dès qu'il y a plusieurs lignes (paiement scindé), chacune
  // redevient libre.
  useEffect(() => {
    if (paiements.length === 1) {
      setPaiements([{ ...paiements[0], montant: String(totalNet) }]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [totalNet, paiements.length]);

  function ajouterLignePaiement() {
    const reste = Math.max(0, totalNet - totalPaiements);
    const modesUtilises = new Set(paiements.map((p) => p.mode));
    // Le crédit est de loin le 2e mode le plus courant (le reste d'un paiement partiel) :
    // proposé en priorité s'il n'est pas déjà utilisé, sinon le premier mode encore libre.
    const modeSuivant =
      (!modesUtilises.has("credit") ? "credit" : undefined) ??
      MODES_PAIEMENT.find((m) => !modesUtilises.has(m.valeur))?.valeur ??
      "especes";
    setPaiements((actuel) => [...actuel, { mode: modeSuivant, montant: String(reste) }]);
  }
  function modifierPaiement(index: number, champs: Partial<LignePaiement>) {
    setPaiements((actuel) => {
      const mis = actuel.map((p, i) => (i === index ? { ...p, ...champs } : p));
      // À deux lignes, la 2e suit automatiquement la 1re pour que la somme reste égale
      // au Total net sans calcul manuel (au-delà de deux, trop ambigu de savoir laquelle ajuster).
      if (champs.montant !== undefined && mis.length === 2) {
        const autreIndex = index === 0 ? 1 : 0;
        const reste = Math.max(0, totalNet - (Number(champs.montant) || 0));
        mis[autreIndex] = { ...mis[autreIndex], montant: String(reste) };
      }
      return mis;
    });
  }
  function retirerPaiement(index: number) {
    setPaiements((actuel) => actuel.filter((_, i) => i !== index));
  }

  async function validerVente() {
    setErreur(null);
    if (panier.length === 0) {
      setErreur("Le panier est vide.");
      return;
    }
    if (!depotId) {
      setErreur("Choisissez un dépôt.");
      return;
    }
    const ligneSousPrixAchat = lignesCalculees.find((l) => l.sousPrixAchat);
    if (ligneSousPrixAchat) {
      setErreur(`Le prix de vente de "${ligneSousPrixAchat.produitNom}" ne peut pas être inférieur au prix d'achat.`);
      return;
    }
    if (totalPaiements !== totalNet) {
      setErreur(`La somme des paiements (${totalPaiements}) doit égaler le total (${totalNet}).`);
      return;
    }
    const utiliseCredit = paiements.some((p) => p.mode === "credit" && Number(p.montant) > 0);
    if (utiliseCredit && !clientId) {
      setErreur("Choisissez un client pour une vente à crédit.");
      return;
    }

    setEnCours(true);
    try {
      const resultat = await api.ventes.creer({
        boutiqueId: session.boutiqueId,
        depotId,
        utilisateurId: session.utilisateurId,
        clientId: clientId || null,
        statut: utiliseCredit ? "credit" : "payee",
        lignes: panier.map((l) => ({
          varianteId: l.varianteId,
          quantite: l.quantite,
          prixUnitaire: l.prixUnitaire,
          remise: l.remise,
        })),
        paiements: paiements
          .filter((p) => Number(p.montant) > 0)
          .map((p) => ({ mode: p.mode, montant: Number(p.montant) })),
        remiseGlobale: remiseGlobaleNombre,
      });
      if (resultat.succes) {
        setTicket(resultat.vente);
        setPanier([]);
        setPaiements([{ mode: "especes", montant: "" }]);
        setRemiseGlobale("0");
        setTypeRemiseGlobale("montant");
        setRemiseGlobaleOuverte(false);
        setClientId("");
        setClientTerme("");
        setCreationClientOuverte(false);
        setNouveauClientTelephone("");
      } else {
        setErreur(resultat.message);
      }
    } catch (e) {
      setErreur(e instanceof Error ? e.message : "Erreur inattendue.");
    } finally {
      setEnCours(false);
    }
  }

  if (ticket) {
    return (
      <div className="ticket">
        <h2>Vente enregistrée</h2>
        <p className="numero-ticket">{ticket.numero}</p>
        <p>Total : {ticket.totalNet} {devise}</p>
        <button onClick={() => setTicket(null)}>Nouvelle vente</button>
      </div>
    );
  }

  return (
    <div className="caisse">
      <div className="entete-caisse">
        <h2>Caisse</h2>
        <div className="entete-caisse-droite">
          <div className="remise-globale-entete">
            {remiseGlobaleOuverte ? (
              <div className="champ-remise-globale">
                <input
                  type="number"
                  min={0}
                  step="any"
                  autoFocus
                  value={remiseGlobale === "0" ? "" : remiseGlobale}
                  onChange={(e) => setRemiseGlobale(e.target.value)}
                />
                <select
                  value={typeRemiseGlobale}
                  onChange={(e) => setTypeRemiseGlobale(e.target.value as "montant" | "pourcentage")}
                >
                  <option value="montant">{devise}</option>
                  <option value="pourcentage">%</option>
                </select>
              </div>
            ) : (
              <button type="button" className="lien" onClick={() => setRemiseGlobaleOuverte(true)}>
                {Number(remiseGlobale) > 0
                  ? `${remiseGlobale} ${typeRemiseGlobale === "pourcentage" ? "%" : devise}`
                  : "Remise globale"}
              </button>
            )}
          </div>
          <div className="bloc-total-net">
            <div className="total-net-entete">Total net : {totalNet} {devise}</div>
            <div className={`total-brut-inline ${remiseGlobaleNombre > 0 ? "" : "masque"}`}>
              Total brut : {totalBrut} {devise}
            </div>
          </div>
        </div>
      </div>
      <div className="colonne-recherche">
        <div className="barre-actions">
          <input
            className="champ-recherche"
            placeholder="Rechercher un produit ou scanner un code-barres…"
            value={terme}
            onChange={(e) => setTerme(e.target.value)}
            autoFocus
          />
          <select value={categorieFiltre} onChange={(e) => setCategorieFiltre(e.target.value)}>
            <option value="">Toutes les catégories</option>
            {categoriesDisponibles.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>
        <div className="catalogue-caisse">
          <table className="tableau-catalogue">
            <thead>
              <tr>
                <th>Produit</th>
                <th>Qté disponible</th>
                <th>Prix unitaire</th>
              </tr>
            </thead>
            <tbody>
              {catalogueFiltre.map((v) => {
                const quantiteAjustee = quantitesDisponiblesAjustees.get(v.id) ?? v.quantiteDisponible;
                const enRupture = quantiteAjustee <= 0;
                return (
                <tr
                  key={v.id}
                  className={enRupture ? "ligne-rupture" : undefined}
                  onClick={() => ajouterAuPanier(v)}
                >
                  <td>
                    {v.produitNom}
                    {v.reference && ` (${v.reference})`}
                  </td>
                  <td>
                    {quantiteAjustee <= v.seuilAlerte ? (
                      <span className="badge-rupture">{quantiteAjustee}</span>
                    ) : (
                      quantiteAjustee
                    )}
                  </td>
                  <td>{v.prixVente} {devise}</td>
                </tr>
                );
              })}
              {catalogueFiltre.length === 0 && (
                <tr>
                  <td colSpan={3} className="liste-vide">
                    Aucun produit ne correspond.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="colonne-panier">
        <div className="panier-scrollable">
        <table className="tableau-panier">
          <thead>
            <tr>
              <th>Produit</th>
              <th>Qté</th>
              <th>PU</th>
              <th>
                <button
                  type="button"
                  className="lien-icone"
                  title={colonneRemiseOuverte ? "Masquer la remise par article" : "Appliquer une remise par article"}
                  onClick={() => setColonneRemiseOuverte((actuel) => !actuel)}
                >
                  {colonneRemiseOuverte ? "−" : "+"}
                </button>
              </th>
              <th>Sous-total</th>
              <th className="colonne-supprimer" />
            </tr>
          </thead>
          <tbody>
            {[...lignesCalculees].reverse().map((l) => (
              <tr key={l.varianteId}>
                <td>{l.produitNom}</td>
                <td>
                  <input
                    className="champ-quantite"
                    type="number"
                    min={0.01}
                    step="any"
                    value={l.quantite === 0 ? "" : l.quantite}
                    onChange={(e) => modifierLigne(l.varianteId, { quantite: Number(e.target.value) })}
                  />
                </td>
                <td>
                  <input
                    className={l.sousPrixAchat ? "champ-invalide" : undefined}
                    type="number"
                    min={0}
                    step="any"
                    value={l.prixUnitaire}
                    disabled={!peutModifierPrix}
                    title={peutModifierPrix ? undefined : "Votre rôle ne permet pas de modifier les prix."}
                    onChange={(e) => modifierLigne(l.varianteId, { prixUnitaire: Number(e.target.value) })}
                  />
                </td>
                <td>
                  {colonneRemiseOuverte && (
                    <input
                      className={l.sousPrixAchat ? "champ-invalide" : undefined}
                      type="number"
                      min={0}
                      step="any"
                      placeholder="Remise"
                      value={l.remise === 0 ? "" : l.remise}
                      onChange={(e) => modifierLigne(l.varianteId, { remise: Number(e.target.value) })}
                    />
                  )}
                </td>
                <td>
                  {l.sousTotal}
                  {l.sousPrixAchat && (
                    <span className="badge-rupture" title="Sous le prix d'achat">
                      ⚠
                    </span>
                  )}
                </td>
                <td className="colonne-supprimer">
                  <button onClick={() => retirerLigne(l.varianteId)}>✕</button>
                </td>
              </tr>
            ))}
            {lignesCalculees.length === 0 && (
              <tr>
                <td colSpan={6} className="panier-vide">
                  Panier vide
                </td>
              </tr>
            )}
          </tbody>
        </table>
        </div>

        <div className="panier-bas-fixe">
        {!session.depotId && (
          <div className="ligne-choix">
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
          </div>
        )}
        <div className="paiements">
          <h3>Paiement</h3>
          {paiements.map((p, i) => (
            <div key={i} className="ligne-paiement">
              <select value={p.mode} onChange={(e) => modifierPaiement(i, { mode: e.target.value as ModePaiement })}>
                {MODES_PAIEMENT.map((m) => (
                  <option key={m.valeur} value={m.valeur}>
                    {m.label}
                  </option>
                ))}
              </select>
              <input
                type="number"
                min={0}
                step="any"
                placeholder="Montant"
                value={p.montant}
                onChange={(e) => modifierPaiement(i, { montant: e.target.value })}
              />
              {p.mode === "especes" && (
                <div className="calculette-monnaie">
                  <input
                    type="number"
                    min={0}
                    step="any"
                    placeholder="Montant reçu"
                    value={p.montantRecu ?? ""}
                    onChange={(e) => modifierPaiement(i, { montantRecu: e.target.value })}
                  />
                  {Number(p.montantRecu) > (Number(p.montant) || 0) && (
                    <div className="monnaie-a-rendre">
                      <span>Monnaie à rendre</span>
                      <strong>
                        {Number(p.montantRecu) - (Number(p.montant) || 0)} {devise}
                      </strong>
                    </div>
                  )}
                </div>
              )}
              {p.mode === "credit" && (
                <div className="champ-client-credit">
                  <div className="client-combobox">
                    <input
                      type="text"
                      value={clientTerme}
                      placeholder="Rechercher ou ajouter un client…"
                      onChange={(e) => {
                        setClientTerme(e.target.value);
                        setClientId("");
                        setListeClientOuverte(true);
                        setCreationClientOuverte(false);
                      }}
                      onFocus={() => setListeClientOuverte(true)}
                      onBlur={() => setTimeout(() => setListeClientOuverte(false), 150)}
                    />
                    {listeClientOuverte && (
                      <ul className="client-suggestions">
                        {clientsFiltres.map((c) => (
                          <li key={c.id} onMouseDown={() => choisirClient(c)}>
                            {c.nom}
                            {c.telephone && ` (${c.telephone})`}
                          </li>
                        ))}
                        {clientTerme.trim() && !clientCorrespondExactement && (
                          <li className="client-suggestion-ajout" onMouseDown={demarrerCreationClient}>
                            + Ajouter « {clientTerme.trim()} » comme nouveau client
                          </li>
                        )}
                        {clientsFiltres.length === 0 && !clientTerme.trim() && (
                          <li className="client-suggestion-vide">Tapez pour rechercher un client…</li>
                        )}
                      </ul>
                    )}
                    {creationClientOuverte && (
                      <div className="creation-client-rapide">
                        <span>
                          Nouveau client : <strong>{clientTerme.trim()}</strong>
                        </span>
                        <input
                          type="tel"
                          autoFocus
                          placeholder="Téléphone (recommandé)"
                          value={nouveauClientTelephone}
                          onChange={(e) => setNouveauClientTelephone(e.target.value)}
                        />
                        <div className="creation-client-actions">
                          <button type="button" onClick={confirmerCreationClient}>
                            Créer le client
                          </button>
                          <button type="button" className="lien" onClick={() => setCreationClientOuverte(false)}>
                            Annuler
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}
              {paiements.length > 1 && <button onClick={() => retirerPaiement(i)}>✕</button>}
            </div>
          ))}
          <button type="button" className="lien" onClick={ajouterLignePaiement}>
            + mode de paiement
          </button>
          <div className="recap-paiement">
            Saisi : {totalPaiements} / {totalNet} {devise}
          </div>
        </div>

        {erreur && <div className="message-erreur">{erreur}</div>}

        <button className="bouton-valider" disabled={enCours} onClick={validerVente}>
          {enCours ? "Validation…" : "Valider la vente"}
        </button>
        </div>
      </div>
    </div>
  );
}
