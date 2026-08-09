import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

import type { Session } from "../api/auth";
import { useDevise } from "../contexts/DeviseContext";
import { formaterMontant } from "../lib/formatage";
import { libelleModePaiement } from "../lib/libelles";
import { obtenirBoutiqueLocale } from "../services/boutique";
import { obtenirVenteDetail, type VenteDetail } from "../services/ventes";
import type { BoutiqueLocale } from "../db/schema";

/**
 * Port navigateur de client-electron/src/components/FactureVente.tsx.
 * Deux adaptations obligatoires (pas d'équivalent Electron en navigateur) :
 * - "Exporter en PDF" (webContents.printToPDF, API Electron) → repli sur
 *   window.print() ("Imprimer"), le navigateur propose "Enregistrer en PDF"
 *   dans sa boîte de dialogue d'impression.
 * - WhatsApp (shell.openExternal) → window.open(), fonctionne nativement.
 * Pas de logo (client-web n'a pas de LogoContext — hors périmètre ici, comme
 * pour la synchro : les images ne sont jamais synchronisées).
 */

function ContenuFacture({
  vente,
  boutique,
  devise,
  session,
}: {
  vente: VenteDetail;
  boutique: BoutiqueLocale | null;
  devise: string;
  session: Session;
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

      <div className="facture-meta">
        <div>
          <strong>Facture N°</strong> {vente.numero}
          <br />
          <strong>Date</strong> {new Date(vente.dateCreation).toLocaleString("fr-FR")}
        </div>
        <div>
          <strong>Client</strong> {vente.clientNom ?? "Client de passage"}
          <br />
          <strong>Vendu par</strong> {session.username}
        </div>
      </div>

      <div className="zone-tableau-scroll">
        <table className="tableau-catalogue">
          <thead>
            <tr>
              <th>N°</th>
              <th>Référence</th>
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
                <td>{l.reference || ""}</td>
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
              <td />
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
  const [vente, setVente] = useState<VenteDetail | null>(null);
  const [boutique, setBoutique] = useState<BoutiqueLocale | null>(null);

  useEffect(() => {
    obtenirVenteDetail(venteId).then((v) => setVente(v ?? null));
  }, [venteId]);

  useEffect(() => {
    obtenirBoutiqueLocale(session.boutiqueId).then((b) => setBoutique(b ?? null));
  }, [session.boutiqueId]);

  function envoyerParWhatsapp() {
    if (!vente?.clientTelephone) return;
    const numero = vente.clientTelephone.replace(/\D/g, "");
    const message =
      `Bonjour ${vente.clientNom ?? ""}, voici votre facture ${vente.numero} de ${boutique?.nom ?? session.boutiqueNom}. ` +
      `Montant total : ${formaterMontant(vente.totalNet)} ${devise}. Merci pour votre achat !`;
    window.open(`https://wa.me/${numero}?text=${encodeURIComponent(message)}`, "_blank", "noopener");
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
          <button type="button" className="bouton-primaire" onClick={() => window.print()}>
            Imprimer / PDF
          </button>
          <button type="button" className="lien bouton-retour" onClick={onRetour}>
            {labelRetour}
          </button>
        </div>
      </div>
      <div className="modale-corps">
        <ContenuFacture vente={vente} boutique={boutique} devise={devise} session={session} />
      </div>

      {createPortal(
        <div className="zone-impression-facture">
          <ContenuFacture vente={vente} boutique={boutique} devise={devise} session={session} />
        </div>,
        document.body,
      )}
    </>
  );
}
