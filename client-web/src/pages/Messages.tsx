import { useEffect, useState } from "react";
import type { CSSProperties } from "react";

import { api } from "../api";
import type { Session, UtilisateurResume } from "../api";
import FiltrePeriodeHistorique from "../components/FiltrePeriodeHistorique";
import { useDevise } from "../contexts/DeviseContext";
import { formaterMontant } from "../lib/formatage";
import { libelleModePaiement, libelleStatutVente } from "../lib/libelles";
import { bornesPeriode, dansPeriode, jourLocal, type PeriodeHistorique } from "../lib/periode";
import { obtenirCredit, type CreditDetail } from "../services/clients";
import {
  ErreurMessage,
  envoyerMessage,
  genererRappelsCredit,
  listerMessages,
  marquerMessageTraite,
  type MessageResume,
  type StatutMessage,
} from "../services/messages";
import { listerDepotsDetail, type DepotResume } from "../services/stock";
import { obtenirVenteDetail, type VenteDetail } from "../services/ventes";

/**
 * Port de client-electron/src/pages/Messages.tsx : rappels de crédit et
 * tickets WhatsApp, local d'abord (IndexedDB, voir services/messages.ts). La
 * liste des utilisateurs (filtre « Caissier ») reste en ligne uniquement
 * (comptes.Utilisateur hors synchronisation, voir CLAUDE.md).
 */

function libelleType(type: MessageResume["type"]): string {
  return type === "rappel_credit" ? "Rappel de crédit" : "Ticket WhatsApp";
}

function libelleStatut(message: MessageResume): string {
  if (message.statut === "envoyee") return message.canal === "interne" ? "Traité" : "Envoyé";
  if (message.statut === "echouee") return "Échec";
  return "En attente";
}

function classeStatut(statut: StatutMessage): string {
  return statut === "envoyee" ? "badge-payee" : statut === "echouee" ? "badge-annulee" : "badge-credit";
}

/** Numéro utilisable par WhatsApp : celui du message, sinon celui du client. */
function numeroWhatsapp(message: MessageResume): string {
  return (message.destinataire || message.clientTelephone || "").replace(/\D/g, "");
}

function ouvrirWhatsapp(numero: string, texte: string) {
  const url = `https://wa.me/${numero}?text=${encodeURIComponent(texte)}`;
  window.open(url, "_blank", "noopener");
}

function dateCourte(iso: string): string {
  return new Date(iso).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" });
}

function DetailCreditLie({ creditId }: { creditId: string }) {
  const devise = useDevise();
  const [credit, setCredit] = useState<CreditDetail | null | undefined>(undefined);

  useEffect(() => {
    obtenirCredit(creditId).then((c) => setCredit(c ?? null));
  }, [creditId]);

  if (credit === undefined) return <p className="sous-info">Chargement du crédit…</p>;
  if (credit === null) return <p className="sous-info">Crédit introuvable (peut-être supprimé).</p>;

  return (
    <div className="tuiles-fiche">
      <div className="tuile-fiche">
        <span className="sous-info">👤 Client</span>
        <strong>{credit.clientNom}</strong>
      </div>
      <div className="tuile-fiche">
        <span className="sous-info">💳 Montant du crédit</span>
        <strong className="nowrap">
          {formaterMontant(credit.montant)} {devise}
        </strong>
      </div>
      <div className="tuile-fiche">
        <span className="sous-info">✅ Déjà payé</span>
        <strong className="nowrap">
          {formaterMontant(credit.montantPaye)} {devise}
        </strong>
      </div>
      <div className={`tuile-fiche${credit.solde > 0 ? " tuile-fiche--alerte" : ""}`}>
        <span className="sous-info">💰 Reste dû</span>
        <strong className="nowrap">
          {formaterMontant(credit.solde)} {devise}
        </strong>
      </div>
    </div>
  );
}

