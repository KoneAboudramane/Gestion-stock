import { useEffect, useState } from "react";
import type { CSSProperties } from "react";

import { api } from "../api";
import type { Session, UtilisateurResume } from "../api";
import { useDevise } from "../contexts/DeviseContext";
import { formaterMontant } from "../lib/formatage";
import { libelleCanalMessage, libelleModePaiement, libelleStatutVente } from "../lib/libelles";
import { obtenirCredit, type CreditDetail } from "../services/clients";
import { envoyerMessage, genererRappelsCredit, listerMessages, type MessageResume, type StatutMessage } from "../services/messages";
import { listerDepotsDetail, type DepotResume } from "../services/stock";
import { obtenirVenteDetail, type VenteDetail } from "../services/ventes";

/**
 * Port de client-electron/src/pages/Messages.tsx : rappels de crédit, local
 * d'abord (IndexedDB, voir services/messages.ts). Le détail d'un crédit lié
 * et celui d'une vente liée se lisent tous deux localement désormais — les
 * deux référencent le même enregistrement, juste via des chemins différents.
 * La gestion des utilisateurs (filtre "Caissier") reste en ligne uniquement
 * (comptes.Utilisateur hors synchronisation, voir CLAUDE.md).
 *
 * Chaque section (En attente / Historique) est un bouton-carte qui ouvre sa
 * propre modale, même patron que Comptabilite.tsx/Rapports.tsx/Reglages.tsx.
 */
function libelleType(type: MessageResume["type"]): string {
  return type === "rappel_credit" ? "Rappel de crédit" : "Ticket WhatsApp";
}

function libelleStatut(statut: StatutMessage): string {
  if (statut === "envoyee") return "Envoyée";
  if (statut === "echouee") return "Échouée";
  return "En attente";
}

