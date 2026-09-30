import { useEffect, useMemo, useState } from "react";

//<adaptateur>
import type { Session } from "../api";
import type { ColonneExport } from "../lib/export";
import { listerCredits, rembourserCredit } from "../services/clients";
import { listerDettes, payerDette } from "../services/achats";
import {
  compteClient,
  compteFournisseur,
  deposerSurCompteClient,
  remboursementFournisseur,
  rendreDuCompteClient,
  verserAvanceFournisseur,
  type CompteTiers,
  type ModeArgent,
  type OperationCompte,
} from "../services/comptesTiers";
import { listerDepotsDetail } from "../services/stock";

const donnees = {
  compte: (genre: GenreTiers, id: string): Promise<CompteTiers> =>
    genre === "client" ? compteClient(id) : compteFournisseur(id),
  /** Entrée sur le compte : dépôt du client / avance versée au fournisseur. */
  entree: (genre: GenreTiers, id: string, op: OperationCompte): Promise<CompteTiers> =>
    genre === "client" ? deposerSurCompteClient(id, op) : verserAvanceFournisseur(id, op),
  /** Sortie du compte : argent rendu au client / remboursé par le fournisseur. */
  sortie: (genre: GenreTiers, id: string, op: OperationCompte): Promise<CompteTiers> =>
    genre === "client" ? rendreDuCompteClient(id, op) : remboursementFournisseur(id, op),
  depots: async (boutiqueId: string): Promise<{ id: string; nom: string }[]> => listerDepotsDetail(boutiqueId),
  /** Crédits (client) ou dettes (fournisseur) encore ouverts. */
  ouverts: async (genre: GenreTiers, boutiqueId: string, id: string): Promise<DuOuvert[]> =>
    genre === "client"
      ? (await listerCredits(boutiqueId, id, "en_cours")).map((c) => ({
          id: c.id,
          libelle: c.venteNumero ?? "Crédit",
          date: c.dateCreation,
          solde: c.solde,
        }))
      : (await listerDettes(boutiqueId, id, "en_cours")).map((d) => ({
          id: d.id,
          libelle: d.commandeNumero ?? "Dette",
          date: d.dateCreation,
          solde: d.solde,
        })),
  regler: async (genre: GenreTiers, duId: string, montant: number, utilisateurId: string | null): Promise<void> => {
    if (genre === "client") await rembourserCredit(duId, montant, "compte_client", null, utilisateurId);
    else await payerDette(duId, montant, "compte_fournisseur", null, utilisateurId);
  },
  ouvrirLien: (url: string) => {
    window.open(url, "_blank", "noopener");
  },
};
//</adaptateur>
import BoutonsExport from "./BoutonsExport";
import ChampMontant from "./ChampMontant";
import FiltrePeriodeHistorique from "./FiltrePeriodeHistorique";
import { useDevise } from "../contexts/DeviseContext";
import { useNomsUtilisateurs } from "../hooks/useNomsUtilisateurs";
import { formaterMontant } from "../lib/formatage";
import { OPERATEURS_MOBILE_MONEY, libelleOperateurMobileMoney } from "../lib/libelles";
import { bornesPeriode, dansPeriode, type PeriodeHistorique } from "../lib/periode";

export type GenreTiers = "client" | "fournisseur";

interface DuOuvert {
  id: string;
  libelle: string;
  date: string;
  solde: number;
}

const LIBELLES_OPERATION: Record<GenreTiers, Record<string, string>> = {
  client: {
    depot: "⬇️ Dépôt",
    utilisation: "🛒 Utilisé",
    rendu: "↩️ Argent rendu",
    annulation: "↺ Remis sur le compte",
  },
  fournisseur: {
    avance: "⬆️ Avance versée",
    avoir: "📦 Avoir (retour)",
    utilisation: "🧾 Utilisé",
    remboursement: "↩️ Remboursé",
    annulation: "↺ Remis sur le compte",
  },
};

const LIBELLES_MODE_ARGENT: Record<ModeArgent, string> = {
  especes: "Espèces",
  mobile_money: "Mobile Money",
  banque: "Banque",
};

function libelleMode(mode: string, operateur: string): string {
  if (!mode) return "—";
  if (mode === "mobile_money") return operateur ? libelleOperateurMobileMoney(operateur) : "Mobile Money";
  return LIBELLES_MODE_ARGENT[mode as ModeArgent] ?? mode;
}

function messageDe(erreur: unknown): string {
  return erreur instanceof Error ? erreur.message : "Erreur inattendue.";
}

type Formulaire = "entree" | "sortie" | "regler" | null;

