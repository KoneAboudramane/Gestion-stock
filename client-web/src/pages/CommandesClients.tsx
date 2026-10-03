import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

import type { Session } from "../api/auth";
import ChampMontant from "../components/ChampMontant";
import ModaleConfirmation from "../components/ModaleConfirmation";
import { useDevise } from "../contexts/DeviseContext";
import { formaterMontant, normaliserTelephone } from "../lib/formatage";
import { OPERATEURS_MOBILE_MONEY } from "../lib/libelles";
import { jourLocal } from "../lib/periode";
import { rechercherVariantesAchat, type VarianteAchat } from "../services/achats";
import { obtenirBoutiqueLocale } from "../services/boutique";
import { creerClient, listerClientsDetail, type ClientDetailResume } from "../services/clients";
import {
  annulerCommandeClient,
  creerCommandeClient,
  listerCommandesClient,
  livrerCommandeClient,
  marquerCommandePrete,
  modifierCommandeClient,
  obtenirCommandeClient,
  reservations,
  verserAvanceCommande,
  type CommandeClientDetail,
  type CommandeClientResume,
  type LigneCommandeClientEntree,
  type StatutCommandeClient,
} from "../services/commandesClient";
import type { ModeArgent } from "../services/comptesTiers";
import { listerParametres } from "../services/configuration";
import { listerDepotsDetail, listerStock, type DepotResume } from "../services/stock";
import type { ModePaiement } from "../services/ventes";

// --- Carte « Commandes clients » de la page Clients ---
// Port de client-electron/src/pages/CommandesClients.tsx : seul l'adaptateur
// de données ci-dessous diffère, le reste de l'écran est identique.

/** Accès aux données (seule partie qui diffère entre le bureau et le web). */
const donnees = {
  listerCommandes: listerCommandesClient,
  obtenirCommande: obtenirCommandeClient,
  creerCommande: creerCommandeClient,
  modifierCommande: modifierCommandeClient,
  marquerPrete: marquerCommandePrete,
  annulerCommande: annulerCommandeClient,
  verserAvance: verserAvanceCommande,
  livrer: livrerCommandeClient,
  reservations,
  listerClients: (boutiqueId: string) => listerClientsDetail(boutiqueId),
  creerClient: (boutiqueId: string, nom: string, telephone: string) => creerClient(boutiqueId, nom, telephone),
  listerDepots: listerDepotsDetail,
  stockDepot: (boutiqueId: string, depotId: string) => listerStock(boutiqueId, depotId),
  rechercherArticles: rechercherVariantesAchat,
  boutique: obtenirBoutiqueLocale,
  formatTicket: async (boutiqueId: string) =>
    (await listerParametres(boutiqueId)).find((p) => p.cle === "format_ticket")?.valeur || "a4",
  exporterPdf: async (_nomFichier: string): Promise<string | null> => null,
  ouvrirLien: (url: string) => {
    window.open(url, "_blank", "noopener");
  },
  /** Pas de logo de boutique côté web (comme les autres reçus). */
  useLogo: () => "",
  /** L'impression du navigateur propose aussi l'enregistrement en PDF. */
  pdfSepare: false,
};

type Boutique = NonNullable<Awaited<ReturnType<typeof donnees.boutique>>>;

type ArticleRecherche = VarianteAchat;

const STATUTS: Record<StatutCommandeClient, { label: string; classe: string }> = {
  en_attente: { label: "En attente", classe: "badge-brouillon" },
  prete: { label: "Prête", classe: "badge-commandee" },
  partielle: { label: "Livrée en partie", classe: "badge-partielle" },
  livree: { label: "Livrée", classe: "badge-recue" },
  annulee: { label: "Annulée", classe: "badge-annulee" },
};

function estOuverte(statut: StatutCommandeClient): boolean {
  return statut === "en_attente" || statut === "prete" || statut === "partielle";
}

function enRetard(c: { statut: StatutCommandeClient; dateLivraisonPrevue: string | null }): boolean {
  return estOuverte(c.statut) && !!c.dateLivraisonPrevue && c.dateLivraisonPrevue < jourLocal(new Date());
}

/** Date locale (AAAA-MM-JJ) dans `n` jours. */
function jourDansNJours(n: number): string {
  const date = new Date();
  date.setDate(date.getDate() + n);
  return jourLocal(date);
}

function formaterJour(jour: string | null): string {
  if (!jour) return "—";
  const [a, m, j] = jour.split("-");
  return `${j}/${m}/${a}`;
}

function messageErreur(e: unknown): string {
  return e instanceof Error ? e.message : "Erreur inattendue.";
}

function nombre(valeur: string): number {
  return Number(valeur) || 0;
}

function BadgeStatut({ statut }: { statut: StatutCommandeClient }) {
  return <span className={STATUTS[statut].classe}>{STATUTS[statut].label}</span>;
}

function DateLivraison({ commande }: { commande: CommandeClientResume }) {
  const aujourdhui = jourLocal(new Date());
  return (
    <span className="nowrap">
      {formaterJour(commande.dateLivraisonPrevue)}
      {enRetard(commande) && <span className="badge-retard"> en retard</span>}
      {estOuverte(commande.statut) && commande.dateLivraisonPrevue === aujourdhui && (
        <span className="badge-commandee"> aujourd'hui</span>
      )}
    </span>
  );
}

/** Hauteur d'une ligne vide du quadrillage, bordure comprise (voir index.css). */
const HAUTEUR_LIGNE_VIDE = 45;

/**
 * Lignes vides qui prolongent le quadrillage du tableau jusqu'en bas de sa
 * zone, sans créer de défilement : recalculé quand la zone change de taille
 * ou quand les données changent (`dependances`).
 */