function DetailCreditLie({ creditId }: { creditId: string }) {
  const devise = useDevise();
  const [credit, setCredit] = useState<CreditDetail | null | undefined>(undefined);

  useEffect(() => {
    obtenirCredit(creditId).then((c) => setCredit(c ?? null));
  }, [creditId]);

  if (credit === undefined) return <p>Chargement du crédit…</p>;
  if (credit === null) return <p>Crédit introuvable (peut-être supprimé).</p>;

  return (
    <div className="totaux">
      <h3>Crédit lié</h3>
      <div>Client : {credit.clientNom}</div>
      <div>
        Montant : {formaterMontant(credit.montant)} {devise} · Payé : {formaterMontant(credit.montantPaye)} {devise}
      </div>
      <div className="total-net">
        Solde : {formaterMontant(credit.solde)} {devise}
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

  if (vente === undefined) return <p>Chargement de la vente…</p>;
  if (vente === null) return <p>Vente introuvable localement (pas encore synchronisée sur cet appareil ?).</p>;

  return (
    <div className="totaux">
      <h3>
        Vente {vente.numero} <span className={`badge-${vente.statut}`}>{libelleStatutVente(vente.statut)}</span>
      </h3>
      <ul className="liste-simple">
        {vente.lignes.map((l) => (
          <li key={l.id}>
            {l.produitNom} x{l.quantite} = {formaterMontant(l.sousTotal)} {devise}
          </li>
        ))}
      </ul>
      <div className="total-net">
        Total net : {formaterMontant(vente.totalNet)} {devise}
      </div>
      <ul className="liste-simple">
        {vente.paiements.map((p) => (
          <li key={p.id}>
            {libelleModePaiement(p.mode)} : {formaterMontant(p.montant)} {devise}
          </li>
        ))}
      </ul>
    </div>
  );
}

function DetailMessage({ message, onRetour, onEnvoye }: { message: MessageResume; onRetour: () => void; onEnvoye: () => void }) {
  const [enCours, setEnCours] = useState(false);

  async function envoyer() {
    setEnCours(true);
    try {
      if (message.canal === "whatsapp" && message.destinataire) {
        const numero = message.destinataire.replace(/\D/g, "");
        window.open(`https://wa.me/${numero}?text=${encodeURIComponent(message.message)}`, "_blank", "noopener");
      }
      await envoyerMessage(message.id);
      onEnvoye();
    } finally {
      setEnCours(false);
    }
  }

  return (
    <div className="detail-produit">
      <div className="entete-detail">
        <h3>{libelleType(message.type)}</h3>
        <button type="button" className="lien bouton-retour" onClick={onRetour}>
          ← Retour à la liste
        </button>
      </div>
      <p>
        {message.depotNom ?? "Dépôt inconnu"} · {new Date(message.dateCreation).toLocaleString("fr-FR")}
      </p>
      <p>
        Canal : {libelleCanalMessage(message.canal)} · Destinataire : {message.destinataire || "aucun"} · Statut :{" "}
        <span className={message.statut === "envoyee" ? "badge-payee" : "badge-credit"}>{libelleStatut(message.statut)}</span>
      </p>
      <p>{message.message}</p>
      {message.statut === "en_attente" && (
        <button type="button" onClick={envoyer} disabled={enCours}>
          {enCours ? "Envoi…" : "Envoyer"}
        </button>
      )}

      {message.referenceType === "clients.Credit" && message.referenceId && <DetailCreditLie creditId={message.referenceId} />}
      {message.referenceType === "ventes.Vente" && message.referenceId && <DetailVenteLiee venteId={message.referenceId} />}
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

function ModaleMessages({
  session, statut, titre, onFermer,
}: { session: Session; statut: "enAttente" | "historique"; titre: string; onFermer: () => void }) {
  const [messagesListe, setMessagesListe] = useState<MessageResume[]>([]);
  const [depots, setDepots] = useState<DepotResume[]>([]);
  const [utilisateurs, setUtilisateurs] = useState<UtilisateurResume[]>([]);
  const [filtreDepotId, setFiltreDepotId] = useState("");
  const [filtreUtilisateurId, setFiltreUtilisateurId] = useState("");
  const [messageSelectionneId, setMessageSelectionneId] = useState<string | null>(null);

  const verrouilleSurDepot = Boolean(session.depotId);
  const depotIdEffectif = verrouilleSurDepot ? (session.depotId ?? undefined) : filtreDepotId || undefined;
  const utilisateurIdEffectif = verrouilleSurDepot ? undefined : filtreUtilisateurId || undefined;

  const nomsUtilisateurs = new Map(utilisateurs.map((u) => [String(u.id), `${u.first_name} ${u.last_name}`.trim() || u.username]));

  async function rafraichir() {
    setMessagesListe(await listerMessages(session.boutiqueId, { depotId: depotIdEffectif, utilisateurId: utilisateurIdEffectif }));
  }

  useEffect(() => {
    if (verrouilleSurDepot) return;
    listerDepotsDetail(session.boutiqueId).then(setDepots);
    api.comptes.listerUtilisateurs().then((r) => r.succes && setUtilisateurs(r.resultat));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [verrouilleSurDepot]);

  // Les rappels de crédit se détectent à chaque ouverture de la modale, comme
  // les alertes de rupture — les tickets WhatsApp naissent, eux, à la vente.
  useEffect(() => {
    (async () => {
      await genererRappelsCredit(session.boutiqueId);
      await rafraichir();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [depotIdEffectif, utilisateurIdEffectif]);

  const messagesAffiches = messagesListe.filter((m) => (statut === "enAttente" ? m.statut === "en_attente" : m.statut !== "en_attente"));
  const messageSelectionne = messagesListe.find((m) => m.id === messageSelectionneId);

  return (
    <div className="fond-modale" onClick={onFermer}>
      <div className="modale-selection-produits" onClick={(e) => e.stopPropagation()}>
        <EnteteModale titre={titre} onFermer={onFermer} />
        <div className="modale-corps">
          {messageSelectionne ? (
            <DetailMessage
              message={messageSelectionne}
              onRetour={() => setMessageSelectionneId(null)}
              onEnvoye={rafraichir}
            />
          ) : (
            <>
              {!verrouilleSurDepot && (
                <div className="barre-actions">
                  <select value={filtreDepotId} onChange={(e) => setFiltreDepotId(e.target.value)}>
                    <option value="">Tous les dépôts</option>
                    {depots.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.nom}
                      </option>
                    ))}
                  </select>
                  <select value={filtreUtilisateurId} onChange={(e) => setFiltreUtilisateurId(e.target.value)}>
                    <option value="">Tous les caissiers</option>
                    {utilisateurs.map((u) => (
                      <option key={u.id} value={String(u.id)}>
                        {`${u.first_name} ${u.last_name}`.trim() || u.username}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              <div className="zone-tableau-scroll">
                <table className="tableau-catalogue">
                  <thead>
                    <tr>
                      <th>N°</th>
                      <th>Date</th>
                      <th>Type</th>
                      <th>Dépôt</th>
                      <th>Caissier</th>
                      <th>Canal</th>
                      <th>Destinataire</th>
                      <th>Statut</th>
                    </tr>
                  </thead>
                  <tbody>
                    {messagesAffiches.map((m, index) => (
                      <tr key={m.id} onClick={() => setMessageSelectionneId(m.id)}>
                        <td>{index + 1}</td>
                        <td>{new Date(m.dateCreation).toLocaleString("fr-FR")}</td>
                        <td>{libelleType(m.type)}</td>
                        <td>{m.depotNom ?? ""}</td>
                        <td>{m.utilisateurId ? (nomsUtilisateurs.get(m.utilisateurId) ?? "inconnu") : "inconnu"}</td>
                        <td>{libelleCanalMessage(m.canal)}</td>
                        <td>{m.destinataire || ""}</td>
                        <td>
                          <span className={m.statut === "envoyee" ? "badge-payee" : "badge-credit"}>{libelleStatut(m.statut)}</span>
                        </td>
                      </tr>
                    ))}
                    {messagesAffiches.length === 0 && (
                      <tr>
                        <td colSpan={8} className="liste-vide">
                          {statut === "enAttente" ? "Aucun message en attente." : "Aucun message dans l'historique."}
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      </div>
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

export default function Messages({ session }: { session: Session }) {
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
          onFermer={() => setSectionOuverte(null)}
        />
      )}
    </div>
  );
}
