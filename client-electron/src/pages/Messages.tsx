import { useEffect, useState } from "react";

import { api } from "../api/client";
import type {
  CreditDetail,
  Depot,
  MessageResume,
  Session,
  StatutMessage,
  UtilisateurResume,
  VenteDetail,
} from "../api/client";
import { useDevise } from "../contexts/DeviseContext";
import { formaterMontant } from "../lib/formatage";
import { libelleCanalMessage, libelleModePaiement, libelleStatutVente } from "../lib/libelles";

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
    api.credits.obtenir(creditId).then((c) => setCredit(c ?? null));
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
      {credit.echeance && <div>Échéance : {credit.echeance}</div>}
    </div>
  );
}

function DetailVenteLiee({ venteId }: { venteId: string }) {
  const devise = useDevise();
  const [vente, setVente] = useState<VenteDetail | null | undefined>(undefined);

  useEffect(() => {
    api.ventes.obtenir(venteId).then((v) => setVente(v ?? null));
  }, [venteId]);

  if (vente === undefined) return <p>Chargement de la vente…</p>;
  if (vente === null) return <p>Vente introuvable (peut-être supprimée).</p>;

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

function DetailMessage({
  message,
  onRetour,
  onEnvoye,
}: {
  message: MessageResume;
  onRetour: () => void;
  onEnvoye: () => void;
}) {
  const [enCours, setEnCours] = useState(false);

  async function envoyer() {
    setEnCours(true);
    try {
      if (message.canal === "whatsapp" && message.destinataire) {
        const numero = message.destinataire.replace(/\D/g, "");
        await api.systeme.ouvrirExterne(`https://wa.me/${numero}?text=${encodeURIComponent(message.message)}`);
      }
      await api.messages.envoyer(message.id);
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
        Canal : {libelleCanalMessage(message.canal)} · Destinataire : {message.destinataire || "—"} · Statut :{" "}
        <span className={message.statut === "envoyee" ? "badge-payee" : "badge-credit"}>
          {libelleStatut(message.statut)}
        </span>
      </p>
      <p>{message.message}</p>
      {message.statut === "en_attente" && (
        <button type="button" onClick={envoyer} disabled={enCours}>
          {enCours ? "Envoi…" : "Envoyer"}
        </button>
      )}

      {message.referenceType === "clients.Credit" && message.referenceId && (
        <DetailCreditLie creditId={message.referenceId} />
      )}
      {message.referenceType === "ventes.Vente" && message.referenceId && (
        <DetailVenteLiee venteId={message.referenceId} />
      )}
    </div>
  );
}

export default function Messages({ session }: { session: Session }) {
  const [onglet, setOnglet] = useState<"enAttente" | "historique">("enAttente");
  const [messagesListe, setMessagesListe] = useState<MessageResume[]>([]);
  const [depots, setDepots] = useState<Depot[]>([]);
  const [utilisateurs, setUtilisateurs] = useState<UtilisateurResume[]>([]);
  const [filtreDepotId, setFiltreDepotId] = useState("");
  const [filtreUtilisateurId, setFiltreUtilisateurId] = useState("");
  const [messageSelectionneId, setMessageSelectionneId] = useState<string | null>(null);

  const verrouilleSurDepot = Boolean(session.depotId);
  const depotIdEffectif = verrouilleSurDepot ? session.depotId! : filtreDepotId || undefined;
  const utilisateurIdEffectif = verrouilleSurDepot ? undefined : filtreUtilisateurId || undefined;

  const nomsUtilisateurs = new Map(
    utilisateurs.map((u) => [String(u.id), `${u.first_name} ${u.last_name}`.trim() || u.username]),
  );

  async function rafraichir() {
    setMessagesListe(
      await api.messages.lister(session.boutiqueId, {
        depotId: depotIdEffectif,
        utilisateurId: utilisateurIdEffectif,
      }),
    );
  }

  useEffect(() => {
    if (verrouilleSurDepot) return;
    api.catalogue.listerDepots(session.boutiqueId).then(setDepots);
    api.comptes.listerUtilisateurs(session).then((resultat) => {
      if (resultat.succes) setUtilisateurs(resultat.resultat);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.boutiqueId, verrouilleSurDepot]);

  // Les rappels de crédit se détectent à chaque ouverture de la page, comme
  // les alertes de rupture — les tickets WhatsApp naissent, eux, à la vente.
  useEffect(() => {
    (async () => {
      await api.messages.genererRappelsCredit(session.boutiqueId);
      await rafraichir();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.boutiqueId, depotIdEffectif, utilisateurIdEffectif]);

  const messagesAffiches = messagesListe.filter((m) =>
    onglet === "enAttente" ? m.statut === "en_attente" : m.statut !== "en_attente",
  );

  const messageSelectionne = messagesListe.find((m) => m.id === messageSelectionneId);
  if (messageSelectionne) {
    return (
      <div className="page-produits">
        <DetailMessage
          message={messageSelectionne}
          onRetour={() => setMessageSelectionneId(null)}
          onEnvoye={rafraichir}
        />
      </div>
    );
  }

  return (
    <div className="page-produits">
      <div className="barre-actions barre-actions-avec-onglets">
        <div className="barre-onglets">
          <button
            type="button"
            className={`onglet ${onglet === "enAttente" ? "actif" : ""}`}
            onClick={() => setOnglet("enAttente")}
          >
            En attente
          </button>
          <button
            type="button"
            className={`onglet ${onglet === "historique" ? "actif" : ""}`}
            onClick={() => setOnglet("historique")}
          >
            Historique
          </button>
        </div>
        {!verrouilleSurDepot && (
          <>
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
          </>
        )}
      </div>
      <div className="zone-tableau-scroll">
      <table className="tableau-catalogue">
        <thead>
          <tr>
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
          {messagesAffiches.map((m) => (
            <tr key={m.id} onClick={() => setMessageSelectionneId(m.id)}>
              <td>{new Date(m.dateCreation).toLocaleString("fr-FR")}</td>
              <td>{libelleType(m.type)}</td>
              <td>{m.depotNom ?? ""}</td>
              <td>{m.utilisateurId ? nomsUtilisateurs.get(m.utilisateurId) ?? "—" : "—"}</td>
              <td>{libelleCanalMessage(m.canal)}</td>
              <td>{m.destinataire || ""}</td>
              <td>
                <span className={m.statut === "envoyee" ? "badge-payee" : "badge-credit"}>
                  {libelleStatut(m.statut)}
                </span>
              </td>
            </tr>
          ))}
          {messagesAffiches.length === 0 && (
            <tr>
              <td colSpan={7} className="liste-vide">
                {onglet === "enAttente" ? "Aucun message en attente." : "Aucun message dans l'historique."}
              </td>
            </tr>
          )}
          {messagesAffiches.length > 0 &&
            Array.from({ length: Math.max(0, 10 - messagesAffiches.length) }).map((_, i) => (
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
  );
}
