import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

import type { Session } from "../api/auth";
import { useDevise } from "../contexts/DeviseContext";
import { formaterMontant } from "../lib/formatage";
import { libelleModePaiement } from "../lib/libelles";
import { useLogoBoutique } from "../contexts/LogoContext";
import { useNomsUtilisateurs } from "../hooks/useNomsUtilisateurs";
import { obtenirBoutiqueLocale } from "../services/boutique";
import { envoyerMessage, genererTicketWhatsapp } from "../services/messages";
import { listerParametres } from "../services/configuration";
import { obtenirVenteDetail, type VenteDetail } from "../services/ventes";
import type { BoutiqueLocale } from "../db/schema";
import { imprimer } from "../lib/impression";

/**
 * Port de client-electron/src/components/FactureVente.tsx (logo de l'appareil,
 * nom du vendeur, trace WhatsApp dans Messages). « Exporter en PDF » du bureau
 * (webContents.printToPDF) → « Imprimer / PDF » : la fenêtre d'impression
 * propose « Enregistrer en PDF ».
 */

function ContenuFacture({
  vente,
  boutique,
  logo,
  vendeurNom,
  devise,
  session,
  formatTicket,
}: {
  vente: VenteDetail;
  boutique: BoutiqueLocale | null;
  logo: string;
  vendeurNom: string;
  devise: string;
  session: Session;
  formatTicket: string;
}) {
  // Sur un ticket étroit (80mm/58mm), la référence (SKU) encombre plus
  // qu'elle n'aide — un vrai ticket de caisse ne l'affiche pas.
  const colonneReference = formatTicket === "a4";
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

      <div className="facture-meta">
        <div>
          <strong>Facture N°</strong> {vente.numero}
          <br />
          <strong>Date</strong> {new Date(vente.dateCreation).toLocaleString("fr-FR")}
        </div>
        <div>
          <strong>Client</strong> {vente.clientNom ?? "Client de passage"}
          <br />
          <strong>Vendu par</strong> {vendeurNom || session.username}
        </div>
      </div>

      <div className="zone-tableau-scroll">
        <table className="tableau-catalogue">
          <thead>
            <tr>
              <th>N°</th>
              {colonneReference && <th>Référence</th>}
              <th>Désignation</th>
              <th>Qté</th>
              <th>PU</th>
              <th>Sous-total</th>
            </tr>
          </thead>
          <tbody>
            {vente.lignes.map((l, index) => (
              <tr key={l.id}>
                <td>{index + 1}</td>
                {colonneReference && <td>{l.reference || ""}</td>}
                <td>{l.produitNom}</td>
                <td>{l.quantite}</td>
                <td>
                  {l.prixNormal != null && l.prixNormal > l.prixUnitaire && (
                    <s className="prix-barre">{formaterMontant(l.prixNormal)}</s>
                  )}
                  {formaterMontant(l.prixUnitaire)}
                  {l.prixNormal != null && <div className="mention-destockage">Déstockage</div>}
                </td>
                <td>{formaterMontant(l.sousTotal)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="totaux facture-totaux">
        <div>
          Total brut : {formaterMontant(vente.totalBrut)} {devise}
        </div>
        {vente.remise > 0 && (
          <div>
            Remise : {formaterMontant(vente.remise)} {devise}
          </div>
        )}
        <div className="total-net">
          Total net à payer : {formaterMontant(vente.totalNet)} {devise}
        </div>
      </div>

      <div className="facture-paiements">
        <h3>Paiements</h3>
        <ul className="liste-simple">
          {vente.paiements.map((p) => (
            <li key={p.id}>
              {libelleModePaiement(p.mode)} : {formaterMontant(p.montant)} {devise}
            </li>
          ))}
          {vente.paiements.length === 0 && <li className="liste-vide">Aucun paiement.</li>}
        </ul>
      </div>
    </div>
  );
}

export default function FactureVente({
  venteId,
  session,
  labelRetour = "← Retour",
  onRetour,
}: {
  venteId: string;
  session: Session;
  labelRetour?: string;
  onRetour: () => void;
}) {
  const devise = useDevise();
  const [vente, setVente] = useState<VenteDetail | null>(null);
  const [boutique, setBoutique] = useState<BoutiqueLocale | null>(null);
  const logo = useLogoBoutique();
  const nomUtilisateur = useNomsUtilisateurs(session, { sansVous: true });
  const [formatTicket, setFormatTicket] = useState("a4");

  useEffect(() => {
    obtenirVenteDetail(venteId).then((v) => setVente(v ?? null));
  }, [venteId]);

  useEffect(() => {
    obtenirBoutiqueLocale(session.boutiqueId).then((b) => setBoutique(b ?? null));
    listerParametres(session.boutiqueId).then((parametres) =>
      setFormatTicket(parametres.find((p) => p.cle === "format_ticket")?.valeur || "a4"),
    );
  }, [session.boutiqueId]);

  async function envoyerParWhatsapp() {
    if (!vente?.clientTelephone) return;
    const numero = vente.clientTelephone.replace(/\D/g, "");
    const message =
      `Bonjour ${vente.clientNom ?? ""}, voici votre facture ${vente.numero} de ${boutique?.nom ?? session.boutiqueNom}. ` +
      `Montant total : ${formaterMontant(vente.totalNet)} ${devise}. Merci pour votre achat !`;
    window.open(`https://wa.me/${numero}?text=${encodeURIComponent(message)}`, "_blank", "noopener");

    // Laisse une trace dans le journal Messages, comme le rappel de crédit.
    try {
      await envoyerMessage(await genererTicketWhatsapp(venteId));
    } catch {
      // La trace n'est qu'un plus : WhatsApp est déjà ouvert.
    }
  }

  if (!vente) return <p>Chargement…</p>;

  return (
    <>
      <div className="modale-entete entete-fixe">
        <h3>Facture {vente.numero}</h3>
        <div className="actions-formulaire">
          {vente.clientTelephone && (
            <button type="button" className="bouton-primaire" onClick={envoyerParWhatsapp}>
              Envoyer par WhatsApp
            </button>
          )}
          <button type="button" className="bouton-primaire" onClick={() => void imprimer(vente ? `Facture-${vente.numero}` : "Facture")}>
            Imprimer / PDF
          </button>
          <button type="button" className="lien bouton-retour" onClick={onRetour}>
            {labelRetour}
          </button>
        </div>
      </div>
      <div className="modale-corps">
        <ContenuFacture
          vente={vente}
          boutique={boutique}
          logo={logo}
          vendeurNom={vente.utilisateurId ? nomUtilisateur(vente.utilisateurId) : ""}
          devise={devise}
          session={session}
          formatTicket={formatTicket}
        />
      </div>

      {createPortal(
        <div className={`zone-impression-facture format-ticket-${formatTicket}`}>
          <ContenuFacture
          vente={vente}
          boutique={boutique}
          logo={logo}
          vendeurNom={vente.utilisateurId ? nomUtilisateur(vente.utilisateurId) : ""}
          devise={devise}
          session={session}
          formatTicket={formatTicket}
        />
        </div>,
        document.body,
      )}
    </>
  );
}
