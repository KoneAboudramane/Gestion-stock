import { useEffect, useRef, useState } from "react";

import { api } from "../api/client";
import type { DepotResume, FournisseurResume, ResultatEcriture, Session, VarianteRecherchee } from "../api/client";
import ChampMontant from "../components/ChampMontant";
import { useDevise } from "../contexts/DeviseContext";
import { useFabricationPropre } from "../hooks/useFabricationPropre";
import { formaterMontant } from "../lib/formatage";
import { OPERATEURS_MOBILE_MONEY } from "../lib/libelles";

// --- Carte « Entrée de stock » de la page Stock ---
// Un seul point d'entrée, mais chaque origine garde ses règles : l'achat
// rapide passe par une vraie commande + réception (CUMP, caisse, dette,
// comptabilité), l'ouverture complète les articles créés sans stock, la fabrication
// aux boutiques qui fabriquent, et le don entre au coût moyen actuel.

type Origine = "achat" | "ouverture" | "fabrication" | "don";

const ORIGINES: { cle: Origine; icone: string; label: string; aide: string; regle: string }[] = [
  {
    cle: "achat",
    icone: "🛒",
    label: "Achat rapide",
    aide: "Marchandise achetée : coût, caisse et dette fournisseur suivis comme une réception.",
    regle: "Enregistré comme une vraie réception : le coût moyen, la caisse et la dette du fournisseur sont mis à jour.",
  },
  {
    cle: "ouverture",
    icone: "📦",
    label: "Stock d'ouverture",
    aide: "Articles créés sans stock initial : complétez ici la quantité que vous avez déjà.",
    regle: "Voici vos articles créés sans stock initial. Saisissez la quantité de ceux que vous avez : une ligne laissée à 0 reste dans la liste pour plus tard.",
  },
  {
    cle: "fabrication",
    icone: "🏭",
    label: "Fabrication",
    aide: "Produits fabriqués par la boutique, à leur coût de fabrication.",
    regle: "Le coût de fabrication est moyenné avec le stock existant (coût moyen pondéré).",
  },
  {
    cle: "don",
    icone: "🎁",
    label: "Don / échantillon reçu",
    aide: "Marchandise reçue gratuitement : elle entre au coût moyen actuel.",
    regle: "Le coût moyen ne change pas. Une valeur estimée n'est demandée que pour un article sans prix d'achat.",
  },
];

const MOTIF_PAR_DEFAUT: Record<Origine, string> = {
  achat: "",
  ouverture: "Stock d'ouverture",
  fabrication: "Fabrication",
  don: "Don reçu",
};

type ModePaiement = "especes" | "mobile_money" | "banque" | "compte_fournisseur";

interface LigneEntree {
  varianteId: string;
  produitNom: string;
  reference: string;
  quantite: string;
  prixAchat: string;
  prixVente: string;
  /** Coût moyen actuel de l'article (don : entre à ce coût s'il est connu). */
  coutActuel: number;
}

function nombre(valeur: string): number {
  return Number(valeur) || 0;
}

