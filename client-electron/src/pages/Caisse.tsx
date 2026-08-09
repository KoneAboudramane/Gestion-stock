import { useEffect, useMemo, useState } from "react";

import { api } from "../api/client";
import type { ClientBoutique, OperateurMobileMoney, Session, VarianteCatalogue, VenteCreee } from "../api/client";
import ChampMontant from "../components/ChampMontant";
import FactureVente from "../components/FactureVente";
import { useDevise } from "../contexts/DeviseContext";
import { formaterMontant, normaliserTelephone, telephoneValide } from "../lib/formatage";
import { OPERATEURS_MOBILE_MONEY } from "../lib/libelles";

interface LignePanier {
  varianteId: string;
  produitNom: string;
  reference: string;
  quantite: number;
  prixUnitaire: number;
  remise: number;
  prixAchat: number;
}

interface SelectionModaleVente {
  varianteId: string;
  quantite: number;
  prixUnitaire: number;
}

export default function Caisse({ session }: { session: Session }) {
  const peutModifierPrix = !!session.permissions.modifier_prix;
  const devise = useDevise();

  const [terme, setTerme] = useState("");
  const [suggestionsOuvertes, setSuggestionsOuvertes] = useState(false);
  const [modaleProduitsOuverte, setModaleProduitsOuverte] = useState(false);
  const [selectionModale, setSelectionModale] = useState<SelectionModaleVente[]>([]);
  const [erreurModale, setErreurModale] = useState<string | null>(null);
  const [modaleClientsOuverte, setModaleClientsOuverte] = useState(false);
  const [catalogue, setCatalogue] = useState<VarianteCatalogue[]>([]);
  const [panier, setPanier] = useState<LignePanier[]>([]);
  const [depotId, setDepotId] = useState(session.depotId ?? "");
  const [clients, setClients] = useState<ClientBoutique[]>([]);
  const [clientId, setClientId] = useState("");
  const [clientTerme, setClientTerme] = useState("");
  const [clientRechercheReguliers, setClientRechercheReguliers] = useState("");
  const [ongletModaleClients, setOngletModaleClients] = useState<"reguliers" | "occasionnel">("reguliers");
  const [nouveauClientNom, setNouveauClientNom] = useState("");
  const [nouveauClientTelephone, setNouveauClientTelephone] = useState("");
  const [nouveauClientAdresse, setNouveauClientAdresse] = useState("");
  const [erreurModaleClients, setErreurModaleClients] = useState<string | null>(null);
  const [remiseGlobale, setRemiseGlobale] = useState("0");
  const [typeRemiseGlobale, setTypeRemiseGlobale] = useState<"montant" | "pourcentage">("montant");
  const [montantEspeces, setMontantEspeces] = useState("");
  const [montantRecuEspeces, setMontantRecuEspeces] = useState("");
  const [montantCredit, setMontantCredit] = useState("");
  const [montantMobileMoney, setMontantMobileMoney] = useState("");
  // Champ de paiement le plus récemment saisi à la main par le caissier — sert
  // à déterminer quel(s) autre(s) champ(s) doivent s'ajuster automatiquement
  // pour que la somme des paiements colle toujours au Total net.
  const [dernierChampPaiement, setDernierChampPaiement] = useState<"especes" | "credit" | "mobileMoney" | "aucun">(
    "aucun",
  );
  const [operateurMobileMoney, setOperateurMobileMoney] = useState<OperateurMobileMoney | "">("");
  const [erreur, setErreur] = useState<string | null>(null);
  const [ticket, setTicket] = useState<VenteCreee | null>(null);
  const [enCours, setEnCours] = useState(false);

  useEffect(() => {
    // Si l'utilisateur a un dépôt assigné (Réglages), on l'utilise directement.
    // Sinon, on prend silencieusement le premier dépôt de la boutique — pas de
    // sélecteur en Caisse, le dépôt se configure dans Informations boutique.
    if (!session.depotId) {
      api.catalogue.listerDepots(session.boutiqueId).then((liste) => {
        if (liste[0]) setDepotId(liste[0].id);
      });
    }
    api.catalogue.listerClients(session.boutiqueId).then(setClients);
  }, [session.boutiqueId, session.depotId]);

  // Recharge la quantité disponible affichée dès que le dépôt change.
  useEffect(() => {
    api.catalogue.listerVariantesCatalogue(session.boutiqueId, depotId || undefined).then(setCatalogue);
  }, [session.boutiqueId, depotId]);

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
  // figure pas. Ici on ne fait plus que filtrer par recherche ;
  // une quantité à 0 (rupture) reste affichée mais grisée (voir plus bas).
  const catalogueFiltre = useMemo(() => {
    const q = terme.trim().toLowerCase();
    if (!q) return catalogue;
    return catalogue.filter(
      (v) =>
        v.produitNom.toLowerCase().includes(q) ||
        v.reference.toLowerCase().includes(q) ||
        v.codeBarres.toLowerCase().includes(q),
    );
  }, [catalogue, terme]);

  // Liste "Clients réguliers" du modal de sélection en Caisse — les clients
  // occasionnels n'y figurent jamais (voir electron/services/catalogue.ts).
  const clientsFiltres = useMemo(() => {
    const q = clientRechercheReguliers.trim().toLowerCase();
    if (!q) return clients;
    return clients.filter((c) => c.nom.toLowerCase().includes(q));
  }, [clients, clientRechercheReguliers]);

  function choisirClient(client: ClientBoutique) {
    setClientId(client.id);
    setClientTerme(client.nom);
    fermerModaleClients();
  }

  function fermerModaleClients() {
    setModaleClientsOuverte(false);
    setClientRechercheReguliers("");
    setOngletModaleClients("reguliers");
    setNouveauClientNom("");
    setNouveauClientTelephone("");
    setNouveauClientAdresse("");
    setErreurModaleClients(null);
  }

  // Client "de passage" : saisi à la volée pour une vente à crédit, jamais
  // ajouté au répertoire clients (est_permanent = false) — voir mémoire
  // projet "clients permanents vs occasionnels".
  async function confirmerCreationClientOccasionnel() {
    const nom = nouveauClientNom.trim();
    if (!nom) {
      setErreurModaleClients("Le nom complet est obligatoire.");
      return;
    }
    const telephone = nouveauClientTelephone.trim();
    if (telephone && !telephoneValide(telephone)) {
      setErreurModaleClients("Téléphone au format international requis, ex. +2250712345678.");
      return;
    }
    const adresse = nouveauClientAdresse.trim();
    const resultat = await api.clients.creer(session.boutiqueId, nom, telephone, adresse, false);
    if (resultat.succes) {
      choisirClient({ id: resultat.resultat, nom, telephone, adresse });
    } else {
      setErreurModaleClients(resultat.message);
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
          reference: variante.reference,
          quantite: 1,
          prixUnitaire: variante.prixVente,
          remise: 0,
          prixAchat: variante.prixAchat,
        },
      ];
    });
    setTerme("");
  }

  function selectionnerProduitModale(variante: VarianteCatalogue) {
    const quantiteAjustee = quantitesDisponiblesAjustees.get(variante.id) ?? variante.quantiteDisponible;
    const dejaSelectionnee = selectionModale.find((s) => s.varianteId === variante.id)?.quantite ?? 0;
    if (quantiteAjustee - dejaSelectionnee <= 0) {
      setErreurModale(`"${variante.produitNom}" est en rupture de stock dans ce dépôt.`);
      return;
    }
    setErreurModale(null);
    setSelectionModale((actuel) => {
      const existant = actuel.find((s) => s.varianteId === variante.id);
      if (existant) {
        return actuel.map((s) => (s.varianteId === variante.id ? { ...s, quantite: s.quantite + 1 } : s));
      }
      return [...actuel, { varianteId: variante.id, quantite: 1, prixUnitaire: variante.prixVente }];
    });
  }

  function deselectionnerModale(varianteId: string) {
    setSelectionModale((actuel) => actuel.filter((s) => s.varianteId !== varianteId));
  }

  function modifierPrixSelectionModale(varianteId: string, prix: number) {
    setSelectionModale((actuel) => actuel.map((s) => (s.varianteId === varianteId ? { ...s, prixUnitaire: prix } : s)));
  }

  function modifierQuantiteSelectionModale(varianteId: string, quantite: number) {
    if (quantite <= 0) {
      setSelectionModale((actuel) => actuel.filter((s) => s.varianteId !== varianteId));
      return;
    }
    setSelectionModale((actuel) => actuel.map((s) => (s.varianteId === varianteId ? { ...s, quantite } : s)));
  }

  function fermerModaleProduits() {
    setModaleProduitsOuverte(false);
    setSelectionModale([]);
    setErreurModale(null);
  }

  function confirmerSelectionModale() {
    if (selectionModale.length === 0) {
      setErreurModale("Sélectionnez au moins un article.");
      return;
    }
    const ligneSousPrixAchat = selectionModale.find((s) => {
      const v = catalogue.find((c) => c.id === s.varianteId);
      return v && s.prixUnitaire < v.prixAchat;
    });
    if (ligneSousPrixAchat) {
      const v = catalogue.find((c) => c.id === ligneSousPrixAchat.varianteId);
      setErreurModale(`Le prix de vente de "${v?.produitNom}" ne peut pas être inférieur au prix d'achat.`);
      return;
    }
    setPanier((actuel) => {
      let resultat = actuel;
      for (const s of selectionModale) {
        const v = catalogue.find((c) => c.id === s.varianteId);
        if (!v) continue;
        const existant = resultat.find((l) => l.varianteId === s.varianteId);
        if (existant) {
          resultat = resultat.map((l) =>
            l.varianteId === s.varianteId
              ? { ...l, quantite: l.quantite + s.quantite, prixUnitaire: s.prixUnitaire }
              : l,
          );
        } else {
          resultat = [
            ...resultat,
            {
              varianteId: v.id,
              produitNom: v.produitNom,
              reference: v.reference,
              quantite: s.quantite,
              prixUnitaire: s.prixUnitaire,
              remise: 0,
              prixAchat: v.prixAchat,
            },
          ];
        }
      }
      return resultat;
    });
    setTerme("");
    setSelectionModale([]);
    setErreurModale(null);
    setModaleProduitsOuverte(false);
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

  // Dans le modal Vente, le panier déjà confirmé n'inclut pas encore la sélection en
  // cours — on ajoute son montant pour que Total brut/net bougent en direct pendant
  // qu'on choisit les produits, avant même de cliquer sur Confirmer.
  const totalSelectionModale = selectionModale.reduce(
    (somme, s) => somme + Math.round(s.quantite * s.prixUnitaire),
    0,
  );
  const totalBrutModale = totalBrut + totalSelectionModale;
  const remiseGlobaleNombreModale =
    typeRemiseGlobale === "pourcentage"
      ? Math.round((totalBrutModale * (Number(remiseGlobale) || 0)) / 100)
      : Number(remiseGlobale) || 0;
  const totalNetModale = Math.round(totalBrutModale - remiseGlobaleNombreModale);
  const totalPaiements =
    (Number(montantEspeces) || 0) + (Number(montantCredit) || 0) + (Number(montantMobileMoney) || 0);
  const creditSansClient = (Number(montantCredit) || 0) > 0 && !clientId;

  // Les 3 champs de paiement restent toujours cohérents avec le Total net : le
  // champ que le caissier vient de saisir à la main (Espèces, Crédit ou Mobile
  // Money) est respecté tel quel, et un seul autre champ absorbe automatiquement
  // le reste pour que la somme colle toujours au Total net. Par défaut (aucune
  // saisie), Espèces reçoit le total en entier ; dès que le caissier touche
  // Crédit ou Mobile Money, c'est Espèces qui s'ajuste ; s'il touche Espèces
  // lui-même, c'est Crédit qui absorbe la différence.
  useEffect(() => {
    const especes = Number(montantEspeces) || 0;
    const credit = Number(montantCredit) || 0;
    const mobileMoney = Number(montantMobileMoney) || 0;

    if (dernierChampPaiement === "especes") {
      const reste = totalNet - especes - mobileMoney;
      setMontantCredit(reste > 0 ? String(reste) : "");
    } else {
      const reste = totalNet - credit - mobileMoney;
      setMontantEspeces(reste > 0 ? String(reste) : "");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [totalNet, montantEspeces, montantCredit, montantMobileMoney, dernierChampPaiement]);

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
    const utiliseCredit = (Number(montantCredit) || 0) > 0;
    if (utiliseCredit && !clientId) {
      setErreur("Choisissez un client pour une vente à crédit.");
      return;
    }
    const utiliseMobileMoney = (Number(montantMobileMoney) || 0) > 0;
    if (utiliseMobileMoney && !operateurMobileMoney) {
      setErreur("Choisissez un opérateur Mobile Money.");
      return;
    }

    const paiementsAEnvoyer = [
      ...((Number(montantEspeces) || 0) > 0 ? [{ mode: "especes" as const, montant: Number(montantEspeces) }] : []),
      ...(utiliseCredit ? [{ mode: "credit" as const, montant: Number(montantCredit) }] : []),
      ...(utiliseMobileMoney
        ? [{ mode: "mobile_money" as const, operateur: operateurMobileMoney, montant: Number(montantMobileMoney) }]
        : []),
    ];

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
        paiements: paiementsAEnvoyer,
        remiseGlobale: remiseGlobaleNombre,
      });
      if (resultat.succes) {
        setTicket(resultat.vente);
        // Le stock réellement décrémenté par la vente doit se refléter dans le
        // catalogue affiché (quantités disponibles), pas seulement dans le
        // panier local qui vient d'être vidé.
        api.catalogue.listerVariantesCatalogue(session.boutiqueId, depotId || undefined).then(setCatalogue);
        setPanier([]);
        setMontantEspeces("");
        setMontantRecuEspeces("");
        setMontantCredit("");
        setMontantMobileMoney("");
        setOperateurMobileMoney("");
        setDernierChampPaiement("aucun");
        setRemiseGlobale("0");
        setTypeRemiseGlobale("montant");
        setClientId("");
        setClientTerme("");
      } else {
        setErreur(resultat.message);
      }
    } catch (e) {
      setErreur(e instanceof Error ? e.message : "Erreur inattendue.");
    } finally {
      setEnCours(false);
    }
  }

  // Aucun des 3 champs de paiement ne doit dépasser le Total net, saisi seul.
  function plafonnerMontantPaiement(valeur: string): string {
    return (Number(valeur) || 0) > totalNet ? String(totalNet) : valeur;
  }

  function annulerVente() {
    setErreur(null);
    setPanier([]);
    setTerme("");
    setMontantEspeces("");
    setMontantRecuEspeces("");
    setMontantCredit("");
    setMontantMobileMoney("");
    setOperateurMobileMoney("");
    setDernierChampPaiement("aucun");
    setRemiseGlobale("0");
    setTypeRemiseGlobale("montant");
    setClientId("");
    setClientTerme("");
  }

  if (ticket) {
    return (
      <div className="page-facture-vente">
        <FactureVente
          venteId={ticket.id}
          session={session}
          labelRetour="Nouvelle vente"
          onRetour={() => setTicket(null)}
        />
      </div>
    );
  }

  return (
    <div className="caisse">
      <div className="carte-caisse-principale">
        <div className="colonne-caisse colonne-recherche-vente">
          <h4 className="titre-colonne-caisse">Article</h4>
          <div className="recherche-produit-combobox">
            <button
              type="button"
              className="bouton-ajouter-produit-dans-champ"
              title="Vente"
              onClick={() => setModaleProduitsOuverte(true)}
            >
              +
            </button>
            <input
              className="champ-recherche champ-recherche-avec-bouton"
              placeholder="Rechercher un article ou scanner un code-barres…"
              value={terme}
              onChange={(e) => {
                setTerme(e.target.value);
                setSuggestionsOuvertes(true);
              }}
              onFocus={() => setSuggestionsOuvertes(true)}
              onBlur={() => setTimeout(() => setSuggestionsOuvertes(false), 150)}
              autoFocus
            />
            {suggestionsOuvertes && terme.trim() && (
              <ul className="suggestions-produit-recherche">
                {catalogueFiltre.slice(0, 8).map((v) => {
                  const quantiteAjustee = quantitesDisponiblesAjustees.get(v.id) ?? v.quantiteDisponible;
                  const enRupture = quantiteAjustee <= 0;
                  return (
                    <li
                      key={v.id}
                      className={enRupture ? "ligne-rupture" : undefined}
                      onMouseDown={() => ajouterAuPanier(v)}
                    >
                      <span>
                        {v.produitNom}
                        {v.reference && ` (${v.reference})`}
                      </span>
                      <span className="suggestion-produit-details">
                        {quantiteAjustee <= v.seuilAlerte ? (
                          <span className="badge-rupture">{quantiteAjustee}</span>
                        ) : (
                          quantiteAjustee
                        )}
                        {" · "}
                        {formaterMontant(v.prixVente)} {devise}
                      </span>
                    </li>
                  );
                })}
                {catalogueFiltre.length === 0 && (
                  <li className="suggestion-produit-vide">Aucun article ne correspond.</li>
                )}
              </ul>
            )}
          </div>
          <button
            type="button"
            className="bouton-annuler-vente"
            disabled={enCours}
            onClick={annulerVente}
          >
            Annuler la vente
          </button>
        </div>

        <div className="colonne-caisse colonne-modes-paiement">
          <h4 className="titre-colonne-caisse">Paiement</h4>
          <div className="bloc-paiement">
            <label>Espèces</label>
            <ChampMontant
              placeholder="Montant"
              value={montantEspeces === "0" ? "" : montantEspeces}
              onChange={(v) => {
                setMontantEspeces(plafonnerMontantPaiement(v));
                setDernierChampPaiement("especes");
              }}
            />
          </div>

          <div className="bloc-paiement">
            <label>Crédit</label>
            <ChampMontant
              placeholder="Montant"
              value={montantCredit}
              onChange={(v) => {
                setMontantCredit(plafonnerMontantPaiement(v));
                setDernierChampPaiement("credit");
              }}
            />
          </div>

          <div className="bloc-paiement">
            <div className="ligne-mobile-money">
              <select
                value={operateurMobileMoney}
                onChange={(e) => setOperateurMobileMoney(e.target.value as OperateurMobileMoney)}
              >
                <option value="">Mobile Money</option>
                {OPERATEURS_MOBILE_MONEY.map((o) => (
                  <option key={o.valeur} value={o.valeur}>
                    {o.label}
                  </option>
                ))}
              </select>
              <ChampMontant
                placeholder="Montant"
                value={montantMobileMoney}
                onChange={(v) => {
                  setMontantMobileMoney(plafonnerMontantPaiement(v));
                  setDernierChampPaiement("mobileMoney");
                }}
              />
            </div>
          </div>

          <div className="bloc-paiement">
            <label>Client</label>
            <button
              type="button"
              className="bouton-choisir-client"
              onClick={() => setModaleClientsOuverte(true)}
            >
              {clientId ? clientTerme : "Associer un client"}
            </button>
          </div>
        </div>

        <div className="colonne-caisse colonne-totaux">
          <div className="bloc-total-net">
            <div className="total-net-entete">
              <span className="total-net-label">Total net</span>
              <span className="total-net-montant">
                {formaterMontant(totalNet)} {devise}
              </span>
            </div>
          </div>
          <div className="zone-erreur-vente">{erreur && <div className="message-erreur">{erreur}</div>}</div>
          <div className="boutons-validation">
            <button
              className="bouton-valider"
              disabled={enCours || creditSansClient}
              title={creditSansClient ? "Choisissez un client pour une vente à crédit." : undefined}
              onClick={validerVente}
            >
              {enCours ? "Confirmation…" : "Confirmer la vente"}
            </button>
          </div>
        </div>
      </div>

      {modaleProduitsOuverte && (
        <div className="fond-modale" onClick={fermerModaleProduits}>
          <div className="modale-selection-produits" onClick={(e) => e.stopPropagation()}>
            <div className="modale-entete">
              <h3>Vente</h3>
              <button type="button" className="lien bouton-retour" onClick={fermerModaleProduits}>
                ← Retour
              </button>
            </div>
            <div className="modale-corps">
              <div className="ajustements-modale">
                <div className="ajustements-modale-corps">
                  <div className="remise-globale-entete">
                    <div className="champ-remise-globale">
                      <ChampMontant
                        placeholder="Remise"
                        value={remiseGlobale === "0" ? "" : remiseGlobale}
                        onChange={setRemiseGlobale}
                      />
                      <select
                        value={typeRemiseGlobale}
                        onChange={(e) => setTypeRemiseGlobale(e.target.value as "montant" | "pourcentage")}
                      >
                        <option value="montant">{devise}</option>
                        <option value="pourcentage">%</option>
                      </select>
                    </div>
                  </div>
                  <div className="bloc-total-net">
                    <div className="total-net-entete">
                      Total net : {formaterMontant(totalNetModale)} {devise}
                    </div>
                    <div className="total-brut-inline">
                      Total brut : {formaterMontant(totalBrutModale)} {devise}
                    </div>
                  </div>
                  <button type="button" className="bouton-valider" onClick={confirmerSelectionModale}>
                    Valider la vente
                  </button>
                </div>
              </div>
              {erreurModale && <div className="message-erreur">{erreurModale}</div>}
              <div className="ligne-recherche-monnaie">
                <input
                  className="champ-recherche"
                  placeholder="Rechercher un article ou scanner un code-barres…"
                  value={terme}
                  onChange={(e) => setTerme(e.target.value)}
                  autoFocus
                />
                <div className="calculette-monnaie">
                  <ChampMontant
                    placeholder="Montant reçu"
                    value={montantRecuEspeces}
                    onChange={setMontantRecuEspeces}
                  />
                  <div className="monnaie-a-rendre">
                    <span>Monnaie à rendre</span>
                    <strong>
                      {formaterMontant(Math.max(0, (Number(montantRecuEspeces) || 0) - totalNetModale))}{" "}
                      {devise}
                    </strong>
                  </div>
                </div>
              </div>
              <div className="catalogue-caisse">
                <table className="tableau-catalogue">
                  <thead>
                    <tr>
                      <th>N°</th>
                      <th>Référence</th>
                      <th>Désignation</th>
                      <th>Qté disponible</th>
                      <th>Prix de vente</th>
                      <th>Qté sélectionnée</th>
                      <th>Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {catalogueFiltre.map((v, index) => {
                      const quantiteBase = quantitesDisponiblesAjustees.get(v.id) ?? v.quantiteDisponible;
                      const selection = selectionModale.find((s) => s.varianteId === v.id);
                      const estSelectionnee = !!selection;
                      const quantiteAjustee = quantiteBase - (selection?.quantite ?? 0);
                      const enRupture = quantiteAjustee <= 0;
                      return (
                        <tr
                          key={v.id}
                          tabIndex={0}
                          role="button"
                          aria-pressed={estSelectionnee}
                          className={
                            [enRupture && !estSelectionnee ? "ligne-rupture" : "", estSelectionnee ? "ligne-selectionnee" : ""]
                              .filter(Boolean)
                              .join(" ") || undefined
                          }
                          onClick={() => selectionnerProduitModale(v)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault();
                              selectionnerProduitModale(v);
                            }
                          }}
                        >
                          <td>{index + 1}</td>
                          <td>{v.reference || "—"}</td>
                          <td>{v.produitNom}</td>
                          <td>
                            {quantiteAjustee <= v.seuilAlerte ? (
                              <span className="badge-rupture">{quantiteAjustee}</span>
                            ) : (
                              quantiteAjustee
                            )}
                          </td>
                          <td onClick={selection ? (e) => e.stopPropagation() : undefined}>
                            {selection ? (
                              <ChampMontant
                                className={selection.prixUnitaire < v.prixAchat ? "champ-invalide" : undefined}
                                title={
                                  selection.prixUnitaire < v.prixAchat
                                    ? "Le prix de vente est inférieur au prix d'achat."
                                    : undefined
                                }
                                value={String(selection.prixUnitaire)}
                                onChange={(valeur) => modifierPrixSelectionModale(v.id, Number(valeur) || 0)}
                              />
                            ) : (
                              <>
                                {formaterMontant(v.prixVente)} {devise}
                              </>
                            )}
                          </td>
                          <td onClick={selection ? (e) => e.stopPropagation() : undefined}>
                            {selection ? (
                              <div className="qte-selection-controle">
                                <input
                                  className="champ-quantite"
                                  type="number"
                                  min={0.01}
                                  step="any"
                                  value={selection.quantite}
                                  onChange={(e) =>
                                    modifierQuantiteSelectionModale(v.id, Number(e.target.value) || 0)
                                  }
                                />
                                <button
                                  type="button"
                                  className="bouton-deselection"
                                  onClick={() => deselectionnerModale(v.id)}
                                  title="Retirer de la sélection"
                                >
                                  ✕
                                </button>
                              </div>
                            ) : (
                              0
                            )}
                          </td>
                          <td>
                            {selection
                              ? `${formaterMontant(Math.round(selection.quantite * selection.prixUnitaire))} ${devise}`
                              : "—"}
                          </td>
                        </tr>
                      );
                    })}
                    {catalogueFiltre.length === 0 && (
                      <tr>
                        <td colSpan={7} className="liste-vide">
                          Aucun article ne correspond.
                        </td>
                      </tr>
                    )}
                    {/* Lignes vides pour que le tableau soit déjà tracé (grille visible,
                        au moins 10 lignes) même quand peu d'articles correspondent. */}
                    {catalogueFiltre.length > 0 &&
                      Array.from({ length: Math.max(0, 10 - catalogueFiltre.length) }).map((_, i) => (
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
            </div>
          </div>
        </div>
      )}

      {modaleClientsOuverte && (
        <div className="fond-modale" onClick={fermerModaleClients}>
          <div className="modale-selection-produits" onClick={(e) => e.stopPropagation()}>
            <div className="modale-entete">
              <h3>Choisir un client</h3>
              <button type="button" className="lien bouton-retour" onClick={fermerModaleClients}>
                ← Retour
              </button>
            </div>
            <div className="modale-corps">
              <div className="barre-onglets">
                <button
                  type="button"
                  className={ongletModaleClients === "reguliers" ? "onglet actif" : "onglet"}
                  onClick={() => setOngletModaleClients("reguliers")}
                >
                  Clients réguliers
                </button>
                <button
                  type="button"
                  className={ongletModaleClients === "occasionnel" ? "onglet actif" : "onglet"}
                  onClick={() => setOngletModaleClients("occasionnel")}
                >
                  Client de passage
                </button>
              </div>

              {ongletModaleClients === "reguliers" ? (
                <>
                  <input
                    className="champ-recherche"
                    placeholder="Rechercher un client…"
                    value={clientRechercheReguliers}
                    onChange={(e) => setClientRechercheReguliers(e.target.value)}
                    autoFocus
                  />
                  <div className="catalogue-caisse catalogue-clients-reguliers">
                    <table className="tableau-catalogue">
                      <thead>
                        <tr>
                          <th>Nom</th>
                          <th>Téléphone</th>
                          <th>Adresse</th>
                        </tr>
                      </thead>
                      <tbody>
                        {clientsFiltres.map((c) => (
                          <tr key={c.id} onClick={() => choisirClient(c)}>
                            <td>{c.nom}</td>
                            <td>{c.telephone || "—"}</td>
                            <td>{c.adresse || "—"}</td>
                          </tr>
                        ))}
                        {clientsFiltres.length === 0 && (
                          <tr>
                            <td colSpan={3} className="liste-vide">
                              {clients.length === 0
                                ? "Aucun client régulier enregistré."
                                : "Aucun client ne correspond."}
                            </td>
                          </tr>
                        )}
                        {clientsFiltres.length > 0 &&
                          Array.from({ length: Math.max(0, 10 - clientsFiltres.length) }).map((_, i) => (
                            <tr key={`vide-${i}`} className="ligne-groupe-vide">
                              <td>&nbsp;</td>
                              <td>&nbsp;</td>
                              <td>&nbsp;</td>
                            </tr>
                          ))}
                      </tbody>
                    </table>
                  </div>
                </>
              ) : (
                <div className="creation-client-rapide">
                  <div className="champs-client-occasionnel">
                    <input
                      placeholder="Nom complet"
                      value={nouveauClientNom}
                      onChange={(e) => setNouveauClientNom(e.target.value)}
                      autoFocus
                    />
                    <div className="champ-telephone-avec-aide">
                      <input
                        type="tel"
                        placeholder="+2250712345678"
                        value={nouveauClientTelephone}
                        onChange={(e) => setNouveauClientTelephone(normaliserTelephone(e.target.value))}
                      />
                      <span className="aide-format-telephone">Indicatif + numéro, ex. 2250712345678</span>
                    </div>
                    <input
                      placeholder="Adresse"
                      value={nouveauClientAdresse}
                      onChange={(e) => setNouveauClientAdresse(e.target.value)}
                    />
                  </div>
                  {erreurModaleClients && <div className="message-erreur">{erreurModaleClients}</div>}
                  <div className="creation-client-actions">
                    <button type="button" onClick={confirmerCreationClientOccasionnel}>
                      Ajouter et sélectionner
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      <div className="colonne-panier">
        <div className="panier-scrollable">
        <table className="tableau-panier">
          <thead>
            <tr>
              <th>N°</th>
              <th>Référence</th>
              <th>Désignation</th>
              <th>Qté</th>
              <th>Prix de vente</th>
              <th>Sous-total</th>
              <th className="colonne-supprimer" />
            </tr>
          </thead>
          <tbody>
            {[...lignesCalculees].reverse().map((l, index) => (
              <tr key={l.varianteId}>
                <td>{index + 1}</td>
                <td>{l.reference || "—"}</td>
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
                  <ChampMontant
                    className={l.sousPrixAchat ? "champ-invalide" : undefined}
                    value={String(l.prixUnitaire)}
                    disabled={!peutModifierPrix}
                    title={peutModifierPrix ? undefined : "Votre rôle ne permet pas de modifier les prix."}
                    onChange={(valeur) => modifierLigne(l.varianteId, { prixUnitaire: Number(valeur) || 0 })}
                  />
                </td>
                <td>
                  {formaterMontant(l.sousTotal)}
                  {l.sousPrixAchat && (
                    <span className="badge-rupture" title="Sous le prix d'achat">
                      ⚠
                    </span>
                  )}
                </td>
                <td className="colonne-supprimer">
                  <button
                    type="button"
                    className="lien-icone lien-icone-danger"
                    title="Retirer du panier"
                    onClick={() => retirerLigne(l.varianteId)}
                  >
                    ✕
                  </button>
                </td>
              </tr>
            ))}
            {/* Lignes vides pour que le tableau soit déjà tracé (grille visible,
                au moins 10 lignes) même quand le panier est vide ou peu rempli. */}
            {Array.from({ length: Math.max(0, 10 - lignesCalculees.length) }).map((_, i) => (
              <tr key={`vide-${i}`} className="ligne-groupe-vide">
                <td>&nbsp;</td>
                <td>&nbsp;</td>
                <td>&nbsp;</td>
                <td>&nbsp;</td>
                <td>&nbsp;</td>
                <td>&nbsp;</td>
                <td className="colonne-supprimer">&nbsp;</td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      </div>
    </div>
  );
}
