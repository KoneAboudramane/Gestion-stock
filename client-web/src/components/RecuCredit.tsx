import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

import { api } from "../api";
import type { Session } from "../api/auth";
import { useDevise } from "../contexts/DeviseContext";
import { formaterMontant } from "../lib/formatage";
import { libelleModeReglement } from "../lib/libelles";
import { obtenirBoutiqueLocale } from "../services/boutique";
import { listerParametres } from "../services/configuration";
import { obtenirClient, obtenirCredit, type CreditDetail, type PaiementCreditDetail } from "../services/clients";
import type { BoutiqueLocale } from "../db/schema";

/** Port navigateur de client-electron/src/components/RecuCredit.tsx. */

/**
 * Solde restant juste après ce règlement précis (pas forcément le dernier :
 * on peut rouvrir le reçu d'un règlement plus ancien depuis le tableau des
 * règlements) — credit.solde ne reflète que l'état courant du crédit.
 */
function soldeApresPaiement(credit: CreditDetail, paiementId: string): number {
  const parDate = [...credit.paiements].sort((a, b) => a.dateCreation.localeCompare(b.dateCreation));
  let cumule = 0;
  for (const p of parDate) {
    cumule += p.montant;
    if (p.id === paiementId) break;
  }
  return Math.max(0, credit.montant - cumule);
}

function ContenuRecu({
  credit,
  paiement,
  boutique,
  devise,
  session,
  encaissePar,
}: {
  credit: CreditDetail;
  paiement: PaiementCreditDetail;
  boutique: BoutiqueLocale | null;
  devise: string;
  session: Session;
  encaissePar: string;
}) {
  return (
    <div className="facture-imprimable">
      <div className="facture-entete-boutique">
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

      <h3>Reçu de paiement — Crédit</h3>

      <div className="facture-meta">
        <div>
          <strong>Reçu N°</strong> {paiement.id.slice(0, 8).toUpperCase()}
          <br />
          <strong>Date</strong> {new Date(paiement.dateCreation).toLocaleString("fr-FR")}
        </div>
        <div>
          <strong>Client</strong> {credit.clientNom}
          <br />
          <strong>Encaissé par</strong> {encaissePar || "—"}
          {credit.venteNumero && (
            <>
              <br />
              <strong>Vente d'origine</strong> {credit.venteNumero}
            </>
          )}
        </div>
      </div>

      <div className="totaux facture-totaux">
        <div>
          Montant réglé : {formaterMontant(paiement.montant)} {devise}
        </div>
        <div>Mode de paiement : {libelleModeReglement(paiement.mode)}</div>
        <div className="total-net">
          Solde restant : {formaterMontant(soldeApresPaiement(credit, paiement.id))} {devise}
        </div>
      </div>
    </div>
  );
}

export default function RecuCredit({
  creditId,
  paiementId,
  session,
  labelRetour = "← Retour",
  onRetour,
}: {
  creditId: string;
  paiementId: string;
  session: Session;
  labelRetour?: string;
  onRetour: () => void;
}) {
  const devise = useDevise();
  const [credit, setCredit] = useState<CreditDetail | null>(null);
  const [boutique, setBoutique] = useState<BoutiqueLocale | null>(null);
  const [clientTelephone, setClientTelephone] = useState<string | null>(null);
  const [formatTicket, setFormatTicket] = useState("a4");
  const [encaissePar, setEncaissePar] = useState("");

  useEffect(() => {
    obtenirCredit(creditId).then((c) => setCredit(c ?? null));
  }, [creditId]);

  useEffect(() => {
    obtenirBoutiqueLocale(session.boutiqueId).then((b) => setBoutique(b ?? null));
    listerParametres(session.boutiqueId).then((parametres) =>
      setFormatTicket(parametres.find((p) => p.cle === "format_ticket")?.valeur || "a4"),
    );
  }, [session.boutiqueId]);

  useEffect(() => {
    if (!credit?.clientId) return;
    obtenirClient(credit.clientId).then((c) => setClientTelephone(c?.telephone || null));
  }, [credit?.clientId]);

  const paiement = credit?.paiements.find((p) => p.id === paiementId);

  useEffect(() => {
    if (!paiement?.utilisateurId) {
      setEncaissePar("");
      return;
    }
    Promise.all([api.comptes.listerUtilisateurs(), api.comptes.listerRoles()]).then(
      ([resultatUtilisateurs, resultatRoles]) => {
        if (!resultatUtilisateurs.succes) return;
        const trouve = resultatUtilisateurs.resultat.find((u) => u.id === Number(paiement.utilisateurId));
        if (!trouve) {
          setEncaissePar("");
          return;
        }
        const nom = `${trouve.first_name} ${trouve.last_name}`.trim() || trouve.username;
        const role = resultatRoles.succes ? resultatRoles.resultat.find((r) => r.id === trouve.role) : undefined;
        setEncaissePar(role ? `${nom} (${role.nom})` : nom);
      },
    );
  }, [paiement?.utilisateurId]);

  function envoyerParWhatsapp() {
    if (!clientTelephone || !credit || !paiement) return;
    const numero = clientTelephone.replace(/\D/g, "");
    const soldeRestant = soldeApresPaiement(credit, paiement.id);
    const message =
      `Bonjour ${credit.clientNom}, nous confirmons la réception de votre règlement de ${formaterMontant(paiement.montant)} ${devise} ` +
      `pour votre crédit chez ${boutique?.nom ?? session.boutiqueNom}. Solde restant : ${formaterMontant(soldeRestant)} ${devise}. Merci !`;
    window.open(`https://wa.me/${numero}?text=${encodeURIComponent(message)}`, "_blank", "noopener");
  }

  if (!credit || !paiement) return <p>Chargement…</p>;

  return (
    <>
      <div className="modale-entete entete-fixe">
        <h3>Reçu de paiement</h3>
        <div className="actions-formulaire">
          {clientTelephone && (
            <button type="button" className="bouton-primaire" onClick={envoyerParWhatsapp}>
              Envoyer par WhatsApp
            </button>
          )}
          <button type="button" className="bouton-primaire" onClick={() => window.print()}>
            Imprimer / PDF
          </button>
          <button type="button" className="lien bouton-retour" onClick={onRetour}>
            {labelRetour}
          </button>
        </div>
      </div>
      <div className="modale-corps">
        <ContenuRecu
          credit={credit}
          paiement={paiement}
          boutique={boutique}
          devise={devise}
          session={session}
          encaissePar={encaissePar}
        />
      </div>

      {createPortal(
        <div className={`zone-impression-facture format-ticket-${formatTicket}`}>
          <ContenuRecu
          credit={credit}
          paiement={paiement}
          boutique={boutique}
          devise={devise}
          session={session}
          encaissePar={encaissePar}
        />
        </div>,
        document.body,
      )}
    </>
  );
}