function useLignesVides(dependances: unknown[]) {
  const zone = useRef<HTMLDivElement>(null);
  const [nombre, setNombre] = useState(0);
  /** Place restante (moins d'une ligne) absorbée par la dernière ligne vide. */
  const [surplus, setSurplus] = useState(0);
  useLayoutEffect(() => {
    const element = zone.current;
    if (!element) return;
    const mesurer = () => {
      let occupe = element.querySelector("thead")?.getBoundingClientRect().height ?? 0;
      element.querySelectorAll("tbody tr:not(.ligne-groupe-vide)").forEach((tr) => {
        occupe += tr.getBoundingClientRect().height;
      });
      const disponible = Math.max(0, element.clientHeight - occupe - 2);
      const lignes = Math.floor(disponible / HAUTEUR_LIGNE_VIDE);
      setNombre(lignes);
      setSurplus(Math.floor(disponible - lignes * HAUTEUR_LIGNE_VIDE));
    };
    mesurer();
    // Une fois l'écran entièrement placé (messages, barres, liste des livraisons).
    const image = requestAnimationFrame(mesurer);
    const minuteur = setTimeout(mesurer, 150);
    const observateur = new ResizeObserver(mesurer);
    observateur.observe(element);
    return () => {
      cancelAnimationFrame(image);
      clearTimeout(minuteur);
      observateur.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, dependances);
  return { zone, nombre, surplus };
}

function LignesVides({ nombre, surplus = 0, colonnes }: { nombre: number; surplus?: number; colonnes: number }) {
  // La dernière ligne vide prend aussi le reste de place : le quadrillage
  // descend pile jusqu'en bas. S'il n'y a la place d'aucune ligne entière,
  // une ligne basse comble le reste (au-delà de quelques pixels).
  const hauteurs = Array.from({ length: nombre }, (_, i) =>
    i === nombre - 1 ? HAUTEUR_LIGNE_VIDE + surplus : HAUTEUR_LIGNE_VIDE,
  );
  if (nombre === 0 && surplus >= 8) hauteurs.push(surplus);
  return (
    <>
      {hauteurs.map((hauteur, i) => (
        <tr key={`vide-${i}`} className="ligne-groupe-vide">
          {Array.from({ length: colonnes }).map((__, j) => (
            <td key={j} style={hauteur !== HAUTEUR_LIGNE_VIDE ? { height: hauteur } : undefined}>
              &nbsp;
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}

/** Commande préparée ailleurs (panier de la Caisse) : pré-remplit « Nouvelle commande ». */
export interface CommandePreparee {
  clientId?: string;
  clientNom?: string;
  depotId?: string;
  lignes: { varianteId: string; produitNom: string; reference: string; quantite: number; prixUnitaire: number }[];
  avertissement?: string;
}

type Vue =
  | { type: "liste" }
  | { type: "formulaire"; id?: string }
  | { type: "detail"; id: string }
  | { type: "livrer"; id: string }
  | { type: "avance"; id: string }
  | { type: "bon"; id: string };

export function ModaleCommandesClients({
  session,
  onFermer,
  nouvelle,
  onCreee,
}: {
  session: Session;
  onFermer: () => void;
  /** Ouvre directement « Nouvelle commande », pré-remplie (bouton « Passer commande » de la Caisse). */
  nouvelle?: CommandePreparee;
  onCreee?: (message: string) => void;
}) {
  const [vue, setVue] = useState<Vue>(nouvelle ? { type: "formulaire" } : { type: "liste" });
  const [message, setMessage] = useState<string | null>(null);
  // Le pré-remplissage ne sert qu'une fois : ensuite la fenêtre se comporte normalement.
  const [preparee, setPreparee] = useState(nouvelle);

  function ouvrir(v: Vue, texte: string | null = null) {
    setMessage(texte);
    setVue(v);
  }

  return (
    <div className="fond-modale" onClick={onFermer}>
      <div className="modale-selection-produits modale-commandes-clients" onClick={(e) => e.stopPropagation()}>
        {vue.type === "liste" && (
          <ListeCommandes session={session} onFermer={onFermer} onOuvrir={ouvrir} message={message} />
        )}
        {vue.type === "formulaire" && (
          <FormulaireCommande
            session={session}
            commandeId={vue.id}
            initiale={vue.id ? undefined : preparee}
            onRetour={() =>
              vue.id ? ouvrir({ type: "detail", id: vue.id }) : preparee ? onFermer() : ouvrir({ type: "liste" })
            }
            onEnregistree={(id, texte) => {
              if (!vue.id && preparee) {
                setPreparee(undefined);
                onCreee?.(texte);
              }
              ouvrir({ type: "detail", id }, texte);
            }}
          />
        )}
        {vue.type === "detail" && (
          <DetailCommande session={session} commandeId={vue.id} message={message} onOuvrir={ouvrir} />
        )}
        {vue.type === "livrer" && (
          <LivraisonCommande
            session={session}
            commandeId={vue.id}
            onRetour={() => ouvrir({ type: "detail", id: vue.id })}
            onLivree={(texte) => ouvrir({ type: "detail", id: vue.id }, texte)}
          />
        )}
        {vue.type === "avance" && (
          <AvanceCommande
            session={session}
            commandeId={vue.id}
            onRetour={() => ouvrir({ type: "detail", id: vue.id })}
            onVersee={(texte) => ouvrir({ type: "detail", id: vue.id }, texte)}
          />
        )}
        {vue.type === "bon" && (
          <BonDeCommande session={session} commandeId={vue.id} onRetour={() => ouvrir({ type: "detail", id: vue.id })} />
        )}
      </div>
    </div>
  );
}

// --- Liste ---

type FiltreStatut = "ouvertes" | "retard" | "avance" | "livree" | "annulee" | "toutes";

const MESSAGES_LISTE_VIDE: Record<FiltreStatut, string> = {
  ouvertes: "Aucune commande à livrer.",
  retard: "Aucune commande en retard.",
  avance: "Aucune commande à livrer avec une avance.",
  livree: "Aucune commande livrée.",
  annulee: "Aucune commande annulée.",
  toutes: "Aucune commande.",
};

function ListeCommandes({
  session,
  onFermer,
  onOuvrir,
  message,
}: {
  session: Session;
  onFermer: () => void;
  onOuvrir: (v: Vue, texte?: string | null) => void;
  message: string | null;
}) {
  const devise = useDevise();
  const [commandes, setCommandes] = useState<CommandeClientResume[]>([]);
  const [filtre, setFiltre] = useState<FiltreStatut>("ouvertes");
  const [recherche, setRecherche] = useState("");
  const [erreur, setErreur] = useState<string | null>(null);
  const grille = useLignesVides([commandes, filtre, recherche]);

  function recharger() {
    donnees.listerCommandes(session.boutiqueId).then(setCommandes);
  }
  useEffect(recharger, [session.boutiqueId]);

  const ouvertes = commandes.filter((c) => estOuverte(c.statut));
  const enRetardListe = ouvertes.filter(enRetard);
  const avecAvance = ouvertes.filter((c) => c.avance > 0);
  const affichees = commandes.filter((c) => {
    if (filtre === "ouvertes" && !estOuverte(c.statut)) return false;
    if (filtre === "retard" && !enRetard(c)) return false;
    if (filtre === "avance" && !(estOuverte(c.statut) && c.avance > 0)) return false;
    if (filtre === "livree" && c.statut !== "livree") return false;
    if (filtre === "annulee" && c.statut !== "annulee") return false;
    const t = recherche.trim().toLowerCase();
    return !t || c.clientNom.toLowerCase().includes(t) || c.numero.toLowerCase().includes(t) || c.clientTelephone.includes(t);
  });

  /** Coche « Prête » directement dans la liste (sans ouvrir la fiche). */
  async function basculerPrete(c: CommandeClientResume) {
    setErreur(null);
    try {
      await donnees.marquerPrete(c.id, c.statut !== "prete");
      recharger();
    } catch (e) {
      setErreur(messageErreur(e));
    }
  }

  function Tuile({ cle, icone, libelle, valeur, alerte }: { cle: FiltreStatut | null; icone: string; libelle: string; valeur: string; alerte?: boolean }) {
    const classes = ["tuile-fiche"];
    if (alerte) classes.push("tuile-fiche--alerte");
    if (cle) classes.push("tuile-filtre-commande");
    if (cle && filtre === cle) classes.push("tuile-filtre-commande--active");
    const contenu = (
      <>
        <span className="sous-info">
          {icone} {libelle}
        </span>
        <strong className="nowrap">{valeur}</strong>
      </>
    );
    return cle ? (
      <button type="button" className={classes.join(" ")} onClick={() => setFiltre(filtre === cle ? "ouvertes" : cle)}>
        {contenu}
      </button>
    ) : (
      <div className={classes.join(" ")}>{contenu}</div>
    );
  }

  return (
    <>
      <div className="modale-entete">
        <h3>Commandes clients</h3>
        <button type="button" className="lien bouton-retour" onClick={onFermer}>
          ← Retour
        </button>
      </div>
      <div className="modale-corps corps-commandes-clients">
        {message && <div className="message-succes">{message}</div>}
        {erreur && <div className="message-erreur">{erreur}</div>}
        <div className="barre-actions barre-filtres-historique">
          <select value={filtre} onChange={(e) => setFiltre(e.target.value as FiltreStatut)}>
            <option value="ouvertes">À livrer</option>
            <option value="retard">En retard</option>
            <option value="avance">À livrer, avec avance</option>
            <option value="livree">Livrées</option>
            <option value="annulee">Annulées</option>
            <option value="toutes">Toutes</option>
          </select>
          <input
            type="search"
            placeholder="Rechercher un client, un numéro…"
            value={recherche}
            onChange={(e) => setRecherche(e.target.value)}
          />
          {session.permissions.vendre && (
            <button type="button" className="bouton-ajouter-variante" onClick={() => onOuvrir({ type: "formulaire" })}>
              + Nouvelle commande
            </button>
          )}
        </div>
        <div className="tuiles-fiche">
          <Tuile cle="ouvertes" icone="📋" libelle="Commandes à livrer" valeur={String(ouvertes.length)} />
          <Tuile
            cle="retard"
            icone="⏰"
            libelle="En retard"
            valeur={String(enRetardListe.length)}
            alerte={enRetardListe.length > 0}
          />
          <Tuile
            cle={null}
            icone="📦"
            libelle="Reste à livrer"
            valeur={`${formaterMontant(ouvertes.reduce((t, c) => t + c.resteALivrer, 0))} ${devise}`}
          />
          <Tuile
            cle="avance"
            icone="👛"
            libelle={`Avances reçues (${avecAvance.length})`}
            valeur={`${formaterMontant(avecAvance.reduce((t, c) => t + c.avance, 0))} ${devise}`}
          />
        </div>
        <div className="zone-tableau-scroll zone-commandes-clients" ref={grille.zone}>
          <table className="tableau-catalogue">
            <thead>
              <tr>
                <th>N°</th>
                <th>Client</th>
                <th>Livraison prévue</th>
                <th>Articles</th>
                <th className="col-montant-commande">Total</th>
                <th className="col-montant-commande">Avance</th>
                <th className="col-montant-commande">Reste à livrer</th>
                <th>Statut</th>
                <th className="col-prete-commande" title="Marchandise préparée, prête à livrer">
                  Prête
                </th>
              </tr>
            </thead>
            <tbody>
              {affichees.map((c) => (
                <tr
                  key={c.id}
                  className={`ligne-cliquable${enRetard(c) ? " ligne-commande-en-retard" : ""}`}
                  onClick={() => onOuvrir({ type: "detail", id: c.id })}
                >
                  <td className="nowrap">{c.numero}</td>
                  <td>
                    {c.clientNom}
                    {c.clientTelephone && <div className="sous-info">{c.clientTelephone}</div>}
                  </td>
                  <td>
                    <DateLivraison commande={c} />
                  </td>
                  <td>{c.nombreArticles}</td>
                  <td className="nowrap col-montant-commande">{formaterMontant(c.total)}</td>
                  <td className="nowrap col-montant-commande">{c.avance > 0 ? formaterMontant(c.avance) : "—"}</td>
                  <td className="nowrap col-montant-commande">
                    {estOuverte(c.statut) ? formaterMontant(c.resteALivrer) : "—"}
                  </td>
                  <td>
                    <BadgeStatut statut={c.statut} />
                  </td>
                  <td className="col-prete-commande" onClick={(e) => e.stopPropagation()}>
                    {c.statut === "en_attente" || c.statut === "prete" ? (
                      <input
                        type="checkbox"
                        checked={c.statut === "prete"}
                        title={c.statut === "prete" ? "Remettre en attente" : "Marquer prête"}
                        onChange={() => basculerPrete(c)}
                      />
                    ) : (
                      "—"
                    )}
                  </td>
                </tr>
              ))}
              {affichees.length === 0 && (
                <tr>
                  <td colSpan={9} className="liste-vide-compacte">
                    {MESSAGES_LISTE_VIDE[filtre]}
                  </td>
                </tr>
              )}
              <LignesVides nombre={grille.nombre} surplus={grille.surplus} colonnes={9} />
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}

// --- Création / modification ---

interface LigneSaisie {
  varianteId: string;
  produitNom: string;
  reference: string;
  quantite: string;
  prixUnitaire: string;
  /** Déjà livré (modification d'une commande livrée en partie). */
  quantiteLivree: number;
}

function FormulaireCommande({
  session,
  commandeId,
  initiale,
  onRetour,
  onEnregistree,
}: {
  session: Session;
  commandeId?: string;
  initiale?: CommandePreparee;
  onRetour: () => void;
  onEnregistree: (id: string, message: string) => void;
}) {
  const devise = useDevise();
  const peutModifierPrix = !!session.permissions.modifier_prix;
  const [commande, setCommande] = useState<CommandeClientDetail | null>(null);
  const [clients, setClients] = useState<ClientDetailResume[]>([]);
  const [clientId, setClientId] = useState(initiale?.clientId ?? "");
  const [rechercheClient, setRechercheClient] = useState("");
  const [listeClientsOuverte, setListeClientsOuverte] = useState(false);
  const [nouveauClient, setNouveauClient] = useState<{ nom: string; telephone: string } | null>(null);
  const [depots, setDepots] = useState<DepotResume[]>([]);
  const [depotId, setDepotId] = useState(initiale?.depotId ?? "");
  const [dateLivraison, setDateLivraison] = useState("");
  const [note, setNote] = useState("");
  const [lignes, setLignes] = useState<LigneSaisie[]>(() =>
    (initiale?.lignes ?? []).map((l) => ({
      varianteId: l.varianteId,
      produitNom: l.produitNom,
      reference: l.reference,
      quantite: String(l.quantite),
      prixUnitaire: String(l.prixUnitaire),
      quantiteLivree: 0,
    })),
  );
  const grille = useLignesVides([lignes.length]);
  const [terme, setTerme] = useState("");
  const [resultats, setResultats] = useState<ArticleRecherche[]>([]);
  const [rechercheOuverte, setRechercheOuverte] = useState(false);
  const [stock, setStock] = useState<Map<string, number>>(new Map());
  const [reserve, setReserve] = useState<Map<string, number>>(new Map());
  const [erreur, setErreur] = useState<string | null>(null);
  const [enCours, setEnCours] = useState(false);

  useEffect(() => {
    donnees.listerClients(session.boutiqueId).then(setClients);
    donnees.listerDepots(session.boutiqueId).then((liste) => {
      setDepots(liste);
      setDepotId((actuel) => actuel || session.depotId || liste[0]?.id || "");
    });
    if (commandeId) {
      donnees.obtenirCommande(commandeId).then((c) => {
        if (!c) return;
        setCommande(c);
        setClientId(c.clientId);
        setDepotId(c.depotId);
        setDateLivraison(c.dateLivraisonPrevue ?? "");
        setNote(c.note);
        setLignes(
          c.lignes.map((l) => ({
            varianteId: l.varianteId,
            produitNom: l.produitNom,
            reference: l.reference,
            quantite: String(l.quantite),
            prixUnitaire: String(l.prixUnitaire),
            quantiteLivree: l.quantiteLivree,
          })),
        );
      });
    }
  }, [session.boutiqueId, session.depotId, commandeId]);

  // Stock libre du dépôt choisi : stock moins ce que les AUTRES commandes réservent.
  useEffect(() => {
    if (!depotId) return;
    donnees.stockDepot(session.boutiqueId, depotId).then((liste) => setStock(new Map(liste.map((s) => [s.varianteId, Number(s.quantite)]))));
    donnees.reservations(session.boutiqueId, depotId).then((liste) => setReserve(new Map(liste.map((r) => [r.varianteId, r.quantite]))));
  }, [session.boutiqueId, depotId]);

  useEffect(() => {
    if (!terme.trim()) {
      setResultats([]);
      return;
    }
    const minuteur = setTimeout(() => {
      donnees.rechercherArticles(session.boutiqueId, terme.trim()).then(setResultats);
    }, 200);
    return () => clearTimeout(minuteur);
  }, [terme, session.boutiqueId]);

  function reserveAutres(varianteId: string): number {
    const total = reserve.get(varianteId) ?? 0;
    // La commande modifiée réserve elle-même son restant (dans son dépôt d'origine).
    const propre = commande && commande.depotId === depotId && estOuverte(commande.statut)
      ? commande.lignes.filter((l) => l.varianteId === varianteId).reduce((t, l) => t + Math.max(0, l.quantite - l.quantiteLivree), 0)
      : 0;
    return Math.max(0, total - propre);
  }

  function ajouterArticle(article: ArticleRecherche) {
    setTerme("");
    setErreur(null);
    if (lignes.some((l) => l.varianteId === article.id)) {
      setLignes((actuel) =>
        actuel.map((l) => (l.varianteId === article.id ? { ...l, quantite: String(nombre(l.quantite) + 1) } : l)),
      );
      return;
    }
    setLignes((actuel) => [
      ...actuel,
      {
        varianteId: article.id,
        produitNom: article.produitNom,
        reference: article.reference,
        quantite: "1",
        prixUnitaire: String(article.prixVente || ""),
        quantiteLivree: 0,
      },
    ]);
  }

  function modifierLigne(varianteId: string, champs: Partial<LigneSaisie>) {
    setErreur(null);
    setLignes((actuel) => actuel.map((l) => (l.varianteId === varianteId ? { ...l, ...champs } : l)));
  }

  const clientChoisi = clients.find((c) => c.id === clientId);
  // Client venu de la Caisse mais absent de la liste (client de passage) : on garde son nom.
  const libelleClient = clientChoisi
    ? `${clientChoisi.nom}${clientChoisi.telephone ? ` · ${clientChoisi.telephone}` : ""}`
    : clientId && clientId === initiale?.clientId
      ? initiale.clientNom ?? ""
      : "";
  const clientsFiltres = clients
    .filter((c) => {
      const t = rechercheClient.trim().toLowerCase();
      return !t || c.nom.toLowerCase().includes(t) || c.telephone.includes(t);
    })
    .slice(0, 30);
  const total = lignes.reduce((t, l) => t + Math.round(nombre(l.quantite) * nombre(l.prixUnitaire)), 0);
  const livreeEnPartie = commande?.statut === "partielle";
  // Comme en Caisse, la commande part du dépôt de vente de l'utilisateur. Seul
  // qui gère le stock choisit un autre dépôt, et seulement s'il y en a plusieurs.
  const peutChoisirDepot = !!session.permissions.gerer_produits_stock_achats && depots.length > 1;

  async function enregistrer() {
    setErreur(null);
    let idClient = clientId;
    if (nouveauClient) {
      if (!nouveauClient.nom.trim()) return setErreur("Indiquez le nom du nouveau client.");
    } else if (!idClient) {
      return setErreur("Choisissez le client.");
    }
    if (!depotId) return setErreur("Choisissez le dépôt qui livrera.");
    if (lignes.length === 0) return setErreur("Ajoutez au moins un article.");
    for (const l of lignes) {
      if (!(nombre(l.quantite) > 0)) return setErreur(`${l.produitNom} : indiquez une quantité supérieure à 0.`);
      if (nombre(l.quantite) < l.quantiteLivree) {
        return setErreur(`${l.produitNom} : déjà ${formaterMontant(l.quantiteLivree)} livrés, la quantité ne peut pas être inférieure.`);
      }
      if (l.prixUnitaire.trim() === "") return setErreur(`${l.produitNom} : indiquez le prix.`);
    }
    const lignesEntree: LigneCommandeClientEntree[] = lignes.map((l) => ({
      varianteId: l.varianteId,
      quantite: nombre(l.quantite),
      prixUnitaire: nombre(l.prixUnitaire),
    }));
    setEnCours(true);
    try {
      if (nouveauClient) {
        idClient = await donnees.creerClient(session.boutiqueId, nouveauClient.nom.trim(), normaliserTelephone(nouveauClient.telephone));
      }
      if (commandeId) {
        await donnees.modifierCommande(commandeId, {
          clientId: idClient,
          depotId,
          dateLivraisonPrevue: dateLivraison || null,
          note,
          lignes: lignesEntree,
        });
        onEnregistree(commandeId, "✅ Commande modifiée.");
      } else {
        const cree = await donnees.creerCommande({
          boutiqueId: session.boutiqueId,
          clientId: idClient,
          depotId,
          utilisateurId: session.utilisateurId,
          dateLivraisonPrevue: dateLivraison || null,
          note,
          lignes: lignesEntree,
        });
        onEnregistree(cree.id, `✅ Commande ${cree.numero} enregistrée.`);
      }
    } catch (e) {
      setErreur(messageErreur(e));
    } finally {
      setEnCours(false);
    }
  }

  return (
    <div className="formulaire-mouvement-groupe formulaire-saisie-commande-client">
      <div className="modale-entete entete-fixe">
        <h3>{commandeId ? `Modifier la commande ${commande?.numero ?? ""}` : "Nouvelle commande"}</h3>
        <div className="actions-formulaire">
          <button type="button" className="bouton-primaire" onClick={enregistrer} disabled={enCours}>
            {enCours ? "Enregistrement…" : "Enregistrer"}
          </button>
          <button type="button" className="lien bouton-retour" onClick={onRetour}>
            ← Retour
          </button>
        </div>
      </div>
      {erreur && <div className="message-erreur">{erreur}</div>}
      {initiale?.avertissement && !erreur && <div className="message-avertissement-reserve">{initiale.avertissement}</div>}
      <div className="colonnes-mouvement-groupe">
        <div className="colonne-recherche-groupe">
          <div className="ligne-champs-recherche-commande">
            <div className="champ-client-commande">
              <span className="libelle-champ">Client</span>
              {nouveauClient ? (
                <div className="nouveau-client-commande">
                  <input
                    placeholder="Nom du client"
                    value={nouveauClient.nom}
                    onChange={(e) => setNouveauClient({ ...nouveauClient, nom: e.target.value })}
                    autoFocus
                  />
                  <input
                    placeholder="Téléphone (ex. 2250712345678)"
                    value={nouveauClient.telephone}
                    onChange={(e) => setNouveauClient({ ...nouveauClient, telephone: e.target.value })}
                  />
                  <button type="button" className="lien" onClick={() => setNouveauClient(null)}>
                    Choisir un client existant
                  </button>
                </div>
              ) : (
                <div className="recherche-commande-combobox recherche-client-commande">
                  <input
                    placeholder="Rechercher un client (nom ou téléphone)…"
                    value={listeClientsOuverte ? rechercheClient : libelleClient || rechercheClient}
                    onChange={(e) => setRechercheClient(e.target.value)}
                    onFocus={() => {
                      setRechercheClient("");
                      setListeClientsOuverte(true);
                    }}
                    onBlur={() => setListeClientsOuverte(false)}
                    disabled={livreeEnPartie}
                    title={livreeEnPartie ? "Une partie est déjà livrée : le client ne change plus." : undefined}
                  />
                  {listeClientsOuverte && (
                    <ul className="resultats-recherche">
                      {clientsFiltres.map((c) => (
                        <li
                          key={c.id}
                          onMouseDown={(e) => {
                            e.preventDefault();
                            setClientId(c.id);
                            setListeClientsOuverte(false);
                            (e.currentTarget.closest(".recherche-client-commande")?.querySelector("input") as HTMLInputElement | null)?.blur();
                          }}
                        >
                          <span>{c.nom}</span>
                          <span className="sous-info">{c.telephone}</span>
                        </li>
                      ))}
                      <li
                        className="ajout-client-commande"
                        onMouseDown={(e) => {
                          e.preventDefault();
                          setNouveauClient({ nom: rechercheClient.trim(), telephone: "" });
                          setListeClientsOuverte(false);
                        }}
                      >
                        + Nouveau client{rechercheClient.trim() ? ` « ${rechercheClient.trim()} »` : ""}
                      </li>
                    </ul>
                  )}
                </div>
              )}
            </div>
            {peutChoisirDepot && (
              <label>
                Dépôt qui livre
                <select value={depotId} onChange={(e) => setDepotId(e.target.value)} disabled={livreeEnPartie}>
                  {depots.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.nom}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <label>
              Livraison prévue
              <input type="date" value={dateLivraison} onChange={(e) => setDateLivraison(e.target.value)} />
              <span className="raccourcis-date-commande">
                {[
                  { libelle: "Demain", jours: 1 },
                  { libelle: "Dans 3 jours", jours: 3 },
                  { libelle: "Dans 1 semaine", jours: 7 },
                ].map((r) => (
                  <button key={r.jours} type="button" className="lien" onClick={() => setDateLivraison(jourDansNJours(r.jours))}>
                    {r.libelle}
                  </button>
                ))}
              </span>
            </label>
            <label className="champ-note-commande">
              Note
              <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="ex. livrer au chantier" />
            </label>
          </div>
          <div className="ligne-champs-recherche-commande">
            <div className="recherche-commande-combobox recherche-article-commande">
              <input
                placeholder="🔍 Ajouter un article (nom, référence, code-barres)…"
                value={terme}
                onChange={(e) => setTerme(e.target.value)}
                onFocus={() => setRechercheOuverte(true)}
                onBlur={() => setRechercheOuverte(false)}
                onKeyDown={async (e) => {
                  if (e.key !== "Enter") return;
                  e.preventDefault();
                  const saisie = terme.trim();
                  if (!saisie) return;
                  const liste = await donnees.rechercherArticles(session.boutiqueId, saisie);
                  const trouve =
                    liste.find((v) => v.codeBarres === saisie) ??
                    liste.find((v) => (v.reference || "").toLowerCase() === saisie.toLowerCase()) ??
                    (liste.length === 1 ? liste[0] : undefined);
                  if (trouve) ajouterArticle(trouve);
                  else setResultats(liste);
                }}
              />
              {terme.trim() && rechercheOuverte && (
                <ul className="resultats-recherche">
                  {resultats.map((v) => {
                    const libre = (stock.get(v.id) ?? 0) - reserveAutres(v.id);
                    return (
                      <li
                        key={v.id}
                        onMouseDown={(e) => {
                          e.preventDefault();
                          ajouterArticle(v);
                        }}
                      >
                        <span>
                          {v.produitNom}
                          {v.reference && <span className="sous-info"> · {v.reference}</span>}
                        </span>
                        <span className="sous-info nowrap">
                          stock libre {formaterMontant(libre)} · {formaterMontant(v.prixVente)} {devise}
                        </span>
                      </li>
                    );
                  })}
                  {resultats.length === 0 && <li className="liste-vide-compacte">Aucun résultat.</li>}
                </ul>
              )}
            </div>
            <span className="nombre-articles-commande">
              {lignes.length} article{lignes.length > 1 ? "s" : ""}
            </span>
            <div className="total-net total-net-commande">
              Total : <span className="montant-total-commande">{formaterMontant(total)} {devise}</span>
            </div>
          </div>
        </div>
        <div className="colonne-lignes-groupe">
          <div className="lignes-groupe-scrollable zone-lignes-commande" ref={grille.zone}>
            <table className="tableau-catalogue">
              <thead>
                <tr>
                  <th>N°</th>
                  <th>Référence</th>
                  <th>Désignation</th>
                  <th title="Stock du dépôt moins ce que les autres commandes réservent">Stock libre</th>
                  <th>Qté</th>
                  <th>Prix unitaire</th>
                  <th className="colonne-sous-total">Sous-total</th>
                  <th className="colonne-actions-variante" />
                </tr>
              </thead>
              <tbody>
                {lignes.map((l, i) => {
                  const libre = (stock.get(l.varianteId) ?? 0) - reserveAutres(l.varianteId);
                  const manque = nombre(l.quantite) - l.quantiteLivree > libre;
                  return (
                    <tr key={l.varianteId}>
                      <td>{i + 1}</td>
                      <td>{l.reference}</td>
                      <td>
                        {l.produitNom}
                        {l.quantiteLivree > 0 && (
                          <div className="sous-info">Déjà livré : {formaterMontant(l.quantiteLivree)}</div>
                        )}
                      </td>
                      <td className={`nowrap${manque ? " texte-manque-stock" : ""}`} title={manque ? "Pas assez de stock libre : à commander chez le fournisseur." : undefined}>
                        {formaterMontant(libre)}
                        {manque && " ⚠"}
                      </td>
                      <td>
                        <input
                          className="champ-quantite-commande"
                          type="number"
                          min={l.quantiteLivree || 0.01}
                          step="any"
                          value={l.quantite}
                          onChange={(e) => modifierLigne(l.varianteId, { quantite: e.target.value })}
                        />
                      </td>
                      <td>
                        <ChampMontant
                          className="champ-prix-commande"
                          value={l.prixUnitaire}
                          onChange={(valeur) => modifierLigne(l.varianteId, { prixUnitaire: valeur })}
                          disabled={!peutModifierPrix || l.quantiteLivree > 0}
                          title={
                            l.quantiteLivree > 0
                              ? "Déjà livré en partie : le prix ne change plus."
                              : !peutModifierPrix
                                ? "Vous n'avez pas le droit de modifier les prix."
                                : undefined
                          }
                        />
                      </td>
                      <td className="colonne-sous-total">
                        <strong>{formaterMontant(Math.round(nombre(l.quantite) * nombre(l.prixUnitaire)))}</strong>
                      </td>
                      <td className="colonne-actions-variante">
                        <button
                          type="button"
                          className="bouton-retirer-ligne-groupe"
                          title={l.quantiteLivree > 0 ? "Déjà livré en partie : ne peut pas être retiré." : "Retirer"}
                          disabled={l.quantiteLivree > 0}
                          onClick={() => setLignes((actuel) => actuel.filter((x) => x.varianteId !== l.varianteId))}
                        >
                          ✕
                        </button>
                      </td>
                    </tr>
                  );
                })}
                <LignesVides nombre={grille.nombre} surplus={grille.surplus} colonnes={8} />
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}

// --- Fiche de la commande ---

function DetailCommande({
  session,
  commandeId,
  message,
  onOuvrir,
}: {
  session: Session;
  commandeId: string;
  message: string | null;
  onOuvrir: (v: Vue, texte?: string | null) => void;
}) {
  const devise = useDevise();
  const [commande, setCommande] = useState<CommandeClientDetail | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [confirmerAnnulation, setConfirmerAnnulation] = useState(false);
  const grille = useLignesVides([commande]);
  const [enCours, setEnCours] = useState(false);
  const [info, setInfo] = useState<string | null>(message);

  function recharger() {
    donnees.obtenirCommande(commandeId).then((c) => setCommande(c ?? null));
  }
  useEffect(recharger, [commandeId]);

  if (!commande) return <p className="modale-corps">Chargement…</p>;

  const ouverte = estOuverte(commande.statut);
  const peutAnnuler = commande.avance <= 0 || !!session.permissions.annuler_vente;
  const valeurLivree = commande.lignes.reduce((t, l) => t + Math.round(l.quantiteLivree * l.prixUnitaire), 0);
  const quantiteCommandee = commande.lignes.reduce((t, l) => t + l.quantite, 0);
  const quantiteLivree = commande.lignes.reduce((t, l) => t + l.quantiteLivree, 0);
  const pourcentageLivre = quantiteCommandee > 0 ? Math.round((quantiteLivree / quantiteCommandee) * 100) : 0;

  async function basculerPrete() {
    if (!commande) return;
    setErreur(null);
    try {
      await donnees.marquerPrete(commande.id, commande.statut !== "prete");
      setInfo(commande.statut !== "prete" ? "✅ Commande marquée prête." : "Commande remise en attente.");
      recharger();
    } catch (e) {
      setErreur(messageErreur(e));
    }
  }

  async function annuler() {
    if (!commande) return;
    setEnCours(true);
    try {
      await donnees.annulerCommande(commande.id);
      setConfirmerAnnulation(false);
      setInfo(
        commande.avance > 0
          ? `Commande annulée. L'avance de ${formaterMontant(commande.avance)} ${devise} reste sur le compte de ${commande.clientNom} (Comptes → Rendre pour la lui rendre).`
          : "Commande annulée.",
      );
      recharger();
    } catch (e) {
      setErreur(messageErreur(e));
      setConfirmerAnnulation(false);
    } finally {
      setEnCours(false);
    }
  }

  return (
    <>
      <div className="modale-entete entete-fixe">
        <h3>
          Commande {commande.numero} <BadgeStatut statut={commande.statut} />
        </h3>
        <div className="actions-formulaire">
          {ouverte && session.permissions.vendre && (
            <button type="button" className="bouton-primaire" onClick={() => onOuvrir({ type: "livrer", id: commande.id })}>
              🚚 Livrer
            </button>
          )}
          <button type="button" className="lien bouton-retour" onClick={() => onOuvrir({ type: "liste" })}>
            ← Retour
          </button>
        </div>
      </div>
      <div className="barre-actions-commande">
        {ouverte && (
          <button type="button" onClick={() => onOuvrir({ type: "avance", id: commande.id })}>
            👛 Avance
          </button>
        )}
        {(commande.statut === "en_attente" || commande.statut === "prete") && (
          <button type="button" onClick={basculerPrete}>
            {commande.statut === "prete" ? "↩ Remettre en attente" : "✔ Marquer prête"}
          </button>
        )}
        {ouverte && session.permissions.vendre && (
          <button type="button" onClick={() => onOuvrir({ type: "formulaire", id: commande.id })}>
            ✏️ Modifier
          </button>
        )}
        <button type="button" onClick={() => onOuvrir({ type: "bon", id: commande.id })}>
          🧾 Bon de commande
        </button>
        {ouverte && (
          <button
            type="button"
            className="bouton-annuler-commande"
            disabled={!peutAnnuler}
            title={peutAnnuler ? undefined : "Une avance a été versée : annulation réservée au patron ou au gérant."}
            onClick={() => setConfirmerAnnulation(true)}
          >
            ✕ Annuler la commande
          </button>
        )}
      </div>
      <div className="modale-corps corps-commandes-clients">
        {info && <div className="message-succes">{info}</div>}
        {erreur && <div className="message-erreur">{erreur}</div>}
        <div className="infos-reception">
          <div>
            <span className="sous-info">Client</span>
            <strong>{commande.clientNom}</strong>
            {commande.clientTelephone && <span className="sous-info">{commande.clientTelephone}</span>}
          </div>
          <div>
            <span className="sous-info">Dépôt qui livre</span>
            <strong>{commande.depotNom}</strong>
          </div>
          <div>
            <span className="sous-info">Livraison prévue</span>
            <strong>
              <DateLivraison commande={commande} />
            </strong>
          </div>
          <div>
            <span className="sous-info">Commandée le</span>
            <strong>{new Date(commande.dateCreation).toLocaleDateString("fr-FR")}</strong>
          </div>
          {commande.note && (
            <div>
              <span className="sous-info">Note</span>
              <strong>{commande.note}</strong>
            </div>
          )}
        </div>
        <div className="tuiles-fiche">
          <div className="tuile-fiche">
            <span className="sous-info">💰 Total de la commande</span>
            <strong className="nowrap">
              {formaterMontant(commande.total)} {devise}
            </strong>
          </div>
          <div className="tuile-fiche">
            <span className="sous-info">🚚 Déjà livré</span>
            <strong className="nowrap">
              {formaterMontant(valeurLivree)} {devise}
            </strong>
          </div>
          <div className="tuile-fiche">
            <span className="sous-info">👛 Avance versée</span>
            <strong className="nowrap">
              {formaterMontant(commande.avance)} {devise}
            </strong>
          </div>
          <div className="tuile-fiche" title="Ce que le client a sur son porte-monnaie : servira à payer la livraison.">
            <span className="sous-info">💼 Sur son compte</span>
            <strong className="nowrap">
              {formaterMontant(commande.soldeCompteClient)} {devise}
            </strong>
          </div>
        </div>
        <div className="progression-commande">
          <div className="progression-commande-texte">
            <span>
              🚚 Livré : <strong>{formaterMontant(quantiteLivree)}</strong> / {formaterMontant(quantiteCommandee)} article
              {quantiteCommandee > 1 ? "s" : ""}
            </span>
            <strong>{pourcentageLivre} %</strong>
          </div>
          <div className="progression-commande-barre">
            <div style={{ width: `${pourcentageLivre}%` }} />
          </div>
        </div>
        <div className="zone-tableau-scroll zone-lignes-commande" ref={grille.zone}>
          <table className="tableau-catalogue">
            <thead>
              <tr>
                <th>Article</th>
                <th>Commandé</th>
                <th>Livré</th>
                <th>Reste</th>
                <th title="Stock du dépôt, moins ce que les autres commandes réservent">Stock libre</th>
                <th className="col-montant-commande">Prix</th>
                <th className="col-montant-commande">Montant</th>
              </tr>
            </thead>
            <tbody>
              {commande.lignes.map((l) => {
                const reste = Math.max(0, l.quantite - l.quantiteLivree);
                const libre = l.stockDepot - l.reserveAutres;
                const manque = ouverte && reste > libre;
                return (
                  <tr key={l.id}>
                    <td>
                      {l.produitNom}
                      {l.reference && <div className="sous-info">{l.reference}</div>}
                    </td>
                    <td>{formaterMontant(l.quantite)}</td>
                    <td>{formaterMontant(l.quantiteLivree)}</td>
                    <td>
                      <strong>{formaterMontant(reste)}</strong>
                    </td>
                    <td className={manque ? "texte-manque-stock" : undefined}>
                      {formaterMontant(libre)}
                      {manque && ` ⚠ manque ${formaterMontant(reste - Math.max(0, libre))}`}
                    </td>
                    <td className="nowrap col-montant-commande">{formaterMontant(l.prixUnitaire)}</td>
                    <td className="nowrap col-montant-commande">{formaterMontant(l.sousTotal)}</td>
                  </tr>
                );
              })}
              <LignesVides nombre={grille.nombre} surplus={grille.surplus} colonnes={7} />
            </tbody>
          </table>
        </div>
        {commande.livraisons.length > 0 && (
          <div className="livraisons-commande">
            <strong>Livraisons</strong>
            {commande.livraisons.map((v) => (
              <div key={v.venteId} className="sous-info">
                {new Date(v.dateCreation).toLocaleString("fr-FR")} · vente {v.numero} · {formaterMontant(v.totalNet)} {devise}
                {v.statut === "annulee" && " (annulée)"}
              </div>
            ))}
          </div>
        )}
      </div>
      {confirmerAnnulation && (
        <ModaleConfirmation
          titre={`Annuler la commande ${commande.numero} ?`}
          description={
            (commande.statut === "partielle" ? "Ce qui a déjà été livré reste vendu ; seul le restant est annulé. " : "") +
            (commande.avance > 0
              ? `L'avance de ${formaterMontant(commande.avance)} ${devise} reste sur le compte du client.`
              : "La réservation du stock est libérée.")
          }
          labelConfirmer="Annuler la commande"
          dangereux
          enCours={enCours}
          onAnnuler={() => setConfirmerAnnulation(false)}
          onConfirmer={annuler}
        />
      )}
    </>
  );
}

// --- Livraison ---

type ModeReste = "especes" | "mobile_money" | "credit";

function LivraisonCommande({
  session,
  commandeId,
  onRetour,
  onLivree,
}: {
  session: Session;
  commandeId: string;
  onRetour: () => void;
  onLivree: (message: string) => void;
}) {
  const devise = useDevise();
  const [commande, setCommande] = useState<CommandeClientDetail | null>(null);
  const [quantites, setQuantites] = useState<Record<string, string>>({});
  const grille = useLignesVides([commande]);
  const [montantCompteSaisi, setMontantCompteSaisi] = useState<string | null>(null);
  const [modeReste, setModeReste] = useState<ModeReste>("especes");
  const [operateur, setOperateur] = useState("orange_money");
  const [erreur, setErreur] = useState<string | null>(null);
  const [enCours, setEnCours] = useState(false);
  /** Livraison vérifiée, en attente de la confirmation du résumé. */
  const [aConfirmer, setAConfirmer] = useState<Parameters<typeof donnees.livrer>[0] | null>(null);

  /** Tout le restant, dans la limite du stock du dépôt (choix par défaut). */
  function quantitesEnStock(c: CommandeClientDetail): Record<string, string> {
    return Object.fromEntries(
      c.lignes.map((l) => {
        const reste = Math.max(0, l.quantite - l.quantiteLivree);
        return [l.varianteId, String(Math.max(0, Math.min(reste, l.stockDepot)))];
      }),
    );
  }

  useEffect(() => {
    donnees.obtenirCommande(commandeId).then((c) => {
      if (!c) return;
      setCommande(c);
      setQuantites(quantitesEnStock(c));
    });
  }, [commandeId]);

  const total = useMemo(
    () => (commande ? commande.lignes.reduce((t, l) => t + Math.round(nombre(quantites[l.varianteId] ?? "") * l.prixUnitaire), 0) : 0),
    [commande, quantites],
  );

  if (!commande) return <p className="modale-corps">Chargement…</p>;

  const compteMax = Math.min(commande.soldeCompteClient, total);
  const montantCompte = Math.min(montantCompteSaisi === null ? compteMax : nombre(montantCompteSaisi), compteMax);
  const reste = total - montantCompte;

  /** Vérifie la saisie, puis montre le résumé à confirmer. */
  function preparerLivraison() {
    if (!commande) return;
    setErreur(null);
    const lignes = commande.lignes
      .map((l) => ({ varianteId: l.varianteId, quantite: nombre(quantites[l.varianteId] ?? "") }))
      .filter((l) => l.quantite > 0);
    if (lignes.length === 0) return setErreur("Indiquez au moins une quantité à livrer.");
    for (const l of commande.lignes) {
      const q = nombre(quantites[l.varianteId] ?? "");
      if (q > l.quantite - l.quantiteLivree + 1e-9) return setErreur(`${l.produitNom} : plus que le restant à livrer.`);
      if (q > l.stockDepot + 1e-9) return setErreur(`${l.produitNom} : stock insuffisant dans le dépôt (${formaterMontant(l.stockDepot)}).`);
    }
    const paiements: { mode: ModePaiement; operateur?: "" | "orange_money" | "mtn_money" | "moov_money" | "wave"; montant: number }[] = [];
    if (montantCompte > 0) paiements.push({ mode: "compte_client", montant: montantCompte });
    if (reste > 0) {
      paiements.push({
        mode: modeReste,
        operateur: modeReste === "mobile_money" ? (operateur as "orange_money") : "",
        montant: reste,
      });
    }
    setAConfirmer({ commandeId, utilisateurId: session.utilisateurId, lignes, paiements });
  }

  async function livrer() {
    if (!aConfirmer) return;
    setEnCours(true);
    try {
      const vente = await donnees.livrer(aConfirmer);
      onLivree(`✅ Livraison enregistrée : vente ${vente.numero} (${formaterMontant(vente.totalNet)} ${devise}).`);
    } catch (e) {
      setErreur(messageErreur(e));
      setAConfirmer(null);
    } finally {
      setEnCours(false);
    }
  }

  const unitesALivrer = commande.lignes.reduce((t, l) => t + nombre(quantites[l.varianteId] ?? ""), 0);
  const articlesALivrer = commande.lignes.filter((l) => nombre(quantites[l.varianteId] ?? "") > 0).length;
  const libelleModeReste =
    modeReste === "especes"
      ? "💵 en espèces"
      : modeReste === "credit"
        ? "📒 à crédit"
        : `📱 par ${OPERATEURS_MOBILE_MONEY.find((o) => o.valeur === operateur)?.label ?? "Mobile Money"}`;

  return (
    <div className="formulaire-commande-client">
      <div className="modale-entete entete-fixe">
        <h3>Livrer la commande {commande.numero}</h3>
        <div className="actions-formulaire">
          <button type="button" className="bouton-primaire" onClick={preparerLivraison} disabled={enCours || total <= 0}>
            Confirmer la livraison
          </button>
          <button type="button" className="lien bouton-retour" onClick={onRetour}>
            ← Retour
          </button>
        </div>
      </div>
      <p className="sous-info">
        {commande.clientNom} · dépôt {commande.depotNom}. La livraison est enregistrée comme une vente, au prix de la commande.
      </p>
      {erreur && <div className="message-erreur">{erreur}</div>}
      <div className="recap-livraison-commande">
        <div className="ligne-recap-livraison">
          <span>À payer pour cette livraison</span>
          <strong>
            {formaterMontant(total)} {devise}
          </strong>
        </div>
        {commande.soldeCompteClient > 0 && (
          <div className="ligne-recap-livraison">
            <span>👛 Payé avec son compte (disponible {formaterMontant(commande.soldeCompteClient)})</span>
            <ChampMontant
              className="champ-montant-deja-paye"
              value={montantCompteSaisi ?? String(compteMax)}
              onChange={setMontantCompteSaisi}
            />
          </div>
        )}
        {reste > 0 && (
          <div className="ligne-recap-livraison">
            <span>
              Reste <strong>{formaterMontant(reste)} {devise}</strong> payé par
            </span>
            <span className="choix-reglement-livraison">
              <select value={modeReste} onChange={(e) => setModeReste(e.target.value as ModeReste)}>
                <option value="especes">💵 Espèces</option>
                <option value="mobile_money">📱 Mobile Money</option>
                <option value="credit">📒 Crédit</option>
              </select>
              {modeReste === "mobile_money" && (
                <select value={operateur} onChange={(e) => setOperateur(e.target.value)}>
                  {OPERATEURS_MOBILE_MONEY.map((o) => (
                    <option key={o.valeur} value={o.valeur}>
                      {o.label}
                    </option>
                  ))}
                </select>
              )}
            </span>
          </div>
        )}
      </div>
      <div className="raccourcis-livraison">
        <button
          type="button"
          onClick={() => {
            setErreur(null);
            setQuantites(quantitesEnStock(commande));
          }}
        >
          📦 Tout ce qui est en stock
        </button>
        <button
          type="button"
          onClick={() => {
            setErreur(null);
            setQuantites(Object.fromEntries(commande.lignes.map((l) => [l.varianteId, "0"])));
          }}
        >
          Tout remettre à 0
        </button>
        <span className="sous-info">
          {articlesALivrer} article{articlesALivrer > 1 ? "s" : ""} · {formaterMontant(unitesALivrer)} unité
          {unitesALivrer > 1 ? "s" : ""} à livrer
        </span>
      </div>
      <div className="zone-tableau-scroll zone-lignes-commande" ref={grille.zone}>
        <table className="tableau-catalogue">
          <thead>
            <tr>
              <th>Article</th>
              <th>Reste à livrer</th>
              <th>Stock du dépôt</th>
              <th>À livrer maintenant</th>
              <th className="col-montant-commande">Prix</th>
              <th className="col-montant-commande">Montant</th>
            </tr>
          </thead>
          <tbody>
            {commande.lignes
              .filter((l) => l.quantite - l.quantiteLivree > 0)
              .map((l) => {
                const q = nombre(quantites[l.varianteId] ?? "");
                return (
                  <tr key={l.id}>
                    <td>{l.produitNom}</td>
                    <td>{formaterMontant(l.quantite - l.quantiteLivree)}</td>
                    <td className={l.stockDepot < l.quantite - l.quantiteLivree ? "texte-manque-stock" : undefined}>
                      {formaterMontant(l.stockDepot)}
                    </td>
                    <td>
                      <input
                        className="champ-quantite-commande"
                        type="number"
                        min={0}
                        step="any"
                        value={quantites[l.varianteId] ?? ""}
                        onChange={(e) => {
                          setErreur(null);
                          setQuantites({ ...quantites, [l.varianteId]: e.target.value });
                        }}
                      />
                    </td>
                    <td className="nowrap col-montant-commande">{formaterMontant(l.prixUnitaire)}</td>
                    <td className="nowrap col-montant-commande">
                      <strong>{formaterMontant(Math.round(q * l.prixUnitaire))}</strong>
                    </td>
                  </tr>
                );
              })}
            <LignesVides nombre={grille.nombre} surplus={grille.surplus} colonnes={6} />
          </tbody>
        </table>
      </div>
      {aConfirmer && (
        <ModaleConfirmation
          titre={`Livrer à ${commande.clientNom} ?`}
          labelConfirmer="Livrer"
          enCours={enCours}
          onAnnuler={() => setAConfirmer(null)}
          onConfirmer={livrer}
        >
          <ul className="resume-livraison">
            <li>
              📦 {articlesALivrer} article{articlesALivrer > 1 ? "s" : ""}, {formaterMontant(unitesALivrer)} unité
              {unitesALivrer > 1 ? "s" : ""}, depuis le dépôt {commande.depotNom}
            </li>
            <li>
              💰 Total : <strong>{formaterMontant(total)} {devise}</strong>
            </li>
            {montantCompte > 0 && (
              <li>
                👛 Payé avec son compte : {formaterMontant(montantCompte)} {devise}
              </li>
            )}
            {reste > 0 && (
              <li>
                Reste {formaterMontant(reste)} {devise} {libelleModeReste}
              </li>
            )}
          </ul>
        </ModaleConfirmation>
      )}
    </div>
  );
}

// --- Avance ---

function AvanceCommande({
  session,
  commandeId,
  onRetour,
  onVersee,
}: {
  session: Session;
  commandeId: string;
  onRetour: () => void;
  onVersee: (message: string) => void;
}) {
  const devise = useDevise();
  const [commande, setCommande] = useState<CommandeClientDetail | null>(null);
  const [montant, setMontant] = useState("");
  const [mode, setMode] = useState<ModeArgent>("especes");
  const [operateur, setOperateur] = useState("orange_money");
  const [erreur, setErreur] = useState<string | null>(null);
  const [enCours, setEnCours] = useState(false);

  useEffect(() => {
    donnees.obtenirCommande(commandeId).then((c) => setCommande(c ?? null));
  }, [commandeId]);

  if (!commande) return <p className="modale-corps">Chargement…</p>;

  async function verser() {
    if (!commande) return;
    setErreur(null);
    if (!(nombre(montant) > 0)) return setErreur("Indiquez le montant de l'avance.");
    setEnCours(true);
    try {
      await donnees.verserAvance(commande.id, {
        montant: nombre(montant),
        mode,
        operateur: mode === "mobile_money" ? operateur : "",
        depotId: commande.depotId,
        utilisateurId: session.utilisateurId,
      });
      onVersee(
        `✅ Avance de ${formaterMontant(nombre(montant))} ${devise} enregistrée sur le compte de ${commande.clientNom}. Elle servira à payer la livraison.`,
      );
    } catch (e) {
      setErreur(messageErreur(e));
    } finally {
      setEnCours(false);
    }
  }

  return (
    <>
      <div className="modale-entete entete-fixe">
        <h3>Avance sur la commande {commande.numero}</h3>
        <div className="actions-formulaire">
          <button type="button" className="bouton-primaire" onClick={verser} disabled={enCours}>
            {enCours ? "Enregistrement…" : "Enregistrer l'avance"}
          </button>
          <button type="button" className="lien bouton-retour" onClick={onRetour}>
            ← Retour
          </button>
        </div>
      </div>
      <div className="modale-corps">
        {erreur && <div className="message-erreur">{erreur}</div>}
        <p className="sous-info">
          L'avance va sur le porte-monnaie de {commande.clientNom} et paiera automatiquement la livraison. Si la commande est
          annulée, elle reste sur son compte et peut lui être rendue.
        </p>
        <div className="tuiles-fiche">
          <div className="tuile-fiche">
            <span className="sous-info">Total de la commande</span>
            <strong className="nowrap">
              {formaterMontant(commande.total)} {devise}
            </strong>
          </div>
          <div className="tuile-fiche">
            <span className="sous-info">Avance déjà versée</span>
            <strong className="nowrap">
              {formaterMontant(commande.avance)} {devise}
            </strong>
          </div>
        </div>
        <div className="ligne-champs-commande-client">
          <label>
            Montant
            <ChampMontant value={montant} onChange={setMontant} autoFocus />
          </label>
          <label>
            Reçu en
            <select value={mode} onChange={(e) => setMode(e.target.value as ModeArgent)}>
              <option value="especes">💵 Espèces (caisse du dépôt {commande.depotNom})</option>
              <option value="mobile_money">📱 Mobile Money</option>
              <option value="banque">🏦 Banque</option>
            </select>
          </label>
          {mode === "mobile_money" && (
            <label>
              Opérateur
              <select value={operateur} onChange={(e) => setOperateur(e.target.value)}>
                {OPERATEURS_MOBILE_MONEY.map((o) => (
                  <option key={o.valeur} value={o.valeur}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
      </div>
    </>
  );
}

// --- Bon de commande (impression, PDF, WhatsApp) ---

function ContenuBon({
  commande,
  boutique,
  logo,
  devise,
  session,
}: {
  commande: CommandeClientDetail;
  boutique: Boutique | null;
  logo: string;
  devise: string;
  session: Session;
}) {
  // Ce qui reste à livrer, moins ce que le client a déjà sur son compte (avances).
  const valeurLivree = commande.total - commande.resteALivrer;
  const resteAPayer = Math.max(0, commande.resteALivrer - commande.soldeCompteClient);
  return (
    <div className="facture-imprimable">
      <div className="facture-entete-boutique">
        {logo && <img src={logo} alt="" className="facture-logo" />}
        <div>
          <h2>
            {boutique?.nom ?? session.boutiqueNom}
            {(boutique?.adresse || boutique?.telephone) && (
              <span className="facture-coordonnees-boutique">
                {boutique?.adresse && ` · ${boutique.adresse}`}
                {boutique?.telephone && ` · ${boutique.telephone}`}
              </span>
            )}
          </h2>
        </div>
      </div>
      <h3>Bon de commande</h3>
      <div className="facture-meta">
        <div>
          <strong>N°</strong> {commande.numero}
          <br />
          <strong>Date</strong> {new Date(commande.dateCreation).toLocaleDateString("fr-FR")}
          <br />
          <strong>Livraison prévue</strong> {formaterJour(commande.dateLivraisonPrevue)}
        </div>
        <div>
          <strong>Client</strong> {commande.clientNom}
          {commande.clientTelephone && (
            <>
              <br />
              <strong>Téléphone</strong> {commande.clientTelephone}
            </>
          )}
        </div>
      </div>
      <table className="tableau-catalogue">
        <thead>
          <tr>
            <th>Article</th>
            <th>Qté</th>
            <th>Prix</th>
            <th>Montant</th>
          </tr>
        </thead>
        <tbody>
          {commande.lignes.map((l) => (
            <tr key={l.id}>
              <td>{l.produitNom}</td>
              <td>{formaterMontant(l.quantite)}</td>
              <td>{formaterMontant(l.prixUnitaire)}</td>
              <td>{formaterMontant(l.sousTotal)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="totaux facture-totaux">
        <div>
          Total : {formaterMontant(commande.total)} {devise}
        </div>
        {commande.avance > 0 && (
          <div>
            Avance versée : {formaterMontant(commande.avance)} {devise}
          </div>
        )}
        {valeurLivree > 0 && (
          <div>
            Déjà livré : {formaterMontant(valeurLivree)} {devise}
          </div>
        )}
        {estOuverte(commande.statut) && (
          <div className="total-net">
            Reste à payer à la livraison : {formaterMontant(resteAPayer)} {devise}
          </div>
        )}
      </div>
      {commande.note && <p className="note-aide">Note : {commande.note}</p>}
    </div>
  );
}

function BonDeCommande({ session, commandeId, onRetour }: { session: Session; commandeId: string; onRetour: () => void }) {
  const devise = useDevise();
  const logo = donnees.useLogo();
  const [commande, setCommande] = useState<CommandeClientDetail | null>(null);
  const [boutique, setBoutique] = useState<Boutique | null>(null);
  const [formatTicket, setFormatTicket] = useState("a4");
  const [messageExport, setMessageExport] = useState<string | null>(null);
  const [enExport, setEnExport] = useState(false);

  useEffect(() => {
    donnees.obtenirCommande(commandeId).then((c) => setCommande(c ?? null));
    donnees.boutique(session.boutiqueId).then((b) => setBoutique(b ?? null));
    donnees.formatTicket(session.boutiqueId).then(setFormatTicket);
  }, [commandeId, session.boutiqueId]);

  if (!commande) return <p className="modale-corps">Chargement…</p>;

  async function exporterPdf() {
    if (!commande) return;
    setEnExport(true);
    setMessageExport(null);
    try {
      const texte = await donnees.exporterPdf(`Bon-de-commande-${commande.numero}.pdf`);
      if (texte) setMessageExport(texte);
    } catch (e) {
      setMessageExport(messageErreur(e));
    } finally {
      setEnExport(false);
    }
  }

  function envoyerParWhatsapp() {
    if (!commande?.clientTelephone) return;
    const articles = commande.lignes.map((l) => `- ${formaterMontant(l.quantite)} × ${l.produitNom}`).join("\n");
    const message =
      `Bonjour ${commande.clientNom}, voici votre commande ${commande.numero} chez ${boutique?.nom ?? session.boutiqueNom} :\n` +
      `${articles}\nTotal : ${formaterMontant(commande.total)} ${devise}` +
      (commande.avance > 0 ? `\nAvance versée : ${formaterMontant(commande.avance)} ${devise}` : "") +
      (estOuverte(commande.statut)
        ? `\nReste à payer à la livraison : ${formaterMontant(Math.max(0, commande.resteALivrer - commande.soldeCompteClient))} ${devise}`
        : "") +
      (commande.dateLivraisonPrevue ? `\nLivraison prévue le ${formaterJour(commande.dateLivraisonPrevue)}.` : "") +
      "\nMerci !";
    donnees.ouvrirLien(`https://wa.me/${commande.clientTelephone.replace(/\D/g, "")}?text=${encodeURIComponent(message)}`);
  }

  return (
    <>
      <div className="modale-entete entete-fixe">
        <h3>Bon de commande {commande.numero}</h3>
        <div className="actions-formulaire">
          {commande.clientTelephone && (
            <button type="button" className="bouton-primaire" onClick={envoyerParWhatsapp}>
              Envoyer par WhatsApp
            </button>
          )}
          {donnees.pdfSepare && (
            <button type="button" className="bouton-primaire" onClick={exporterPdf} disabled={enExport}>
              {enExport ? "Export…" : "Exporter en PDF"}
            </button>
          )}
          <button type="button" className="bouton-primaire" onClick={() => window.print()}>
            {donnees.pdfSepare ? "Imprimer" : "Imprimer / PDF"}
          </button>
          <button type="button" className="lien bouton-retour" onClick={onRetour}>
            ← Retour
          </button>
        </div>
      </div>
      {messageExport && <p className="note-aide">{messageExport}</p>}
      <div className="modale-corps">
        <ContenuBon commande={commande} boutique={boutique} logo={logo} devise={devise} session={session} />
      </div>
      {createPortal(
        <div className={`zone-impression-facture format-ticket-${formatTicket}`}>
          <ContenuBon commande={commande} boutique={boutique} logo={logo} devise={devise} session={session} />
        </div>,
        document.body,
      )}
    </>
  );
}