export function ModaleEntreeStock({ session, onFermer }: { session: Session; onFermer: () => void }) {
  const [origine, setOrigine] = useState<Origine | null>(null);
  const [succes, setSucces] = useState<string | null>(null);
  const fabricationPropre = useFabricationPropre(session.boutiqueId);
  /** Articles créés sans stock initial, à compléter en « Stock d'ouverture ». */
  const [nombreSansStock, setNombreSansStock] = useState(0);

  useEffect(() => {
    if (origine === null) api.entreesStock.articlesSansStock(session.boutiqueId).then((liste) => setNombreSansStock(liste.length));
  }, [session.boutiqueId, origine]);

  return (
    <div className="fond-modale" onClick={onFermer}>
      <div className="modale-selection-produits" onClick={(e) => e.stopPropagation()}>
        {origine ? (
          <FormulaireEntreeStock
            key={origine}
            session={session}
            origine={origine}
            onRetour={() => setOrigine(null)}
            onEnregistree={(message) => {
              setSucces(message);
              setOrigine(null);
            }}
          />
        ) : (
          <>
            <div className="modale-entete">
              <h3>Entrée de stock</h3>
              <button type="button" className="lien bouton-retour" onClick={onFermer}>
                ← Retour
              </button>
            </div>
            <div className="modale-corps">
              {succes && <div className="message-succes">{succes}</div>}
              <p className="sous-info">D'où vient la marchandise ?</p>
              <div className="grille-documents-comptables grille-origines-entree">
                {ORIGINES.map((o) => {
                  const indisponible = o.cle === "fabrication" && !fabricationPropre;
                  return (
                    <button
                      key={o.cle}
                      type="button"
                      className="carte-document-comptable carte-origine-entree"
                      disabled={indisponible}
                      onClick={() => {
                        setSucces(null);
                        setOrigine(o.cle);
                      }}
                    >
                      <span className="icone-document-comptable">{o.icone}</span>
                      {o.label}
                      <span className="sous-info aide-origine-entree">
                        {indisponible
                          ? "Réservé aux boutiques qui fabriquent (Réglages → Informations boutique)."
                          : o.aide}
                      </span>
                      {o.cle === "ouverture" && nombreSansStock > 0 && (
                        <span className="badge-sans-stock">
                          {nombreSansStock} article{nombreSansStock > 1 ? "s" : ""} sans stock
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function FormulaireEntreeStock({
  session,
  origine,
  onRetour,
  onEnregistree,
}: {
  session: Session;
  origine: Origine;
  onRetour: () => void;
  onEnregistree: (message: string) => void;
}) {
  const devise = useDevise();
  const titre = ORIGINES.find((o) => o.cle === origine)!;
  const champRecherche = useRef<HTMLInputElement>(null);
  const zoneLignes = useRef<HTMLDivElement>(null);
  /** Lignes vides pour remplir la zone du tableau jusqu'en bas, sans créer de défilement. */
  const [lignesVisibles, setLignesVisibles] = useState(6);

  useEffect(() => {
    const zone = zoneLignes.current;
    if (!zone) return;
    const mesurer = () => {
      const entete = zone.querySelector("thead")?.getBoundingClientRect().height ?? 45;
      const ligne = zone.querySelector("tbody tr")?.getBoundingClientRect().height || 52;
      setLignesVisibles(Math.max(1, Math.floor((zone.clientHeight - entete) / ligne)));
    };
    mesurer();
    const observateur = new ResizeObserver(mesurer);
    observateur.observe(zone);
    return () => observateur.disconnect();
  }, []);
  const [depots, setDepots] = useState<DepotResume[]>([]);
  const [depotId, setDepotId] = useState("");
  /** Stock actuel de chaque article dans le dépôt choisi. */
  const [stockDepot, setStockDepot] = useState<Map<string, number>>(new Map());
  const [motif, setMotif] = useState(MOTIF_PAR_DEFAUT[origine]);
  const [terme, setTerme] = useState("");
  const [resultats, setResultats] = useState<VarianteRecherchee[]>([]);
  const [dropdownOuvert, setDropdownOuvert] = useState(false);
  const [lignes, setLignes] = useState<LigneEntree[]>([]);
  const [erreur, setErreur] = useState<string | null>(null);
  const [enCours, setEnCours] = useState(false);
  /** Ouverture : articles sans stock (seuls proposés à la recherche). */
  const [idsSansStock, setIdsSansStock] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (origine !== "ouverture") return;
    api.entreesStock.articlesSansStock(session.boutiqueId).then((liste) => {
      setIdsSansStock(new Set(liste.map((v) => v.id)));
      setLignes(
        liste.map((v) => ({
          varianteId: v.id,
          produitNom: v.produitNom,
          reference: v.reference,
          quantite: "",
          prixAchat: String(v.prixAchat || ""),
          prixVente: String(v.prixVente || ""),
          coutActuel: v.prixAchat,
        })),
      );
    });
  }, [session.boutiqueId, origine]);

  // Achat rapide : fournisseur ("" = Divers) et paiement.
  const [fournisseurs, setFournisseurs] = useState<FournisseurResume[]>([]);
  const [fournisseurId, setFournisseurId] = useState("");
  const [soldeCompteFournisseur, setSoldeCompteFournisseur] = useState(0);
  const [montantPayeSaisi, setMontantPayeSaisi] = useState<string | null>(null);
  const [modePaiement, setModePaiement] = useState<ModePaiement>("especes");
  const [operateur, setOperateur] = useState("orange_money");

  useEffect(() => {
    api.depots.lister(session.boutiqueId).then((liste) => {
      setDepots(liste);
      setDepotId((actuel) => actuel || liste[0]?.id || "");
    });
    if (origine === "achat") api.fournisseurs.lister(session.boutiqueId).then(setFournisseurs);
  }, [session.boutiqueId, origine]);

  useEffect(() => {
    if (!depotId) return;
    api.stock
      .lister(session.boutiqueId, depotId)
      .then((liste) => setStockDepot(new Map(liste.map((s) => [s.varianteId, Number(s.quantite)]))));
  }, [session.boutiqueId, depotId]);

  useEffect(() => {
    setSoldeCompteFournisseur(0);
    if (!fournisseurId) return;
    api.comptesTiers.compteFournisseur(fournisseurId).then((c) => setSoldeCompteFournisseur(c.solde));
  }, [fournisseurId]);

  useEffect(() => {
    if (modePaiement === "compte_fournisseur" && soldeCompteFournisseur <= 0) setModePaiement("especes");
  }, [modePaiement, soldeCompteFournisseur]);

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

  /** Ajoute l'article, ou +1 s'il est déjà dans la liste (douchette). */
  function ajouterLigne(variante: VarianteRecherchee) {
    setErreur(null);
    setTerme("");
    champRecherche.current?.focus();
    if (lignes.some((l) => l.varianteId === variante.id)) {
      setLignes((actuel) =>
        actuel.map((l) => (l.varianteId === variante.id ? { ...l, quantite: String(nombre(l.quantite) + 1) } : l)),
      );
      return;
    }
    setLignes((actuel) => [
      ...actuel,
      {
        varianteId: variante.id,
        produitNom: variante.produitNom,
        reference: variante.reference,
        quantite: "1",
        prixAchat: origine === "don" ? "" : String(variante.prixAchat || ""),
        prixVente: String(variante.prixVente || ""),
        coutActuel: variante.prixAchat,
      },
    ]);
  }

  /** Ouverture : seuls les articles sans stock peuvent être choisis. */
  function proposables<T extends { id: string }>(liste: T[]): T[] {
    return origine === "ouverture" ? liste.filter((v) => idsSansStock.has(v.id)) : liste;
  }

  /** Entrée dans la recherche : code-barres ou référence exacts, sinon le seul résultat. */
  async function validerRecherche() {
    const saisie = terme.trim();
    if (!saisie) return;
    const liste = proposables(await api.catalogue.rechercherVariantes(session.boutiqueId, saisie));
    const minuscule = saisie.toLowerCase();
    const trouve =
      liste.find((v) => v.codeBarres === saisie) ??
      liste.find((v) => (v.reference || "").toLowerCase() === minuscule) ??
      (liste.length === 1 ? liste[0] : undefined);
    if (trouve) ajouterLigne(trouve);
    else if (liste.length === 0) setErreur(`Aucun article ne correspond à « ${saisie} ».`);
    else setResultats(liste);
  }

  function modifierLigne(varianteId: string, champs: Partial<LigneEntree>) {
    setErreur(null);
    setLignes((actuel) => actuel.map((l) => (l.varianteId === varianteId ? { ...l, ...champs } : l)));
  }

  function retirerLigne(varianteId: string) {
    setLignes((actuel) => actuel.filter((l) => l.varianteId !== varianteId));
  }

  /** Coût unitaire retenu pour la valeur de la ligne. */
  function coutLigne(l: LigneEntree): number {
    if (origine === "don") return l.coutActuel > 0 ? l.coutActuel : nombre(l.prixAchat);
    return nombre(l.prixAchat);
  }

  const total = lignes.reduce((t, l) => t + Math.round(nombre(l.quantite) * coutLigne(l)), 0);
  const unites = lignes.reduce((t, l) => t + nombre(l.quantite), 0);
  const montantPaye = montantPayeSaisi === null ? total : nombre(montantPayeSaisi);
  const resteAPayer = Math.max(0, total - montantPaye);
  const nomFournisseur = fournisseurs.find((f) => f.id === fournisseurId)?.nom ?? "Divers";
  /** Ouverture : les lignes laissées à 0 restent dans la liste pour plus tard. */
  const lignesAEnregistrer = origine === "ouverture" ? lignes.filter((l) => nombre(l.quantite) > 0) : lignes;

  function verifier(): string | null {
    if (!depotId) return "Choisissez un dépôt.";
    if (lignesAEnregistrer.length === 0) {
      return origine === "ouverture" ? "Saisissez la quantité d'au moins un article." : "Ajoutez au moins un article.";
    }
    for (const l of lignesAEnregistrer) {
      if (!(nombre(l.quantite) > 0)) return `${l.produitNom} : indiquez une quantité supérieure à 0.`;
      if (origine === "don") {
        if (l.coutActuel <= 0 && !(nombre(l.prixAchat) > 0)) {
          return `${l.produitNom} n'a pas encore de prix d'achat : indiquez sa valeur estimée.`;
        }
      } else if (l.prixAchat.trim() === "") {
        return `${l.produitNom} : indiquez le ${origine === "achat" ? "prix d'achat" : "coût unitaire"}.`;
      }
    }
    if (origine === "achat" && montantPaye > total) return "Le montant payé dépasse le total de l'achat.";
    if (origine === "achat" && modePaiement === "compte_fournisseur" && montantPaye > soldeCompteFournisseur) {
      return "Le compte du fournisseur ne suffit pas.";
    }
    return null;
  }

  async function enregistrer() {
    setErreur(null);
    const probleme = verifier();
    if (probleme) {
      setErreur(probleme);
      return;
    }
    setEnCours(true);
    try {
      let resultat: ResultatEcriture<unknown>;
      if (origine === "achat") {
        resultat = await api.entreesStock.achatRapide({
          boutiqueId: session.boutiqueId,
          depotId,
          fournisseurId: fournisseurId || null,
          utilisateurId: session.utilisateurId,
          lignes: lignes.map((l) => ({
            varianteId: l.varianteId,
            quantite: nombre(l.quantite),
            prixAchat: nombre(l.prixAchat),
            prixVente: nombre(l.prixVente),
          })),
          montantPaye,
          modePaiement: montantPaye > 0 ? modePaiement : "",
          operateurPaiement: montantPaye > 0 && modePaiement === "mobile_money" ? operateur : "",
        });
      } else {
        const params = {
          depotId,
          motif,
          utilisateurId: session.utilisateurId,
          lignes: lignesAEnregistrer.map((l) => ({
            varianteId: l.varianteId,
            quantite: nombre(l.quantite),
            prixAchat: l.prixAchat.trim() === "" ? undefined : nombre(l.prixAchat),
            prixVente: origine === "don" || l.prixVente.trim() === "" ? undefined : nombre(l.prixVente),
          })),
        };
        resultat =
          origine === "ouverture"
            ? await api.entreesStock.ouverture(params)
            : origine === "fabrication"
              ? await api.entreesStock.fabrication(params)
              : await api.entreesStock.don(params);
      }
      if (!resultat.succes) {
        setErreur(resultat.message);
        return;
      }
      const depotNom = depots.find((d) => d.id === depotId)?.nom ?? "";
      onEnregistree(
        `✅ ${titre.label} enregistré : ${lignesAEnregistrer.length} article${lignesAEnregistrer.length > 1 ? "s" : ""} (${formaterMontant(unites)} unité${unites > 1 ? "s" : ""}) entrés au dépôt ${depotNom}.` +
          (origine === "achat" && resteAPayer > 0
            ? ` Reste dû à ${nomFournisseur} : ${formaterMontant(resteAPayer)} ${devise}.`
            : ""),
      );
    } finally {
      setEnCours(false);
    }
  }

  const libelleCout =
    origine === "achat" ? "Prix d'achat" : origine === "don" ? "Coût" : origine === "fabrication" ? "Coût de fabrication" : "Coût unitaire";
  const colonnes = origine === "don" ? 7 : 8;

  return (
    <div className={`formulaire-mouvement-groupe formulaire-entree-stock entree-${origine}`}>
      <div className="modale-entete entete-fixe">
        <h3>
          <span className="pastille-entree">{titre.icone}</span> {titre.label}
        </h3>
        <div className="actions-formulaire">
          <button type="button" className="bouton-primaire" onClick={enregistrer} disabled={enCours}>
            {enCours ? "Enregistrement…" : `Enregistrer (${lignesAEnregistrer.length})`}
          </button>
          <button type="button" className="lien bouton-retour" onClick={onRetour}>
            ← Retour
          </button>
        </div>
      </div>
      <div className="regle-entree">{titre.regle}</div>
      {erreur && <div className="message-erreur">{erreur}</div>}
      <div className="colonnes-mouvement-groupe">
        <div className="colonne-recherche-groupe">
          <div className="ligne-champs-recherche-commande">
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
            {origine === "achat" ? (
              <label>
                Fournisseur
                <select value={fournisseurId} onChange={(e) => setFournisseurId(e.target.value)}>
                  <option value="">Divers (par défaut)</option>
                  {fournisseurs
                    .filter((f) => f.nom.trim().toLowerCase() !== "divers")
                    .map((f) => (
                      <option key={f.id} value={f.id}>
                        {f.nom}
                      </option>
                    ))}
                </select>
              </label>
            ) : (
              <label>
                Motif
                <input value={motif} onChange={(e) => setMotif(e.target.value)} />
              </label>
            )}
          <div className="recherche-commande-combobox recherche-entree-stock">
            <input
              ref={champRecherche}
              autoFocus
              placeholder="🔍 Rechercher ou scanner un article (nom, référence, code-barres)…"
              value={terme}
              onChange={(e) => setTerme(e.target.value)}
              onFocus={() => setDropdownOuvert(true)}
              onBlur={() => setDropdownOuvert(false)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  validerRecherche();
                }
              }}
            />
            {terme.trim() && dropdownOuvert && (
              <ul className="resultats-recherche">
                {proposables(resultats).map((v) => {
                  const dejaAjoute = lignes.some((l) => l.varianteId === v.id);
                  return (
                    <li
                      key={v.id}
                      onMouseDown={(e) => {
                        e.preventDefault();
                        ajouterLigne(v);
                      }}
                    >
                      <span className="resultat-entree-nom">
                        {v.produitNom}
                        {v.reference && <span className="sous-info"> · {v.reference}</span>}
                      </span>
                      <span className="sous-info resultat-entree-infos">
                        {dejaAjoute && <strong>déjà ajouté (+1) · </strong>}
                        en stock {formaterMontant(stockDepot.get(v.id) ?? 0)} · achat {formaterMontant(v.prixAchat)} ·
                        vente {formaterMontant(v.prixVente)}
                      </span>
                    </li>
                  );
                })}
                {proposables(resultats).length === 0 && (
                  <li className="liste-vide">
                    {origine === "ouverture" ? "Aucun article sans stock ne correspond." : "Aucun résultat."}
                  </li>
                )}
              </ul>
            )}
          </div>
          </div>
        </div>

        <div className="colonne-lignes-groupe">
          <div className="barre-totaux-entree">
            <div className="resume-entree-stock">
              <strong>
                {lignesAEnregistrer.length} article{lignesAEnregistrer.length > 1 ? "s" : ""}
              </strong>
              {origine === "ouverture" && <span className="sous-info">sur {lignes.length} sans stock ·</span>}
              <span className="sous-info">
                {formaterMontant(unites)} unité{unites > 1 ? "s" : ""}
              </span>
            </div>
            {origine === "achat" ? (
              <div className="recap-paiement-entree">
                <div className="ligne-recap-entree">
                  <span>Total de l'achat</span>
                  <strong>
                    {formaterMontant(total)} {devise}
                  </strong>
                </div>
                <div className="ligne-recap-entree ligne-recap-paiement">
                  <span>Payé</span>
                  <ChampMontant
                    className="champ-montant-deja-paye"
                    value={montantPayeSaisi ?? String(total)}
                    onChange={setMontantPayeSaisi}
                  />
                  {montantPaye > 0 && (
                    <select value={modePaiement} onChange={(e) => setModePaiement(e.target.value as ModePaiement)}>
                      <option value="especes">💵 Espèces (caisse)</option>
                      <option value="mobile_money">📱 Mobile Money</option>
                      <option value="banque">🏦 Banque</option>
                      {soldeCompteFournisseur > 0 && (
                        <option value="compte_fournisseur">
                          👛 Compte fournisseur (disponible {formaterMontant(soldeCompteFournisseur)})
                        </option>
                      )}
                    </select>
                  )}
                  {montantPaye > 0 && modePaiement === "mobile_money" && (
                    <select value={operateur} onChange={(e) => setOperateur(e.target.value)}>
                      {OPERATEURS_MOBILE_MONEY.map((o) => (
                        <option key={o.valeur} value={o.valeur}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                  )}
                </div>
                <div className={`ligne-recap-entree ligne-recap-reste${resteAPayer > 0 ? " reste-du" : ""}`}>
                  <span>{resteAPayer > 0 ? `Reste dû à ${nomFournisseur}` : "Reste dû"}</span>
                  <strong>
                    {formaterMontant(resteAPayer)} {devise}
                  </strong>
                </div>
              </div>
            ) : (
              <div className="recap-paiement-entree">
                <div className="ligne-recap-entree">
                  <span>Valeur entrée</span>
                  <strong>
                    {formaterMontant(total)} {devise}
                  </strong>
                </div>
              </div>
            )}
          </div>
          <div className="lignes-groupe-scrollable" ref={zoneLignes}>
            <table className="tableau-catalogue">
              <thead>
                <tr>
                  <th className="colonne-numero-groupe">N°</th>
                  <th className="col-designation-groupe">Désignation</th>
                  <th title="Stock dans ce dépôt, avant → après l'entrée">Stock</th>
                  <th>Quantité</th>
                  <th>{libelleCout}</th>
                  {origine !== "don" && <th>Prix de vente</th>}
                  <th className="col-montant-entree">Valeur</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {lignes.map((l, index) => {
                  const avant = stockDepot.get(l.varianteId) ?? 0;
                  return (
                    <tr key={l.varianteId}>
                      <td className="colonne-numero-groupe">{index + 1}</td>
                      <td className="col-designation-groupe">
                        {l.produitNom}
                        {l.reference && <div className="sous-info">{l.reference}</div>}
                      </td>
                      <td className="nowrap stock-avant-apres">
                        <span className="sous-info">{formaterMontant(avant)}</span> →{" "}
                        <strong>{formaterMontant(avant + nombre(l.quantite))}</strong>
                      </td>
                      <td>
                        <input
                          className="champ-quantite-entree"
                          type="number"
                          min={0.01}
                          step="any"
                          placeholder="0"
                          value={l.quantite}
                          onChange={(e) => modifierLigne(l.varianteId, { quantite: e.target.value })}
                        />
                      </td>
                      <td>
                        {origine === "don" && l.coutActuel > 0 ? (
                          <span className="sous-info nowrap" title="Le don entre au coût moyen actuel, qui ne change pas.">
                            {formaterMontant(l.coutActuel)} (coût moyen)
                          </span>
                        ) : (
                          <ChampMontant
                            className="champ-prix-entree"
                            value={l.prixAchat}
                            placeholder={origine === "don" ? "Valeur estimée" : ""}
                            onChange={(valeur) => modifierLigne(l.varianteId, { prixAchat: valeur })}
                          />
                        )}
                      </td>
                      {origine !== "don" && (
                        <td>
                          <ChampMontant
                            className="champ-prix-entree"
                            value={l.prixVente}
                            onChange={(valeur) => modifierLigne(l.varianteId, { prixVente: valeur })}
                          />
                        </td>
                      )}
                      <td className="nowrap col-montant-entree">
                        <strong>{formaterMontant(Math.round(nombre(l.quantite) * coutLigne(l)))}</strong>
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
                  );
                })}
                {lignes.length === 0 && (
                  <tr className="ligne-groupe-vide">
                    <td colSpan={colonnes} className="invite-entree-vide">
                      {origine === "ouverture"
                        ? "Tous vos articles actifs ont déjà du stock : rien à compléter."
                        : "Recherchez ou scannez un article pour l'ajouter."}
                    </td>
                  </tr>
                )}
                {Array.from({ length: Math.max(0, lignesVisibles - Math.max(lignes.length, 1)) }).map((_, i) => (
                  <tr key={`vide-${i}`} className="ligne-groupe-vide">
                    {Array.from({ length: colonnes }).map((__, j) => (
                      <td key={j}>&nbsp;</td>
                    ))}
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
