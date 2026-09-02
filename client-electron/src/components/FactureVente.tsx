import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

import { api } from "../api/client";
import type { BoutiqueDetail, Session, VenteDetail } from "../api/client";
import { useLogoBoutique } from "../contexts/LogoContext";
import { useDevise } from "../contexts/DeviseContext";
import { formaterMontant } from "../lib/formatage";
import { libelleModePaiement } from "../lib/libelles";

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
  boutique: BoutiqueDetail | null;
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
              <th>Remise</th>
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
                <td>{formaterMontant(l.prixUnitaire)}</td>
                <td>{formaterMontant(l.remise)}</td>
                <td>{formaterMontant(l.sousTotal)}</td>
              </tr>
            ))}
            <tr className="ligne-total-facture">
              <td>
                <strong>Total</strong>
              </td>
              {colonneReference && <td />}
              <td />
              <td>
                <strong>{vente.lignes.reduce((somme, l) => somme + l.quantite, 0)}</strong>
              </td>
              <td>
                <strong>{formaterMontant(vente.lignes.reduce((somme, l) => somme + l.prixUnitaire, 0))}</strong>
              </td>
              <td>
                <strong>{formaterMontant(vente.lignes.reduce((somme, l) => somme + l.remise, 0))}</strong>
              </td>
              <td>
                <strong>{formaterMontant(vente.lignes.reduce((somme, l) => somme + l.sousTotal, 0))}</strong>
              </td>
            </tr>
          </tbody>
        </table>
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
  const logo = useLogoBoutique();
  const [vente, setVente] = useState<VenteDetail | null>(null);
  const [boutique, setBoutique] = useState<BoutiqueDetail | null>(null);
  const [vendeurNom, setVendeurNom] = useState("");
  const [formatTicket, setFormatTicket] = useState("a4");
  const [enExport, setEnExport] = useState(false);
  const [messageExport, setMessageExport] = useState<string | null>(null);

  useEffect(() => {
    api.ventes.obtenir(venteId).then((v) => setVente(v ?? null));
  }, [venteId]);

  useEffect(() => {
    api.reglages.obtenirBoutique(session.boutiqueId).then((b) => setBoutique(b ?? null));
    api.reglages
      .listerParametres(session.boutiqueId)
      .then((parametres) => setFormatTicket(parametres.find((p) => p.cle === "format_ticket")?.valeur || "a4"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.boutiqueId]);

  useEffect(() => {
    if (!vente?.utilisateurId) {
      setVendeurNom("");
      return;
    }
    api.comptes.listerUtilisateurs(session).then((resultat) => {
      if (!resultat.succes) return;
      const trouve = resultat.resultat.find((u) => u.id === Number(vente.utilisateurId));
      setVendeurNom(trouve ? `${trouve.first_name} ${trouve.last_name}`.trim() || trouve.username : "");
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vente?.utilisateurId]);

  async function exporterPdf() {
    if (!vente) return;
    setEnExport(true);
    setMessageExport(null);
    try {
      const resultat = await api.systeme.exporterPdf(`Facture-${vente.numero}.pdf`);
      if (!resultat.succes) {
        setMessageExport(resultat.message);
      } else if (!resultat.resultat.annule) {
        setMessageExport(`Enregistrée : ${resultat.resultat.chemin}`);
      }
    } finally {
      setEnExport(false);
    }
  }

  async function envoyerParWhatsapp() {
    if (!vente?.clientTelephone) return;
    const numero = vente.clientTelephone.replace(/\D/g, "");
    const message =
      `Bonjour ${vente.clientNom ?? ""}, voici votre facture ${vente.numero} de ${boutique?.nom ?? session.boutiqueNom}. ` +
      `Montant total : ${formaterMontant(vente.totalNet)} ${devise}. Merci pour votre achat !`;
    api.systeme.ouvrirExterne(`https://wa.me/${numero}?text=${encodeURIComponent(message)}`);

    // Laisse une trace dans le journal Messages, cohérent avec le rappel de crédit.
    const genere = await api.messages.genererTicketWhatsapp(venteId);
    if (genere.succes) await api.messages.envoyer(genere.resultat);
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
          <button type="button" className="bouton-primaire" onClick={exporterPdf} disabled={enExport}>
            {enExport ? "Export…" : "Exporter en PDF"}
          </button>
          <button type="button" className="bouton-primaire" onClick={() => window.print()}>
            Imprimer
          </button>
          <button type="button" className="lien bouton-retour" onClick={onRetour}>
            {labelRetour}
          </button>
        </div>
      </div>
      {messageExport && <p className="note-aide">{messageExport}</p>}
      <div className="modale-corps">
        <ContenuFacture
          vente={vente}
          boutique={boutique}
          logo={logo}
          vendeurNom={vendeurNom}
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
            vendeurNom={vendeurNom}
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