function DetailVenteLiee({ venteId }: { venteId: string }) {
  const devise = useDevise();
  const [vente, setVente] = useState<VenteDetail | null | undefined>(undefined);

  useEffect(() => {
    obtenirVenteDetail(venteId).then((v) => setVente(v ?? null));
  }, [venteId]);

  if (vente === undefined) return <p className="sous-info">Chargement de la vente…</p>;
  if (vente === null) return <p className="sous-info">Vente introuvable (peut-être supprimée ou pas encore synchronisée).</p>;

  return (
    <div className="tuiles-fiche">
      <div className="tuile-fiche">
        <span className="sous-info">🧾 Vente</span>
        <strong>
          {vente.numero} <span className={`badge-${vente.statut}`}>{libelleStatutVente(vente.statut)}</span>
        </strong>
      </div>
      <div className="tuile-fiche">
        <span className="sous-info">📦 Articles</span>
        <strong>{vente.lignes.reduce((t, l) => t + l.quantite, 0)}</strong>
      </div>
      <div className="tuile-fiche">
        <span className="sous-info">💰 Total net</span>
        <strong className="nowrap">
          {formaterMontant(vente.totalNet)} {devise}
        </strong>
      </div>
      <div className="tuile-fiche">
        <span className="sous-info">💵 Paiement</span>
        <strong>{vente.paiements.map((p) => libelleModePaiement(p.mode)).join(", ") || "—"}</strong>
      </div>
    </div>
  );
}