/**
 * Onglet « 📄 Compte » d'une fiche client ou fournisseur : ce qu'il a chez
 * nous (client : argent laissé d'avance) ou ce qu'il nous doit (fournisseur :
 * avances, avoirs), relevé avec solde courant, opérations, export et WhatsApp.
 */
export function PanneauCompte({
  genre,
  tiersId,
  tiersNom,
  telephone,
  session,
  classeZone = "zone-tableau-scroll-client",
  onModifie,
}: {
  genre: GenreTiers;
  tiersId: string;
  tiersNom: string;
  telephone: string;
  session: Session;
  /** Classe de hauteur fixe de la zone du tableau, celle des autres onglets de la fiche. */
  classeZone?: string;
  /** Après une opération (les chiffres de la fiche peuvent avoir changé). */
  onModifie?: () => void;
}) {
  const devise = useDevise();
  const nomUtilisateur = useNomsUtilisateurs(session);
  const [compte, setCompte] = useState<CompteTiers | null>(null);
  const [ouverts, setOuverts] = useState<DuOuvert[]>([]);
  const [periode, setPeriode] = useState<PeriodeHistorique>("tout");
  const [debutPerso, setDebutPerso] = useState("");
  const [finPerso, setFinPerso] = useState("");
  const [formulaire, setFormulaire] = useState<Formulaire>(null);

  const client = genre === "client";
  const peutEntree = client ? !!session.permissions.gerer_clients : !!session.permissions.gerer_produits_stock_achats;
  const peutSortie = client ? !!session.permissions.gerer_tresorerie : !!session.permissions.gerer_produits_stock_achats;
  const peutRegler = peutEntree;

  async function rafraichir() {
    setCompte(await donnees.compte(genre, tiersId));
    setOuverts(await donnees.ouverts(genre, session.boutiqueId, tiersId));
  }
  useEffect(() => {
    rafraichir();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [genre, tiersId]);

  // Solde courant après chaque opération (ordre chronologique), puis la période, du plus récent au plus ancien.
  const lignes = useMemo(() => {
    let courant = 0;
    const toutes = (compte?.mouvements ?? []).map((m) => {
      courant += m.montant;
      return { ...m, soldeApres: courant };
    });
    const bornes = bornesPeriode(periode, debutPerso, finPerso);
    return toutes.filter((m) => dansPeriode(m.dateCreation, bornes)).reverse();
  }, [compte, periode, debutPerso, finPerso]);

  const solde = compte?.solde ?? 0;
  const entrees = lignes.reduce((t, m) => t + Math.max(0, m.montant), 0);
  const sorties = lignes.reduce((t, m) => t + Math.max(0, -m.montant), 0);
  const detteOuverte = ouverts.reduce((t, d) => t + d.solde, 0);

  function detail(m: (typeof lignes)[number]): string {
    // Le motif reprend souvent le numéro (« Vente VTE-… ») : on ne le répète pas.
    const numeros = [m.venteNumero, m.commandeNumero].filter(Boolean) as string[];
    const motifUtile = m.motif && !numeros.some((n) => m.motif.includes(n)) ? m.motif : "";
    const numeroMotif = numeros.length && m.motif && !motifUtile ? m.motif : numeros.join(" · ");
    return [numeroMotif, motifUtile].filter(Boolean).join(" · ");
  }

  const libelleSolde = client ? "Sur son compte" : "À notre crédit chez lui";
  const colonnesExport: ColonneExport[] = [
    { cle: "date", libelle: "Date" },
    { cle: "operation", libelle: "Opération" },
    { cle: "detail", libelle: "Détail" },
    { cle: "mode", libelle: "Mode" },
    { cle: "entree", libelle: `Entrée (${devise})` },
    { cle: "sortie", libelle: `Sortie (${devise})` },
    { cle: "solde", libelle: `Solde (${devise})` },
  ];
  const lignesExport = lignes.map((m) => ({
    date: new Date(m.dateCreation).toLocaleString("fr-FR"),
    operation: (LIBELLES_OPERATION[genre][m.type] ?? m.type).replace(/^\S+\s/, ""),
    detail: detail(m),
    mode: libelleMode(m.mode, m.operateur),
    entree: m.montant > 0 ? m.montant : "",
    sortie: m.montant < 0 ? -m.montant : "",
    solde: m.soldeApres,
  }));

  function envoyerWhatsApp() {
    const numero = telephone.replace(/\D/g, "");
    if (!numero || !compte) return;
    const dernieres = [...compte.mouvements].reverse().slice(0, 10);
    const texte = [
      `Bonjour ${tiersNom},`,
      client
        ? `Voici le relevé de votre compte chez ${session.boutiqueNom}.`
        : `Voici l'état de notre compte chez vous (${session.boutiqueNom}).`,
      "",
      client
        ? `Solde disponible : ${formaterMontant(solde)} ${devise}`
        : `Montant à notre crédit : ${formaterMontant(solde)} ${devise}`,
      ...(dernieres.length
        ? [
            "",
            "Dernières opérations :",
            ...dernieres.map(
              (m) =>
                `• ${new Date(m.dateCreation).toLocaleDateString("fr-FR")} — ` +
                `${(LIBELLES_OPERATION[genre][m.type] ?? m.type).replace(/^\S+\s/, "")} ` +
                `${m.montant > 0 ? "+" : "−"}${formaterMontant(Math.abs(m.montant))} ${devise}`,
            ),
          ]
        : []),
      "",
      "Merci.",
    ].join("\n");
    donnees.ouvrirLien(`https://wa.me/${numero}?text=${encodeURIComponent(texte)}`);
  }

  return (
    <>
      <div className="barre-compte-tiers">
        <div className="solde-compte-tiers">
          <span className="sous-info">👛 {libelleSolde}</span>
          <strong className="nowrap">
            {formaterMontant(solde)} {devise}
          </strong>
          {detteOuverte > 0 && (
            <span className="sous-info">
              {client ? "Crédit dû" : "Nous lui devons"} : {formaterMontant(detteOuverte)} {devise}
            </span>
          )}
        </div>
        <span className="actions-ligne">
          {peutEntree && (
            <button type="button" className="bouton-primaire" onClick={() => setFormulaire("entree")}>
              {client ? "⬇️ Déposer" : "⬆️ Verser une avance"}
            </button>
          )}
          {peutSortie && (
            <button type="button" onClick={() => setFormulaire("sortie")} disabled={solde <= 0}>
              {client ? "↩️ Rendre" : "↩️ Remboursement reçu"}
            </button>
          )}
          {peutRegler && solde > 0 && detteOuverte > 0 && (
            <button type="button" onClick={() => setFormulaire("regler")}>
              {client ? "💳 Régler un crédit avec le compte" : "💰 Régler une dette avec le compte"}
            </button>
          )}
        </span>
      </div>

      <div className="barre-actions barre-filtres-historique">
        <FiltrePeriodeHistorique
          periode={periode}
          setPeriode={setPeriode}
          debutPerso={debutPerso}
          setDebutPerso={setDebutPerso}
          finPerso={finPerso}
          setFinPerso={setFinPerso}
        />
        <span className="sous-info nowrap">
          Entrées <span className="montant-entree">+{formaterMontant(entrees)}</span> · Sorties{" "}
          <span className="montant-sortie">−{formaterMontant(sorties)}</span> {devise}
        </span>
        {telephone && (
          <button type="button" onClick={envoyerWhatsApp} title="Envoyer le solde et les dernières opérations">
            📲 Relevé WhatsApp
          </button>
        )}
        <BoutonsExport titre={`Compte — ${tiersNom}`} colonnes={colonnesExport} lignes={lignesExport} compact />
      </div>

      <div className={`zone-tableau-scroll ${classeZone}`}>
        <table className="tableau-catalogue tableau-grille-journee">
          <thead>
            <tr>
              <th>Date</th>
              <th>Opération</th>
              <th>Détail</th>
              <th>Mode</th>
              <th>Entrée</th>
              <th>Sortie</th>
              <th>Solde</th>
            </tr>
          </thead>
          <tbody>
            {lignes.map((m) => (
              <tr key={m.id} title={m.utilisateurId ? `Par ${nomUtilisateur(m.utilisateurId)}` : undefined}>
                <td className="nowrap" title={new Date(m.dateCreation).toLocaleString("fr-FR")}>
                  {new Date(m.dateCreation).toLocaleDateString("fr-FR")}
                </td>
                <td className="nowrap">{LIBELLES_OPERATION[genre][m.type] ?? m.type}</td>
                <td>{detail(m)}</td>
                <td className="nowrap">{libelleMode(m.mode, m.operateur)}</td>
                <td className="nowrap montant-entree">{m.montant > 0 ? `+${formaterMontant(m.montant)}` : ""}</td>
                <td className="nowrap montant-sortie">{m.montant < 0 ? `−${formaterMontant(-m.montant)}` : ""}</td>
                <td className="nowrap">
                  <strong>
                    {formaterMontant(m.soldeApres)} {devise}
                  </strong>
                </td>
              </tr>
            ))}
            {lignes.length === 0 && (
              <tr>
                <td colSpan={7} className="liste-vide">
                  {compte && compte.mouvements.length > 0
                    ? "Aucune opération sur cette période."
                    : client
                      ? "Aucune opération : le client n'a encore rien déposé."
                      : "Aucune opération : ni avance, ni avoir chez ce fournisseur."}
                </td>
              </tr>
            )}
            {Array.from({ length: Math.max(0, 10 - Math.max(1, lignes.length)) }).map((_, i) => (
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

      {(formulaire === "entree" || formulaire === "sortie") && (
        <FormulaireOperation
          genre={genre}
          sens={formulaire}
          tiersId={tiersId}
          tiersNom={tiersNom}
          solde={solde}
          session={session}
          onFermer={() => setFormulaire(null)}
          onFait={(c) => {
            setCompte(c);
            setFormulaire(null);
            onModifie?.();
          }}
        />
      )}
      {formulaire === "regler" && (
        <FormulaireReglement
          genre={genre}
          tiersNom={tiersNom}
          solde={solde}
          ouverts={ouverts}
          session={session}
          onFermer={() => setFormulaire(null)}
          onFait={async () => {
            setFormulaire(null);
            await rafraichir();
            onModifie?.();
          }}
        />
      )}
    </>
  );
}

function FormulaireOperation({
  genre,
  sens,
  tiersId,
  tiersNom,
  solde,
  session,
  onFermer,
  onFait,
}: {
  genre: GenreTiers;
  sens: "entree" | "sortie";
  tiersId: string;
  tiersNom: string;
  solde: number;
  session: Session;
  onFermer: () => void;
  onFait: (compte: CompteTiers) => void;
}) {
  const devise = useDevise();
  const [montant, setMontant] = useState("");
  const [mode, setMode] = useState<ModeArgent>("especes");
  const [operateur, setOperateur] = useState<string>(OPERATEURS_MOBILE_MONEY[0].valeur);
  const [depots, setDepots] = useState<{ id: string; nom: string }[]>([]);
  const [depotId, setDepotId] = useState(session.depotId ?? "");
  const [motif, setMotif] = useState("");
  const [erreur, setErreur] = useState<string | null>(null);
  const [enCours, setEnCours] = useState(false);

  useEffect(() => {
    if (!session.depotId) {
      donnees.depots(session.boutiqueId).then((d) => {
        setDepots(d);
        if (d.length === 1) setDepotId(d[0].id);
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const client = genre === "client";
  const titre =
    sens === "entree"
      ? client
        ? `⬇️ Dépôt sur le compte de ${tiersNom}`
        : `⬆️ Avance versée à ${tiersNom}`
      : client
        ? `↩️ Rendre de l'argent à ${tiersNom}`
        : `↩️ ${tiersNom} nous rembourse`;
  const aide =
    sens === "entree"
      ? client
        ? "L'argent que le client laisse d'avance. Il pourra l'utiliser en caisse ou pour régler un crédit."
        : "L'argent versé d'avance au fournisseur. Il servira à payer une réception ou une dette."
      : client
        ? "L'argent sort du compte du client et lui est rendu."
        : "Le fournisseur nous rend de l'argent (avance ou avoir non utilisés)."
  const valeur = Number(montant) || 0;

  async function valider(evenement: React.FormEvent) {
    evenement.preventDefault();
    setErreur(null);
    setEnCours(true);
    try {
      const op: OperationCompte = {
        montant: valeur,
        mode,
        operateur: mode === "mobile_money" ? operateur : "",
        depotId: mode === "especes" ? depotId || null : null,
        utilisateurId: session.utilisateurId,
        motif,
      };
      onFait(await (sens === "entree" ? donnees.entree(genre, tiersId, op) : donnees.sortie(genre, tiersId, op)));
    } catch (e) {
      setErreur(messageDe(e));
    } finally {
      setEnCours(false);
    }
  }

  return (
    <div
      className="fond-modale"
      onClick={(e) => {
        e.stopPropagation();
        onFermer();
      }}
    >
      <form className="modale-confirmation" onClick={(e) => e.stopPropagation()} onSubmit={valider}>
        <h3>{titre}</h3>
        <p className="note-aide">{aide}</p>
        {sens === "sortie" && (
          <p className="sous-info">
            Disponible : <strong>{formaterMontant(solde)} {devise}</strong>
          </p>
        )}
        <div className="ligne-champs-fiche">
          <ChampMontant placeholder="Montant" value={montant} onChange={setMontant} autoFocus />
          {sens === "sortie" && (
            <button type="button" onClick={() => setMontant(String(solde))}>
              Tout
            </button>
          )}
        </div>
        <div className="ligne-champs-fiche">
          <select value={mode} onChange={(e) => setMode(e.target.value as ModeArgent)}>
            <option value="especes">Espèces (caisse)</option>
            <option value="mobile_money">Mobile Money</option>
            <option value="banque">Banque</option>
          </select>
          {mode === "mobile_money" && (
            <select value={operateur} onChange={(e) => setOperateur(e.target.value)}>
              {OPERATEURS_MOBILE_MONEY.map((o) => (
                <option key={o.valeur} value={o.valeur}>
                  {o.label}
                </option>
              ))}
            </select>
          )}
          {mode === "especes" && !session.depotId && (
            <select value={depotId} onChange={(e) => setDepotId(e.target.value)}>
              <option value="">Dépôt (caisse)…</option>
              {depots.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.nom}
                </option>
              ))}
            </select>
          )}
        </div>
        <input value={motif} onChange={(e) => setMotif(e.target.value)} placeholder="Motif (facultatif)" maxLength={255} />
        {erreur && <div className="message-erreur">{erreur}</div>}
        <div className="actions-formulaire">
          <button type="button" onClick={onFermer}>
            Annuler
          </button>
          <button
            type="submit"
            className="bouton-primaire"
            disabled={enCours || valeur <= 0 || (sens === "sortie" && valeur > solde) || (mode === "especes" && !depotId)}
          >
            {enCours ? "Enregistrement…" : "Valider"}
          </button>
        </div>
      </form>
    </div>
  );
}

function FormulaireReglement({
  genre,
  tiersNom,
  solde,
  ouverts,
  session,
  onFermer,
  onFait,
}: {
  genre: GenreTiers;
  tiersNom: string;
  solde: number;
  ouverts: DuOuvert[];
  session: Session;
  onFermer: () => void;
  onFait: () => void;
}) {
  const devise = useDevise();
  const tries = [...ouverts].sort((a, b) => a.date.localeCompare(b.date));
  const [duId, setDuId] = useState(tries[0]?.id ?? "");
  const du = tries.find((d) => d.id === duId);
  const [montant, setMontant] = useState(String(Math.min(solde, tries[0]?.solde ?? 0)));
  const [erreur, setErreur] = useState<string | null>(null);
  const [enCours, setEnCours] = useState(false);
  const client = genre === "client";
  const valeur = Number(montant) || 0;
  const maximum = Math.min(solde, du?.solde ?? 0);

  async function valider(evenement: React.FormEvent) {
    evenement.preventDefault();
    setErreur(null);
    setEnCours(true);
    try {
      await donnees.regler(genre, duId, valeur, session.utilisateurId);
      onFait();
    } catch (e) {
      setErreur(messageDe(e));
    } finally {
      setEnCours(false);
    }
  }

  return (
    <div
      className="fond-modale"
      onClick={(e) => {
        e.stopPropagation();
        onFermer();
      }}
    >
      <form className="modale-confirmation" onClick={(e) => e.stopPropagation()} onSubmit={valider}>
        <h3>{client ? `💳 Régler un crédit de ${tiersNom}` : `💰 Régler une dette envers ${tiersNom}`}</h3>
        <p className="sous-info">
          {client
            ? "L'argent du compte du client rembourse son crédit. Rien ne passe par la caisse."
            : "Ce que le fournisseur nous doit (avance, avoir) règle notre dette. Rien ne passe par la caisse."}
        </p>
        <p className="sous-info">
          Disponible sur le compte : <strong>{formaterMontant(solde)} {devise}</strong>
        </p>
        <select
          value={duId}
          onChange={(e) => {
            setDuId(e.target.value);
            const choisi = tries.find((d) => d.id === e.target.value);
            setMontant(String(Math.min(solde, choisi?.solde ?? 0)));
          }}
        >
          {tries.map((d) => (
            <option key={d.id} value={d.id}>
              {d.libelle} du {new Date(d.date).toLocaleDateString("fr-FR")} — reste {formaterMontant(d.solde)} {devise}
            </option>
          ))}
        </select>
        <div className="ligne-champs-fiche">
          <ChampMontant placeholder="Montant" value={montant} onChange={setMontant} />
          <button type="button" onClick={() => setMontant(String(maximum))}>
            Le maximum
          </button>
        </div>
        {erreur && <div className="message-erreur">{erreur}</div>}
        <div className="actions-formulaire">
          <button type="button" onClick={onFermer}>
            Annuler
          </button>
          <button type="submit" className="bouton-primaire" disabled={enCours || !duId || valeur <= 0 || valeur > maximum}>
            {enCours ? "Enregistrement…" : "Régler"}
          </button>
        </div>
      </form>
    </div>
  );
}