function DetailMessage({
  message,
  onFermer,
  onEnvoye,
  onNaviguer,
}: {
  message: MessageResume;
  onFermer: () => void;
  onEnvoye: () => void;
  onNaviguer?: (cible: string) => void;
}) {
  const [texte, setTexte] = useState(message.message);
  const [numero, setNumero] = useState(message.destinataire || message.clientTelephone || "");
  const [erreur, setErreur] = useState<string | null>(null);
  const [enCours, setEnCours] = useState(false);
  const enAttente = message.statut === "en_attente";

  async function executer(action: () => Promise<boolean>) {
    setEnCours(true);
    setErreur(null);
    try {
      if (await action()) onEnvoye();
    } finally {
      setEnCours(false);
    }
  }

  async function envoyer(): Promise<boolean> {
    const chiffres = numero.replace(/\D/g, "");
    if (!chiffres) {
      setErreur("Ajoutez le numéro WhatsApp du client pour envoyer ce message.");
      return false;
    }
    ouvrirWhatsapp(chiffres, texte);
    try {
        await envoyerMessage(message.id, texte, numero || undefined);
      } catch (e) {
        setErreur(e instanceof ErreurMessage ? e.message : "Erreur inattendue.");
        return false;
      }
      return true;
  }

  async function traiter(): Promise<boolean> {
    const id = message.id;
    try {
        await marquerMessageTraite(id);
      } catch (e) {
        setErreur(e instanceof ErreurMessage ? e.message : "Erreur inattendue.");
        return false;
      }
      return true;
  }

  return (
    <div className="fond-modale" onClick={onFermer}>
      <div className="modale-selection-produits" onClick={(e) => e.stopPropagation()}>
        <EnteteModale titre={`${libelleType(message.type)}${message.clientNom ? ` · ${message.clientNom}` : ""}`} onFermer={onFermer} />
        <div className="modale-corps">
          <p className="sous-info">
            {dateCourte(message.dateCreation)} · {message.depotNom ?? "Tous les dépôts"} ·{" "}
            <span className={classeStatut(message.statut)}>{libelleStatut(message)}</span>
            {message.dateEnvoi && ` le ${dateCourte(message.dateEnvoi)}`}
          </p>
          {erreur && <div className="message-erreur">{erreur}</div>}
          {message.referenceType === "clients.Credit" && message.referenceId && <DetailCreditLie creditId={message.referenceId} />}
          {message.referenceType === "ventes.Vente" && message.referenceId && <DetailVenteLiee venteId={message.referenceId} />}
          <div className="zone-bulle-message">
            {enAttente ? (
              <textarea className="bulle-message bulle-message--edition" value={texte} onChange={(e) => setTexte(e.target.value)} rows={6} />
            ) : (
              <div className="bulle-message">{message.message}</div>
            )}
          </div>
          <div className="barre-actions">
            {enAttente && (
              <label className="champ-numero-message">
                📞
                <input value={numero} onChange={(e) => setNumero(e.target.value)} placeholder="Numéro WhatsApp du client" />
              </label>
            )}
            <span className="actions-ligne">
              {message.referenceType === "clients.Credit" && onNaviguer && (
                <button type="button" onClick={() => onNaviguer("clients:credits")}>
                  Ouvrir les crédits →
                </button>
              )}
              {enAttente && (
                <>
                  <button type="button" onClick={() => executer(traiter)} disabled={enCours}>
                    ✓ Marquer comme traité
                  </button>
                  <button type="button" className="bouton-primaire" onClick={() => executer(envoyer)} disabled={enCours}>
                    📲 Envoyer par WhatsApp
                  </button>
                </>
              )}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

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

// --- Modale (En attente / Historique) ---

export function ModaleMessages({
  session, statut, titre, onNaviguer, onFermer,
}: {
  session: Session;
  statut: "enAttente" | "historique";
  titre: string;
  onNaviguer?: (cible: string) => void;
  onFermer: () => void;
}) {
  const [messagesListe, setMessagesListe] = useState<MessageResume[]>([]);
  const [depots, setDepots] = useState<DepotResume[]>([]);
  const [utilisateurs, setUtilisateurs] = useState<UtilisateurResume[]>([]);
  const [filtreDepotId, setFiltreDepotId] = useState("");
  const [filtreUtilisateurId, setFiltreUtilisateurId] = useState("");
  const [filtreType, setFiltreType] = useState<"" | MessageResume["type"]>("");
  const [periode, setPeriode] = useState<PeriodeHistorique>("tout");
  const [debutPerso, setDebutPerso] = useState(jourLocal(new Date()));
  const [finPerso, setFinPerso] = useState(jourLocal(new Date()));
  const [terme, setTerme] = useState("");
  const [messageSelectionneId, setMessageSelectionneId] = useState<string | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);

  const verrouilleSurDepot = Boolean(session.depotId);
  const depotIdEffectif = verrouilleSurDepot ? (session.depotId ?? undefined) : filtreDepotId || undefined;
  const utilisateurIdEffectif = verrouilleSurDepot ? undefined : filtreUtilisateurId || undefined;

  const nomsUtilisateurs = new Map(
    utilisateurs.map((u) => [String(u.id), `${u.first_name} ${u.last_name}`.trim() || u.username]),
  );
  // Rappels et tickets automatiques : pas d'auteur humain.
  const auteur = (m: MessageResume) => (m.utilisateurId ? (nomsUtilisateurs.get(m.utilisateurId) ?? "Autre utilisateur") : "Système");

  async function rafraichir() {
    setMessagesListe(await listerMessages(session.boutiqueId, { depotId: depotIdEffectif, utilisateurId: utilisateurIdEffectif }));
  }

  useEffect(() => {
    if (verrouilleSurDepot) return;
    listerDepotsDetail(session.boutiqueId).then(setDepots);
    api.comptes.listerUtilisateurs().then((r) => r.succes && setUtilisateurs(r.resultat));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.boutiqueId, verrouilleSurDepot]);

  // Les rappels de crédit se détectent à chaque ouverture de la modale, comme
  // les alertes de rupture — les tickets WhatsApp naissent, eux, à la vente.
  useEffect(() => {
    (async () => {
      await genererRappelsCredit(session.boutiqueId);
      await rafraichir();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.boutiqueId, depotIdEffectif, utilisateurIdEffectif]);

  async function traiter(m: MessageResume) {
    setErreur(null);
    const id = m.id;
    const ok = await (async () => {
      try {
        await marquerMessageTraite(id);
      } catch (e) {
        setErreur(e instanceof ErreurMessage ? e.message : "Erreur inattendue.");
        return false;
      }
      return true;
    })();
    if (ok) await rafraichir();
  }

  async function envoyerDirect(m: MessageResume) {
    setErreur(null);
    const numero = numeroWhatsapp(m);
    if (!numero) {
      setMessageSelectionneId(m.id);
      return;
    }
    ouvrirWhatsapp(numero, m.message);
    const message = m;
    const texte = m.message;
    const ok = await (async () => {
      try {
        await envoyerMessage(message.id, texte, numero || undefined);
      } catch (e) {
        setErreur(e instanceof ErreurMessage ? e.message : "Erreur inattendue.");
        return false;
      }
      return true;
    })();
    if (ok) await rafraichir();
  }

  const cle = terme.trim().toLowerCase();
  const duStatut = messagesListe.filter((m) => (statut === "enAttente" ? m.statut === "en_attente" : m.statut !== "en_attente"));
  const messagesAffiches = duStatut.filter(
    (m) =>
      (!filtreType || m.type === filtreType) &&
      dansPeriode(m.dateCreation, bornesPeriode(periode, debutPerso, finPerso)) &&
      (!cle || m.message.toLowerCase().includes(cle) || (m.clientNom ?? "").toLowerCase().includes(cle)),
  );
  const messageSelectionne = messagesListe.find((m) => m.id === messageSelectionneId);
  const debutMois = jourLocal(new Date(new Date().getFullYear(), new Date().getMonth(), 1));
  const envoyesCeMois = messagesListe.filter((m) => m.statut === "envoyee" && (m.dateEnvoi ?? m.dateCreation).slice(0, 10) >= debutMois).length;

  return (
    <div className="fond-modale" onClick={onFermer}>
      <div className="modale-selection-produits" onClick={(e) => e.stopPropagation()}>
        <EnteteModale titre={titre} onFermer={onFermer} />
        <div className="modale-corps">
          <div className="tuiles-fiche">
            <div className={`tuile-fiche${messagesListe.some((m) => m.statut === "en_attente") ? " tuile-fiche--attention" : ""}`}>
              <span className="sous-info">⏳ En attente</span>
              <strong>{messagesListe.filter((m) => m.statut === "en_attente").length}</strong>
            </div>
            <div className="tuile-fiche">
              <span className="sous-info">💳 Rappels de crédit</span>
              <strong>{duStatut.filter((m) => m.type === "rappel_credit").length}</strong>
            </div>
            <div className="tuile-fiche">
              <span className="sous-info">🧾 Tickets WhatsApp</span>
              <strong>{duStatut.filter((m) => m.type === "ticket_whatsapp").length}</strong>
            </div>
            <div className="tuile-fiche">
              <span className="sous-info">📤 Envoyés ce mois</span>
              <strong>{envoyesCeMois}</strong>
            </div>
          </div>
          <div className="barre-actions barre-filtres-historique">
            <select value={filtreType} onChange={(e) => setFiltreType(e.target.value as typeof filtreType)}>
              <option value="">Tous les types</option>
              <option value="rappel_credit">Rappels de crédit</option>
              <option value="ticket_whatsapp">Tickets WhatsApp</option>
            </select>
            <FiltrePeriodeHistorique
              periode={periode}
              setPeriode={setPeriode}
              debutPerso={debutPerso}
              setDebutPerso={setDebutPerso}
              finPerso={finPerso}
              setFinPerso={setFinPerso}
            />
            {!verrouilleSurDepot && depots.length > 1 && (
              <select value={filtreDepotId} onChange={(e) => setFiltreDepotId(e.target.value)}>
                <option value="">Tous les dépôts</option>
                {depots.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.nom}
                  </option>
                ))}
              </select>
            )}
            {!verrouilleSurDepot && utilisateurs.length > 0 && (
              <select value={filtreUtilisateurId} onChange={(e) => setFiltreUtilisateurId(e.target.value)}>
                <option value="">Tous les caissiers</option>
                {utilisateurs.map((u) => (
                  <option key={u.id} value={String(u.id)}>
                    {`${u.first_name} ${u.last_name}`.trim() || u.username}
                  </option>
                ))}
              </select>
            )}
            <input type="search" placeholder="Client, message…" value={terme} onChange={(e) => setTerme(e.target.value)} />
          </div>
          {erreur && <div className="message-erreur">{erreur}</div>}
          <div className="zone-tableau-scroll zone-commandes-fiche">
            <table className="tableau-catalogue carte-mobile">
              <thead>
                <tr>
                  <th>Type</th>
                  <th>Client</th>
                  <th>Message</th>
                  <th>Téléphone</th>
                  <th>Date</th>
                  <th>{statut === "enAttente" ? "Actions" : "Statut"}</th>
                </tr>
              </thead>
              <tbody>
                {messagesAffiches.map((m) => (
                  <tr key={m.id} onClick={() => setMessageSelectionneId(m.id)} title="Ouvrir le message">
                    <td data-label="Type" className="nowrap">
                      {m.type === "rappel_credit" ? "💳" : "🧾"} {libelleType(m.type)}
                    </td>
                    <td data-label="Client">
                      {m.clientNom ?? "—"}
                      <br />
                      <span className="sous-info">par {auteur(m)}</span>
                    </td>
                    <td data-label="Message" className="apercu-message" title={m.message}>
                      {m.message}
                    </td>
                    <td data-label="Téléphone" className="nowrap">{m.destinataire || m.clientTelephone || "—"}</td>
                    <td data-label="Date" className="nowrap">{dateCourte(m.dateCreation)}</td>
                    <td data-label="Actions" className="nowrap" onClick={(e) => e.stopPropagation()}>
                      {m.statut === "en_attente" ? (
                        <span className="actions-ligne">
                          <button
                            type="button"
                            className="lien-icone"
                            title={numeroWhatsapp(m) ? "Envoyer par WhatsApp" : "Pas de numéro : ouvrir pour l'ajouter"}
                            onClick={() => envoyerDirect(m)}
                          >
                            📲
                          </button>
                          <button type="button" className="lien-icone" title="Marquer comme traité" onClick={() => traiter(m)}>
                            ✓
                          </button>
                        </span>
                      ) : (
                        <span className={classeStatut(m.statut)}>{libelleStatut(m)}</span>
                      )}
                    </td>
                  </tr>
                ))}
                {messagesAffiches.length === 0 && (
                  <tr>
                    <td colSpan={6} className="liste-vide">
                      {duStatut.length === 0
                        ? statut === "enAttente"
                          ? "Aucun message en attente 👍"
                          : "Aucun message dans l'historique."
                        : "Aucun message pour ces filtres."}
                    </td>
                  </tr>
                )}
                {Array.from({ length: Math.max(0, 10 - Math.max(1, messagesAffiches.length)) }).map((_, i) => (
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
      </div>
      {messageSelectionne && (
        <DetailMessage
          key={messageSelectionne.id}
          message={messageSelectionne}
          onFermer={() => setMessageSelectionneId(null)}
          onEnvoye={() => {
            setMessageSelectionneId(null);
            rafraichir();
          }}
          onNaviguer={onNaviguer}
        />
      )}
    </div>
  );
}

// --- Page principale ---

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
  { cle: "enAttente", label: "En attente", icone: "⏳" },
  { cle: "historique", label: "Historique", icone: "📜" },
] as const;

type SectionMessages = (typeof SECTIONS)[number]["cle"];

export default function Messages({ session, onNaviguer }: { session: Session; onNaviguer?: (cible: string) => void }) {
  const [sectionOuverte, setSectionOuverte] = useState<SectionMessages | null>(null);

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
      {sectionOuverte && (
        <ModaleMessages
          session={session}
          statut={sectionOuverte}
          titre={SECTIONS.find((s) => s.cle === sectionOuverte)!.label}
          onNaviguer={onNaviguer}
          onFermer={() => setSectionOuverte(null)}
        />
      )}
    </div>
  );
}
